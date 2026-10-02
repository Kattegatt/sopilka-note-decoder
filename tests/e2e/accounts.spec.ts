import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createProject } from "../../app/project";

async function ready(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /Збережено на пристрої|Синхронізовано|Потрібен вхід|Офлайн/ }).first()).toBeVisible();
}
async function register(page: Page, username: string) {
  await page.getByRole("button", { name: "Увійти / Зареєструватися" }).click();
  await page.getByRole("button", { name: "Створити акаунт" }).click();
  await page.getByLabel("Логін", { exact: true }).fill(username);
  await page.getByLabel("Пароль", { exact: true }).fill("strong-password-123");
  await page.getByLabel("Повторіть пароль", { exact: true }).fill("strong-password-123");
  await page.getByRole("button", { name: "Зареєструватися", exact: true }).click();
  await expect(page.getByText(username, { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Синхронізовано" })).toBeVisible();
}
async function login(page: Page, username: string) {
  await page.getByRole("button", { name: "Увійти / Зареєструватися" }).click();
  await page.getByLabel("Логін", { exact: true }).fill(username);
  await page.getByLabel("Пароль", { exact: true }).fill("strong-password-123");
  await page.getByRole("dialog").getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(page.getByText(username, { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Синхронізовано" })).toBeVisible();
}
async function wake(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event("online"))); }

test.beforeEach(async ({ context }, info) => {
  // Separate test clients, so the real auth limiter remains enabled during browser tests.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${info.line}` });
});

let secondContext: BrowserContext | undefined;
test.afterEach(async () => { await secondContext?.close(); secondContext = undefined; });

test("guest projects survive reload and legacy IndexedDB migration", async ({ page }, info) => {
  const project = createProject("Старі ноти");
  await page.goto("/favicon.svg");
  await page.evaluate(async (project) => {
    await new Promise<void>((resolve, reject) => { const deletion = indexedDB.deleteDatabase("sopilka-projects"); deletion.onsuccess = () => resolve(); deletion.onerror = () => reject(deletion.error); });
    const request = indexedDB.open("sopilka-projects", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("projects", { keyPath: "id" });
      store.createIndex("by-updated", "updatedAt");
    };
    const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put({ ...(project as object), title: "Старі ноти" });
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); }); db.close();
  }, project);
  await page.goto("/"); await ready(page);
  await expect(page.getByLabel("Назва проєкту")).toHaveValue("Старі ноти");
  await page.getByLabel("Назва проєкту").fill("Локальні ноти");
  await page.reload(); await ready(page);
  await expect(page.getByLabel("Назва проєкту")).toHaveValue("Локальні ноти");
  await page.getByRole("button", { name: "Увійти / Зареєструватися" }).click();
  await page.getByRole("button", { name: "Створити акаунт" }).click();
  await page.screenshot({ path: info.outputPath("registration.png") });
});

test("two devices sync offline edits and deletions; logout isolates account cache", async ({ page, browser }) => {
  const username = `music_${crypto.randomUUID().slice(0, 20)}`;
  await page.goto("/"); await ready(page);
  await page.getByLabel("Назва проєкту").fill("Мої ноти");
  await register(page, username);
  secondContext = await browser.newContext(); const other = await secondContext.newPage();
  await other.goto("/"); await ready(other); await login(other, username);
  await other.getByRole("combobox", { name: "Відкрити проєкт" }).selectOption({ label: "Мої ноти" });
  await expect(other.getByLabel("Назва проєкту")).toHaveValue("Мої ноти");
  await secondContext.setOffline(true);
  await other.getByLabel("Назва проєкту").fill("Зміни офлайн");
  await other.reload(); await ready(other);
  await expect(other.getByLabel("Назва проєкту")).toHaveValue("Зміни офлайн");
  await secondContext.setOffline(false); await wake(other);
  await expect(other.getByRole("status").filter({ hasText: "Синхронізовано" })).toBeVisible();
  await wake(page);
  await expect(page.getByLabel("Назва проєкту")).toHaveValue("Зміни офлайн");
  other.once("dialog", (dialog) => dialog.accept());
  await other.getByRole("button", { name: "Видалити проєкт" }).click();
  await expect(other.getByRole("combobox", { name: "Відкрити проєкт" })).not.toContainText("Зміни офлайн");
  await expect(other.getByRole("status").filter({ hasText: "Синхронізовано" })).toBeVisible();
  await wake(page);
  await expect(page.getByRole("combobox", { name: "Відкрити проєкт" })).not.toContainText("Зміни офлайн");
  await page.getByRole("button", { name: "Вийти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Увійти / Зареєструватися" })).toBeVisible();
  await expect(page.getByText(username, { exact: true })).not.toBeVisible();
  await page.reload(); await ready(page);
  await expect(page.getByText(username, { exact: true })).not.toBeVisible();
  const apiCache = await page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = (await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))).flat();
    return requests.filter((request) => new URL(request.url).pathname.startsWith("/api/")).map((request) => request.url);
  });
  expect(apiCache).toEqual([]);
});

test("logout in one tab switches other tabs to guest mode", async ({ page, context }) => {
  const username = `tabs_${crypto.randomUUID().slice(0, 20)}`;
  await page.goto("/"); await ready(page); await register(page, username);
  const other = await context.newPage(); await other.goto("/");
  await expect(other.getByText(username, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Вийти", exact: true }).click();
  await expect(other.getByRole("button", { name: "Увійти / Зареєструватися" })).toBeVisible();
  await expect(other.getByText(username, { exact: true })).not.toBeVisible();
});

test("different accounts retain separate offline libraries on the same browser", async ({ page, context }) => {
  const a = `first_${crypto.randomUUID().slice(0, 20)}`, b = `second_${crypto.randomUUID().slice(0, 20)}`;
  await page.goto("/"); await ready(page);
  await page.getByLabel("Назва проєкту").fill("Приватні ноти A"); await register(page, a);
  await page.getByRole("button", { name: "Вийти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Увійти / Зареєструватися" })).toBeVisible();
  await expect(page.getByLabel("Назва проєкту")).not.toHaveValue("Приватні ноти A");
  await page.getByLabel("Назва проєкту").fill("Гостьові ноти B"); await register(page, b);
  const records = await (await page.request.get("/api/projects")).json();
  expect(records.changes.map((record: { project: { title: string } | null }) => record.project?.title)).toEqual(["Гостьові ноти B"]);
  await page.getByRole("button", { name: "Вийти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Увійти / Зареєструватися" })).toBeVisible();
  await login(page, a);
  await expect(page.getByLabel("Назва проєкту")).toHaveValue("Приватні ноти A");
  await context.setOffline(true); await page.reload(); await ready(page);
  await expect(page.getByLabel("Назва проєкту")).toHaveValue("Приватні ноти A");
  await page.getByRole("button", { name: "Вийти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Увійти / Зареєструватися" })).toBeVisible();
  await context.setOffline(false); await wake(page);
  await page.reload(); await ready(page);
  await expect(page.getByText(a, { exact: true })).not.toBeVisible();
});
