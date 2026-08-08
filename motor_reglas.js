// motor_reglas.js — reglas de negocio COMO DATOS, versionadas, no como
// constantes en el código.
//
// Nace de una pregunta directa: ¿se puede tener control (cambiar un parámetro
// sin tocar código ni redeployar) y trazabilidad (saber qué regla aplicaba en
// qué fecha, para poder explicar una decisión de hace meses) sobre las reglas
// de negocio? Deliberadamente NO es un motor externo (BRMS, microservicio de
// reglas): para un equipo de una persona, sin ambiente de staging, un
// componente nuevo con su propia infraestructura y una llamada de red en el
// camino crítico de originar un crédito sería un punto de falla que hoy no
// existe, a cambio de nada que ya se necesite. En vez de eso, las reglas
// viven en la MISMA base de datos que todo lo demás, como filas versionadas
// — el "motor" es este módulo; la trazabilidad es la bitácora que ya existe
// en store_expediente.js (cada llamada que usa una regla debe registrar en la
// bitácora CUÁL versión de la regla aplicó, no solo el resultado).
//
// Principio de versionado: NUNCA se hace UPDATE sobre una regla vigente. Cada
// cambio CIERRA la fila anterior (pone vigente_hasta) y CREA una fila nueva
// (version + 1). Así una regla nunca "desaparece": siempre se puede
// reconstruir qué valor aplicaba en cualquier fecha pasada — historial() lo
// deja ver completo.
//
// Primeras reglas migradas aquí (para probar el patrón con algo ya conocido,
// antes de usarlo en CU-012): el tope de responsable/aval y el checklist de
// documentos requerido — ambos vivían como constantes fijas en
// store_expediente.js. CU-012 (escalera de autorización por monto, bloqueos
// automáticos) usará el mismo patrón cuando se construya.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const usePg = !!process.env.DATABASE_URL;
let pool = null;

const mem = {
  reglas: [], // { id, clave, valor(jsonb), version, vigente_desde, vigente_hasta, aprobado_por, motivo, creado_ts }
  _seq: 1,    // SOLO se usa en modo archivo — en Postgres el id lo asigna la propia tabla (RETURNING id), ver crearVersion().
};

function escribirJSON(archivo, obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, archivo), tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, p);
  } catch (e) { console.error("[motor_reglas] archivo:", e.message); }
}
function leerJSON(archivo, porDefecto) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, archivo), "utf8")); }
  catch { return porDefecto; }
}
function persistir() {
  if (usePg) return;
  escribirJSON("motor_reglas.json", mem.reglas);
}
// Recalcula el contador de ids de modo archivo a partir de lo ya cargado —
// sin esto, cada reinicio volvería a empezar en 1 y chocaría con ids que ya
// existen en el archivo (ver el mismo bug, ya corregido, en store_expediente.js).
function recalcularSecuencia() {
  mem._seq = mem.reglas.length ? Math.max(...mem.reglas.map((r) => r.id)) + 1 : 1;
}
function siguienteId() { return mem._seq++; }

// ---------- valores iniciales — SON los que el sistema ya usaba como
// constantes antes de este módulo. Se siembran solo si la clave no existe
// todavía, para que instalar el motor de reglas no cambie ni un
// comportamiento existente el día que se despliega. ----------
const VALORES_INICIALES = {
  tope_responsable: {
    maximo: 2,
    nota: "Máximo de clientas activas que puede respaldar la misma responsable — Requerimiento Maestro / Solicitud de Crédito FOOAX 2026.",
  },
  tope_aval: {
    maximo: 1,
    nota: "Máximo de clientas activas que puede respaldar el mismo aval — solo aplica en créditos mayores a $10,000.",
  },
  checklist_base: {
    documentos: [
      "solicitante_ine", "solicitante_comprobante_domicilio", "solicitante_curp", "solicitante_foto_negocio",
      "responsable_ine", "responsable_comprobante_domicilio",
    ],
    nota: "Documentos que exige siempre el checklist del expediente (Sección 12, Solicitud de Crédito FOOAX 2026).",
  },
  checklist_aval: {
    documentos: ["aval_ine", "aval_comprobante_domicilio"],
    nota: "Documentos adicionales cuando el crédito requiere aval.",
  },
};

async function init() {
  if (usePg) {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS reglas (
      id serial PRIMARY KEY,
      clave text NOT NULL,
      valor jsonb NOT NULL,
      version int NOT NULL,
      vigente_desde bigint NOT NULL,
      vigente_hasta bigint,
      aprobado_por text,
      motivo text,
      creado_ts bigint NOT NULL
    )`);
    // Garantía a nivel de base de datos (no solo de código) de que nunca hay
    // dos versiones "vigentes" al mismo tiempo para la misma clave.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS reglas_vigente_unica
      ON reglas (clave) WHERE vigente_hasta IS NULL`);
    const r = await pool.query("SELECT * FROM reglas ORDER BY clave, version");
    mem.reglas = r.rows;
  } else {
    mem.reglas = leerJSON("motor_reglas.json", []);
    recalcularSecuencia();
  }
  await sembrarSiFaltan();
  console.log(`[motor_reglas] listo · ${mem.reglas.length} versiones de reglas · ${todasVigentes().length} vigentes`);
}

async function sembrarSiFaltan() {
  for (const [clave, valor] of Object.entries(VALORES_INICIALES)) {
    if (!obtenerRegla(clave)) {
      await crearVersion(clave, valor, {
        aprobado_por: "sistema",
        motivo: "valor con el que ya operaba el sistema antes de este motor de reglas — sembrado automáticamente para no cambiar comportamiento al instalarlo",
      });
    }
  }
}

// ---------- lectura ----------
function obtenerRegla(clave) {
  return mem.reglas.find((r) => r.clave === clave && r.vigente_hasta == null) || null;
}
function historialRegla(clave) {
  return mem.reglas.filter((r) => r.clave === clave).sort((a, b) => a.version - b.version);
}
function todasVigentes() {
  const claves = [...new Set(mem.reglas.map((r) => r.clave))];
  return claves.map((c) => obtenerRegla(c)).filter(Boolean);
}

// ---------- escritura: SIEMPRE crea una versión nueva, nunca actualiza una
// existente. Cierra la anterior (vigente_hasta) antes de abrir la siguiente. ----------
async function crearVersion(clave, valor, { aprobado_por, motivo } = {}) {
  const anterior = obtenerRegla(clave);
  const version = anterior ? anterior.version + 1 : 1;
  const ahora = Date.now();

  if (anterior) {
    anterior.vigente_hasta = ahora;
    if (usePg) {
      await pool.query("UPDATE reglas SET vigente_hasta=$2 WHERE id=$1", [anterior.id, ahora])
        .catch((e) => console.error("[motor_reglas] cerrar versión anterior:", e.message));
    }
  }

  let id;
  if (usePg) {
    const ins = await pool.query(
      "INSERT INTO reglas (clave, valor, version, vigente_desde, vigente_hasta, aprobado_por, motivo, creado_ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [clave, valor, version, ahora, null, aprobado_por || null, motivo || null, ahora]
    ).catch((e) => { console.error("[motor_reglas] nueva versión:", e.message); return null; });
    id = ins ? ins.rows[0].id : siguienteId(); // respaldo si la inserción falló: al menos queda en memoria
  } else {
    id = siguienteId();
  }

  const row = {
    id, clave, valor, version,
    vigente_desde: ahora, vigente_hasta: null,
    aprobado_por: aprobado_por || null, motivo: motivo || null, creado_ts: ahora,
  };
  mem.reglas.push(row);
  if (!usePg) persistir();
  return row;
}

// Verbo público — para quien llama la API, "actualizar" es lo que tiene
// sentido; por dentro siempre es crear una versión nueva y cerrar la anterior.
async function actualizarRegla(clave, valor, opciones) {
  return crearVersion(clave, valor, opciones);
}

// ---------- ayudantes específicos — para que quien retrofittea una regla
// existente no tenga que repetir "si no hay fila, usa este respaldo" en cada
// sitio. Devuelven { valor, clave, version } o el respaldo con version 0 (0 =
// "todavía no hay una regla en la base, se está usando el valor de fábrica"). ----------
function obtenerConRespaldo(clave, respaldo) {
  const r = obtenerRegla(clave);
  if (r) return { valor: r.valor, clave: r.clave, version: r.version };
  console.error(`[motor_reglas] no hay regla vigente para "${clave}" — usando respaldo de fábrica. ¿Corrió init()?`);
  return { valor: respaldo, clave, version: 0 };
}

module.exports = {
  init,
  obtenerRegla, historialRegla, todasVigentes,
  actualizarRegla, obtenerConRespaldo,
  VALORES_INICIALES,
  // expuesto para pruebas / diagnóstico, nunca para lógica de negocio nueva:
  _mem: mem,
};
