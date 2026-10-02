import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import { GUEST, LocalStore } from "../app/storage";
import { createProject } from "../app/project";
import { ProjectSync, SyncError } from "../app/sync";
import type { ProjectChanges, ProjectOperation, RemoteProject } from "../shared/sync";

const stores: LocalStore[] = [];
function device(name = crypto.randomUUID()) {
  const store = new LocalStore(name, false);
  stores.push(store); return store;
}
afterEach(async () => { await Promise.all(stores.splice(0).map((store) => store.close())); });

function cloud() {
  const projects = new Map<string, RemoteProject>();
  const operations = new Map<string, number>();
  let revision = 0;
  const transport = async (path: string, init?: RequestInit): Promise<ProjectChanges | { revision: number }> => {
    if (init?.method === "PUT" || init?.method === "DELETE") {
      const operation: ProjectOperation = JSON.parse(String(init.body));
      if (operations.has(operation.operationId)) return { revision: operations.get(operation.operationId)! };
      revision++;
      operations.set(operation.operationId, revision);
      projects.set(operation.id, { id: operation.id, project: operation.project, revision, updatedAt: new Date().toISOString() });
      return { revision };
    }
    const after = Number(new URL(path, "http://localhost").searchParams.get("after"));
    const changes = [...projects.values()].filter((record) => record.revision > after).sort((a, b) => a.revision - b.revision);
    return { changes, cursor: changes.at(-1)?.revision ?? after, hasMore: false };
  };
  return { transport, projects };
}

describe("local-first storage", () => {
  it("migrates legacy projects and imports guests atomically only once", async () => {
    const name = crypto.randomUUID();
    const project = createProject("Legacy");
    const legacy = await openDB(name, 1, { upgrade(db) {
      const store = db.createObjectStore("projects", { keyPath: "id" });
      store.createIndex("by-updated", "updatedAt");
    } });
    await legacy.put("projects", project); legacy.close();
    const store = device(name);
    expect((await store.list(GUEST))[0]).toEqual(project);
    await store.importGuests("a"); await store.importGuests("a");
    expect(await store.list(GUEST)).toEqual([]);
    expect(await store.list("a")).toHaveLength(1);
    expect(await store.pending("a")).toHaveLength(1);
    await store.importGuests("b");
    expect(await store.list("b")).toEqual([]);
    expect(await store.pending("b")).toEqual([]);
  });

  it("retains local data, account identity and queue across reload, including failed logout", async () => {
    const name = crypto.randomUUID();
    const first = device(name); const project = createProject();
    await first.setAccount({ id: "a", login: "account_a" });
    await first.save("a", project); await first.close(); stores.splice(stores.indexOf(first), 1);
    const reloaded = device(name);
    expect((await reloaded.account())?.id).toBe("a");
    expect(await reloaded.list("a")).toHaveLength(1);
    expect(await reloaded.pending("a")).toHaveLength(1);
    await reloaded.setLogoutPending(true); await reloaded.setAccount(null);
    expect(await reloaded.logoutPending()).toBe(true);
    expect(await reloaded.account()).toBeNull();
    expect(await reloaded.list("a")).toHaveLength(1);
    expect(await reloaded.list(GUEST)).toEqual([]);
  });

  it("does not enqueue cache normalization or resurrect deleted projects", async () => {
    const store = device(); const project = createProject();
    await store.save("a", project);
    const pending = (await store.pending("a"))[0]; await store.acknowledge(pending);
    await store.save("a", { ...project, normalizedMei: "<mei/>" }, false);
    expect(await store.pending("a")).toEqual([]);
    await store.remove("a", project.id);
    await store.save("a", project, false);
    expect(await store.list("a")).toEqual([]);
    expect((await store.pending("a"))[0].project).toBeNull();
  });
});

describe("device synchronization", () => {
  it("transfers complete projects, preserves last accepted edits and propagates deletion", async () => {
    const a = device(), b = device(); const server = cloud(); const project = createProject();
    const syncA = new ProjectSync(a, "user", () => {}, server.transport);
    const syncB = new ProjectSync(b, "user", () => {}, server.transport);
    await a.save("user", project); await syncA.run(); await syncB.run();
    expect(await b.load("user", project.id)).toEqual(project);
    await b.save("user", { ...project, title: "Offline B", tempoPercent: 75 });
    await a.save("user", { ...project, title: "Online A" }); await syncA.run();
    await syncB.run(); await syncA.run();
    expect((await a.load("user", project.id))?.title).toBe("Offline B");
    expect((await a.load("user", project.id))?.tempoPercent).toBe(75);
    await b.remove("user", project.id); await syncB.run(); await syncA.run();
    expect(await a.load("user", project.id)).toBeUndefined();
  });

  it("retries a lost response without overwriting a subsequent server edit", async () => {
    const a = device(), b = device(); const server = cloud(); const project = createProject();
    let fail = true;
    const syncA = new ProjectSync(a, "user", () => {}, async (path, init) => {
      const result = await server.transport(path, init);
      if (fail && init?.method === "PUT") { fail = false; throw new TypeError("Lost response"); }
      return result;
    });
    const syncB = new ProjectSync(b, "user", () => {}, server.transport);
    await a.save("user", project); await syncA.run();
    expect(await a.pending("user")).toHaveLength(1);
    await syncB.run();
    await b.save("user", { ...project, title: "Newer B" }); await syncB.run();
    await syncA.run();
    expect((await a.load("user", project.id))?.title).toBe("Newer B");
    expect(await a.pending("user")).toHaveLength(0);
  });

  it("keeps edits made while sending and ignores stopped-account responses", async () => {
    const store = device(); const server = cloud(); const project = createProject();
    await store.save("a", project);
    let sent!: () => void; const sending = new Promise<void>((resolve) => { sent = resolve; });
    let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
    const sync = new ProjectSync(store, "a", () => {}, async (path, init) => {
      const response = await server.transport(path, init);
      if (init?.method === "PUT") { sent(); await barrier; }
      return response;
    });
    const run = sync.run(); await sending;
    await store.save("a", { ...project, title: "Edited while sending" });
    release(); await run;
    expect((await store.load("a", project.id))?.title).toBe("Edited while sending");
    expect(await store.pending("a")).toHaveLength(1);
    const operation = (await store.pending("a"))[0];
    let releaseStopped!: () => void;
    const stopped = new ProjectSync(store, "a", () => {}, async () => {
      await new Promise<void>((resolve) => { releaseStopped = resolve; }); return { revision: 100 };
    });
    const stale = stopped.run();
    while (!releaseStopped) await new Promise((resolve) => setTimeout(resolve, 0));
    stopped.stop(); releaseStopped(); await stale;
    expect((await store.pending("a"))[0].operationId).toBe(operation.operationId);
    expect(await store.list("b")).toEqual([]);
  });

  it("pauses on an expired session without losing queued work", async () => {
    const store = device(); await store.save("a", createProject());
    const statuses: string[] = [];
    const sync = new ProjectSync(store, "a", (status) => statuses.push(status), async () => { throw new SyncError(401, "Потрібен вхід"); });
    await sync.run();
    expect(statuses.at(-1)).toBe("login");
    expect(await store.pending("a")).toHaveLength(1);
  });
});
