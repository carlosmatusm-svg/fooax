// Almacenamiento del sistema FOOAX.
//   • En producción (Railway) usa PostgreSQL — los datos NUNCA se pierden al
//     reiniciar. Se activa solo si existe la variable DATABASE_URL.
//   • En local (tu Mac, sin DATABASE_URL) usa archivos JSON, como antes.
// En ambos casos mantiene una copia en memoria para que las lecturas sean
// instantáneas y síncronas (el resto del servidor no cambia); las escrituras
// se reflejan en memoria y se persisten en la base en segundo plano.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const usePg = !!process.env.DATABASE_URL;

let pool = null;
const mem = { snapshots: {}, movimientos: [], padron: [] };

// ---------- arranque ----------
async function init() {
  if (usePg) {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await pool.query(
      "CREATE TABLE IF NOT EXISTS snapshots (ejecutivo text, fecha text, data jsonb, ts bigint, recibido bigint, PRIMARY KEY (ejecutivo, fecha))"
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS movimientos (folio text PRIMARY KEY, fecha text, data jsonb, ts bigint)"
    );
    await pool.query("CREATE TABLE IF NOT EXISTS padron (id text, data jsonb)");

    const s = await pool.query("SELECT ejecutivo, fecha, data, ts, recibido FROM snapshots");
    for (const r of s.rows) {
      mem.snapshots[r.ejecutivo] = mem.snapshots[r.ejecutivo] || {};
      mem.snapshots[r.ejecutivo][r.fecha] = Object.assign({}, r.data, {
        ts: Number(r.ts), recibido: Number(r.recibido),
      });
    }
    const m = await pool.query("SELECT data FROM movimientos ORDER BY ts");
    mem.movimientos = m.rows.map((r) => r.data);
    const p = await pool.query("SELECT data FROM padron");
    mem.padron = p.rows.map((r) => r.data);

    // Siembra el padrón la primera vez (desde el archivo que viaja con el código).
    if (mem.padron.length === 0) {
      try {
        const seed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "padron.json"), "utf8"));
        for (const c of seed) await pool.query("INSERT INTO padron (id, data) VALUES ($1,$2)", [c.id, c]);
        mem.padron = seed;
        console.log(`[store] padrón sembrado en PostgreSQL: ${seed.length}`);
      } catch (e) { console.error("[store] no se pudo sembrar padrón:", e.message); }
    }
    console.log(`[store] PostgreSQL listo · ${mem.padron.length} clientas, ${mem.movimientos.length} movimientos`);
  } else {
    try { mem.snapshots = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "snapshots.json"), "utf8")); } catch { mem.snapshots = {}; }
    try { mem.movimientos = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "movimientos.json"), "utf8")); } catch { mem.movimientos = []; }
    try { mem.padron = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "padron.json"), "utf8")); } catch { mem.padron = []; }
    console.log(`[store] archivos locales · ${mem.padron.length} clientas`);
  }
}

// ---------- persistencia ----------
function escribirJSON(file, obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, file), tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, p);
  } catch (e) { console.error("[store] archivo:", e.message); }
}
function persistSnapshot(ejecutivo, fecha, rec) {
  if (usePg) {
    pool.query(
      "INSERT INTO snapshots (ejecutivo, fecha, data, ts, recibido) VALUES ($1,$2,$3,$4,$5) " +
      "ON CONFLICT (ejecutivo, fecha) DO UPDATE SET data=$3, ts=$4, recibido=$5",
      [ejecutivo, fecha, rec, rec.ts, rec.recibido]
    ).catch((e) => console.error("[store] snapshot:", e.message));
  } else escribirJSON("snapshots.json", mem.snapshots);
}
function persistMovimiento(mov) {
  if (usePg) {
    pool.query(
      "INSERT INTO movimientos (folio, fecha, data, ts) VALUES ($1,$2,$3,$4) ON CONFLICT (folio) DO NOTHING",
      [mov.folio, mov.fecha, mov, mov.ts]
    ).catch((e) => console.error("[store] movimiento:", e.message));
  } else escribirJSON("movimientos.json", mem.movimientos);
}

module.exports = {
  init,
  padron() { return mem.padron; },

  // Upsert idempotente por (ejecutivo, fecha): reenviar el mismo snapshot nunca
  // duplica, solo reemplaza por la versión más reciente.
  guardarSnapshot(ejecutivo, fecha, snapshot) {
    mem.snapshots[ejecutivo] = mem.snapshots[ejecutivo] || {};
    const previo = mem.snapshots[ejecutivo][fecha];
    if (previo && previo.ts > snapshot.ts) return previo;
    const rec = Object.assign({}, snapshot, { recibido: Date.now() });
    mem.snapshots[ejecutivo][fecha] = rec;
    persistSnapshot(ejecutivo, fecha, rec);
    return rec;
  },
  snapshotsDeFecha(fecha) {
    const out = {};
    for (const ej in mem.snapshots) if (mem.snapshots[ej][fecha]) out[ej] = mem.snapshots[ej][fecha];
    return out;
  },
  respaldo() { return { snapshots: mem.snapshots, movimientos: mem.movimientos }; },

  // Append-only: nunca se borra ni se edita un movimiento (rastro auditable).
  agregarMovimiento(mov) {
    mem.movimientos.push(mov);
    persistMovimiento(mov);
    return mov;
  },
  movimientosDeFecha(fecha) {
    return mem.movimientos.filter((m) => m.fecha === fecha);
  },
};
