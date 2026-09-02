// store_credito.js — capa de datos para el flujo de colocación con
// segregación de funciones (CU-011 a CU-013) y la sincronización automática
// al desembolsar (CU-014, "pagaré + tabla + ticket + cartera" en un solo
// acto).
//
// ALCANCE DE ESTE MÓDULO (25-ago-2026, Carlos) — leer antes de tocarlo:
//   Karina asignó a Carlos, dentro de la Fase 3 de su cotización del
//   14-ago-2026, tres piezas: (1) esta segregación (Anexo K §2.2), (2) la
//   sincronización automática al desembolsar, y (3) las renovaciones desde
//   sucursal (ver store_renovacion.js). Este archivo cubre (1) y (2) — están
//   en el mismo módulo porque la sincronización ES lo que pasa dentro del
//   paso "dispersar" del flujo segregado; no se pueden separar sin duplicar
//   candados.
//
//   DELIBERADAMENTE FUERA de este módulo (para no programar sobre supuestos
//   sin confirmar — ver FOA_Docs/PENDIENTES_POR_CONFIRMAR.md secciones 4 y 8,
//   y FOA_Docs/03_Solicitudes_de_Informacion/Preguntas_Karina_Parte_Carlos_FOOAX):
//     - El motor de análisis de crédito de 7 pasos con buró (CU-012) — es
//       otro módulo, de otro alcance, no asignado a Carlos en esta cotización.
//       Aquí la "autorización" actúa sobre el monto solicitado directamente;
//       si CU-012 llega a construirse, esta función seguirá funcionando igual
//       (solo cambia de dónde sale el monto a autorizar).
//     - Los montos exactos de la escalera de autorización (parametros_autorizacion
//       se deja VACÍA a propósito — Karina/Dirección los llenan después, sin
//       reprogramar, igual que ella hace con sus propios pendientes).
//     - El candado K.1–K.3 como bloqueo por Anexo K "definición firme": el
//       archivo del Anexo K (13-ago-2026) todavía dice "Propuesta de
//       Dirección, no definición firme"; Karina afirma en su cotización que
//       ya está aprobado, pero sin confirmación directa de Anel/CLIC. Por
//       eso el candado técnico de aquí (distintos puestos por paso) SÍ se
//       programa — es la misma arquitectura de "candado por puesto" que ya
//       usa store_expediente.js/rutas_expediente.js para el expediente y el
//       módulo ARCO, no algo nuevo o más agresivo — pero NINGÚN monto de
//       escalera queda hardcodeado, y el PR que introduce esto debe dejarlo
//       explícito para que Carlos y Karina lo revisen antes de ir a producción.
//     - Wiring con el padrón/cartera real de store.js: la "cartera" que
//       menciona la sincronización automática se deja como un objeto de
//       salida (`cartera_pendiente_alta`) en la respuesta de dispersar(), NO
//       como una escritura directa a store.js — ese archivo es el corazón de
//       la cobranza real, sin ambiente de pruebas (ver su propio comentario
//       de cabecera), y conectar esto ahí es una decisión aparte que necesita
//       revisión explícita, no un efecto secundario silencioso de este PR.
//     - Generación real del PDF del pagaré y el motor de tabla de
//       amortización con interés: no existen todavía en ningún lado del
//       sistema (ver Pendientes, sección 11) — aquí se genera el REGISTRO del
//       pagaré y del plan de pagos (metadata + fechas + cuota), no el
//       documento físico ni el cálculo de interés real.
//
// Mismo patrón dual que store_expediente.js: PostgreSQL si hay DATABASE_URL,
// archivos JSON en local si no. Pool propio — no toca store.js ni store_expediente.js.
const fs = require("fs");
const path = require("path");
const storeExp = require("./store_expediente");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const usePg = !!process.env.DATABASE_URL;

let pool = null;
const mem = {
  solicitudes: [],              // { id, id_sucursal, clienta_id, producto, monto_solicitado, plazo_solicitado, destino, centro, estado, originado_por, creado_ts }
  autorizaciones: [],           // { id, solicitud_id, decision, monto_autorizado, autorizado_por, puesto_autoriza, ts }
  sobres_dispersion: [],        // { id, solicitud_id, monto_autorizado, comision_apertura, garantia_pct, garantia_monto, neto, modalidad_entrega, dispersado_por, puesto_dispersa, ts }
  pagares: [],                  // { id, solicitud_id, tipo, producto, razon_social, monto, plazo, generado_ts }
  plan_pagos: [],                // { id, pagare_id, numero_pago, fecha_programada, cuota, generado_ts }
  entregas: [],                  // { id, solicitud_id, firma_entrega_clienta, gps_entrega, entregado_por, puesto_entrega, ts }
  custodia_pagares: [],         // { id, pagare_id, evento, a_quien, puesto_custodia, ts }
  // Escalera de autorización por monto — VACÍA A PROPÓSITO. Cada fila:
  // { id, monto_desde, monto_hasta (null = sin techo), puesto_autoriza, requisitos, vigente_desde, vigente_hasta }
  // Dirección la llena vía POST /api/creditos/escalera (direccion_general) —
  // hasta entonces, autorizar() responde 409 en vez de adivinar un monto.
  parametros_autorizacion: [],
  _seq: 1,
};

function siguienteId() { return mem._seq++; }
function recalcularSecuencia() {
  const maxes = [
    ...mem.solicitudes, ...mem.autorizaciones, ...mem.sobres_dispersion,
    ...mem.pagares, ...mem.plan_pagos, ...mem.entregas, ...mem.custodia_pagares,
    ...mem.parametros_autorizacion,
  ].map((r) => Number(r.id) || 0);
  mem._seq = (maxes.length ? Math.max(...maxes) : 0) + 1;
}
function escribirJSON(archivo, obj) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, archivo), JSON.stringify(obj)); }
  catch (e) { console.error("[store_credito] no se pudo escribir " + archivo + ":", e.message); }
}
function leerJSON(archivo, porDefecto) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, archivo), "utf8")); }
  catch { return porDefecto; }
}
function persistirTodo() {
  if (usePg) return;
  escribirJSON("credito_solicitudes.json", mem.solicitudes);
  escribirJSON("credito_autorizaciones.json", mem.autorizaciones);
  escribirJSON("credito_sobres_dispersion.json", mem.sobres_dispersion);
  escribirJSON("credito_pagares.json", mem.pagares);
  escribirJSON("credito_plan_pagos.json", mem.plan_pagos);
  escribirJSON("credito_entregas.json", mem.entregas);
  escribirJSON("credito_custodia_pagares.json", mem.custodia_pagares);
  escribirJSON("credito_parametros_autorizacion.json", mem.parametros_autorizacion);
}

async function init() {
  if (usePg) {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    // Mismo esquema que migraciones/003_originacion_propuesta.sql y
    // 004_pagare_propuesta.sql (propuestas, nunca aplicadas), más las
    // columnas de puesto que agrega migraciones/007_colocacion_segregacion_ajustes.sql.
    await pool.query(`CREATE TABLE IF NOT EXISTS solicitudes (
      id serial PRIMARY KEY, id_sucursal text, clienta_id text NOT NULL, grupo_id int,
      producto text NOT NULL, monto_solicitado numeric NOT NULL, plazo_solicitado int NOT NULL,
      destino text, centro text, ciclo_numero int, estado text NOT NULL DEFAULT 'pendiente_autorizacion',
      originado_por text NOT NULL, creado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS autorizaciones (
      id serial PRIMARY KEY, solicitud_id int NOT NULL REFERENCES solicitudes(id),
      decision text NOT NULL, monto_autorizado numeric, autorizado_por text NOT NULL,
      puesto_autoriza text NOT NULL, ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sobres_dispersion (
      id serial PRIMARY KEY, solicitud_id int NOT NULL REFERENCES solicitudes(id),
      monto_autorizado numeric NOT NULL, comision_apertura numeric NOT NULL DEFAULT 0,
      garantia_pct numeric NOT NULL DEFAULT 0.10, garantia_monto numeric NOT NULL,
      neto numeric NOT NULL, modalidad_entrega text NOT NULL,
      dispersado_por text NOT NULL, puesto_dispersa text NOT NULL, ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS pagares (
      id serial PRIMARY KEY, solicitud_id int NOT NULL REFERENCES solicitudes(id),
      tipo text NOT NULL DEFAULT 'individual', producto text NOT NULL,
      razon_social text NOT NULL DEFAULT 'FOOAX, S.A. de C.V.',
      monto numeric NOT NULL, plazo int NOT NULL, generado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS plan_pagos (
      id serial PRIMARY KEY, pagare_id int NOT NULL REFERENCES pagares(id),
      numero_pago int NOT NULL, fecha_programada text NOT NULL, cuota numeric NOT NULL,
      generado_ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS entregas_credito (
      id serial PRIMARY KEY, solicitud_id int NOT NULL REFERENCES solicitudes(id),
      firma_entrega_clienta text, gps_entrega text,
      entregado_por text NOT NULL, puesto_entrega text NOT NULL, ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS custodia_pagares (
      id serial PRIMARY KEY, pagare_id int NOT NULL REFERENCES pagares(id),
      evento text NOT NULL, a_quien text, puesto_custodia text NOT NULL, ts bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS parametros_autorizacion (
      id serial PRIMARY KEY, monto_desde numeric NOT NULL, monto_hasta numeric,
      puesto_autoriza text NOT NULL, requisitos text,
      vigente_desde bigint NOT NULL, vigente_hasta bigint
    )`);

    const s = await pool.query("SELECT * FROM solicitudes"); mem.solicitudes = s.rows;
    const au = await pool.query("SELECT * FROM autorizaciones"); mem.autorizaciones = au.rows;
    const sd = await pool.query("SELECT * FROM sobres_dispersion"); mem.sobres_dispersion = sd.rows;
    const pg = await pool.query("SELECT * FROM pagares"); mem.pagares = pg.rows;
    const pp = await pool.query("SELECT * FROM plan_pagos"); mem.plan_pagos = pp.rows;
    const en = await pool.query("SELECT * FROM entregas_credito"); mem.entregas = en.rows;
    const cu = await pool.query("SELECT * FROM custodia_pagares"); mem.custodia_pagares = cu.rows;
    const pa = await pool.query("SELECT * FROM parametros_autorizacion"); mem.parametros_autorizacion = pa.rows;
    recalcularSecuencia();
    console.log(`[store_credito] PostgreSQL listo · ${mem.solicitudes.length} solicitudes, ${mem.parametros_autorizacion.length} niveles de escalera configurados`);
  } else {
    mem.solicitudes = leerJSON("credito_solicitudes.json", []);
    mem.autorizaciones = leerJSON("credito_autorizaciones.json", []);
    mem.sobres_dispersion = leerJSON("credito_sobres_dispersion.json", []);
    mem.pagares = leerJSON("credito_pagares.json", []);
    mem.plan_pagos = leerJSON("credito_plan_pagos.json", []);
    mem.entregas = leerJSON("credito_entregas.json", []);
    mem.custodia_pagares = leerJSON("credito_custodia_pagares.json", []);
    mem.parametros_autorizacion = leerJSON("credito_parametros_autorizacion.json", []);
    recalcularSecuencia();
    console.log(`[store_credito] archivos locales · ${mem.solicitudes.length} solicitudes, ${mem.parametros_autorizacion.length} niveles de escalera configurados`);
  }
}

function persistAsync(tabla, fila, cols) {
  if (!usePg) return;
  const keys = Object.keys(cols);
  const placeholders = keys.map((_, i) => "$" + (i + 1)).join(",");
  pool.query(`INSERT INTO ${tabla} (${keys.join(",")}) VALUES (${placeholders})`, keys.map((k) => cols[k]))
    .catch((e) => console.error(`[store_credito] ${tabla}:`, e.message));
}

// ---------- 1 · solicitud (CU-011, resumido) ----------
// Candado: no se puede solicitar sobre un expediente incompleto — mismo
// principio "expediente incompleto = desembolso cancelado, sin excepciones"
// que ya usa CU-010/CU-013 (ver rutas_expediente.js).
function crearSolicitud({ id_sucursal, clienta_id, producto, monto_solicitado, plazo_solicitado, destino, centro, originado_por }) {
  const candado = storeExp.expedienteBloqueaDesembolso(clienta_id);
  if (candado && candado.bloquea) {
    return { ok: false, error: "Expediente incompleto — no se puede solicitar crédito hasta integrarlo.", detalle: candado };
  }
  const monto = Number(monto_solicitado);
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: "El monto solicitado debe ser mayor a 0." };
  const plazo = Number(plazo_solicitado);
  if (!Number.isFinite(plazo) || plazo <= 0) return { ok: false, error: "El plazo (número de pagos) debe ser mayor a 0." };
  const id = siguienteId();
  const solicitud = {
    id, id_sucursal: id_sucursal || null, clienta_id: String(clienta_id), producto: String(producto || ""),
    monto_solicitado: monto, plazo_solicitado: plazo, destino: destino || null, centro: centro || null,
    estado: "pendiente_autorizacion", originado_por, creado_ts: Date.now(),
  };
  mem.solicitudes.push(solicitud);
  persistirTodo();
  persistAsync("solicitudes", solicitud, solicitud);
  return { ok: true, solicitud };
}

function obtenerSolicitud(id) { return mem.solicitudes.find((s) => String(s.id) === String(id)) || null; }

// ---------- 2 · escalera de autorización (configurable por Dirección) ----------
// Vacía hasta que Dirección la llene — ver cabecera del archivo. Devuelve el
// primer nivel cuyo rango cubre el monto, o null si no hay ninguno (todavía).
function nivelParaMonto(monto) {
  const ahora = Date.now();
  return mem.parametros_autorizacion.find((p) =>
    monto >= Number(p.monto_desde) &&
    (p.monto_hasta === null || p.monto_hasta === undefined || monto <= Number(p.monto_hasta)) &&
    (p.vigente_desde || 0) <= ahora &&
    (!p.vigente_hasta || p.vigente_hasta >= ahora)
  ) || null;
}
function agregarNivelEscalera({ monto_desde, monto_hasta, puesto_autoriza, requisitos, agregado_por }) {
  const id = siguienteId();
  const nivel = {
    id, monto_desde: Number(monto_desde), monto_hasta: (monto_hasta === null || monto_hasta === undefined || monto_hasta === "") ? null : Number(monto_hasta),
    puesto_autoriza, requisitos: requisitos || null, vigente_desde: Date.now(), vigente_hasta: null,
  };
  mem.parametros_autorizacion.push(nivel);
  persistirTodo();
  persistAsync("parametros_autorizacion", nivel, nivel);
  return { ok: true, nivel };
}
function escaleraVigente() { return mem.parametros_autorizacion.filter((p) => !p.vigente_hasta || p.vigente_hasta >= Date.now()); }

// ---------- 3 · autorizar (candado K: puesto según escalera) ----------
function autorizar(solicitudId, { decision, monto_autorizado, autorizado_por, puesto_autoriza }) {
  const s = obtenerSolicitud(solicitudId);
  if (!s) return { ok: false, error: "Solicitud no encontrada." };
  if (s.estado !== "pendiente_autorizacion") return { ok: false, error: `La solicitud está en estado "${s.estado}", no se puede autorizar de nuevo.` };
  if (!["autoriza", "rechaza", "modifica"].includes(decision)) return { ok: false, error: "Decisión inválida (autoriza | rechaza | modifica)." };
  const montoEvaluar = decision === "modifica" ? Number(monto_autorizado) : s.monto_solicitado;
  if (decision !== "rechaza" && (!Number.isFinite(montoEvaluar) || montoEvaluar <= 0)) {
    return { ok: false, error: "Monto autorizado inválido." };
  }
  const id = siguienteId();
  const auth = {
    id, solicitud_id: s.id, decision, monto_autorizado: decision === "rechaza" ? null : montoEvaluar,
    autorizado_por, puesto_autoriza, ts: Date.now(),
  };
  mem.autorizaciones.push(auth);
  s.estado = decision === "rechaza" ? "rechazada" : "autorizada";
  persistirTodo();
  persistAsync("autorizaciones", auth, auth);
  return { ok: true, autorizacion: auth, solicitud: s };
}
function autorizacionDeSolicitud(solicitudId) {
  const de = mem.autorizaciones.filter((a) => String(a.solicitud_id) === String(solicitudId));
  return de[de.length - 1] || null;
}

// ---------- 4 · dispersar (candado K.2 + sincronización automática) ----------
// Regla K.2 (Anexo K): "quien autoriza no dispersa". Defensa en profundidad:
// aunque la ruta ya exige el puesto administracion_finanzas vía requierePuesto,
// aquí se vuelve a comparar contra quién autorizó, por si algún día dos
// puestos distintos comparten esa misma etiqueta de puesto.
function dispersar(solicitudId, { comision_apertura, garantia_pct, modalidad_entrega, dispersado_por, puesto_dispersa, cuota_manual }) {
  const s = obtenerSolicitud(solicitudId);
  if (!s) return { ok: false, error: "Solicitud no encontrada." };
  if (s.estado !== "autorizada") return { ok: false, error: `La solicitud está en estado "${s.estado}", no se puede dispersar.` };
  const auth = autorizacionDeSolicitud(solicitudId);
  if (!auth || auth.decision === "rechaza") return { ok: false, error: "No hay autorización vigente para dispersar." };
  if (auth.puesto_autoriza === puesto_dispersa) {
    return { ok: false, error: "Regla K.2 (Anexo K): el puesto que autoriza no puede ser el mismo que dispersa." };
  }
  const monto = Number(auth.monto_autorizado);
  const comision = Number(comision_apertura) || 0;
  const garPct = Number.isFinite(Number(garantia_pct)) ? Number(garantia_pct) : 0.10; // Anexo F §7: 10% directo a pasivo
  const garantiaMonto = Math.round(monto * garPct * 100) / 100;
  const neto = Math.round((monto - comision - garantiaMonto) * 100) / 100;
  if (neto <= 0) return { ok: false, error: "El neto a entregar resultó en 0 o negativo — revisa comisión y garantía." };
  const idSobre = siguienteId();
  const sobre = {
    id: idSobre, solicitud_id: s.id, monto_autorizado: monto, comision_apertura: comision,
    garantia_pct: garPct, garantia_monto: garantiaMonto, neto, modalidad_entrega: modalidad_entrega || "efectivo",
    dispersado_por, puesto_dispersa, ts: Date.now(),
  };
  mem.sobres_dispersion.push(sobre);

  // --- sincronización automática (punto 1 de Karina): en el MISMO acto se
  // generan pagaré + plan de pagos. El "ticket de garantía" es este mismo
  // sobre (garantia_monto/garantia_pct) hasta que exista un formato propio
  // (ver Preguntas_Karina_Parte_Carlos_FOOAX, SYNC-01).
  const idPagare = siguienteId();
  const pagare = {
    id: idPagare, solicitud_id: s.id, tipo: "individual", producto: s.producto,
    razon_social: "FOOAX, S.A. de C.V.", monto, plazo: s.plazo_solicitado, generado_ts: Date.now(),
  };
  mem.pagares.push(pagare);

  // Plan de pagos: cuota MANUAL (mismo criterio ya usado por /api/creditos/alta
  // y /api/creditos/recredito en store.js/server.js — la cuota es un dato de
  // entrada, no un cálculo de interés; el motor real de amortización todavía
  // no existe en ningún lado del sistema, ver Pendientes sección 11) repartida
  // en fechas semanales consecutivas desde hoy — el "calendario auto-programado"
  // que pide la cotización de Karina.
  const cuota = Number(cuota_manual) > 0 ? Number(cuota_manual) : Math.round((monto / s.plazo_solicitado) * 100) / 100;
  const hoy = new Date();
  for (let n = 1; n <= s.plazo_solicitado; n++) {
    const fecha = new Date(hoy.getTime() + n * 7 * 24 * 60 * 60 * 1000);
    mem.plan_pagos.push({
      id: siguienteId(), pagare_id: idPagare, numero_pago: n,
      fecha_programada: fecha.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }),
      cuota, generado_ts: Date.now(),
    });
  }

  s.estado = "dispersada";
  persistirTodo();
  persistAsync("sobres_dispersion", sobre, sobre);
  persistAsync("pagares", pagare, pagare);

  return {
    ok: true, solicitud: s, sobre, pagare,
    plan_pagos: mem.plan_pagos.filter((p) => p.pagare_id === idPagare),
    // Deliberadamente NO se escribe al padrón de store.js — ver cabecera del
    // archivo. Esta es la información que necesitaría ese alta cuando se
    // decida conectar los dos módulos.
    cartera_pendiente_alta: {
      id: s.clienta_id, producto: s.producto, saldo: monto, cuota,
      centro: s.centro, plazo: s.plazo_solicitado,
    },
  };
}

// ---------- 5 · entregar (candado K.2: quien dispersa no entrega) ----------
function entregar(solicitudId, { firma_entrega_clienta, gps_entrega, entregado_por, puesto_entrega }) {
  const s = obtenerSolicitud(solicitudId);
  if (!s) return { ok: false, error: "Solicitud no encontrada." };
  if (s.estado !== "dispersada") return { ok: false, error: `La solicitud está en estado "${s.estado}", no se puede entregar.` };
  const sobre = mem.sobres_dispersion.filter((d) => String(d.solicitud_id) === String(solicitudId)).pop();
  if (sobre && sobre.puesto_dispersa === puesto_entrega) {
    return { ok: false, error: "Regla K.2 (Anexo K): el puesto que dispersa no puede ser el mismo que entrega." };
  }
  const id = siguienteId();
  const entrega = { id, solicitud_id: s.id, firma_entrega_clienta: firma_entrega_clienta || null, gps_entrega: gps_entrega || null, entregado_por, puesto_entrega, ts: Date.now() };
  mem.entregas.push(entrega);
  s.estado = "entregada";
  persistirTodo();
  persistAsync("entregas_credito", entrega, entrega);
  return { ok: true, entrega, solicitud: s };
}

// ---------- 6 · custodia del pagaré (candado K.2: quien entrega no custodia) ----------
function custodiarPagare(pagareId, { evento, a_quien, custodio_por, puesto_custodia }) {
  const pagare = mem.pagares.find((p) => String(p.id) === String(pagareId));
  if (!pagare) return { ok: false, error: "Pagaré no encontrado." };
  const entrega = mem.entregas.filter((e) => String(e.solicitud_id) === String(pagare.solicitud_id)).pop();
  if (entrega && entrega.puesto_entrega === puesto_custodia) {
    return { ok: false, error: "Regla K.2 (Anexo K): el puesto que entrega no puede ser el mismo que custodia el pagaré." };
  }
  if (!["entro", "salio"].includes(evento)) return { ok: false, error: "Evento inválido (entro | salio)." };
  const id = siguienteId();
  const ev = { id, pagare_id: pagare.id, evento, a_quien: a_quien || null, puesto_custodia, ts: Date.now() };
  mem.custodia_pagares.push(ev);
  persistirTodo();
  persistAsync("custodia_pagares", ev, ev);
  return { ok: true, evento: ev };
}
function custodiaDePagare(pagareId) { return mem.custodia_pagares.filter((c) => String(c.pagare_id) === String(pagareId)); }

module.exports = {
  init,
  crearSolicitud, obtenerSolicitud,
  agregarNivelEscalera, nivelParaMonto, escaleraVigente,
  autorizar, autorizacionDeSolicitud,
  dispersar,
  entregar,
  custodiarPagare, custodiaDePagare,
  // expuesto para pruebas / diagnóstico, nunca para lógica de negocio nueva:
  _mem: mem,
};
