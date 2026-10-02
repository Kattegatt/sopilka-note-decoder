import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { Project } from "./domain";
import { withProjectDefaults } from "./project";
import type { ProjectOperation, RemoteProject } from "../shared/sync";

export const GUEST = "guest";
export interface CachedAccount { id: string; login: string }
export interface LocalProject { owner: string; id: string; project: Project }
export interface PendingOperation extends ProjectOperation { owner: string; queueId?: number }
interface SopilkaDatabase extends DBSchema {
  projects: { key: string; value: Project; indexes: { "by-updated": string } };
  records: { key: [string, string]; value: LocalProject; indexes: { "by-owner": string } };
  outbox: { key: number; value: PendingOperation; indexes: { "by-owner": string; "by-project": [string, string] } };
  metadata: { key: string; value: unknown };
}

type ChangeKind = "content" | "account";
export class LocalStore {
  private database: Promise<IDBPDatabase<SopilkaDatabase>>;
  private listeners = new Set<(kind: ChangeKind) => void>();
  private channel?: BroadcastChannel;

  constructor(name = "sopilka-projects", broadcast = true) {
    this.database = openDB<SopilkaDatabase>(name, 2, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        const records = db.createObjectStore("records", { keyPath: ["owner", "id"] });
        records.createIndex("by-owner", "owner");
        const outbox = db.createObjectStore("outbox", { autoIncrement: true, keyPath: "queueId" });
        outbox.createIndex("by-owner", "owner");
        outbox.createIndex("by-project", ["owner", "id"]);
        db.createObjectStore("metadata");
        if (db.objectStoreNames.contains("projects")) {
          // Copy in the same upgrade transaction; retain the legacy store for safe migration.
          void (async () => {
            let cursor = await transaction.objectStore("projects").openCursor();
            while (cursor) {
              const project = withProjectDefaults(cursor.value);
              await records.put({ owner: GUEST, id: project.id, project });
              cursor = await cursor.continue();
            }
          })().catch(() => transaction.abort());
        }
      },
      blocking: () => { void this.database.then((db) => db.close()); },
    });
    if (broadcast && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`${name}-changes`);
      this.channel.onmessage = (event) => {
        if (event.data === "content" || event.data === "account") this.emit(event.data, false);
      };
    }
  }

  subscribe(listener: (kind: ChangeKind) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(kind: ChangeKind, broadcast = true) {
    for (const listener of this.listeners) listener(kind);
    if (broadcast) this.channel?.postMessage(kind);
  }

  async logoutPending() { return Boolean(await (await this.database).get("metadata", "logoutPending")); }
  async setLogoutPending(value: boolean) { await (await this.database).put("metadata", value, "logoutPending"); }

  async account(): Promise<CachedAccount | null> {
    const account = await (await this.database).get("metadata", "account") as (CachedAccount & { email?: string }) | undefined;
    return account ? { id: account.id, login: account.login ?? account.email ?? "" } : null;
  }

  async setAccount(account: CachedAccount | null) {
    await (await this.database).put("metadata", account, "account");
    this.emit("account");
  }

  async list(owner: string): Promise<Project[]> {
    const records = await (await this.database).getAllFromIndex("records", "by-owner", owner);
    return records.map((record) => withProjectDefaults(record.project))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(owner: string, id: string) {
    const record = await (await this.database).get("records", [owner, id]);
    return record ? withProjectDefaults(record.project) : undefined;
  }

  async save(owner: string, project: Project, dirty = true) {
    const db = await this.database;
    const tx = db.transaction(["records", "outbox"], "readwrite");
    const previous = await tx.objectStore("records").get([owner, project.id]);
    if (!dirty && !previous) { await tx.done; return; }
    await tx.objectStore("records").put({ owner, id: project.id, project });
    if (owner !== GUEST && dirty) await this.enqueue(tx, owner, project.id, project);
    await tx.done;
    this.emit("content");
  }

  private async enqueue(tx: IDBPTransaction<SopilkaDatabase, ["records", "outbox"], "readwrite">,
    owner: string, id: string, project: Project | null) {
    const outbox = tx.objectStore("outbox");
    const keys = await outbox.index("by-project").getAllKeys([owner, id]);
    for (const key of keys) await outbox.delete(key);
    await outbox.add({ owner, id, project, operationId: crypto.randomUUID() });
  }

  async remove(owner: string, id: string) {
    const db = await this.database;
    const tx = db.transaction(["records", "outbox"], "readwrite");
    await tx.objectStore("records").delete([owner, id]);
    if (owner !== GUEST) await this.enqueue(tx, owner, id, null);
    await tx.done;
    this.emit("content");
  }

  async importGuests(owner: string) {
    if (owner === GUEST) return;
    const db = await this.database;
    const tx = db.transaction(["records", "outbox"], "readwrite");
    const records = tx.objectStore("records");
    const guests = await records.index("by-owner").getAll(GUEST);
    for (const record of guests) {
      await records.put({ ...record, owner });
      await this.enqueue(tx, owner, record.id, record.project);
      await records.delete([GUEST, record.id]);
    }
    await tx.done;
    this.emit("content");
  }

  async pending(owner: string) {
    return (await this.database).getAllFromIndex("outbox", "by-owner", owner);
  }

  async acknowledge(operation: PendingOperation) {
    if (operation.queueId === undefined) return;
    const db = await this.database;
    const tx = db.transaction("outbox", "readwrite");
    const current = await tx.store.get(operation.queueId);
    if (current?.operationId === operation.operationId) await tx.store.delete(operation.queueId);
    await tx.done;
  }

  async cursor(owner: string) {
    return (await (await this.database).get("metadata", `cursor:${owner}`) as number | undefined) ?? 0;
  }

  async receive(owner: string, changes: RemoteProject[], cursor: number) {
    const db = await this.database;
    const tx = db.transaction(["records", "outbox", "metadata"], "readwrite");
    for (const change of changes) {
      const pending = await tx.objectStore("outbox").index("by-project").getKey([owner, change.id]);
      if (pending !== undefined) continue;
      if (change.project) {
        await tx.objectStore("records").put({ owner, id: change.id, project: withProjectDefaults(change.project) });
      } else await tx.objectStore("records").delete([owner, change.id]);
    }
    await tx.objectStore("metadata").put(cursor, `cursor:${owner}`);
    await tx.done;
    if (changes.length) this.emit("content");
  }

  async close() {
    this.channel?.close();
    (await this.database).close();
  }
}

let store: LocalStore | undefined;
export function getLocalStore() { return store ??= new LocalStore(); }
