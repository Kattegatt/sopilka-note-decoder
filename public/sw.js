const CACHE = "sopilka-v6";
const appUrl = (path = "") => new URL(path, self.registration.scope).href;
const SHELL = [
  appUrl(),
  appUrl("manifest.webmanifest"),
  appUrl("favicon.svg"),
  appUrl("faust/waveguide/dsp-module.wasm"),
  appUrl("faust/waveguide/dsp-meta.json"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const fetchAndCache = () => fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  });
  if (event.request.mode === "navigate") {
    event.respondWith(fetchAndCache().catch(() => caches.match(event.request).then((cached) => cached || caches.match(appUrl()))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetchAndCache()).catch(() => caches.match(appUrl())));
});
