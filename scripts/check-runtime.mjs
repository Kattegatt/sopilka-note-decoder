import { createServer } from "../build/server/app.js";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const directory = await mkdtemp(join(tmpdir(), "sopilka-runtime-"));
const databasePath = join(directory, "runtime.sqlite");
const app = await createServer({ databasePath, baseURL: "https://sopilka.example",
  secret: "runtime-test-secret-at-least-32-characters", staticRoot: resolve("dist") });
try {
  assert.equal((await app.inject("/api/health")).statusCode, 200);
  const index = await app.inject({ url: "/", headers: { accept: "text/html" } });
  assert.equal(index.statusCode, 200); assert.match(index.body, /id="root"/);
  assert.equal((await app.inject({ url: "/api/missing", headers: { accept: "text/html" } })).statusCode, 404);
  assert.equal((await app.inject("/assets/missing.js")).statusCode, 404);
  assert.equal((await app.inject("/sw.js")).headers["cache-control"], "no-cache");
  const manifest = (await app.inject("/offline-assets.json")).json();
  for (const asset of manifest) assert.equal((await app.inject("/" + asset)).statusCode, 200);
  const backup = spawnSync(process.execPath, ["scripts/backup.mjs"], {
    encoding: "utf8", env: { ...process.env, DATABASE_PATH: databasePath, BACKUP_DIR: join(directory, "backups") },
  });
  assert.equal(backup.status, 0, backup.stderr);
  const [file] = await readdir(join(directory, "backups"));
  const restored = new Database(join(directory, "backups", file), { readonly: true });
  assert.deepEqual(restored.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  restored.close();
  console.info("Runtime: health, static assets, API isolation and SQLite backup integrity passed.");
} finally {
  await app.close(); await rm(directory, { recursive: true, force: true });
}
