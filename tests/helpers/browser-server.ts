import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../../server/app";

const directory = await mkdtemp(join(tmpdir(), "sopilka-e2e-"));
const app = await createServer({ databasePath: join(directory, "test.sqlite"),
  baseURL: "http://127.0.0.1:4173", secret: "browser-test-secret-at-least-32-characters",
  staticRoot: resolve("dist") });
await app.listen({ port: 4173, host: "127.0.0.1" });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void app.close().then(() => rm(directory, { recursive: true, force: true })).then(() => process.exit(0));
});
