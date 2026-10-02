import { betterAuth, type BetterAuthOptions } from "better-auth";
import Database from "better-sqlite3";
import { username } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";

export async function createAuth(db: Database.Database, baseURL: string, secret: string) {
  const options = {
    database: db,
    baseURL,
    secret,
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    plugins: [username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => /^[a-zA-Z0-9_.-]+$/.test(value),
      immutableUsername: true,
      displayUsername: false,
    })],
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
