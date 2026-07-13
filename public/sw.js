// FOOAX · Service Worker — hace la app instalable y robusta sin señal.
// Guarda el "cascarón" de la app para que abra aunque no haya internet; la
// captura offline ya vive en localStorage. Las llamadas al servidor (/api)
// siempre van a la red (nunca se cachean), para no servir datos viejos.
const CACHE = "fooax-v1";
const ASSETS = ["/", "/sync.js", "/captura-agil.js", "/img/logo-fooax.jpg", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // POST (sync, login) siempre a la red
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;     // datos: siempre frescos, nunca cache

  if (req.mode === "navigate") {
    // páginas: red primero, y si no hay señal, del cache
    e.respondWith(
      fetch(req).then((r) => {
        const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r;
      }).catch(() => caches.match(req).then((m) => m || caches.match("/")))
    );
  } else {
    // assets (js, imagen): cache primero para que cargue instantáneo y offline
    e.respondWith(
      caches.match(req).then((m) => m || fetch(req).then((r) => {
        const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r;
      }))
    );
  }
});
