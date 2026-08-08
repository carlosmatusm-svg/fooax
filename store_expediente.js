// store_expediente.js — capa de datos para el módulo de expediente y
// originación (CU-009, CU-010; base para CU-011 a CU-013 y CU-005).
//
// Vive en un archivo APARTE de store.js a propósito: store.js es el corazón
// de la cobranza que ya está en producción con dinero real todos los días, y
// no tiene ambiente de pruebas — así que este módulo nuevo no le toca una
// sola línea. Si algo de expediente falla, la cobranza sigue funcionando.
//
// Mismo patrón dual que store.js: PostgreSQL si hay DATABASE_URL, archivos
// JSON en local si no. Usa su PROPIO pool (no comparte el de store.js) para
// no acoplar los dos módulos — el costo (una conexión extra) es mínimo.
const fs = require("fs");
const path = require("path");
const { cifrar, descifrar } = require("./cifrado");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const usePg = !!process.env.DATABASE_URL;

let pool = null;
const mem = {
  responsables: [],       // { id, id_sucursal, nombre, curp, telefono, domicilio, ocupacion, identificacion, creado_ts }
  avales: [],              // mismos campos que responsables
  clientas_responsables: [], // { clienta_id, responsable_id, credito_id, activo, creado_ts }
  clientas_avales: [],       // { clienta_id, aval_id, credito_id, activo, creado_ts }
  referencias: [],         // { id, clienta_id, nombre, relacion, curp, telefono, consentimiento, creado_ts }
  documentos: [],          // { id, clienta_id, tipo, propietario, contenido_cifrado, iv, auth_tag, creado_ts, creado_por }
  expedientes: {},         // clienta_id -> { id_sucursal, checklist, estatus, validado_por, validado_ts, motivo_rechazo }
  firmas: [],              // { id, clienta_id, tipo, ts, gps, dispositivo, version_aviso }
  bitacora: [],            // { id, ts, usuario, rol, puesto, id_sucursal, accion, entidad, entidad_id, detalle, ip }
  _seq: 1,
};

function siguienteId() { return mem._seq++; }

function escribirJSON(archivo, obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, archivo), tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, p);
  } catch (e) { console.error("[store_expediente] archivo:", e.message); }
}
function leerJSON(archivo, porDefecto) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, archivo), "utf8")); }
  catch { return porDefecto; }
}
function persistirTodo() {
  if (usePg) return;
  escribirJSON("expediente_responsables.json", mem.responsables);
  escribirJSON("expediente_avales.json", mem.avales);
  escribirJSON("expediente_clientas_responsables.json", mem.clientas_responsables);
  escribirJSON("expediente_clientas_avales.json", mem.clientas_avales);
  escribirJSON("expediente_referencias.json", mem.referencias);
  // Los documentos NO se serializan aquí en texto: contienen Buffers cifrados.
  // Se guardan aparte, ya en binario, en persistirDocumento().
  escribirJSON("expediente_expedientes.json", mem.expedientes);
  escribirJSON("expediente_firmas.json", mem.firmas);
  escribirJSON("expediente_bitacora.json", mem.bitacora);
}

// ---------- arranque ----------
async function init() {
  if (usePg) {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

    // Fase 0 — fundamentos (bitácora y puestos). Ver migraciones/001_fundamentos.sql
    // para la versión documentada de este mismo esquema.
    await pool.query(`CREATE TABLE IF NOT EXISTS bitacora_auditoria (
      id serial PRIMARY KEY,
      ts bigint NOT NULL,
      usuario text NOT NULL,
      rol text,
      puesto text,
      id_sucursal text,
      accion text NOT NULL,
      entidad text,
      entidad_id text,
      detalle jsonb,
      ip text
    )`);
    // Nota de despliegue (no se puede expresar en CREATE TABLE): en Railway,
    // revocar UPDATE y DELETE sobre esta tabla al rol de conexión de la app,
    // para que "de solo inserción" sea una garantía de la base de datos y no
    // solo una promesa del código. Ver Estrategia_Desarrollo_Seguro_FOOAX.

    // Fase 1 — expediente (CU-009, CU-010). Ver migraciones/002_expediente.sql.
    await pool.query(`CREATE TABLE IF NOT EXISTS responsables (
      id serial PRIMARY KEY, id_sucursal text, nombre text NOT NULL, curp text,
      telefono text, domicilio text, ocupacion text, identificacion text,
      creado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS avales (
      id serial PRIMARY KEY, id_sucursal text, nombre text NOT NULL, curp text,
      telefono text, domicilio text, ocupacion text, identificacion text,
      creado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS clientas_responsables (
      id serial PRIMARY KEY, clienta_id text NOT NULL, responsable_id int NOT NULL REFERENCES responsables(id),
      credito_id text, activo boolean NOT NULL DEFAULT true, creado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS clientas_avales (
      id serial PRIMARY KEY, clienta_id text NOT NULL, aval_id int NOT NULL REFERENCES avales(id),
      credito_id text, activo boolean NOT NULL DEFAULT true, creado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS referencias (
      id serial PRIMARY KEY, clienta_id text NOT NULL, nombre text NOT NULL, relacion text,
      curp text, telefono text, consentimiento boolean NOT NULL DEFAULT false, creado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS documentos (
      id serial PRIMARY KEY, clienta_id text NOT NULL, tipo text NOT NULL, propietario text NOT NULL,
      contenido_cifrado bytea NOT NULL, iv bytea NOT NULL, auth_tag bytea NOT NULL,
      creado_ts bigint NOT NULL, creado_por text
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS expedientes (
      clienta_id text PRIMARY KEY, id_sucursal text, checklist jsonb NOT NULL DEFAULT '{}',
      estatus text NOT NULL DEFAULT 'incompleto', validado_por text, validado_ts bigint, motivo_rechazo text
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS firmas (
      id serial PRIMARY KEY, clienta_id text NOT NULL, tipo text NOT NULL, ts bigint NOT NULL,
      gps text, dispositivo text, version_aviso text
    )`);

    // Carga a memoria para lecturas síncronas (mismo patrón que store.js).
    const r = await pool.query("SELECT * FROM responsables"); mem.responsables = r.rows;
    const a = await pool.query("SELECT * FROM avales"); mem.avales = a.rows;
    const cr = await pool.query("SELECT * FROM clientas_responsables"); mem.clientas_responsables = cr.rows;
    const ca = await pool.query("SELECT * FROM clientas_avales"); mem.clientas_avales = ca.rows;
    const ref = await pool.query("SELECT * FROM referencias"); mem.referencias = ref.rows;
    const exp = await pool.query("SELECT * FROM expedientes");
    for (const row of exp.rows) mem.expedientes[row.clienta_id] = row;
    const f = await pool.query("SELECT id, clienta_id, tipo, ts, gps, dispositivo, version_aviso FROM firmas");
    mem.firmas = f.rows;
    console.log(`[store_expediente] PostgreSQL listo · ${mem.responsables.length} responsables, ${mem.avales.length} avales`);
  } else {
    mem.responsables = leerJSON("expediente_responsables.json", []);
    mem.avales = leerJSON("expediente_avales.json", []);
    mem.clientas_responsables = leerJSON("expediente_clientas_responsables.json", []);
    mem.clientas_avales = leerJSON("expediente_clientas_avales.json", []);
    mem.referencias = leerJSON("expediente_referencias.json", []);
    mem.expedientes = leerJSON("expediente_expedientes.json", {});
    mem.firmas = leerJSON("expediente_firmas.json", []);
    mem.bitacora = leerJSON("expediente_bitacora.json", []);
    console.log(`[store_expediente] archivos locales · ${mem.responsables.length} responsables, ${mem.avales.length} avales`);
  }
}

// ---------- bitácora única (append-only) ----------
// Se llama explícitamente desde cada ruta que hace algo relevante — no es un
// "log de todo" automático, sino un registro deliberado por acción de negocio,
// tal como lo describe el Requerimiento Maestro (sección 11).
function registrarBitacora({ usuario, rol, puesto, id_sucursal, accion, entidad, entidad_id, detalle, ip }) {
  const ev = {
    id: siguienteId(), ts: Date.now(), usuario, rol, puesto, id_sucursal,
    accion, entidad, entidad_id: entidad_id != null ? String(entidad_id) : null,
    detalle: detalle || null, ip: ip || null,
  };
  mem.bitacora.push(ev);
  if (usePg) {
    pool.query(
      "INSERT INTO bitacora_auditoria (ts, usuario, rol, puesto, id_sucursal, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [ev.ts, ev.usuario, ev.rol, ev.puesto, ev.id_sucursal, ev.accion, ev.entidad, ev.entidad_id, ev.detalle, ev.ip]
    ).catch((e) => console.error("[store_expediente] bitácora:", e.message));
  } else {
    escribirJSON("expediente_bitacora.json", mem.bitacora);
  }
  return ev;
}
function bitacora() { return mem.bitacora; } // usado por las pruebas

// ---------- responsables y avales (con sus topes) ----------
// Tope de RESPONSABLE: máximo 2 clientas activas respaldadas.
// Tope de AVAL: máximo 1 clienta activa respaldada.
// El conteo es por vínculo ACTIVO, no por fila histórica — si un crédito se
// liquida y el vínculo se desactiva, el responsable/aval recupera su cupo.
function contarClientasActivas(vinculos, campoId, id) {
  const vistos = new Set();
  for (const v of vinculos) {
    if (v[campoId] === id && v.activo) vistos.add(v.clienta_id);
  }
  return vistos.size;
}

function crearResponsable(datos) {
  const row = { id: siguienteId(), id_sucursal: datos.id_sucursal || null, nombre: datos.nombre,
    curp: datos.curp || null, telefono: datos.telefono || null, domicilio: datos.domicilio || null,
    ocupacion: datos.ocupacion || null, identificacion: datos.identificacion || null, creado_ts: Date.now() };
  mem.responsables.push(row);
  if (usePg) {
    pool.query("INSERT INTO responsables (id, id_sucursal, nombre, curp, telefono, domicilio, ocupacion, identificacion, creado_ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [row.id, row.id_sucursal, row.nombre, row.curp, row.telefono, row.domicilio, row.ocupacion, row.identificacion, row.creado_ts])
      .catch((e) => console.error("[store_expediente] responsable:", e.message));
  } else persistirTodo();
  return row;
}
// Buscar una responsable/aval YA existente, para vincularla a una SEGUNDA
// clienta sin duplicar su registro (la misma persona real puede respaldar
// hasta el tope — el tope solo tiene sentido si se reutiliza el mismo id).
function obtenerResponsable(id) { return mem.responsables.find((r) => r.id === Number(id)) || null; }
function obtenerAval(id) { return mem.avales.find((a) => a.id === Number(id)) || null; }

function crearAval(datos) {
  const row = { id: siguienteId(), id_sucursal: datos.id_sucursal || null, nombre: datos.nombre,
    curp: datos.curp || null, telefono: datos.telefono || null, domicilio: datos.domicilio || null,
    ocupacion: datos.ocupacion || null, identificacion: datos.identificacion || null, creado_ts: Date.now() };
  mem.avales.push(row);
  if (usePg) {
    pool.query("INSERT INTO avales (id, id_sucursal, nombre, curp, telefono, domicilio, ocupacion, identificacion, creado_ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [row.id, row.id_sucursal, row.nombre, row.curp, row.telefono, row.domicilio, row.ocupacion, row.identificacion, row.creado_ts])
      .catch((e) => console.error("[store_expediente] aval:", e.message));
  } else persistirTodo();
  return row;
}

// Devuelve { ok:true, vinculo } o { ok:false, error } — SIEMPRE valida el tope
// antes de vincular. El candado vive aquí, en el servidor, no en la pantalla.
function vincularResponsable(clientaId, responsableId, creditoId) {
  const yaTiene = contarClientasActivas(mem.clientas_responsables, "responsable_id", responsableId);
  if (yaTiene >= 2) return { ok: false, error: "Esta responsable ya respalda a 2 clientas — es el máximo permitido." };
  const row = { id: siguienteId(), clienta_id: String(clientaId), responsable_id: responsableId,
    credito_id: creditoId || null, activo: true, creado_ts: Date.now() };
  mem.clientas_responsables.push(row);
  if (usePg) {
    pool.query("INSERT INTO clientas_responsables (id, clienta_id, responsable_id, credito_id, activo, creado_ts) VALUES ($1,$2,$3,$4,$5,$6)",
      [row.id, row.clienta_id, row.responsable_id, row.credito_id, row.activo, row.creado_ts])
      .catch((e) => console.error("[store_expediente] vínculo responsable:", e.message));
  } else persistirTodo();
  return { ok: true, vinculo: row };
}
function vincularAval(clientaId, avalId, creditoId) {
  const yaTiene = contarClientasActivas(mem.clientas_avales, "aval_id", avalId);
  if (yaTiene >= 1) return { ok: false, error: "Este aval ya respalda a otra clienta — es el máximo permitido." };
  const row = { id: siguienteId(), clienta_id: String(clientaId), aval_id: avalId,
    credito_id: creditoId || null, activo: true, creado_ts: Date.now() };
  mem.clientas_avales.push(row);
  if (usePg) {
    pool.query("INSERT INTO clientas_avales (id, clienta_id, aval_id, credito_id, activo, creado_ts) VALUES ($1,$2,$3,$4,$5,$6)",
      [row.id, row.clienta_id, row.aval_id, row.credito_id, row.activo, row.creado_ts])
      .catch((e) => console.error("[store_expediente] vínculo aval:", e.message));
  } else persistirTodo();
  return { ok: true, vinculo: row };
}

// ---------- referencias (terceros — requieren su propio consentimiento) ----------
function crearReferencia(datos) {
  const row = { id: siguienteId(), clienta_id: String(datos.clienta_id), nombre: datos.nombre,
    relacion: datos.relacion || null, curp: datos.curp || null, telefono: datos.telefono || null,
    consentimiento: !!datos.consentimiento, creado_ts: Date.now() };
  mem.referencias.push(row);
  if (usePg) {
    pool.query("INSERT INTO referencias (id, clienta_id, nombre, relacion, curp, telefono, consentimiento, creado_ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [row.id, row.clienta_id, row.nombre, row.relacion, row.curp, row.telefono, row.consentimiento, row.creado_ts])
      .catch((e) => console.error("[store_expediente] referencia:", e.message));
  } else persistirTodo();
  return row;
}

// ---------- documentos (cifrados en reposo) ----------
function guardarDocumento({ clienta_id, tipo, propietario, contenido, creado_por }) {
  const { contenido_cifrado, iv, auth_tag } = cifrar(contenido);
  const row = { id: siguienteId(), clienta_id: String(clienta_id), tipo, propietario,
    contenido_cifrado, iv, auth_tag, creado_ts: Date.now(), creado_por: creado_por || null };
  mem.documentos.push(row);
  if (usePg) {
    pool.query("INSERT INTO documentos (id, clienta_id, tipo, propietario, contenido_cifrado, iv, auth_tag, creado_ts, creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [row.id, row.clienta_id, row.tipo, row.propietario, row.contenido_cifrado, row.iv, row.auth_tag, row.creado_ts, row.creado_por])
      .catch((e) => console.error("[store_expediente] documento:", e.message));
  } else {
    // En archivo local: cada documento cifrado va en su propio .bin, nunca en
    // el JSON de texto (evita mezclar binario cifrado con JSON legible).
    try {
      fs.mkdirSync(path.join(DATA_DIR, "documentos"), { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, "documentos", `${row.id}.bin`), row.contenido_cifrado);
      fs.writeFileSync(path.join(DATA_DIR, "documentos", `${row.id}.meta.json`), JSON.stringify({
        ...row, contenido_cifrado: undefined, iv: row.iv.toString("hex"), auth_tag: row.auth_tag.toString("hex"),
      }));
    } catch (e) { console.error("[store_expediente] documento local:", e.message); }
  }
  return { id: row.id, tipo: row.tipo, propietario: row.propietario, creado_ts: row.creado_ts };
}
function documentosDeClienta(clientaId) {
  return mem.documentos
    .filter((d) => d.clienta_id === String(clientaId))
    .map((d) => ({ id: d.id, tipo: d.tipo, propietario: d.propietario, creado_ts: d.creado_ts })); // nunca se regresa el contenido sin pedirlo explícito
}

// ---------- expediente: checklist, candado y validación ----------
// Documentos que EXIGE el checklist (Sección 12 de la Solicitud de Crédito
// FOOAX 2026). Si algún crédito requiere aval, se agrega dinámicamente.
const CHECKLIST_BASE = [
  "solicitante_ine", "solicitante_comprobante_domicilio", "solicitante_curp", "solicitante_foto_negocio",
  "responsable_ine", "responsable_comprobante_domicilio",
];
const CHECKLIST_AVAL = ["aval_ine", "aval_comprobante_domicilio"];

function checklistRequerido(requiereAval) {
  return requiereAval ? [...CHECKLIST_BASE, ...CHECKLIST_AVAL] : CHECKLIST_BASE;
}
function calcularEstatus(clientaId, requiereAval) {
  const docs = new Set(documentosDeClienta(clientaId).map((d) => `${d.propietario}_${d.tipo}`));
  const requeridos = checklistRequerido(requiereAval);
  const faltantes = requeridos.filter((k) => !docs.has(k));
  return { estatus: faltantes.length === 0 ? "completo" : "incompleto", faltantes };
}
function obtenerExpediente(clientaId) {
  return mem.expedientes[String(clientaId)] || null;
}
function actualizarExpediente(clientaId, { id_sucursal, requiereAval }) {
  const { estatus, faltantes } = calcularEstatus(clientaId, requiereAval);
  const row = { clienta_id: String(clientaId), id_sucursal: id_sucursal || null,
    checklist: { requeridos: checklistRequerido(requiereAval), faltantes }, estatus,
    validado_por: null, validado_ts: null, motivo_rechazo: null };
  mem.expedientes[String(clientaId)] = row;
  if (usePg) {
    pool.query(
      "INSERT INTO expedientes (clienta_id, id_sucursal, checklist, estatus) VALUES ($1,$2,$3,$4) " +
      "ON CONFLICT (clienta_id) DO UPDATE SET id_sucursal=$2, checklist=$3, estatus=$4",
      [row.clienta_id, row.id_sucursal, row.checklist, row.estatus]
    ).catch((e) => console.error("[store_expediente] expediente:", e.message));
  } else persistirTodo();
  return row;
}
// CANDADO — CU-010: expediente incompleto = desembolso cancelado, sin
// excepciones. Cualquier ruta que prepare un desembolso debe llamar esto
// primero y detenerse si vieneIncompleto === true.
function expedienteBloqueaDesembolso(clientaId) {
  const exp = obtenerExpediente(clientaId);
  if (!exp) return { bloquea: true, motivo: "No existe expediente para esta clienta." };
  if (exp.estatus !== "completo") return { bloquea: true, motivo: "Expediente incompleto: " + (exp.checklist.faltantes || []).join(", ") };
  if (!exp.validado_por) return { bloquea: true, motivo: "Expediente completo pero aún no validado por Administración y Finanzas." };
  return { bloquea: false };
}
// Validación de Ale (Administración y Finanzas) — CU-010, paso 5.
function validarExpediente(clientaId, { validado_por, aprobado, motivo }) {
  const exp = mem.expedientes[String(clientaId)];
  if (!exp) return { ok: false, error: "No existe expediente para esta clienta." };
  if (exp.estatus !== "completo") return { ok: false, error: "No se puede validar un expediente incompleto." };
  exp.validado_por = aprobado ? validado_por : null;
  exp.validado_ts = aprobado ? Date.now() : null;
  exp.motivo_rechazo = aprobado ? null : (motivo || "Rechazado sin motivo especificado");
  if (usePg) {
    pool.query("UPDATE expedientes SET validado_por=$2, validado_ts=$3, motivo_rechazo=$4 WHERE clienta_id=$1",
      [exp.clienta_id, exp.validado_por, exp.validado_ts, exp.motivo_rechazo])
      .catch((e) => console.error("[store_expediente] validar:", e.message));
  } else persistirTodo();
  return { ok: true, expediente: exp };
}

// ---------- firmas (las tres, siempre separadas) ----------
function registrarFirma({ clienta_id, tipo, gps, dispositivo, version_aviso }) {
  if (!["solicitud", "buro", "datos_sensibles"].includes(tipo)) {
    return { ok: false, error: "Tipo de firma no reconocido: " + tipo };
  }
  const row = { id: siguienteId(), clienta_id: String(clienta_id), tipo, ts: Date.now(),
    gps: gps || null, dispositivo: dispositivo || null, version_aviso: version_aviso || null };
  mem.firmas.push(row);
  if (usePg) {
    pool.query("INSERT INTO firmas (id, clienta_id, tipo, ts, gps, dispositivo, version_aviso) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [row.id, row.clienta_id, row.tipo, row.ts, row.gps, row.dispositivo, row.version_aviso])
      .catch((e) => console.error("[store_expediente] firma:", e.message));
  } else persistirTodo();
  return { ok: true, firma: row };
}
function firmasDeClienta(clientaId) {
  return mem.firmas.filter((f) => f.clienta_id === String(clientaId));
}
function tieneFirma(clientaId, tipo) {
  return firmasDeClienta(clientaId).some((f) => f.tipo === tipo);
}

module.exports = {
  init,
  registrarBitacora, bitacora,
  crearResponsable, crearAval, obtenerResponsable, obtenerAval, vincularResponsable, vincularAval, contarClientasActivas,
  crearReferencia,
  guardarDocumento, documentosDeClienta,
  checklistRequerido, calcularEstatus, obtenerExpediente, actualizarExpediente,
  expedienteBloqueaDesembolso, validarExpediente,
  registrarFirma, firmasDeClienta, tieneFirma,
  // expuesto para pruebas / diagnóstico, nunca para lógica de negocio nueva:
  _mem: mem,
};
