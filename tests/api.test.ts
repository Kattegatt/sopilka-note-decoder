import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "./helpers/server";
import { createProject } from "../app/project";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.app.close(); });

describe("email authentication", () => {
  it("requires email verification, allows login, resending and revokes logout sessions", async () => {
    await f.register();
    const denied = await f.app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: f.headers,
      payload: { email: "music@example.com", password: "strong-password-123" } });
    expect(denied.statusCode).toBe(403);
    const resent = await f.app.inject({ method: "POST", url: "/api/auth/send-verification-email", headers: f.headers,
      payload: { email: "music@example.com", callbackURL: "/" } });
    expect(resent.statusCode).toBe(200);
    expect(f.mails.filter((mail) => mail.kind === "verification")).toHaveLength(2);
    await f.verify();
    const cookie = await f.login();
    const session = await f.app.inject({ url: "/api/auth/get-session", headers: { cookie } });
    expect(session.json().user.emailVerified).toBe(true);
    expect(session.headers["cache-control"]).toBe("no-store");
    const logout = await f.app.inject({ method: "POST", url: "/api/auth/sign-out", headers: { ...f.headers, cookie }, payload: {} });
    expect(logout.statusCode).toBe(200);
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie } })).statusCode).toBe(401);
  });

  it("resets passwords with an emailed token and revokes previous sessions", async () => {
    await f.register();
    await f.verify();
    const cookie = await f.login();
    const reset = await f.app.inject({ method: "POST", url: "/api/auth/request-password-reset", headers: f.headers,
      payload: { email: "music@example.com", redirectTo: "http://localhost:3000/" } });
    expect(reset.statusCode).toBe(200);
    const link = new URL(f.mails.findLast((mail) => mail.kind === "reset")!.url);
    const redirect = await f.app.inject({ url: `${link.pathname}${link.search}`, headers: f.headers });
    expect(redirect.statusCode).toBe(302);
    const token = new URL(String(redirect.headers.location)).searchParams.get("token");
    const changed = await f.app.inject({ method: "POST", url: "/api/auth/reset-password", headers: f.headers,
      payload: { token, newPassword: "replacement-password-123" } });
    expect(changed.statusCode).toBe(200);
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie } })).statusCode).toBe(401);
    await expect(f.login()).rejects.toThrow();
    await expect(f.login("music@example.com", "replacement-password-123")).resolves.toBeTruthy();
    const replay = await f.app.inject({ method: "POST", url: "/api/auth/reset-password", headers: f.headers,
      payload: { token, newPassword: "another-password-123" } });
    expect(replay.statusCode).toBe(400);
  });

  it("rejects foreign origins and reports no store on errors", async () => {
    const result = await f.app.inject({ method: "POST", url: "/api/auth/sign-up/email", headers: { origin: "https://evil.example" },
      payload: { email: "x@example.com", password: "strong-password-123", name: "x" } });
    expect(result.statusCode).toBe(403);
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});

describe("private project API", () => {
  it("isolates users and orders last writes by server revisions rather than device clocks", async () => {
    await f.register("a@example.com"); await f.verify("a@example.com");
    const a = await f.login("a@example.com");
    await f.register("b@example.com"); await f.verify("b@example.com");
    const b = await f.login("b@example.com");
    const project = createProject("First");
    const put = (cookie: string, title: string, updatedAt: string, operationId = crypto.randomUUID()) => f.app.inject({
      method: "PUT", url: `/api/projects/${project.id}`, headers: { ...f.headers, cookie },
      payload: { id: project.id, operationId, project: { ...project, title, updatedAt } },
    });
    const firstOp = crypto.randomUUID();
    const first = await put(a, "First", "2099-01-01T00:00:00.000Z", firstOp);
    expect(first.statusCode).toBe(200);
    const second = await put(a, "Second", "2000-01-01T00:00:00.000Z");
    expect(second.json().revision).toBeGreaterThan(first.json().revision);
    await put(a, "First", "2099-01-01T00:00:00.000Z", firstOp);
    const records = (await f.app.inject({ url: "/api/projects", headers: { cookie: a } })).json();
    expect(records.changes).toHaveLength(1);
    expect(records.changes[0].project.title).toBe("Second");
    expect(records.changes[0].project.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie: b } })).json().changes).toEqual([]);
    await put(b, "B's independent project", project.updatedAt);
    expect((await f.app.inject({ url: "/api/projects", headers: { cookie: a } })).json().changes[0].project.title).toBe("Second");
  });

  it("synchronizes tombstones, validates payloads and paginates", async () => {
    await f.register(); await f.verify(); const cookie = await f.login();
    const headers = { ...f.headers, cookie };
    const project = createProject();
    const invalid = await f.app.inject({ method: "PUT", url: `/api/projects/${project.id}`, headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project: { ...project, sound: { breath: 999 } } } });
    expect(invalid.statusCode).toBe(400);
    const mismatch = await f.app.inject({ method: "PUT", url: "/api/projects/other-id", headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project } });
    expect(mismatch.statusCode).toBe(400);
    const put = await f.app.inject({ method: "PUT", url: `/api/projects/${project.id}`, headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project } });
    expect(put.statusCode).toBe(200);
    const another = createProject();
    await f.app.inject({ method: "PUT", url: `/api/projects/${another.id}`, headers,
      payload: { id: another.id, operationId: crypto.randomUUID(), project: another } });
    const page = (await f.app.inject({ url: "/api/projects?limit=1", headers })).json();
    expect(page.changes).toHaveLength(1); expect(page.hasMore).toBe(true);
    const removed = await f.app.inject({ method: "DELETE", url: `/api/projects/${project.id}`, headers,
      payload: { id: project.id, operationId: crypto.randomUUID(), project: null } });
    expect(removed.statusCode).toBe(200);
    const changes = (await f.app.inject({ url: `/api/projects?after=${put.json().revision}`, headers })).json().changes;
    expect(changes.find((change: { id: string }) => change.id === project.id).project).toBeNull();
    expect((await f.app.inject({ url: "/api/projects?after=-1", headers })).statusCode).toBe(400);
    expect((await f.app.inject({ url: "/api/projects" })).statusCode).toBe(401);
    expect((await f.app.inject({ url: "/api/unknown" })).statusCode).toBe(404);
  });
});

it("limits auth requests and keeps rate-limit responses private", async () => {
  let status = 200;
  for (let i = 0; i < 32; i++) {
    const result = await f.app.inject({ url: "/api/auth/get-session", headers: f.headers });
    status = result.statusCode;
    expect(result.headers["cache-control"]).toBe("no-store");
  }
  expect(status).toBe(429);
});
