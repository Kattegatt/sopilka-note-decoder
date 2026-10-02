import { betterAuth, type BetterAuthOptions } from "better-auth";
import Database from "better-sqlite3";
import { getMigrations } from "better-auth/db/migration";

export interface AuthMail {
  to: string;
  url: string;
  kind: "verification" | "reset";
}

export async function createAuth(db: Database.Database, baseURL: string, secret: string,
  sendMail: (mail: AuthMail) => Promise<void>) {
  const options = {
    database: db,
    baseURL,
    secret,
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => sendMail({ to: user.email, url, kind: "reset" }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendMail({ to: user.email, url, kind: "verification" }),
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    advanced: {
      useSecureCookies: new URL(baseURL).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
  } satisfies BetterAuthOptions;
  const migration = await getMigrations(options);
  await migration.runMigrations();
  const auth = betterAuth(options);
  await auth.$context;
  return auth;
}
