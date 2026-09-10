// DOMINIO: SOBRES Y SEGREGACIÓN DE FUNCIONES (CU-011/012/013, Regla K.2,
// CU-021) — el flujo solicitud → autoriza → dispersa → entrega → custodia, y
// la Regla K.2 (quien autoriza no dispersa, quien dispersa no entrega, quien
// entrega no custodia).
//
// Extraído de server.js el 10-sep-2026 como TERCER caso del patrón
// "strangler fig" documentado en CLAUDE.md ("Reducir dependencia del
// monolito server.js"). Este código venía del PR "CU-011/CU-012/CU-013:
// sobres y segregación de funciones (Regla K.2)" mergeado hoy a develop.
//
// A diferencia de garantia_liquida.js y sincronizacion_desembolso.js, aquí
// las rutas (app.post/app.get) SIGUEN en server.js — son el "pegamento" HTTP
// y no se mueven. Lo que sí se mueve, porque SÍ es una regla de negocio
// (Regla K.2, no solo enrutamiento), es la validación de cada transición de
// estado: mismos checks, mismo orden, mismos mensajes y códigos de estado que
// tenían las rutas — server.js ahora solo llama a estos validadores y
// traduce el resultado a la respuesta HTTP.
//
// Refactor puro: cada validarX(solicitud, usuario) reproduce EXACTAMENTE los
// mismos "if" que ya estaban en la ruta correspondiente, en el mismo orden,
// con el mismo texto de error — verificado con tests/sobres_segregacion.js
// (23/23), smoke.js y bateria_arqueo.js sin cambio de número.
const crypto = require("crypto");

module.exports = function crearDominioSobresSegregacion({ store }) {
  function folioSolicitud() {
    return "SOL-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  }

  function solicitudPorFolio(folio) {
    return store.solicitudes().find((s) => s.folio === String(folio || ""));
  }

  function escaleraAutorizacion() {
    const cfg = store.configuracion() || {};
    return Array.isArray(cfg.escaleraAutorizacion) ? cfg.escaleraAutorizacion : [];
  }

  function puedeAutorizar(usuario) {
    const escalera = escaleraAutorizacion();
    if (escalera.length) return escalera.includes(usuario.id);
    return usuario.rol === "direccion" || usuario.rol === "admin";
  }

  // No encontrada / no es de la misma burbuja (real vs. prueba) — mismo check
  // que ya hacían las 5 rutas de transición antes de esta extracción.
  function noEncontrada(s, usuario) {
    return !s || !!s.test !== !!usuario.test;
  }

  // AUTORIZA (paso 2, escalera K.2).
  function validarAutorizar(s, usuario) {
    if (noEncontrada(s, usuario)) return { ok: false, status: 404, error: "No encuentro esa solicitud." };
    if (s.estado !== "solicitada") return { ok: false, status: 400, error: "Esa solicitud ya no está pendiente de autorizar (estado: " + s.estado + ")." };
    if (!puedeAutorizar(usuario)) return { ok: false, status: 403, error: "No estás en la escalera de autorización." };
    return { ok: true };
  }

  // RECHAZAR: se puede rechazar mientras no se haya dispersado (después de
  // dispersar ya hay dinero comprometido — eso ya no se "rechaza", se maneja
  // como baja, igual que cualquier otro crédito activo).
  function validarRechazar(s, usuario, motivo) {
    if (noEncontrada(s, usuario)) return { ok: false, status: 404, error: "No encuentro esa solicitud." };
    if (!["solicitada", "autorizada"].includes(s.estado)) return { ok: false, status: 400, error: "Esa solicitud ya no se puede rechazar (estado: " + s.estado + ")." };
    if (!motivo) return { ok: false, status: 400, error: "Escribe el motivo del rechazo." };
    return { ok: true };
  }

  // DISPERSA (paso 3, Regla K.2: quien autoriza NO dispersa).
  function validarDispersar(s, usuario) {
    if (noEncontrada(s, usuario)) return { ok: false, status: 404, error: "No encuentro esa solicitud." };
    if (s.estado !== "autorizada") return { ok: false, status: 400, error: `Esa solicitud todavía no está autorizada (estado: ${s.estado}).` };
    if (usuario.test) return { ok: false, status: 400, error: "La cuenta de PRUEBA no puede dispersar en el padrón real." };
    if (usuario.id === s.autorizadaPorId) return { ok: false, status: 403, error: `Regla K.2: quien autorizó (${s.autorizadaPor}) no puede dispersar el mismo crédito.` };
    return { ok: true };
  }

  // ENTREGA (paso 4, Regla K.2: quien dispersa NO entrega).
  function validarEntregar(s, usuario) {
    if (noEncontrada(s, usuario)) return { ok: false, status: 404, error: "No encuentro esa solicitud." };
    if (s.estado !== "dispersada") return { ok: false, status: 400, error: "Esa solicitud todavía no está dispersada (estado: " + s.estado + ")." };
    if (usuario.id === s.dispersadaPorId) return { ok: false, status: 403, error: "Regla K.2: quien dispersó (" + s.dispersadaPor + ") no puede entregar el mismo sobre." };
    return { ok: true };
  }

  // CUSTODIA DEL PAGARÉ (paso 5, Regla K.2: quien entrega NO custodia).
  function validarCustodiar(s, usuario) {
    if (noEncontrada(s, usuario)) return { ok: false, status: 404, error: "No encuentro esa solicitud." };
    if (s.estado !== "entregada") return { ok: false, status: 400, error: "Esa solicitud todavía no está entregada (estado: " + s.estado + ")." };
    if (usuario.id === s.entregadaPorId) return { ok: false, status: 403, error: "Regla K.2: quien entregó (" + s.entregadaPor + ") no puede custodiar el mismo pagaré." };
    return { ok: true };
  }

  return {
    folioSolicitud,
    solicitudPorFolio,
    escaleraAutorizacion,
    puedeAutorizar,
    validarAutorizar,
    validarRechazar,
    validarDispersar,
    validarEntregar,
    validarCustodiar,
  };
};
