// rutas_expediente.js — endpoints del módulo de expediente (CU-009, CU-010).
//
// Se monta desde server.js con un cambio mínimo (ver server.js): este archivo
// no toca ninguna ruta existente de cobranza. Recibe por inyección de
// dependencias lo que necesita del servidor (autenticación, puestos) en vez
// de duplicarlo, para no desincronizarse si esa lógica cambia allá.
const express = require("express");
const storeExp = require("./store_expediente");

// Documentos/fotos llegan como base64 desde el teléfono y pueden pesar más
// que el límite general de 2mb del resto de la API — este router usa su
// propio límite, sin tocar el de server.js.
const jsonGrande = express.json({ limit: "8mb" });

function ipDe(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

// requiere: middleware ya existente en server.js (por rol clásico).
// requierePuesto: middleware nuevo (ver server.js) — candado por PUESTO.
module.exports = function montarRutasExpediente(app, { requiere, requierePuesto }) {
  const r = express.Router();
  r.use(jsonGrande);

  // ---- Buscar responsable/aval YA existente (por nombre o CURP) ----
  // Rutas en /api/responsables y /api/avales — a propósito FUERA de
  // /api/expediente/:clientaId/..., porque si viviera ahí chocaría con la ruta
  // GET /api/expediente/:clientaId (Express la tomaría como si "responsables"
  // fuera un id de clienta). Sin este buscador la pantalla no tiene forma de
  // reutilizar un registro, y el tope de vincularResponsable/vincularAval
  // nunca se pone a prueba en uso real.
  r.get("/api/responsables", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    res.json({ resultados: storeExp.buscarResponsables(req.query.q) });
  });
  r.get("/api/avales", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    res.json({ resultados: storeExp.buscarAvales(req.query.q) });
  });

  // ---- Responsable (tope: máximo 2 clientas activas) ----
  // Se puede mandar responsable_id para VINCULAR a una responsable que ya
  // existe (la misma persona real respaldando a una segunda clienta) — el
  // tope solo tiene sentido si se reutiliza el mismo registro; si no se manda,
  // se crea una responsable nueva.
  r.post("/api/expediente/:clientaId/responsable", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const { clientaId } = req.params;
    const { nombre, curp, telefono, domicilio, ocupacion, identificacion, credito_id, responsable_id } = req.body || {};
    let responsable;
    if (responsable_id) {
      responsable = storeExp.obtenerResponsable(responsable_id);
      if (!responsable) return res.status(400).json({ error: "No existe esa responsable." });
    } else {
      if (!nombre) return res.status(400).json({ error: "Falta el nombre de la responsable." });
      responsable = storeExp.crearResponsable({
        id_sucursal: req.usuario.id_sucursal || null, nombre, curp, telefono, domicilio, ocupacion, identificacion,
      });
    }
    const vinc = storeExp.vincularResponsable(clientaId, responsable.id, credito_id);
    if (!vinc.ok) return res.status(409).json({ error: vinc.error }); // candado de tope — 409 Conflict, no 500
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto,
      id_sucursal: req.usuario.id_sucursal, accion: "expediente.responsable.alta",
      entidad: "clienta", entidad_id: clientaId, detalle: { responsable_id: responsable.id }, ip: ipDe(req),
    });
    res.json({ ok: true, responsable, vinculo: vinc.vinculo });
  });

  // ---- Aval (tope: máximo 1 clienta activa; solo créditos > $10,000) ----
  // Mismo patrón que responsable: aval_id opcional para reutilizar un aval
  // que ya existe.
  r.post("/api/expediente/:clientaId/aval", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const { clientaId } = req.params;
    const { nombre, curp, telefono, domicilio, ocupacion, identificacion, credito_id, aval_id } = req.body || {};
    let aval;
    if (aval_id) {
      aval = storeExp.obtenerAval(aval_id);
      if (!aval) return res.status(400).json({ error: "No existe ese aval." });
    } else {
      if (!nombre) return res.status(400).json({ error: "Falta el nombre del aval." });
      aval = storeExp.crearAval({
        id_sucursal: req.usuario.id_sucursal || null, nombre, curp, telefono, domicilio, ocupacion, identificacion,
      });
    }
    const vinc = storeExp.vincularAval(clientaId, aval.id, credito_id);
    if (!vinc.ok) return res.status(409).json({ error: vinc.error });
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto,
      id_sucursal: req.usuario.id_sucursal, accion: "expediente.aval.alta",
      entidad: "clienta", entidad_id: clientaId, detalle: { aval_id: aval.id }, ip: ipDe(req),
    });
    res.json({ ok: true, aval, vinculo: vinc.vinculo });
  });

  // ---- Referencias (terceros — su propio consentimiento, no el de la clienta) ----
  r.post("/api/expediente/:clientaId/referencia", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const { clientaId } = req.params;
    const { nombre, relacion, curp, telefono, consentimiento } = req.body || {};
    if (!nombre) return res.status(400).json({ error: "Falta el nombre de la referencia." });
    if (!consentimiento) {
      return res.status(400).json({ error: "La referencia debe dar su propio consentimiento antes de guardar sus datos." });
    }
    const ref = storeExp.crearReferencia({ clienta_id: clientaId, nombre, relacion, curp, telefono, consentimiento });
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto,
      id_sucursal: req.usuario.id_sucursal, accion: "expediente.referencia.alta",
      entidad: "clienta", entidad_id: clientaId, detalle: { referencia_id: ref.id }, ip: ipDe(req),
    });
    res.json({ ok: true, referencia: ref });
  });

  // ---- Documentos (cifrados en reposo; nunca se regresa el contenido aquí) ----
  const TIPOS_VALIDOS = ["ine", "comprobante_domicilio", "curp", "foto_negocio"];
  const PROPIETARIOS_VALIDOS = ["solicitante", "responsable", "aval"];
  r.post("/api/expediente/:clientaId/documento", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const { clientaId } = req.params;
    const { tipo, propietario, contenido_base64, requiere_aval } = req.body || {};
    if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ error: "Tipo de documento no válido: " + tipo });
    if (!PROPIETARIOS_VALIDOS.includes(propietario)) return res.status(400).json({ error: "Propietario no válido: " + propietario });
    if (!contenido_base64) return res.status(400).json({ error: "Falta el contenido del documento." });
    let buf;
    try { buf = Buffer.from(contenido_base64, "base64"); } catch { return res.status(400).json({ error: "Documento con codificación inválida." }); }
    if (!buf.length) return res.status(400).json({ error: "Documento vacío." });

    let meta;
    try {
      meta = storeExp.guardarDocumento({ clienta_id: clientaId, tipo, propietario, contenido: buf, creado_por: req.usuario.id });
    } catch (e) {
      // Falla CERRADO: si no hay llave de cifrado configurada, no se guarda
      // nada sin cifrar "por si acaso".
      console.error("[rutas_expediente] documento:", e.message);
      return res.status(500).json({ error: "No se pudo cifrar y guardar el documento. Avisa a Desarrollo." });
    }
    const expediente = storeExp.actualizarExpediente(clientaId, {
      id_sucursal: req.usuario.id_sucursal, requiereAval: !!requiere_aval,
    });
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto,
      id_sucursal: req.usuario.id_sucursal, accion: "expediente.documento.alta",
      entidad: "clienta", entidad_id: clientaId, detalle: { documento_id: meta.id, tipo, propietario }, ip: ipDe(req),
    });
    res.json({ ok: true, documento: meta, expediente });
  });

  // ---- Estatus del expediente (checklist, firmas, documentos — sin contenido) ----
  r.get("/api/expediente/:clientaId", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const { clientaId } = req.params;
    const expediente = storeExp.obtenerExpediente(clientaId);
    const documentos = storeExp.documentosDeClienta(clientaId);
    const firmas = storeExp.firmasDeClienta(clientaId);
    res.json({ expediente, documentos, firmas });
  });

  // ---- Firmas (las tres, siempre separadas — CU-009, Requerimiento Maestro §8) ----
  r.post("/api/expediente/:clientaId/firma", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const { clientaId } = req.params;
    const { tipo, gps, dispositivo, version_aviso } = req.body || {};
    const resultado = storeExp.registrarFirma({ clienta_id: clientaId, tipo, gps, dispositivo, version_aviso });
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto,
      id_sucursal: req.usuario.id_sucursal, accion: "expediente.firma", entidad: "clienta",
      entidad_id: clientaId, detalle: { tipo }, ip: ipDe(req),
    });
    res.json({ ok: true, firma: resultado.firma });
  });

  // ---- Validación del expediente — CU-010, paso 5. Solo Administración y
  // Finanzas (Ale). Candado técnico: no basta con no mostrar el botón, la
  // API misma rechaza a quien no tenga el puesto correcto. ----
  r.post("/api/expediente/:clientaId/validar", requierePuesto("administracion_finanzas"), (req, res) => {
    const { clientaId } = req.params;
    const { aprobado, motivo } = req.body || {};
    const resultado = storeExp.validarExpediente(clientaId, { validado_por: req.usuario.id, aprobado: !!aprobado, motivo });
    if (!resultado.ok) return res.status(409).json({ error: resultado.error });
    storeExp.registrarBitacora({
      usuario: req.usuario.id, rol: req.usuario.rol, puesto: req.usuario.puesto,
      id_sucursal: req.usuario.id_sucursal, accion: aprobado ? "expediente.validar.aprobado" : "expediente.validar.rechazado",
      entidad: "clienta", entidad_id: clientaId, detalle: { motivo: motivo || null }, ip: ipDe(req),
    });
    res.json({ ok: true, expediente: resultado.expediente });
  });

  // ---- Candado de desembolso — lo consulta CU-013 (autorización) antes de
  // dejar avanzar cualquier desembolso. "Expediente incompleto = desembolso
  // cancelado. Sin excepciones." (Requerimiento Maestro y Anexo A). ----
  r.get("/api/expediente/:clientaId/candado", requiere("ejecutivo", "direccion", "admin"), (req, res) => {
    const { clientaId } = req.params;
    res.json(storeExp.expedienteBloqueaDesembolso(clientaId));
  });

  // ---- Bitácora única — solo lectura, solo Dirección/Administración.
  // Es la manera de comprobar "quién hizo qué, cuándo" sin abrir la base de
  // datos directamente; también es lo que usan las pruebas automatizadas. ----
  r.get("/api/bitacora", requiere("direccion", "admin"), (req, res) => {
    const { entidad_id, limite } = req.query;
    let eventos = storeExp.bitacora();
    if (entidad_id) eventos = eventos.filter((e) => e.entidad_id === String(entidad_id));
    const n = Math.min(Number(limite) || 100, 500);
    res.json({ eventos: eventos.slice(-n).reverse() });
  });

  app.use(r);
};
