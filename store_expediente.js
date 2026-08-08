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
const { cifrar } = require("./cifrado");
// descifrar existe en cifrado.js para cuando se construya una función real de
// "ver/descargar documento" — hoy nada lo necesita (documentosDeClienta nunca
// regresa el contenido), así que no se importa para no dejar un import muerto.
const motorReglas = require("./motor_reglas");

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
  expedientes: {},         // clienta_id -> { id_sucursal, checklist, estatus, validado_por, validado_ts, motivo_rechazo, folio_fisico, ubicacion_fisica }
  firmas: [],              // { id, clienta_id, tipo, ts, gps, dispositivo, version_aviso }
  bitacora: [],            // { id, ts, usuario, rol, puesto, id_sucursal, accion, entidad, entidad_id, detalle, ip }
  // Identidad/domicilio/negocio/PLD de la clienta (CU-009 §3) — se guarda como
  // un solo bloque flexible (jsonb / JSON) a propósito, NO como columnas fijas:
  // la Solicitud de Crédito que define estos campos sigue en validación con el
  // Lic. César Cáceres (CU-009 §10), así que conviene poder ajustar el detalle
  // sin migrar el esquema cada vez. Las piezas ya validadas y estables
  // (responsables, avales, documentos, firmas) sí son columnas normales.
  datos_clienta: {},       // clienta_id -> { clienta_id, datos: {...}, actualizado_ts }
  solicitudes_arco: [],    // { id, tipo, entidad, entidad_id, solicitado_por, atendido_por, motivo, ts_solicitud, resultado }
  _seq: 1,
};

function siguienteId() { return mem._seq++; }
// Recalcula el contador de ids a partir de TODO lo ya cargado (todas las
// entidades comparten el mismo mem._seq). Sin esto, cada reinicio del
// servidor volvía a empezar en 1: el primer alta de cualquier tipo chocaba
// con un id que ya existía en Postgres/archivo, el INSERT fallaba en
// silencio (es fire-and-forget, solo hace console.error) y la fila quedaba
// SOLO en memoria — "existía" para quien la acababa de crear, pero
// desaparecía en el siguiente reinicio. Bug real, encontrado al construir el
// motor de reglas; se corrige aquí de una vez.
function recalcularSecuencia() {
  const ids = [
    ...mem.responsables.map((r) => r.id),
    ...mem.avales.map((a) => a.id),
    ...mem.clientas_responsables.map((v) => v.id),
    ...mem.clientas_avales.map((v) => v.id),
    ...mem.referencias.map((r) => r.id),
    ...mem.documentos.map((d) => d.id),
    ...mem.firmas.map((f) => f.id),
    ...mem.bitacora.map((b) => b.id),
    ...mem.solicitudes_arco.map((s) => s.id),
  ];
  mem._seq = ids.length ? Math.max(...ids) + 1 : 1;
}
// Los documentos, en modo archivo, NUNCA se guardaron en un JSON central
// (cada uno vive en su propio .bin + .meta.json, ver guardarDocumento) — pero
// tampoco se releían de vuelta a memoria al arrancar. Resultado: tras un
// reinicio, mem.documentos quedaba vacío aunque los archivos cifrados
// siguieran en disco, y el checklist volvía a marcar todo como faltante. Se
// relee solo el .meta.json de cada uno (nunca el contenido cifrado, que no
// hace falta en memoria hasta que alguien lo pida explícitamente).
function cargarDocumentosDesdeDisco() {
  const carpeta = path.join(DATA_DIR, "documentos");
  if (!fs.existsSync(carpeta)) return [];
  try {
    return fs.readdirSync(carpeta)
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(carpeta, f), "utf8")); } catch { return null; } })
      .filter(Boolean);
  } catch (e) { console.error("[store_expediente] cargar documentos de disco:", e.message); return []; }
}

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
  escribirJSON("expediente_datos_clienta.json", mem.datos_clienta);
  escribirJSON("expediente_solicitudes_arco.json", mem.solicitudes_arco);
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
      estatus text NOT NULL DEFAULT 'incompleto', validado_por text, validado_ts bigint, motivo_rechazo text,
      folio_fisico text, ubicacion_fisica text, requiere_aval boolean NOT NULL DEFAULT false
    )`);
    // Nota de despliegue: si esta tabla ya existía ANTES de este cambio (con
    // Railway ya corriendo), CREATE TABLE IF NOT EXISTS no le agrega las
    // columnas nuevas — hay que correr a mano:
    //   ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS folio_fisico text;
    //   ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS ubicacion_fisica text;
    //   ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS requiere_aval boolean NOT NULL DEFAULT false;
    // Como este módulo aún no se ha desplegado, hoy no aplica — se deja la
    // nota para quien lo despliegue después de que ya esté en producción.
    // Solicitudes de Derechos ARCO (exportar/anonimizar) — trazabilidad de
    // quién pidió qué y quién lo atendió, aparte de la bitácora general
    // (aquí se agrupa todo lo de una misma solicitud en un solo renglón).
    await pool.query(`CREATE TABLE IF NOT EXISTS solicitudes_arco (
      id serial PRIMARY KEY, tipo text NOT NULL, entidad text NOT NULL, entidad_id text NOT NULL,
      solicitado_por text, atendido_por text NOT NULL, motivo text,
      ts_solicitud bigint NOT NULL, resultado jsonb
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS firmas (
      id serial PRIMARY KEY, clienta_id text NOT NULL, tipo text NOT NULL, ts bigint NOT NULL,
      gps text, dispositivo text, version_aviso text
    )`);
    // Identidad/domicilio/negocio/PLD de la clienta (CU-009 §3) — un bloque
    // jsonb, no columnas fijas (ver comentario en mem.datos_clienta arriba).
    await pool.query(`CREATE TABLE IF NOT EXISTS datos_clienta (
      clienta_id text PRIMARY KEY, datos jsonb NOT NULL DEFAULT '{}', actualizado_ts bigint NOT NULL
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
    const dc = await pool.query("SELECT * FROM datos_clienta");
    for (const row of dc.rows) mem.datos_clienta[row.clienta_id] = row;
    // Estas dos NO se cargaban antes (bug real, encontrado al construir el
    // motor de reglas): sin esto, tras cada reinicio/redeploy en Railway la
    // bitácora "olvidaba" todo lo previo, y los documentos ya subidos
    // desaparecían del checklist (pudiendo bloquear un expediente que en
    // realidad ya estaba completo).
    const bit = await pool.query("SELECT * FROM bitacora_auditoria ORDER BY id");
    mem.bitacora = bit.rows;
    const doc = await pool.query("SELECT id, clienta_id, tipo, propietario, creado_ts, creado_por FROM documentos");
    mem.documentos = doc.rows; // sin contenido_cifrado/iv/auth_tag: no hace falta en memoria solo para listar/contar
    const arco = await pool.query("SELECT * FROM solicitudes_arco ORDER BY id");
    mem.solicitudes_arco = arco.rows;
    recalcularSecuencia();
    console.log(`[store_expediente] PostgreSQL listo · ${mem.responsables.length} responsables, ${mem.avales.length} avales, ${mem.documentos.length} documentos, ${mem.bitacora.length} eventos de bitácora`);
  } else {
    mem.responsables = leerJSON("expediente_responsables.json", []);
    mem.avales = leerJSON("expediente_avales.json", []);
    mem.clientas_responsables = leerJSON("expediente_clientas_responsables.json", []);
    mem.clientas_avales = leerJSON("expediente_clientas_avales.json", []);
    mem.referencias = leerJSON("expediente_referencias.json", []);
    mem.expedientes = leerJSON("expediente_expedientes.json", {});
    mem.firmas = leerJSON("expediente_firmas.json", []);
    mem.bitacora = leerJSON("expediente_bitacora.json", []);
    mem.datos_clienta = leerJSON("expediente_datos_clienta.json", {});
    mem.solicitudes_arco = leerJSON("expediente_solicitudes_arco.json", []);
    mem.documentos = cargarDocumentosDesdeDisco(); // ver comentario en la función: antes quedaba vacío tras reiniciar
    recalcularSecuencia();
    console.log(`[store_expediente] archivos locales · ${mem.responsables.length} responsables, ${mem.avales.length} avales, ${mem.documentos.length} documentos`);
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

// Buscar por nombre o CURP — es lo que le falta a la pantalla para poder
// REUTILIZAR una responsable/aval en vez de crear una fila nueva cada vez
// (sin esto, el tope de vincularResponsable/vincularAval nunca se activa en
// uso real, porque cada alta parte de un id distinto). Trae de una vez
// cuántas clientas activas ya respalda cada una, para que la pantalla pueda
// avisar ANTES de intentar vincular ("ya va en 2 de 2").
function buscarResponsables(q) {
  const query = String(q || "").trim().toLowerCase();
  const tope = motorReglas.obtenerConRespaldo("tope_responsable", motorReglas.VALORES_INICIALES.tope_responsable).valor.maximo;
  return mem.responsables
    .filter((r) => !query || r.nombre.toLowerCase().includes(query) || (r.curp || "").toLowerCase().includes(query))
    .map((r) => ({ id: r.id, nombre: r.nombre, curp: r.curp,
      clientas_activas: contarClientasActivas(mem.clientas_responsables, "responsable_id", r.id), tope }))
    .slice(0, 20);
}
function buscarAvales(q) {
  const query = String(q || "").trim().toLowerCase();
  const tope = motorReglas.obtenerConRespaldo("tope_aval", motorReglas.VALORES_INICIALES.tope_aval).valor.maximo;
  return mem.avales
    .filter((a) => !query || a.nombre.toLowerCase().includes(query) || (a.curp || "").toLowerCase().includes(query))
    .map((a) => ({ id: a.id, nombre: a.nombre, curp: a.curp,
      clientas_activas: contarClientasActivas(mem.clientas_avales, "aval_id", a.id), tope }))
    .slice(0, 20);
}

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

// Devuelve { ok:true, vinculo, regla } o { ok:false, error, regla } — SIEMPRE
// valida el tope antes de vincular. El candado vive aquí, en el servidor, no
// en la pantalla. El tope YA NO es un literal (2/1): se lee del motor de
// reglas (motor_reglas.js) — así se puede cambiar el máximo permitido sin
// tocar código ni redeployar, y cada decisión queda ligada a QUÉ VERSIÓN de
// la regla se usó (regla.clave + regla.version), no solo al resultado.
function vincularResponsable(clientaId, responsableId, creditoId) {
  const regla = motorReglas.obtenerConRespaldo("tope_responsable", motorReglas.VALORES_INICIALES.tope_responsable);
  const tope = regla.valor.maximo;
  const yaTiene = contarClientasActivas(mem.clientas_responsables, "responsable_id", responsableId);
  if (yaTiene >= tope) {
    return { ok: false, error: `Esta responsable ya respalda a ${tope} clienta${tope === 1 ? "" : "s"} — es el máximo permitido.`, regla };
  }
  const row = { id: siguienteId(), clienta_id: String(clientaId), responsable_id: responsableId,
    credito_id: creditoId || null, activo: true, creado_ts: Date.now() };
  mem.clientas_responsables.push(row);
  if (usePg) {
    pool.query("INSERT INTO clientas_responsables (id, clienta_id, responsable_id, credito_id, activo, creado_ts) VALUES ($1,$2,$3,$4,$5,$6)",
      [row.id, row.clienta_id, row.responsable_id, row.credito_id, row.activo, row.creado_ts])
      .catch((e) => console.error("[store_expediente] vínculo responsable:", e.message));
  } else persistirTodo();
  return { ok: true, vinculo: row, regla };
}
function vincularAval(clientaId, avalId, creditoId) {
  const regla = motorReglas.obtenerConRespaldo("tope_aval", motorReglas.VALORES_INICIALES.tope_aval);
  const tope = regla.valor.maximo;
  const yaTiene = contarClientasActivas(mem.clientas_avales, "aval_id", avalId);
  if (yaTiene >= tope) {
    return { ok: false, error: `Este aval ya respalda a ${tope} clienta${tope === 1 ? "" : "s"} — es el máximo permitido.`, regla };
  }
  const row = { id: siguienteId(), clienta_id: String(clientaId), aval_id: avalId,
    credito_id: creditoId || null, activo: true, creado_ts: Date.now() };
  mem.clientas_avales.push(row);
  if (usePg) {
    pool.query("INSERT INTO clientas_avales (id, clienta_id, aval_id, credito_id, activo, creado_ts) VALUES ($1,$2,$3,$4,$5,$6)",
      [row.id, row.clienta_id, row.aval_id, row.credito_id, row.activo, row.creado_ts])
      .catch((e) => console.error("[store_expediente] vínculo aval:", e.message));
  } else persistirTodo();
  return { ok: true, vinculo: row, regla };
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
function referenciasDeClienta(clientaId) {
  return mem.referencias.filter((r) => r.clienta_id === String(clientaId));
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

// El checklist YA NO son constantes fijas: se leen del motor de reglas
// (motor_reglas.js), con CHECKLIST_BASE/CHECKLIST_AVAL como respaldo de
// fábrica si por lo que sea la regla no está disponible (falla ABIERTO al
// último valor conocido-bueno, a propósito: un documento requerido no debe
// simplemente desaparecer del checklist por una falla del motor de reglas).
function checklistRequerido(requiereAval) {
  const base = motorReglas.obtenerConRespaldo("checklist_base", { documentos: CHECKLIST_BASE }).valor.documentos;
  const aval = motorReglas.obtenerConRespaldo("checklist_aval", { documentos: CHECKLIST_AVAL }).valor.documentos;
  return requiereAval ? [...base, ...aval] : base;
}
// Campos de datos_clienta (identidad, domicilio, actividad, origen de
// recursos) que la LFPIORPI exige antes de considerar íntegro el expediente
// (diagrama "Integración del Expediente"). Antes de esto, el checklist solo
// revisaba documentos — un expediente podía marcarse "completo" con estos
// campos de texto vacíos.
function datosClientaFaltantes(clientaId) {
  const regla = motorReglas.obtenerConRespaldo("campos_pld_obligatorios", motorReglas.VALORES_INICIALES.campos_pld_obligatorios);
  const datos = (obtenerDatosClienta(clientaId) || {}).datos || {};
  const faltantes = regla.valor.campos.filter((c) => datos[c] === undefined || datos[c] === null || String(datos[c]).trim() === "");
  return { faltantes, regla };
}
function calcularEstatus(clientaId, requiereAval) {
  const docs = new Set(documentosDeClienta(clientaId).map((d) => `${d.propietario}_${d.tipo}`));
  const requeridos = checklistRequerido(requiereAval);
  const faltantesDocs = requeridos.filter((k) => !docs.has(k));
  const { faltantes: faltantesDatos } = datosClientaFaltantes(clientaId);
  // Se distinguen con el prefijo "dato:" para que quien lea el checklist (la
  // pantalla, la bitácora, estas mismas pruebas) sepa si lo que falta es
  // subir un documento o llenar un campo — son acciones distintas.
  const faltantes = [...faltantesDocs, ...faltantesDatos.map((c) => `dato:${c}`)];
  return { estatus: faltantes.length === 0 ? "completo" : "incompleto", faltantes };
}
function obtenerExpediente(clientaId) {
  return mem.expedientes[String(clientaId)] || null;
}
function actualizarExpediente(clientaId, { id_sucursal, requiereAval } = {}) {
  const anterior = mem.expedientes[String(clientaId)] || {};
  // requiereAval es "pegajoso": si no se manda explícitamente (ej. al
  // recalcular por un cambio de datos_clienta, no por subir un documento), se
  // reutiliza el último valor conocido — así ningún recálculo "olvida" que un
  // crédito llevaba aval solo porque quien lo disparó no lo sabía.
  const requiereAvalFinal = requiereAval !== undefined ? !!requiereAval : !!anterior.requiere_aval;
  const { estatus, faltantes } = calcularEstatus(clientaId, requiereAvalFinal);
  // Se preserva folio_fisico/ubicacion_fisica del registro anterior: esta
  // función se llama cada vez que se sube un documento (o se editan los datos
  // de la clienta), y si reconstruyera el registro desde cero perdería lo que
  // Karina Merced ya haya anotado sobre dónde quedó resguardado el papel
  // (CU-010 §3).
  const row = { clienta_id: String(clientaId), id_sucursal: id_sucursal || anterior.id_sucursal || null,
    checklist: { requeridos: checklistRequerido(requiereAvalFinal), faltantes }, estatus,
    requiere_aval: requiereAvalFinal,
    validado_por: null, validado_ts: null, motivo_rechazo: null,
    folio_fisico: anterior.folio_fisico || null, ubicacion_fisica: anterior.ubicacion_fisica || null };
  mem.expedientes[String(clientaId)] = row;
  if (usePg) {
    pool.query(
      "INSERT INTO expedientes (clienta_id, id_sucursal, checklist, estatus, requiere_aval, folio_fisico, ubicacion_fisica) VALUES ($1,$2,$3,$4,$5,$6,$7) " +
      "ON CONFLICT (clienta_id) DO UPDATE SET id_sucursal=$2, checklist=$3, estatus=$4, requiere_aval=$5",
      [row.clienta_id, row.id_sucursal, row.checklist, row.estatus, row.requiere_aval, row.folio_fisico, row.ubicacion_fisica]
    ).catch((e) => console.error("[store_expediente] expediente:", e.message));
  } else persistirTodo();
  return row;
}
// Recalcula el estatus SIN cambiar si requiere aval o no (reutiliza el valor
// ya guardado) — la usa cualquier ruta que edite el expediente sin ser "subir
// un documento" (por ahora, guardar datos de la clienta). Si todavía no
// existe expediente (nunca se subió ni un documento), no hay nada que
// recalcular: null, no error.
function recalcularExpediente(clientaId) {
  if (!mem.expedientes[String(clientaId)]) return null;
  return actualizarExpediente(clientaId, {});
}
// Dónde quedó resguardado el original en papel (CU-010 §3: "el expediente
// físico y el digital deben poder rastrearse juntos"). Lo llena Control
// Operativo (Karina Merced) al armar el expediente; no bloquea nada por sí
// mismo, es trazabilidad.
function registrarUbicacionFisica(clientaId, { folio_fisico, ubicacion_fisica }) {
  const exp = mem.expedientes[String(clientaId)];
  if (!exp) return { ok: false, error: "No existe expediente para esta clienta todavía — sube al menos un documento primero." };
  exp.folio_fisico = folio_fisico || null;
  exp.ubicacion_fisica = ubicacion_fisica || null;
  if (usePg) {
    pool.query("UPDATE expedientes SET folio_fisico=$2, ubicacion_fisica=$3 WHERE clienta_id=$1",
      [exp.clienta_id, exp.folio_fisico, exp.ubicacion_fisica])
      .catch((e) => console.error("[store_expediente] ubicación física:", e.message));
  } else persistirTodo();
  return { ok: true, expediente: exp };
}
// Domicilio SOCIAL (jurisdicción legal) y FISCAL (SAT) — datos
// INSTITUCIONALES fijos, nunca el domicilio de la clienta (CU-010 §3: "evita
// litigar en la jurisdicción equivocada, o facturar con el domicilio
// incorrecto ante el SAT"). Es de solo lectura desde la pantalla — no vive en
// una tabla porque no cambia por clienta ni por expediente.
const DOMICILIO_INSTITUCIONAL = {
  social: "Oaxaca de Juárez, Oaxaca — domicilio social / jurisdicción legal de FOOAX, S.A. de C.V.",
  fiscal: "San Lorenzo Cacaotepec, Oaxaca — domicilio fiscal ante el SAT (Sucursal 1 / matriz)",
};

// ---------- datos de la clienta: identidad, domicilio, negocio, capacidad de
// pago, vivienda, familia, PLD/PEP (CU-009 §3) ----------
// guardarDatosClienta hace MERGE, no reemplaza: la pantalla puede guardar por
// secciones (identidad, domicilio, negocio...) sin tener que reenviar todo el
// formulario cada vez.
function guardarDatosClienta(clientaId, datosNuevos) {
  const existente = mem.datos_clienta[String(clientaId)];
  const datos = { ...(existente ? existente.datos : {}), ...(datosNuevos || {}) };
  const row = { clienta_id: String(clientaId), datos, actualizado_ts: Date.now() };
  mem.datos_clienta[row.clienta_id] = row;
  if (usePg) {
    pool.query(
      "INSERT INTO datos_clienta (clienta_id, datos, actualizado_ts) VALUES ($1,$2,$3) " +
      "ON CONFLICT (clienta_id) DO UPDATE SET datos=$2, actualizado_ts=$3",
      [row.clienta_id, row.datos, row.actualizado_ts]
    ).catch((e) => console.error("[store_expediente] datos_clienta:", e.message));
  } else persistirTodo();
  return row;
}
function obtenerDatosClienta(clientaId) {
  return mem.datos_clienta[String(clientaId)] || null;
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

// ---------- Derechos ARCO (Acceso, Rectificación, Cancelación, Oposición) ----------
// "Cancelación" aquí SIEMPRE es anonimización, nunca DELETE — mismo principio
// de "nunca se borra" que ya rige movimientos y bitácora en todo el sistema.
const ENTIDADES_ARCO = ["clienta", "responsable", "aval", "referencia"];
const MARCADOR_ANONIMIZADO = "[ANONIMIZADO]";

function exportarPersona(entidad, entidadId) {
  if (!ENTIDADES_ARCO.includes(entidad)) return { ok: false, error: "Entidad no reconocida: " + entidad };
  if (entidad === "clienta") {
    const clientaId = String(entidadId);
    return { ok: true, datos: {
      expediente: obtenerExpediente(clientaId), datos_clienta: obtenerDatosClienta(clientaId),
      documentos: documentosDeClienta(clientaId), firmas: firmasDeClienta(clientaId), referencias: referenciasDeClienta(clientaId),
      vinculos_responsable: mem.clientas_responsables.filter((v) => v.clienta_id === clientaId),
      vinculos_aval: mem.clientas_avales.filter((v) => v.clienta_id === clientaId),
    } };
  }
  if (entidad === "responsable") {
    const row = obtenerResponsable(entidadId);
    if (!row) return { ok: false, error: "No existe esa responsable." };
    return { ok: true, datos: { responsable: row, clientas_respaldadas: mem.clientas_responsables.filter((v) => v.responsable_id === row.id) } };
  }
  if (entidad === "aval") {
    const row = obtenerAval(entidadId);
    if (!row) return { ok: false, error: "No existe ese aval." };
    return { ok: true, datos: { aval: row, clientas_respaldadas: mem.clientas_avales.filter((v) => v.aval_id === row.id) } };
  }
  const row = mem.referencias.find((r) => r.id === Number(entidadId));
  if (!row) return { ok: false, error: "No existe esa referencia." };
  return { ok: true, datos: { referencia: row } };
}

function anonimizarFilaPersona(row, tabla) {
  row.nombre = MARCADOR_ANONIMIZADO; row.curp = null; row.telefono = null;
  row.domicilio = null; row.ocupacion = null; row.identificacion = null;
  if (usePg) {
    pool.query(`UPDATE ${tabla} SET nombre=$2, curp=NULL, telefono=NULL, domicilio=NULL, ocupacion=NULL, identificacion=NULL WHERE id=$1`,
      [row.id, MARCADOR_ANONIMIZADO]).catch((e) => console.error(`[store_expediente] anonimizar ${tabla}:`, e.message));
  } else persistirTodo();
}
function anonimizarDatosClienta(clientaId) {
  const row = { clienta_id: String(clientaId), datos: { anonimizado: true, anonimizado_ts: Date.now() }, actualizado_ts: Date.now() };
  mem.datos_clienta[row.clienta_id] = row;
  if (usePg) {
    pool.query("INSERT INTO datos_clienta (clienta_id, datos, actualizado_ts) VALUES ($1,$2,$3) ON CONFLICT (clienta_id) DO UPDATE SET datos=$2, actualizado_ts=$3",
      [row.clienta_id, row.datos, row.actualizado_ts]).catch((e) => console.error("[store_expediente] anonimizar datos_clienta:", e.message));
  } else persistirTodo();
  return row;
}
function anonimizarPersona(entidad, entidadId) {
  if (!ENTIDADES_ARCO.includes(entidad)) return { ok: false, error: "Entidad no reconocida: " + entidad };
  if (entidad === "clienta") return { ok: true, datos_clienta: anonimizarDatosClienta(entidadId) };
  if (entidad === "responsable") {
    const row = obtenerResponsable(entidadId);
    if (!row) return { ok: false, error: "No existe esa responsable." };
    anonimizarFilaPersona(row, "responsables");
    return { ok: true, responsable: row };
  }
  if (entidad === "aval") {
    const row = obtenerAval(entidadId);
    if (!row) return { ok: false, error: "No existe ese aval." };
    anonimizarFilaPersona(row, "avales");
    return { ok: true, aval: row };
  }
  const row = mem.referencias.find((r) => r.id === Number(entidadId));
  if (!row) return { ok: false, error: "No existe esa referencia." };
  row.nombre = MARCADOR_ANONIMIZADO; row.curp = null; row.telefono = null;
  if (usePg) {
    pool.query("UPDATE referencias SET nombre=$2, curp=NULL, telefono=NULL WHERE id=$1", [row.id, MARCADOR_ANONIMIZADO])
      .catch((e) => console.error("[store_expediente] anonimizar referencia:", e.message));
  } else persistirTodo();
  return { ok: true, referencia: row };
}
function registrarSolicitudArco({ tipo, entidad, entidad_id, solicitado_por, atendido_por, motivo, resultado }) {
  const row = { id: siguienteId(), tipo, entidad, entidad_id: String(entidad_id), solicitado_por: solicitado_por || null,
    atendido_por, motivo: motivo || null, ts_solicitud: Date.now(), resultado: resultado || null };
  mem.solicitudes_arco.push(row);
  if (usePg) {
    pool.query("INSERT INTO solicitudes_arco (id, tipo, entidad, entidad_id, solicitado_por, atendido_por, motivo, ts_solicitud, resultado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [row.id, row.tipo, row.entidad, row.entidad_id, row.solicitado_por, row.atendido_por, row.motivo, row.ts_solicitud, row.resultado])
      .catch((e) => console.error("[store_expediente] solicitud ARCO:", e.message));
  } else persistirTodo();
  return row;
}
function historialArco() { return mem.solicitudes_arco; }

// ---------- retención PLD (reporte de solo lectura, NUNCA borra ni anonimiza) ----------
// LFPIORPI: retención física obligatoria (10 años por defecto — ver
// motor_reglas.js "retencion_pld_anios") con borrado lógico. Esta función
// solo SEÑALA candidatos para que Dirección/Administración decida caso por
// caso — nunca actúa por sí sola.
function reporteRetencionPLD() {
  const regla = motorReglas.obtenerConRespaldo("retencion_pld_anios", motorReglas.VALORES_INICIALES.retencion_pld_anios);
  const limiteMs = regla.valor.anios * 365.25 * 24 * 60 * 60 * 1000;
  const ahora = Date.now();
  const candidatos = [];
  for (const clientaId of Object.keys(mem.expedientes)) {
    const fechas = [...firmasDeClienta(clientaId).map((f) => f.ts), ...documentosDeClienta(clientaId).map((d) => d.creado_ts)];
    if (!fechas.length) continue;
    const masReciente = Math.max(...fechas);
    if (ahora - masReciente >= limiteMs) {
      candidatos.push({ clienta_id: clientaId, ultima_actividad_ts: masReciente,
        anios_desde_ultima_actividad: Math.floor((ahora - masReciente) / (365.25 * 24 * 60 * 60 * 1000)) });
    }
  }
  return { regla: { clave: regla.clave, version: regla.version, anios: regla.valor.anios }, candidatos };
}

module.exports = {
  init,
  registrarBitacora, bitacora,
  crearResponsable, crearAval, obtenerResponsable, obtenerAval, buscarResponsables, buscarAvales,
  vincularResponsable, vincularAval, contarClientasActivas,
  crearReferencia, referenciasDeClienta,
  guardarDocumento, documentosDeClienta,
  checklistRequerido, calcularEstatus, datosClientaFaltantes, obtenerExpediente, actualizarExpediente, recalcularExpediente,
  registrarUbicacionFisica, DOMICILIO_INSTITUCIONAL,
  expedienteBloqueaDesembolso, validarExpediente,
  registrarFirma, firmasDeClienta, tieneFirma,
  guardarDatosClienta, obtenerDatosClienta,
  exportarPersona, anonimizarPersona, registrarSolicitudArco, historialArco,
  reporteRetencionPLD,
  // expuesto para pruebas / diagnóstico, nunca para lógica de negocio nueva:
  _mem: mem,
};
