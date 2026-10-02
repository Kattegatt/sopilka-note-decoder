import Fastify from "fastify";
import staticFiles from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import Database from "better-sqlite3";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { createAuth } from "./auth.js";
import { migrateProjects, ProjectRepository } from "./database.js";
import { credentialsSchema, registrationSchema } from "../shared/auth.js";
import { operationSchema } from "../shared/sync.js";

export interface ServerOptions {
  databasePath: string;
  baseURL: string;
  secret: string;
  staticRoot?: string;
  logger?: boolean;
}

export async function createServer(options: ServerOptions) {
  const db = new Database(options.databasePath);
  const app = Fastify({
    logger: options.logger ? {
      serializers: {
        req(request) {
          const path = request.url?.split("?")[0] ?? "";
          return { method: request.method, url: path.startsWith("/api/auth/") ? "/api/auth/[redacted]" : path };
        },
      },
    } : false,
    bodyLimit: 32 * 1024 * 1024,
    // Production has exactly one trusted ingress hop (Traefik), with no published container port.
    trustProxy: (_address, hop) => hop === 0,
  });
  app.addHook("onClose", async () => { db.close(); });
  try {
    const auth = await createAuth(db, options.baseURL, options.secret);
    migrateProjects(db);
    const projects = new ProjectRepository(db);
    await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/api/")) return;
      reply.header("Cache-Control", "no-store");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
          request.headers.origin !== new URL(options.baseURL).origin) {
        return reply.code(403).send({ error: "Недозволене джерело запиту." });
      }
    });
    app.addHook("onSend", async (request, reply, payload) => {
      if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
      return payload;
    });
    app.get("/api/health", async () => {
      db.prepare("SELECT 1").get();
      return { status: "ok" };
    });
    app.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      bodyLimit: 16 * 1024,
      async handler(request, reply) {
        const url = new URL(request.url, options.baseURL);
        let body = request.body;
        if (url.pathname === "/api/auth/register" || url.pathname === "/api/auth/login") {
          const registration = url.pathname.endsWith("register");
          if (request.method !== "POST") return reply.code(405).send({ error: "Недозволений метод." });
          const credentials = (registration ? registrationSchema : credentialsSchema).safeParse(body);
          if (!credentials.success) return reply.code(400).send({
            error: "Логін: 3–30 латинських літер, цифр, крапок, дефісів або підкреслень. Пароль: 8–128 символів.",
          });
          const { login, password } = credentials.data;
          url.pathname = registration ? "/api/auth/sign-up/email" : "/api/auth/sign-in/username";
          // Better Auth requires an email column. This reserved, deterministic identifier is never used for mail.
          body = registration ? {
            name: login, username: login, password,
            email: `${Buffer.from(login).toString("hex")}@accounts.sopilka.invalid`,
          } : { username: login, password, rememberMe: true };
        } else if (!["/api/auth/get-session", "/api/auth/sign-out"].includes(url.pathname)) {
          // Only expose the password/login flow; email, verification and reset endpoints are unavailable.
          return reply.code(404).send({ error: "Не знайдено." });
        }
        const response = await auth.handler(new Request(url, {
          method: request.method,
          headers: fromNodeHeaders({ ...request.headers, "x-forwarded-for": request.ip }),
          ...(body ? { body: JSON.stringify(body) } : {}),
        }));
        reply.code(response.status);
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header("set-cookie", cookies);
        reply.header("Cache-Control", "no-store");
        return reply.send(await response.text());
      },
    });
    await app.register(async (protectedApp) => {
      protectedApp.decorateRequest("ownerId", "");
      protectedApp.addHook("preHandler", async (request, reply) => {
        // Disable the cookie session cache: revocation must take effect immediately.
        const session = await auth.api.getSession({
          headers: fromNodeHeaders({ ...request.headers, "x-forwarded-for": request.ip }), query: { disableCookieCache: true },
        });
        if (!session) return reply.code(401).send({ error: "Потрібен вхід." });
        request.ownerId = session.user.id;
      });
      protectedApp.get("/api/projects", async (request, reply) => {
        const query = z.object({
          after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
          limit: z.coerce.number().int().min(1).max(25).default(10),
        }).safeParse(request.query);
        if (!query.success) return reply.code(400).send({ error: "Некоректний курсор." });
        return projects.changes(request.ownerId, query.data.after, query.data.limit);
      });
      protectedApp.put("/api/projects/:id", async (request, reply) => {
        const operation = operationSchema.safeParse(request.body);
        const { id } = request.params as { id: string };
        if (!operation.success || operation.data.id !== id || !operation.data.project) {
          return reply.code(400).send({ error: "Некоректні дані проєкту." });
        }
        return projects.apply(request.ownerId, operation.data);
      });
      protectedApp.delete("/api/projects/:id", async (request, reply) => {
        const operation = operationSchema.safeParse(request.body);
        const { id } = request.params as { id: string };
        if (!operation.success || operation.data.id !== id || operation.data.project !== null) {
          return reply.code(400).send({ error: "Некоректні дані видалення." });
        }
        return projects.apply(request.ownerId, operation.data);
      });
    });
    if (options.staticRoot) {
      await app.register(staticFiles, {
        root: options.staticRoot,
        setHeaders(response, path) {
          response.header("Cache-Control", path.endsWith("index.html") || path.endsWith("sw.js")
            ? "no-cache" : path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
        },
      });
    }
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || !options.staticRoot || request.method !== "GET" ||
          !request.headers.accept?.includes("text/html")) {
        return reply.code(404).send({ error: "Не знайдено." });
      }
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

declare module "fastify" {
  interface FastifyRequest { ownerId: string }
}
