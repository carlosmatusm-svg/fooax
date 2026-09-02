/* eslint-disable no-undef -- se inyecta al final de la app de cobranza y usa
   sus globals (guardar, STORE_KEY...); no son variables indefinidas, son de
   la página anfitriona. */
// FOOAX · módulo de sincronización — se inyecta al final de la app de cobranza.
// Engancha guardar(): cada vez que la app guarda en el teléfono, también
// programa una subida a la nube. Sin señal no pasa nada: el dato ya quedó
// en localStorage y se reintenta al volver la conexión.
(function () {
  if (typeof guardar !== "function" || typeof STORE_KEY === "undefined") {
    console.warn("[sync] app no compatible");
    return;
  }
  const original = guardar;
  let timer = null;
  let pendiente = false;

  window.guardar = function () {
    original.apply(this, arguments);
    pendiente = true;
    clearTimeout(timer);
    timer = setTimeout(subir, 2000); // debounce: agrupa capturas seguidas
    pintar("pendiente");
  };

  async function subir() {
    if (!pendiente) return true;
    if (!navigator.onLine) { pintar("offline"); return false; }
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return true;
    let fecha;
    try { fecha = JSON.parse(raw).fecha; } catch { }
    // Respaldo en hora de MÉXICO (no UTC): después de las 6pm, UTC ya es el día
    // siguiente y la captura caería en el día equivocado.
    fecha = fecha || new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    pintar("subiendo");
    try {
      const r = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fecha, snapshot: raw, ts: Date.now() }),
      });
      if (r.ok) { pendiente = false; pintar("ok"); return true; }
      if (r.status === 401) { pintar("sesion"); return false; }
      pintar("error"); return false;
    } catch { pintar("offline"); return false; }
  }

  // Fuerza una subida inmediata (la usa el botón "Salir" antes de cerrar sesión).
  window.__forzarSync = function () { pendiente = true; return subir(); };

  // ---- rescate: capturas de DÍAS ANTERIORES apartadas ----
  // Cuando la app "empieza limpio hoy", la captura del día anterior queda en
  // fooax_pend_<fecha>_<STORE_KEY>. Aquí se sube a SU fecha original y se
  // elimina solo cuando el servidor confirma. Nada se pierde nunca.
  async function subirPendientes() {
    if (!navigator.onLine) return;
    const llaves = Object.keys(localStorage).filter(
      (k) => k.indexOf("fooax_pend_") === 0 && k.indexOf(STORE_KEY) > 0
    );
    for (const k of llaves) {
      const fecha = k.slice(11, 21); // fooax_pend_YYYY-MM-DD_...
      const raw = localStorage.getItem(k);
      if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { localStorage.removeItem(k); continue; }
      try {
        const r = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fecha, snapshot: raw, ts: Date.now() }),
        });
        if (r.ok) localStorage.removeItem(k);
      } catch (e) { /* sin señal: se reintenta después */ }
    }
  }
  window.addEventListener("online", subirPendientes);
  setInterval(subirPendientes, 60000);
  setTimeout(subirPendientes, 3000);

  window.addEventListener("online", subir);
  setInterval(() => { if (pendiente) subir(); }, 30000); // reintento de respaldo

  // ---- indicador visual (pastilla flotante) ----
  const pill = document.createElement("div");
  pill.id = "fooax-pill";   // para que la barra de cierre pueda apartarla
  pill.style.cssText = "position:fixed;bottom:14px;right:14px;z-index:9999;" +
    "font:600 12px -apple-system,Segoe UI,Roboto,sans-serif;padding:8px 14px;" +
    "border-radius:99px;box-shadow:0 3px 12px rgba(0,0,0,.25);transition:opacity .3s;" +
    "display:inline-flex;align-items:center;gap:6px";
  document.body.appendChild(pill);
  // iconos SVG de línea (sin depender de internet)
  function svg(paths) {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' + paths + "</svg>";
  }
  const P = {
    cloud:   '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><path d="M9 14l2 2 4-4"/>',
    phone:   '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    upcloud: '<path d="M16 16l-4-4-4 4"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.4 18.4A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
    cloudoff:'<path d="M22.6 17A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"/><line x1="1" y1="1" x2="23" y2="23"/>',
    lock:    '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    alert:   '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  };
  const ESTILOS = {
    ok:        ["#EAF7EF", "#0B7247", P.cloud,    "Sincronizado"],
    pendiente: ["#FFF6E9", "#8A5A00", P.phone,    "Guardado en el teléfono"],
    subiendo:  ["#E5EAFB", "#324AB6", P.upcloud,  "Subiendo a la nube…"],
    offline:   ["#FFF6E9", "#8A5A00", P.cloudoff, "Sin señal · se subirá solo"],
    sesion:    ["#FDECEC", "#B4232F", P.lock,     "Vuelve a iniciar sesión"],
    error:     ["#FDECEC", "#B4232F", P.alert,    "Error al subir · reintentando"],
  };
  function pintar(estado) {
    const [fondo, color, icono, texto] = ESTILOS[estado] || ESTILOS.ok;
    pill.style.background = fondo;
    pill.style.color = color;
    pill.innerHTML = svg(icono) + "<span>" + texto + "</span>";
  }
  pintar(navigator.onLine ? "ok" : "offline");

  // Al abrir la app: si hay señal y ya hay algo capturado guardado en el
  // teléfono, súbelo — así lo que se capturó SIN señal en una sesión anterior
  // (y se cerró la app) se sincroniza solo en cuanto se vuelve a abrir con señal.
  if (navigator.onLine && localStorage.getItem(STORE_KEY)) {
    pendiente = true;
    setTimeout(subir, 1500);
  }
})();
