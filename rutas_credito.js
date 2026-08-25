// rutas_credito.js — endpoints del flujo de colocación con segregación
// (CU-011/012/013) y sincronización automática al dispersar (CU-014).
// Ver store_credito.js para el alcance exacto y lo que queda deliberadamente
// fuera de este PR.
//
// Mapeo de puestos del Anexo K §2.2 a los `puesto` que ya existen en
// server.js (USUARIOS) — Karina no ha confirmado si "Gerencia de Sucursal"
// es el mismo puesto que "gerente_campo" (Neri) o uno nuevo; se usa
// gerente_campo por ser el más parecido que YA existe, para no inventar un
// puesto nuevo sin que Dirección lo confirme. Ver ESC-02 en
// Preguntas_Karina_Parte_Carlos_FOOAX.
//   SOLICITA          -> ejecutivo_credito_cobranza
//   ANALIZA           -> control_operativo_sucursal
//   AUTORIZA           -> gerente_campo (montos bajos) / direccion_general (según escalera — configurable, ver SEG/ESC)
//   DISPERSA           -> administracion_finanzas
//   ENTREGA             -> ejecutivo_credito_cobranza
//   CUSTODIA PAGARÉ    -> control_operativo_sucursal
const express = require("express");
const storeCredito = require("./store_credito");
const storeExp = require("./store_expediente");

function ipDe(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

module.exports = function montarRutasCredito(app, { requiere, requierePuesto }) {
  const r = express.Router();

  // ---- 1 · Solicitud (SOLICITA = ejecutivo_credito_cobranza) ----
  r.post("/api/creditos/solicitudes", requierePuesto("ejecutivo_credito_cobranza"), (req, res) => {
    const b = req.body || {};
    const resultado = storeCredito.crearSolicitud({
      id_sucursal: req.usuario.id_sucursal, clienta_id: b.clienta_id, producto: b.producto,
      monto_solicitado: b.monto_solicitado, plazo_solicitado: b.plazo_solicitado,
      destino: b.destino, centro: b.centro, originado_por: req.usuario.id,
    });
    if (!resultado.ok) return res.status(409).json(resultado);
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto, id_sucursal: req.usuario.id_sucursal,
      accion: "credito.solicitar", entidad: "solicitud", entidad_id: String(resultado.solicitud.id),
      detalle: { monto_solicitado: resultado.solicitud.monto_solicitado }, ip: ipDe(req),
    });
    res.json({ ok: true, solicitud: resultado.solicitud });
  });

  r.get("/api/creditos/solicitudes/:id", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const s = storeCredito.obtenerSolicitud(req.params.id);
    if (!s) return res.status(404).json({ error: "Solicitud no encontrada." });
    res.json({ solicitud: s, autorizacion: storeCredito.autorizacionDeSolicitud(s.id) });
  });

  // ---- 2 · Escalera de autorización (Dirección la configura — vacía hasta entonces) ----
  r.get("/api/creditos/escalera", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    res.json({ niveles: storeCredito.escaleraVigente() });
  });
  r.post("/api/creditos/escalera", requierePuesto("direccion_general"), (req, res) => {
    const b = req.body || {};
    if (!b.puesto_autoriza) return res.status(400).json({ error: "Falta puesto_autoriza." });
    const resultado = storeCredito.agregarNivelEscalera({ ...b, agregado_por: req.usuario.id });
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto, id_sucursal: req.usuario.id_sucursal,
      accion: "credito.escalera.agregar", entidad: "parametro_autorizacion", entidad_id: String(resultado.nivel.id),
      detalle: resultado.nivel, ip: ipDe(req),
    });
    res.json(resultado);
  });

  // ---- 3 · Autorizar (AUTORIZA según escalera — candado dinámico por monto) ----
  // No se puede fijar un solo requierePuesto() aquí: el puesto que autoriza
  // depende del monto (Anexo K §2.2 / CU-012 §6). Se resuelve el nivel ANTES
  // de dejar pasar la petición, y se compara contra el puesto de quien llama.
  r.post("/api/creditos/solicitudes/:id/autorizar", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const s = storeCredito.obtenerSolicitud(req.params.id);
    if (!s) return res.status(404).json({ error: "Solicitud no encontrada." });
    const montoEvaluar = req.body && req.body.decision === "modifica" ? Number(req.body.monto_autorizado) : s.monto_solicitado;
    const nivel = storeCredito.nivelParaMonto(montoEvaluar);
    if (!nivel) {
      return res.status(409).json({
        error: "La escalera de autorización todavía no está configurada para este monto — Dirección debe definirla (POST /api/creditos/escalera) antes de autorizar.",
      });
    }
    if (req.usuario.puesto !== nivel.puesto_autoriza) {
      return res.status(403).json({ error: `Este monto requiere autorización de "${nivel.puesto_autoriza}" — tu puesto no tiene permiso.` });
    }
    const b = req.body || {};
    const resultado = storeCredito.autorizar(s.id, {
      decision: b.decision, monto_autorizado: b.monto_autorizado,
      autorizado_por: req.usuario.id, puesto_autoriza: req.usuario.puesto,
    });
    if (!resultado.ok) return res.status(409).json(resultado);
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto, id_sucursal: req.usuario.id_sucursal,
      accion: "credito.autorizar", entidad: "solicitud", entidad_id: String(s.id),
      detalle: { decision: b.decision, monto_autorizado: resultado.autorizacion.monto_autorizado }, ip: ipDe(req),
    });
    res.json(resultado);
  });

  // ---- 4 · Dispersar (DISPERSA = administracion_finanzas; sincronización automática) ----
  r.post("/api/creditos/solicitudes/:id/dispersar", requierePuesto("administracion_finanzas"), (req, res) => {
    const b = req.body || {};
    const resultado = storeCredito.dispersar(req.params.id, {
      comision_apertura: b.comision_apertura, garantia_pct: b.garantia_pct, modalidad_entrega: b.modalidad_entrega,
      cuota_manual: b.cuota_manual, dispersado_por: req.usuario.id, puesto_dispersa: req.usuario.puesto,
    });
    if (!resultado.ok) return res.status(409).json(resultado);
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto, id_sucursal: req.usuario.id_sucursal,
      accion: "credito.dispersar", entidad: "solicitud", entidad_id: String(req.params.id),
      detalle: { neto: resultado.sobre.neto, pagare_id: resultado.pagare.id }, ip: ipDe(req),
    });
    res.json(resultado);
  });

  // ---- 5 · Entregar (ENTREGA = ejecutivo_credito_cobranza) ----
  r.post("/api/creditos/solicitudes/:id/entregar", requierePuesto("ejecutivo_credito_cobranza"), (req, res) => {
    const b = req.body || {};
    const resultado = storeCredito.entregar(req.params.id, {
      firma_entrega_clienta: b.firma_entrega_clienta, gps_entrega: b.gps_entrega,
      entregado_por: req.usuario.id, puesto_entrega: req.usuario.puesto,
    });
    if (!resultado.ok) return res.status(409).json(resultado);
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto, id_sucursal: req.usuario.id_sucursal,
      accion: "credito.entregar", entidad: "solicitud", entidad_id: String(req.params.id), detalle: {}, ip: ipDe(req),
    });
    res.json(resultado);
  });

  // ---- 6 · Custodia del pagaré (CUSTODIA = control_operativo_sucursal) ----
  r.post("/api/creditos/pagares/:id/custodia", requierePuesto("control_operativo_sucursal"), (req, res) => {
    const b = req.body || {};
    const resultado = storeCredito.custodiarPagare(req.params.id, {
      evento: b.evento, a_quien: b.a_quien, custodio_por: req.usuario.id, puesto_custodia: req.usuario.puesto,
    });
    if (!resultado.ok) return res.status(409).json(resultado);
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto, id_sucursal: req.usuario.id_sucursal,
      accion: "credito.custodia." + b.evento, entidad: "pagare", entidad_id: String(req.params.id), detalle: {}, ip: ipDe(req),
    });
    res.json(resultado);
  });
  r.get("/api/creditos/pagares/:id/custodia", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    res.json({ eventos: storeCredito.custodiaDePagare(req.params.id) });
  });

  app.use(express.json({ limit: "2mb" }), r);
};
