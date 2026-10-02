import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import nodemailer from "nodemailer";
import { createServer } from "./app.js";

const production = process.env.NODE_ENV === "production";
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const secret = process.env.BETTER_AUTH_SECRET;
if (production && (!secret || secret.length < 32 || !process.env.SMTP_HOST || !process.env.SMTP_FROM ||
    !baseURL.startsWith("https://"))) {
  throw new Error("Configure HTTPS BETTER_AUTH_URL, BETTER_AUTH_SECRET (32+ characters), SMTP_HOST and SMTP_FROM.");
}
const databasePath = resolve(process.env.DATABASE_PATH ?? "data/sopilka.sqlite");
await mkdir(dirname(databasePath), { recursive: true });
const transport = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  requireTLS: production && process.env.SMTP_SECURE !== "true",
  ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
}) : null;
const app = await createServer({
  databasePath,
  baseURL,
  secret: secret ?? "sopilka-development-only-secret-do-not-use-in-production",
  staticRoot: production ? resolve("dist") : undefined,
  logger: true,
  async sendMail(mail) {
    if (!transport) {
      // Development only; production refuses to start without SMTP.
      console.info(`[local mail] ${mail.kind} ${mail.to}: ${mail.url}`);
      return;
    }
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: mail.to,
      subject: mail.kind === "verification" ? "Сопілка: підтвердження email" : "Сопілка: відновлення пароля",
      text: `${mail.kind === "verification" ? "Підтвердіть свою пошту" : "Встановіть новий пароль"}:\n\n${mail.url}\n\nЯкщо ви не надсилали цей запит, проігноруйте лист.`,
    });
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? (production ? 8080 : 3001)) });
