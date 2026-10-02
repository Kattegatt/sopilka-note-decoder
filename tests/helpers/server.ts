import { createServer } from "../../server/app";
import type { AuthMail } from "../../server/auth";

export async function fixture() {
  const mails: AuthMail[] = [];
  const app = await createServer({ databasePath: ":memory:", baseURL: "http://localhost:3000",
    secret: "test-only-32-character-secret-for-sopilka", sendMail: async (mail) => { mails.push(mail); } });
  const headers = { origin: "http://localhost:3000" };
  async function register(email = "music@example.com", password = "strong-password-123") {
    const result = await app.inject({ method: "POST", url: "/api/auth/sign-up/email", headers,
      payload: { email, password, name: "Music", callbackURL: "/" } });
    if (result.statusCode !== 200) throw new Error(result.body);
    return result;
  }
  async function verify(email = "music@example.com") {
    const mail = mails.findLast((mail) => mail.to === email && mail.kind === "verification");
    if (!mail) throw new Error("No verification email");
    const url = new URL(mail.url);
    const result = await app.inject({ url: `${url.pathname}${url.search}`, headers });
    if (result.statusCode !== 302) throw new Error(result.body);
    const cookies = result.headers["set-cookie"];
    return (Array.isArray(cookies) ? cookies : [cookies ?? ""]).map((cookie) => cookie.split(";")[0]).join("; ");
  }
  async function login(email = "music@example.com", password = "strong-password-123") {
    const result = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers, payload: { email, password } });
    if (result.statusCode !== 200) throw new Error(result.body);
    const cookies = result.headers["set-cookie"];
    return (Array.isArray(cookies) ? cookies : [cookies ?? ""]).map((cookie) => cookie.split(";")[0]).join("; ");
  }
  return { app, mails, headers, register, verify, login };
}
