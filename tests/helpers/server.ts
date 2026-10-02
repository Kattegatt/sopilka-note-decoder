import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createServer } from "../../server/app";

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sopilka-auth-test-"));
  const databasePath = join(directory, "test.sqlite");
  const app = await createServer({ databasePath, baseURL: "http://localhost:3000",
    secret: "test-only-32-character-secret-for-sopilka" });
  const headers = { origin: "http://localhost:3000" };
  function cookies(result: { headers: Record<string, unknown> }) {
    const values = result.headers["set-cookie"];
    return (Array.isArray(values) ? values : [values ?? ""]).map((cookie) => String(cookie).split(";")[0]).join("; ");
  }
  async function register(login = "music", password = "strong-password-123") {
    const result = await app.inject({ method: "POST", url: "/api/auth/register", headers, payload: { login, password } });
    if (result.statusCode !== 200) throw new Error(result.body);
    return cookies(result);
  }
  async function login(username = "music", password = "strong-password-123") {
    const result = await app.inject({ method: "POST", url: "/api/auth/login", headers, payload: { login: username, password } });
    if (result.statusCode !== 200) throw new Error(result.body);
    return cookies(result);
  }
  function passwordHash(username: string) {
    const db = new Database(databasePath, { readonly: true });
    try {
      return (db.prepare("SELECT a.password FROM account a JOIN user u ON a.userId = u.id WHERE u.username = ?")
        .get(username) as { password: string }).password;
    } finally { db.close(); }
  }
  async function close() { await app.close(); await rm(directory, { recursive: true, force: true }); }
  return { app, headers, register, login, passwordHash, close };
}
