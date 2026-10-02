import type { ProjectChanges } from "../shared/sync";
import { LocalStore, GUEST } from "./storage";

export type SyncStatus = "local" | "syncing" | "synced" | "offline" | "login" | "error";
export class SyncError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const messages: Record<string, string> = {
      EMAIL_NOT_VERIFIED: "Підтвердіть email перед входом.",
      INVALID_EMAIL_OR_PASSWORD: "Неправильний email або пароль.",
      USER_ALREADY_EXISTS: "Акаунт із цією поштою вже існує.",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Акаунт із цією поштою вже існує.",
      INVALID_TOKEN: "Посилання недійсне або термін його дії завершився. Запросіть новий лист.",
    };
    throw new SyncError(response.status, (response.status === 429 ? "Забагато спроб. Спробуйте знову за хвилину." : messages[body.code]) ?? body.error ?? body.message ?? "Не вдалося синхронізувати ноти.");
  }
  return response.json();
}

type Transport = typeof apiFetch;
export class ProjectSync {
  private controller = new AbortController();
  private running?: Promise<void>;
  private rerun = false;
  private stopped = false;

  constructor(private store: LocalStore, readonly owner: string,
    private onStatus: (status: SyncStatus, message?: string) => void,
    private transport: Transport = apiFetch) {}

  stop() { this.stopped = true; this.controller.abort(); }

  run(): Promise<void> {
    if (this.stopped || this.owner === GUEST) return Promise.resolve();
    if (this.running) { this.rerun = true; return this.running; }
    this.running = this.perform().finally(() => {
      this.running = undefined;
      if (this.rerun && !this.stopped) { this.rerun = false; void this.run(); }
    });
    return this.running;
  }

  private async perform() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { this.onStatus("offline"); return; }
    this.onStatus("syncing");
    try {
      // Cooperating tabs take one lock per account so retries cannot reorder writes.
      const work = async () => {
        for (const operation of await this.store.pending(this.owner)) {
          if (this.stopped) return;
          const { operationId, id, project } = operation;
          await this.transport(`/api/projects/${encodeURIComponent(id)}`, {
            method: project ? "PUT" : "DELETE", body: JSON.stringify({ operationId, id, project }),
            signal: this.controller.signal,
          });
          if (this.stopped) return;
          await this.store.acknowledge(operation);
        }
        let hasMore = true;
        while (hasMore && !this.stopped) {
          const cursor = await this.store.cursor(this.owner);
          const result: ProjectChanges = await this.transport(`/api/projects?after=${cursor}`, {
            signal: this.controller.signal,
          });
          if (this.stopped) return;
          await this.store.receive(this.owner, result.changes, result.cursor);
          hasMore = result.hasMore;
        }
      };
      if (typeof navigator !== "undefined" && navigator.locks) {
        await navigator.locks.request(`sopilka-sync:${this.owner}`, { signal: this.controller.signal }, work);
      } else await work();
      if (!this.stopped) this.onStatus((await this.store.pending(this.owner)).length ? "syncing" : "synced");
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof SyncError && (error.status === 401 || error.status === 403)) this.onStatus("login", error.message);
      else if (error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) this.onStatus("offline");
      else this.onStatus("error", error instanceof Error ? error.message : "Помилка синхронізації.");
    }
  }
}
