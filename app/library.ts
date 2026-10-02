import { createProject } from "./project";
import type { Project } from "./domain";
import { getLocalStore, GUEST, type CachedAccount, type LocalStore } from "./storage";
import { apiFetch, ProjectSync, type SyncStatus } from "./sync";

export interface LibraryState {
  account: CachedAccount | null;
  owner: string;
  project: Project;
  projects: Project[];
  ready: boolean;
  status: SyncStatus;
  message: string;
}

export class ProjectLibrary {
  private state: LibraryState = {
    account: null, owner: GUEST, project: createProject("Ода до радості"),
    projects: [], ready: false, status: "local", message: "",
  };
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private writeFailure: unknown;
  private sync?: ProjectSync;
  private generation = 0;
  private editVersion = 0;
  private unsubscribe?: () => void;
  private interval?: ReturnType<typeof setInterval>;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private started = false;
  private sessionRequest?: Promise<void>;

  constructor(private store: LocalStore = getLocalStore()) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<LibraryState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.store.subscribe((kind) => {
      if (kind === "account") void this.store.account().then((account) => {
        if (this.started && account?.id !== this.state.account?.id) void this.activate(account).then(() => this.refreshSession()).catch(this.localError);
      }).catch(this.localError);
      else void this.refresh().catch(this.localError);
    });
    window.addEventListener("online", this.wake);
    window.addEventListener("offline", this.offline);
    document.addEventListener("visibilitychange", this.visible);
    this.interval = setInterval(() => { if (document.visibilityState === "visible") this.wake(); }, 30000);
    const generation = this.generation;
    void this.store.account().then(async (account) => {
      if (!this.started || generation !== this.generation) return;
      await this.activate(account);
      await this.refreshSession();
    }).catch(this.localError);
  }

  stop() {
    this.started = false;
    this.generation++;
    this.sync?.stop();
    this.unsubscribe?.();
    clearInterval(this.interval);
    clearTimeout(this.syncTimer);
    window.removeEventListener("online", this.wake);
    window.removeEventListener("offline", this.offline);
    document.removeEventListener("visibilitychange", this.visible);
  }

  private localError = (error: unknown) => {
    if (this.started) this.patch({ status: "error", message: error instanceof Error ? error.message : "Не вдалося зберегти ноти на пристрої." });
  };
  private offline = () => { if (this.state.account) this.patch({ status: "offline", message: "" }); };
  private visible = () => { if (document.visibilityState === "visible") this.wake(); };
  private wake = () => { void this.refreshSession(); };

  async flush() { await this.writes; if (this.writeFailure) throw this.writeFailure; }
  private write(task: () => Promise<void>) {
    // Capture the owner before queuing, and let a failed write surface without poisoning later writes.
    const result = this.writes.then(task).then(() => { this.writeFailure = undefined; });
    this.writes = result.catch((error) => { this.writeFailure = error; this.localError(error); });
    return result;
  }

  edit(patch: Partial<Project>) {
    if (!this.state.ready) return;
    const owner = this.state.owner;
    const sourceChanged = patch.source && (patch.source.content !== this.state.project.source.content ||
      patch.source.type !== this.state.project.source.type);
    const project = { ...this.state.project, ...patch,
      ...(sourceChanged ? { normalizedMei: "" } : {}), updatedAt: new Date().toISOString() };
    this.editVersion++;
    this.patch({ project, status: owner === GUEST ? "local" : "syncing", message: "" });
    void this.write(() => this.store.save(owner, project)).then(() => this.scheduleSync()).catch(this.localError);
  }

  cache(projectId: string, sourceContent: string, patch: Partial<Project>, owner: string) {
    // Normalization can finish after changing projects. Never apply its result to a different score.
    if (!this.state.ready || this.state.owner !== owner || this.state.project.id !== projectId || this.state.project.source.content !== sourceContent) return;
    const project = { ...this.state.project, ...patch };
    if (JSON.stringify(project) === JSON.stringify(this.state.project)) return;
    this.editVersion++;
    this.patch({ project });
    void this.write(() => this.store.save(owner, project, false)).catch(this.localError);
  }

  private scheduleSync() {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => { void this.sync?.run(); }, 650);
  }

  async refresh() {
    await this.flush();
    const generation = this.generation;
    const version = this.editVersion;
    const owner = this.state.owner;
    const projects = await this.store.list(owner);
    if (!this.started || generation !== this.generation || version !== this.editVersion) return;
    const current = projects.find((project) => project.id === this.state.project.id);
    const project = current ?? projects[0] ?? (this.state.projects.some((item) => item.id === this.state.project.id) ? createProject() : this.state.project);
    this.patch({ projects, ...(JSON.stringify(project) !== JSON.stringify(this.state.project) ? { project } : {}) });
  }

  private async activate(account: CachedAccount | null, importGuests = false) {
    this.sync?.stop();
    clearTimeout(this.syncTimer);
    const generation = ++this.generation;
    this.patch({ ready: false });
    await this.flush();
    const owner = account?.id ?? GUEST;
    if (importGuests) await this.store.importGuests(owner);
    const projects = await this.store.list(owner);
    if (!this.started || generation !== this.generation) return;
    const previous = projects.find((project) => project.id === this.state.project.id);
    this.patch({ account, owner, projects, project: previous ?? projects[0] ?? createProject(), ready: true,
      status: account ? "offline" : "local", message: "" });
    if (account) this.sync = new ProjectSync(this.store, owner, (status, message = "") => {
      if (this.started && generation === this.generation) this.patch({ status, message });
    });
    else this.sync = undefined;
  }

  refreshSession(): Promise<void> {
    if (this.sessionRequest) return this.sessionRequest;
    const generation = this.generation;
    this.sessionRequest = (async () => {
      if (!navigator.onLine || !this.started) { this.offline(); return; }
      try {
        if (await this.store.logoutPending()) {
          await apiFetch("/api/auth/sign-out", { method: "POST", body: "{}" });
          await this.store.setLogoutPending(false);
        }
        const session = await apiFetch("/api/auth/get-session");
        if (!this.started || generation !== this.generation) return;
        if (session?.user) {
          const account = { id: session.user.id, login: session.user.username ?? session.user.name };
          const same = this.state.owner === account.id;
          if (!same || (await this.store.list(GUEST)).length) await this.activate(account, true);
          await this.store.setAccount(account);
          await this.sync?.run();
          await this.refresh();
        } else if (this.state.account) {
          // Keep offline notes in their own namespace until the same user signs in again.
          this.patch({ status: "login", message: "Увійдіть, щоб продовжити синхронізацію." });
        }
      } catch (error) {
        if (this.started && generation === this.generation) {
          this.patch({ status: this.state.account ? "offline" : "local", message: "" });
          if (!(error instanceof TypeError)) this.localError(error);
        }
      }
    })().finally(() => { this.sessionRequest = undefined; });
    return this.sessionRequest;
  }

  async authenticated() {
    // A background session check may have started before the sign-in cookie was set.
    await this.sessionRequest;
    await this.refreshSession();
  }

  async logout() {
    this.generation++;
    this.patch({ ready: false });
    clearTimeout(this.syncTimer);
    this.sync?.stop();
    try { await this.flush(); } catch (error) {
      this.patch({ ready: true });
      throw error;
    }
    await this.store.setLogoutPending(true);
    try {
      if (navigator.onLine) {
        await apiFetch("/api/auth/sign-out", { method: "POST", body: "{}" });
        await this.store.setLogoutPending(false);
      }
    } catch { /* Retry server revocation when a network connection is available. */ }
    await this.activate(null);
    await this.store.setAccount(null);
  }

  async create() {
    await this.flush();
    if (!this.state.ready) return;
    const owner = this.state.owner;
    const generation = this.generation;
    const project = createProject();
    await this.write(() => this.store.save(owner, project));
    if (generation !== this.generation) return;
    this.editVersion++;
    this.patch({ project, status: owner === GUEST ? "local" : "syncing" });
    await this.refresh();
    this.scheduleSync();
  }

  async open(id: string) {
    await this.flush();
    const generation = this.generation;
    const project = await this.store.load(this.state.owner, id);
    if (project && generation === this.generation) { this.editVersion++; this.patch({ project }); }
  }

  async remove() {
    const owner = this.state.owner;
    const generation = this.generation;
    const id = this.state.project.id;
    if (!this.state.ready) return;
    this.patch({ status: owner === GUEST ? "local" : "syncing" });
    await this.flush();
    if (generation !== this.generation || !this.state.ready) return;
    await this.write(() => this.store.remove(owner, id));
    if (generation !== this.generation) return;
    this.editVersion++;
    const projects = await this.store.list(owner);
    if (generation !== this.generation) return;
    this.patch({ projects, project: projects[0] ?? createProject(), status: owner === GUEST ? "local" : "syncing" });
    this.scheduleSync();
  }
}
