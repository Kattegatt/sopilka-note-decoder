import Database from "better-sqlite3";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const directory = resolve(process.env.BACKUP_DIR ?? "/data/backups");
await mkdir(directory, { recursive: true });
const db = new Database(process.env.DATABASE_PATH ?? "/data/sopilka.sqlite", { readonly: true });
const output = resolve(directory, `sopilka-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
try {
  await db.backup(output);
  console.info(output);
} finally { db.close(); }
