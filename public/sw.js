// FOOAX · Service Worker — hace la app instalable y robusta sin señal.
// Guarda el "cascarón" de la app para que abra aunque no haya internet; la
// captura offline ya vive en localStorage. Las llamadas al servidor (/api)
// siempre van a la red (nunca se cachean), para no servir datos viejos.
//
// v2 — corrige el fallo de campo (14-jul): las respuestas REDIRIGIDAS (p.ej.
// "/" → "/app") no pueden servirse del cache para abrir una página; el
// navegador las rechaza y muestra "sin conexión". Ahora toda respuesta se
// guarda "limpia" (sin bandera de redirección) y cada pieza se cachea por
// separado (antes, si una fallaba, el cache quedaba vacío).
const CACHE = "fooax-v3";
const ASSETS = ["/login.html", "/sync.js", "/captura-agil.js", "/img/logo-fooax.jpg", "/manifest.json"];

// Reconstruye la respuesta para que el cache la acepte al navegar sin señal.
function limpia(r) {
  if (!r || !r.redirected) return Promise.resolve(r);
  return r.blob().then((b) => new Response(b, {
    status: 200,
    headers: { "Content-Type": r.headers.get("Content-Type") || "text/html; charset=utf-8" },
  }));
}
function guardar(req, resp) {
  return limpia(resp).then((rl) =>
    caches.open(CACHE).then((c) => c.put(req, rl.clone()).then(() => rl))
  );
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(ASSETS.map((a) =>
        fetch(a).then((r) => { if (r.ok) return limpia(r).then((rl) => c.put(a, rl)); }).catch(() => {})
      ))
    ).then(() => self.skipWaiting())
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
    // páginas: red primero; sin señal, del cache (la app del ejecutivo se
    // guarda al primer uso con internet). Orden: la misma página → la app
    // del ejecutivo → el login.
    e.respondWith(
      fetch(req).then((r) => (r.ok ? guardar(req, r) : r)).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((m) => m || caches.match("/app"))
          .then((m) => m || caches.match("/login.html"))
          .then((m) => m || new Response(
            "<meta charset=utf-8><title>FOOAX</title><body style=\"font-family:sans-serif;text-align:center;padding:40px\"><h2>Sin señal y sin datos guardados</h2><p>Abre la app una vez con internet para que quede lista para usarse sin conexión.</p>",
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
          ))
      )
    );
  } else {
    // assets (js, imagen): responde del cache al instante (offline y rápido)
    // pero SIEMPRE refresca en segundo plano — así las mejoras llegan al
    // teléfono en la siguiente abierta, sin quedarse congeladas en el cache.
    e.respondWith(
      caches.match(req).then((m) => {
        const red = fetch(req).then((r) => (r.ok ? guardar(req, r) : r)).catch(() => m);
        return m || red;
      })
    );
  }
});
