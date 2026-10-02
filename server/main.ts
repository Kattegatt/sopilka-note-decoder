import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "./app.js";

const production = process.env.NODE_ENV === "production";
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const secret = process.env.BETTER_AUTH_SECRET;
if (production && (!secret || secret.length < 32 ||
    !baseURL.startsWith("https://"))) {
  throw new Error("Configure HTTPS BETTER_AUTH_URL, BETTER_AUTH_SECRET (32+ characters).");
}
const databasePath = resolve(process.env.DATABASE_PATH ?? "data/sopilka.sqlite");
await mkdir(dirname(databasePath), { recursive: true });
const app = await createServer({
  databasePath,
  baseURL,
  secret: secret ?? "sopilka-development-only-secret-do-not-use-in-production",
  staticRoot: production ? resolve("dist") : undefined,
  logger: true,
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? (production ? 8080 : 3001)) });
