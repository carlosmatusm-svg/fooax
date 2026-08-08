// rutas_reglas.js — consulta y control del motor de reglas (motor_reglas.js).
//
// Dos niveles de acceso, igual que la bitácora:
//   - LEER (vigentes + historial): Dirección y Administración — quien necesita
//     auditar o entender por qué una regla se comportó de cierta forma.
//   - CAMBIAR el valor de una regla: SOLO Dirección General (puesto
//     direccion_general). Es una decisión de política de negocio, no una
//     tarea operativa — el mismo nivel que ya aprueba estos parámetros hoy
//     (Anel), solo que ahora queda registrado en vez de vivir en la cabeza de
//     quien tocó el código la última vez.
const express = require("express");
const motorReglas = require("./motor_reglas");
const storeExp = require("./store_expediente");

function ipDe(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

module.exports = function montarRutasReglas(app, { requiere, requierePuesto }) {
  const r = express.Router();

  // ---- Todas las reglas VIGENTES ahora mismo — la fotografía de "con qué
  // parámetros está operando el sistema hoy". ----
  r.get("/api/reglas", requiere("direccion", "admin"), (req, res) => {
    res.json({ reglas: motorReglas.todasVigentes() });
  });

  // ---- Historial completo de UNA regla — para poder explicar "¿con qué
  // tope se vinculó esta responsable en marzo?" meses después. ----
  r.get("/api/reglas/:clave/historial", requiere("direccion", "admin"), (req, res) => {
    res.json({ clave: req.params.clave, versiones: motorReglas.historialRegla(req.params.clave) });
  });

  // ---- Cambiar el valor de una regla — SIEMPRE crea una versión nueva,
  // nunca borra la anterior. Requiere motivo (para que el porqué del cambio
  // quede junto con el cambio, no solo en un chat de WhatsApp). ----
  r.post("/api/reglas/:clave", requierePuesto("direccion_general"), (req, res) => {
    const { clave } = req.params;
    const { valor, motivo } = req.body || {};
    if (valor === undefined || valor === null) return res.status(400).json({ error: "Falta el nuevo valor de la regla." });
    if (!motivo) return res.status(400).json({ error: "Todo cambio de regla debe llevar un motivo — queda en el historial." });
    const anterior = motorReglas.obtenerRegla(clave);
    motorReglas.actualizarRegla(clave, valor, { aprobado_por: req.usuario.id, motivo }).then((nueva) => {
      storeExp.registrarBitacora({
        usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto,
        id_sucursal: req.usuario.id_sucursal, accion: "reglas.actualizar",
        entidad: "regla", entidad_id: clave,
        detalle: { version_anterior: anterior ? anterior.version : null, valor_anterior: anterior ? anterior.valor : null, version_nueva: nueva.version, valor_nuevo: nueva.valor, motivo },
        ip: ipDe(req),
      });
      res.json({ ok: true, regla: nueva });
    }).catch((e) => {
      console.error("[rutas_reglas] actualizar:", e.message);
      res.status(500).json({ error: "No se pudo guardar la nueva versión de la regla." });
    });
  });

  app.use(r);
};
