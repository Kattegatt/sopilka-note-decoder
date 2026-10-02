const CACHE = "sopilka-v7";
const appUrl = (path = "") => new URL(path, self.registration.scope).href;
const SHELL = [
  appUrl(),
  appUrl("manifest.webmanifest"),
  appUrl("favicon.svg"),
  appUrl("faust/waveguide/dsp-module.wasm"),
  appUrl("faust/waveguide/dsp-meta.json"),
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch(appUrl("offline-assets.json"), { cache: "no-store" });
    if (!response.ok) throw new Error("Offline asset manifest unavailable");
    const assets = await response.json();
    const cache = await caches.open(CACHE);
    await cache.addAll([...SHELL, ...assets.map((path) => appUrl(path))]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("sopilka-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.searchParams.has("token")) return;
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const fetchAndCache = () => fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  });
  if (event.request.mode === "navigate") {
    event.respondWith(fetchAndCache().catch(() => caches.match(event.request).then((cached) => cached || caches.match(appUrl()))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetchAndCache()).catch(() => Response.error()));
});
