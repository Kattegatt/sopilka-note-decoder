import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "./helpers/server";
import { createProject } from "../app/project";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.close(); });

describe("login and password authentication without email", () => {
  it("signs up immediately, stores a password hash and revokes logout sessions", async () => {
    const cookie = await f.register();
    const hash = f.passwordHash("music");
    expect(hash).not.toBe("strong-password-123");
    expect(hash).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
    const session = await f.app.inject({ url: "/api/auth/get-session", headers: { cookie } });
    expect(session.json().user.username).toBe("music");
    expect(session.json().user.emailVerified).toBe(false);
    expect(session.headers["cache-control"]).toBe("no-store");
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie } })).statusCode).toBe(200);
    await expect(f.login("MUSIC")).resolves.toBeTruthy();
    await expect(f.login("music", "wrong-password")).rejects.toThrow();
    const logout = await f.app.inject({ method: "POST", url: "/api/auth/sign-out", headers: { ...f.headers, cookie }, payload: {} });
    expect(logout.statusCode).toBe(200);
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie } })).statusCode).toBe(401);
  });

  it("validates logins and rejects duplicates without exposing email endpoints", async () => {
    for (const login of ["ab", "user@example.com", "Козак", "long".repeat(10)]) {
      const result = await f.app.inject({ method: "POST", url: "/api/auth/register", headers: f.headers,
        payload: { login, password: "strong-password-123" } });
      expect(result.statusCode).toBe(400);
    }
    const weak = await f.app.inject({ method: "POST", url: "/api/auth/register", headers: f.headers,
      payload: { login: "music", password: "short" } });
    expect(weak.statusCode).toBe(400);
    await f.register("Music");
    await expect(f.register("music")).rejects.toThrow();
    await expect(f.register("user..name")).resolves.toBeTruthy();
    for (const path of ["sign-up/email", "sign-in/email", "send-verification-email", "request-password-reset", "reset-password"]) {
      const result = await f.app.inject({ method: "POST", url: `/api/auth/${path}`, headers: f.headers, payload: {} });
      expect(result.statusCode).toBe(404);
    }
  });

  it("rejects foreign origins and reports no store on errors", async () => {
    const result = await f.app.inject({ method: "POST", url: "/api/auth/register", headers: { origin: "https://evil.example" },
      payload: { login: "music", password: "strong-password-123" } });
    expect(result.statusCode).toBe(403);
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});

describe("private project API", () => {
  it("isolates users and orders last writes by server revisions rather than device clocks", async () => {
    const a = await f.register("account_a");
    const b = await f.register("account_b");
    const project = createProject("First");
    const put = (cookie: string, title: string, updatedAt: string, operationId = crypto.randomUUID()) => f.app.inject({
      method: "PUT", url: `/api/projects/${project.id}`, headers: { ...f.headers, cookie },
      payload: { id: project.id, operationId, project: { ...project, title, updatedAt } },
    });
    const firstOp = crypto.randomUUID();
    const first = await put(a, "First", "2099-01-01T00:00:00.000Z", firstOp);
    expect(first.statusCode).toBe(200);
    const second = await put(a, "Second", "2000-01-01T00:00:00.000Z");
    expect(second.json().revision).toBeGreaterThan(first.json().revision);
    await put(a, "First", "2099-01-01T00:00:00.000Z", firstOp);
    const records = (await f.app.inject({ url: "/api/projects", headers: { cookie: a } })).json();
    expect(records.changes).toHaveLength(1);
    expect(records.changes[0].project.title).toBe("Second");
    expect(records.changes[0].project.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie: b } })).json().changes).toEqual([]);
    await put(b, "B's independent project", project.updatedAt);
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie: a } })).json().changes[0].project.title).toBe("Second");
  });

  it("synchronizes tombstones, validates payloads and paginates", async () => {
    const cookie = await f.register();
    const headers = { ...f.headers, cookie };
    const project = createProject();
    const invalid = await f.app.inject({ method: "PUT", url: `/api/projects/${project.id}`, headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project: { ...project, sound: { breath: 999 } } } });
    expect(invalid.statusCode).toBe(400);
    const mismatch = await f.app.inject({ method: "PUT", url: "/api/projects/other-id", headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project } });
    expect(mismatch.statusCode).toBe(400);
    const put = await f.app.inject({ method: "PUT", url: `/api/projects/${project.id}`, headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project } });
    expect(put.statusCode).toBe(200);
    const another = createProject();
    await f.app.inject({ method: "PUT", url: `/api/projects/${another.id}`, headers,
      payload: { id: another.id, operationId: crypto.randomUUID(), project: another } });
    const page = (await f.app.inject({ url: "/api/projects?limit=1", headers })).json();
    expect(page.changes).toHaveLength(1); expect(page.hasMore).toBe(true);
    const removed = await f.app.inject({ method: "DELETE", url: `/api/projects/${project.id}`, headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project: null } });
    expect(removed.statusCode).toBe(200);
    const changes = (await f.app.inject({ url: `/api/projects?after=${put.json().revision}`, headers })).json().changes;
    expect(changes.find((change: { id: string }) => change.id === project.id).project).toBeNull();
    expect((await f.app.inject({ url: "/api/projects?after=-1", headers })).statusCode).toBe(400);
    expect((await f.app.inject({ url: "/api/projects" })).statusCode).toBe(401);
    expect((await f.app.inject({ url: "/api/unknown" })).statusCode).toBe(404);
  });
});

it("limits auth requests and keeps rate-limit responses private", async () => {
  let status = 200;
  for (let i = 0; i < 32; i++) {
    const result = await f.app.inject({ url: "/api/auth/get-session", headers: f.headers });
    status = result.statusCode;
    expect(result.headers["cache-control"]).toBe("no-store");
  }
  expect(status).toBe(429);
});
