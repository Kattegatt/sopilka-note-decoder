import { openDB, type DBSchema } from "idb";
import type { Project } from "./domain";
import { withProjectDefaults } from "./project";

interface SopilkaDatabase extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { "by-updated": string };
  };
}

const database = typeof window === "undefined" ? null : openDB<SopilkaDatabase>("sopilka-projects", 1, {
  upgrade(db) {
    const store = db.createObjectStore("projects", { keyPath: "id" });
    store.createIndex("by-updated", "updatedAt");
  },
});

export async function listProjects() {
  if (!database) return [];
  const db = await database;
  return (await db.getAllFromIndex("projects", "by-updated")).reverse().map(withProjectDefaults);
}

export async function loadProject(id: string) {
  if (!database) return undefined;
  const project = await (await database).get("projects", id);
  return project ? withProjectDefaults(project) : undefined;
}

export async function saveProject(project: Project) {
  if (!database) return;
  await (await database).put("projects", project);
}

export async function deleteProject(id: string) {
  if (!database) return;
  await (await database).delete("projects", id);
}
