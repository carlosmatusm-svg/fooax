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
const mem = { snapshots: {}, movimientos: [], padron: [], padronBase: [], cambios: [], sesiones: {} };

// Aplica las altas y bajas (capa de cambios) sobre el padrón base del archivo.
// Alta: agrega la clienta. Baja: la marca inactiva (estatus BAJA) sin borrar su
// historia. Devuelve un padrón NUEVO sin mutar el base.
function aplicarCambios(base, cambios) {
  const arr = base.map((c) => Object.assign({}, c));
  const norm2 = (s) => String(s || "").toLowerCase().trim();
  for (const c of cambios) {
    if (c.tipo === "alta" && c.clienta) {
      // Si el padrón base ya la trae (una recarga de plantillas la incluyó),
      // no duplicar: el alta del tablero ya quedó absorbida por la base.
      const ya = arr.some((cl) => String(cl.id) === String(c.clienta.id) && norm2(cl.producto) === norm2(c.clienta.producto));
      if (!ya) arr.push(Object.assign({}, c.clienta, { origen: "alta", activa: true }));
    } else if (c.tipo === "baja") {
      for (const cl of arr) {
        if (String(cl.id) === String(c.id) && (!c.producto || norm2(cl.producto) === norm2(c.producto))) {
          cl.activa = false; cl.estatus = "BAJA";
          cl.motivo_baja = c.motivo || null; cl.fecha_baja = c.fecha || null; cl.baja_por = c.por || null;
        }
      }
    } else if (c.tipo === "ajuste") {
      // EDICIÓN de un crédito por dirección (Anel/Monse): ajuste de saldo/cuota o
      // marcar VENCIDA con su mora. Nunca borra; deja rastro (quién, cuándo, por
      // qué y el saldo anterior). Se aplica al crédito exacto (socio + producto).
      for (const cl of arr) {
        if (String(cl.id) !== String(c.id)) continue;
        if (c.producto && norm2(cl.producto) !== norm2(c.producto)) continue;
        const k = c.campos || {};
        if (k.saldo != null && Number.isFinite(Number(k.saldo))) { cl.saldo_anterior = cl.saldo; cl.saldo = Number(k.saldo); }
        if (k.cuota != null && Number.isFinite(Number(k.cuota))) cl.cuota = Number(k.cuota);
        if (k.mora != null && Number.isFinite(Number(k.mora))) cl.mora = Number(k.mora);
        if (k.estatus) cl.estatus = k.estatus;
        cl.ajuste_motivo = c.motivo || null; cl.ajuste_por = c.por || null; cl.ajuste_fecha = c.fecha || null;
      }
    }
  }
  for (const cl of arr) if (cl.activa === undefined) cl.activa = cl.estatus !== "BAJA";
  return arr;
}

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
    await pool.query("CREATE TABLE IF NOT EXISTS padron_cambios (id text, data jsonb, ts bigint)");
    // Historial de snapshots: cada vez que un sync REEMPLAZA la foto de un día,
    // la versión anterior se archiva aquí (append-only). Así una captura con
    // fecha equivocada nunca destruye cobranza real: siempre es recuperable.
    await pool.query("CREATE TABLE IF NOT EXISTS snapshots_hist (id serial PRIMARY KEY, ejecutivo text, fecha text, data jsonb, ts bigint, recibido bigint, archivado bigint)");
    // Sesiones persistentes: un redespliegue NO desloguea a las ejecutivas a
    // media jornada (antes vivían solo en memoria y cada deploy las mataba).
    await pool.query("CREATE TABLE IF NOT EXISTS sesiones (sid text PRIMARY KEY, usuario text, creada bigint)");
    const se = await pool.query("SELECT sid, usuario, creada FROM sesiones").catch(() => ({ rows: [] }));
    for (const r of se.rows) mem.sesiones[r.sid] = { usuario: r.usuario, creada: Number(r.creada) };

    const s = await pool.query("SELECT ejecutivo, fecha, data, ts, recibido FROM snapshots");
    for (const r of s.rows) {
      mem.snapshots[r.ejecutivo] = mem.snapshots[r.ejecutivo] || {};
      mem.snapshots[r.ejecutivo][r.fecha] = Object.assign({}, r.data, {
        ts: Number(r.ts), recibido: Number(r.recibido),
      });
    }
    const m = await pool.query("SELECT data FROM movimientos ORDER BY ts");
    mem.movimientos = m.rows.map((r) => r.data);
    // El padrón (directorio de clientas con sus cuotas reales) es dato de
    // referencia: su fuente de verdad es el archivo que viaja con el código.
    // En cada arranque se refresca en la base para reflejar cuotas actualizadas.
    // (En Fase 1, cuando haya altas/bajas dentro de la app, esto cambiará.)
    // Carga primero lo que haya en la base (arranque garantizado). Luego intenta
    // refrescar desde el archivo en lotes; si algo falla, se queda con lo de la
    // base y NUNCA tumba el arranque.
    const cb = await pool.query("SELECT data FROM padron_cambios ORDER BY ts");
    mem.cambios = cb.rows.map((r) => r.data);

    const p0 = await pool.query("SELECT data FROM padron").catch(() => ({ rows: [] }));
    mem.padronBase = p0.rows.map((r) => r.data);
    try {
      const seed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "padron.json"), "utf8"));
      await pool.query("DELETE FROM padron");
      for (let i = 0; i < seed.length; i += 500) {
        const chunk = seed.slice(i, i + 500);
        const vals = chunk.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2})`).join(",");
        const params = [];
        chunk.forEach((c) => { params.push(c.id, c); });
        await pool.query(`INSERT INTO padron (id, data) VALUES ${vals}`, params);
      }
      mem.padronBase = seed;
      console.log(`[store] padrón base actualizado desde archivo: ${seed.length}`);
    } catch (e) {
      console.error("[store] no se refrescó el padrón (uso el de la base):", e.message);
    }
    mem.padron = aplicarCambios(mem.padronBase, mem.cambios);
    console.log(`[store] PostgreSQL listo · ${mem.padron.length} clientas (${mem.cambios.length} cambios), ${mem.movimientos.length} movimientos`);
  } else {
    try { mem.snapshots = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "snapshots.json"), "utf8")); } catch { mem.snapshots = {}; }
    try { mem.movimientos = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "movimientos.json"), "utf8")); } catch { mem.movimientos = []; }
    try { mem.padronBase = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "padron.json"), "utf8")); } catch { mem.padronBase = []; }
    try { mem.cambios = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "padron_cambios.json"), "utf8")); } catch { mem.cambios = []; }
    try { mem.sesiones = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sesiones.json"), "utf8")); } catch { mem.sesiones = {}; }
    mem.padron = aplicarCambios(mem.padronBase, mem.cambios);
    console.log(`[store] archivos locales · ${mem.padron.length} clientas (${mem.cambios.length} cambios)`);
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
function persistCambio(c) {
  if (usePg) {
    pool.query("INSERT INTO padron_cambios (id, data, ts) VALUES ($1,$2,$3)", [String(c.id || ""), c, c.ts])
      .catch((e) => console.error("[store] cambio padrón:", e.message));
  } else escribirJSON("padron_cambios.json", mem.cambios);
}
function persistSesion(sid, s) {
  if (usePg) {
    pool.query("INSERT INTO sesiones (sid, usuario, creada) VALUES ($1,$2,$3) ON CONFLICT (sid) DO NOTHING",
      [sid, s.usuario, s.creada]).catch((e) => console.error("[store] sesión:", e.message));
  } else escribirJSON("sesiones.json", mem.sesiones);
}
function eliminarSesion(sid) {
  if (usePg) {
    pool.query("DELETE FROM sesiones WHERE sid=$1", [sid]).catch((e) => console.error("[store] sesión:", e.message));
  } else escribirJSON("sesiones.json", mem.sesiones);
}

module.exports = {
  init,
  modo() { return usePg ? "postgres" : "archivos"; },
  conteos() {
    let snaps = 0;
    for (const ej in mem.snapshots) snaps += Object.keys(mem.snapshots[ej]).length;
    return { snapshots: snaps, movimientos: mem.movimientos.length, padron: mem.padron.length };
  },
  padron() { return mem.padron; },

  // Upsert idempotente por (ejecutivo, fecha): reenviar el mismo snapshot nunca
  // duplica, solo reemplaza por la versión más reciente. ANTES de reemplazar,
  // la versión anterior se archiva en el historial: una captura con fecha
  // equivocada (teléfono pegado en el día viejo) ya no puede destruir la
  // cobranza real de ese día — siempre se puede recuperar.
  guardarSnapshot(ejecutivo, fecha, snapshot) {
    mem.snapshots[ejecutivo] = mem.snapshots[ejecutivo] || {};
    const previo = mem.snapshots[ejecutivo][fecha];
    if (previo && previo.ts > snapshot.ts) return previo;
    if (previo && previo.snapshot !== snapshot.snapshot) {
      const copia = Object.assign({}, previo, { archivado: Date.now() });
      if (usePg) {
        pool.query(
          "INSERT INTO snapshots_hist (ejecutivo, fecha, data, ts, recibido, archivado) VALUES ($1,$2,$3,$4,$5,$6)",
          [ejecutivo, fecha, copia, copia.ts || 0, copia.recibido || 0, copia.archivado]
        ).catch((e) => console.error("[store] historial:", e.message));
      } else {
        try {
          const p = path.join(DATA_DIR, "snapshots_hist.jsonl");
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.appendFileSync(p, JSON.stringify({ ejecutivo, fecha, ...copia }) + "\n");
        } catch (e) { console.error("[store] historial:", e.message); }
      }
    }
    const rec = Object.assign({}, snapshot, { recibido: Date.now() });
    // El sello de CIERRE (y su confirmación) sobrevive a los reemplazos: sin
    // esto, el primer pago tardío después de cerrar borraba el sello, el
    // SEGUNDO ya no fusionaba (reemplazaba y perdía el día), y el "cerró ✓"
    // desaparecía del tablero.
    if (previo) {
      if (previo.cierre && !rec.cierre) rec.cierre = previo.cierre;
      if (previo.confirmado && !rec.confirmado) rec.confirmado = previo.confirmado;
      if (previo.baseCerrada != null && rec.baseCerrada == null) rec.baseCerrada = previo.baseCerrada;
    }
    mem.snapshots[ejecutivo][fecha] = rec;
    persistSnapshot(ejecutivo, fecha, rec);
    return rec;
  },
  snapshotsDeFecha(fecha) {
    const out = {};
    for (const ej in mem.snapshots) if (mem.snapshots[ej][fecha]) out[ej] = mem.snapshots[ej][fecha];
    return out;
  },
  // Todas las versiones archivadas de un día (para rescate). Cada vez que un
  // snapshot se sobrescribe, la versión anterior queda aquí — así se puede
  // recuperar la buena aunque una captura vacía la haya pisado.
  async historialDeFecha(fecha) {
    if (usePg) {
      const r = await pool.query(
        "SELECT ejecutivo, data, ts, recibido, archivado FROM snapshots_hist WHERE fecha=$1 ORDER BY archivado",
        [fecha]
      );
      return r.rows.map((x) => ({ ejecutivo: x.ejecutivo, ...x.data, ts: Number(x.ts), archivado: Number(x.archivado) }));
    }
    try {
      const p = path.join(DATA_DIR, "snapshots_hist.jsonl");
      if (!fs.existsSync(p)) return [];
      return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean)
        .map((l) => JSON.parse(l)).filter((x) => x.fecha === fecha);
    } catch { return []; }
  },
  respaldo() { return { snapshots: mem.snapshots, movimientos: mem.movimientos }; },

  // Append-only: nunca se borra ni se edita un movimiento (rastro auditable).
  agregarMovimiento(mov) {
    // Idempotente por folio. Las ejecutivas sincronizan muchas veces al día y
    // cada sincronización reenvía TODOS sus movimientos; sin esto, el mismo
    // gasto se contaba una vez por sincronización y el efectivo a entregar
    // salía inflado. En Postgres el INSERT ya trae ON CONFLICT DO NOTHING,
    // pero la lista en memoria —que es la que lee el tablero— sí duplicaba.
    const ya = mem.movimientos.find((m) => m.folio === mov.folio);
    if (ya) return ya;
    mem.movimientos.push(mov);
    persistMovimiento(mov);
    return mov;
  },
  movimientosDeFecha(fecha) {
    return mem.movimientos.filter((m) => m.fecha === fecha);
  },
  todosMovimientos() { return mem.movimientos; },
  // Marca la hora en que la ejecutiva CERRÓ su día (botón "Enviar arqueo y
  // cerrar captura" o "Cerrar día"). Vive dentro del registro del snapshot,
  // así que persiste y sobrevive reinicios. Monse ve quién cerró y quién no.
  marcarCierre(ejecutivo, fecha, confirmado) {
    const rec = mem.snapshots[ejecutivo] && mem.snapshots[ejecutivo][fecha];
    if (!rec) return false;
    rec.cierre = Date.now();
    // confirmado = la ejecutiva marcó la palomita "lo que capturé es verdad".
    if (confirmado) rec.confirmado = Date.now();
    // FOTO CONGELADA del día al momento del cierre: las capturas de la sesión
    // siguiente se fusionan SIEMPRE contra esta base (no contra el último
    // merge), para que re-sincronizar sea idempotente y nada se duplique.
    rec.baseCerrada = rec.snapshot;
    persistSnapshot(ejecutivo, fecha, rec);
    return true;
  },
  // Retira el snapshot de un día (lo archiva en el historial ANTES de quitarlo).
  // Se usa cuando una captura estaba MAL FECHADA y ya se re-etiquetó al día
  // correcto: sin esto, la semana contaba ese dinero dos veces (una por fecha).
  retirarSnapshot(ejecutivo, fecha) {
    const rec = mem.snapshots[ejecutivo] && mem.snapshots[ejecutivo][fecha];
    if (!rec) return false;
    const copia = Object.assign({}, rec, { archivado: Date.now(), motivo: "reetiquetado" });
    if (usePg) {
      pool.query(
        "INSERT INTO snapshots_hist (ejecutivo, fecha, data, ts, recibido, archivado) VALUES ($1,$2,$3,$4,$5,$6)",
        [ejecutivo, fecha, copia, copia.ts || 0, copia.recibido || 0, copia.archivado]
      ).catch((e) => console.error("[store] hist reetiquetado:", e.message));
      pool.query("DELETE FROM snapshots WHERE ejecutivo=$1 AND fecha=$2", [ejecutivo, fecha])
        .catch((e) => console.error("[store] retirar:", e.message));
    } else {
      try {
        const ph = path.join(DATA_DIR, "snapshots_hist.jsonl");
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(ph, JSON.stringify({ ejecutivo, fecha, ...copia }) + "\n");
      } catch (e) { console.error("[store] hist reetiquetado:", e.message); }
    }
    delete mem.snapshots[ejecutivo][fecha];
    if (!usePg) escribirJSON("snapshots.json", mem.snapshots);
    return true;
  },
  // Marca/desmarca un movimiento como ANULADO. Nunca se borra: si la ejecutiva
  // lo quitó en su app, aquí queda el rastro (y deja de contar en los totales).
  setMovimientoAnulado(folio, anulado) {
    const m = mem.movimientos.find((x) => x.folio === folio);
    if (!m || !!m.anulado === !!anulado) return;
    m.anulado = !!anulado;
    m.anuladoTs = anulado ? Date.now() : null;
    if (usePg) {
      pool.query("UPDATE movimientos SET data=$2 WHERE folio=$1", [folio, m])
        .catch((e) => console.error("[store] anular:", e.message));
    } else escribirJSON("movimientos.json", mem.movimientos);
  },

  // Alta / baja de clientas (capa de cambios append-only sobre el padrón base).
  // Se re-aplica en vivo para que el buscador y la cartera reflejen el cambio al
  // instante, y persiste para sobrevivir cualquier redespliegue.
  agregarCambioPadron(cambio) {
    mem.cambios.push(cambio);
    mem.padron = aplicarCambios(mem.padronBase, mem.cambios);
    persistCambio(cambio);
    return cambio;
  },
  cambiosPadron() { return mem.cambios; },

  // Sesiones persistentes (sobreviven redespliegues).
  sesiones() { return mem.sesiones; },
  guardarSesion(sid, datos) {
    mem.sesiones[sid] = datos;
    persistSesion(sid, datos);
  },
  borrarSesion(sid) {
    delete mem.sesiones[sid];
    eliminarSesion(sid);
  },
};
