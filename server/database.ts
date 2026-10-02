import Database from "better-sqlite3";
import type { ProjectOperation, RemoteProject, ProjectChanges } from "../shared/sync.js";

export function migrateProjects(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_operations (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      UNIQUE(owner_id, operation_id)
    );
    CREATE TABLE IF NOT EXISTS project_records (
      owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      payload TEXT,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id, id)
    );
    CREATE INDEX IF NOT EXISTS projects_by_owner_revision ON project_records(owner_id, revision);
  `);
}

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  apply(owner: string, operation: ProjectOperation): { revision: number } {
    return this.db.transaction(() => {
      const previous = this.db.prepare(
        "SELECT revision FROM project_operations WHERE owner_id = ? AND operation_id = ?",
      ).get(owner, operation.operationId) as { revision: number } | undefined;
      if (previous) return previous;
      const insertion = this.db.prepare(
        "INSERT INTO project_operations(owner_id, operation_id, project_id) VALUES (?, ?, ?)",
      ).run(owner, operation.operationId, operation.id);
      const revision = Number(insertion.lastInsertRowid);
      const updatedAt = new Date().toISOString();
      const payload = operation.project ? JSON.stringify({ ...operation.project, updatedAt }) : null;
      this.db.prepare(`
        INSERT INTO project_records(owner_id, id, payload, revision, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, id) DO UPDATE SET payload=excluded.payload,
          revision=excluded.revision, updated_at=excluded.updated_at
      `).run(owner, operation.id, payload, revision, updatedAt);
      return { revision };
    })();
  }

  changes(owner: string, after: number, limit = 10): ProjectChanges {
    const rows = this.db.prepare(`
      SELECT id, payload, revision, updated_at FROM project_records
      WHERE owner_id = ? AND revision > ? ORDER BY revision LIMIT ?
    `).all(owner, after, limit + 1) as Array<{
      id: string; payload: string | null; revision: number; updated_at: string;
    }>;
    const changes: RemoteProject[] = rows.slice(0, limit).map((row) => ({
      id: row.id,
      project: row.payload === null ? null : JSON.parse(row.payload),
      revision: row.revision,
      updatedAt: row.updated_at,
    }));
    return { changes, cursor: changes.at(-1)?.revision ?? after, hasMore: rows.length > limit };
  }
}
