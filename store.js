// Almacenamiento del sistema FOOAX.
//   • En producción (Railway) usa PostgreSQL — los datos NUNCA se pierden al
//     reiniciar. Se activa solo si existe la variable DATABASE_URL.
//   • En local (tu Mac, sin DATABASE_URL) usa archivos JSON, como antes.
// En ambos casos mantiene una copia en memoria para que las lecturas sean
// instantáneas y síncronas (el resto del servidor no cambia); las escrituras
// se reflejan en memoria y se persisten en la base en segundo plano.
const fs = require("fs");
const path = require("path");

// Carpeta de datos. Se puede apuntar a otra con DATA_DIR para correr la batería
// sobre datos limpios y desechables SIN tocar los de trabajo (la batería exige
// datos limpios y antes había que vaciar `data/`, que es cobranza de verdad):
//   DATA_DIR=/tmp/fooax-prueba node server.js
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const usePg = !!process.env.DATABASE_URL;

let pool = null;
const mem = { snapshots: {}, movimientos: [], padron: [], padronBase: [], cambios: [], sesiones: {}, ajustes: [],
  // Gestión de renovaciones: en qué va cada clienta que está por terminar
  // (Pendiente, Contactada, Renovó, Solo recuperación…). Vivía en el
  // localStorage del teléfono junto con la captura del día, así que al
  // enviar el arqueo se borraba y había que remarcar todo al día siguiente
  // (lo reportó Nery el 19-ago). Append-only, como los ajustes: cada marca
  // se agrega encima y queda quién la puso y cuándo.
  renov: [] };

// ¿ENTRA O SALE ESE DINERO? Desde el 6-ago el movimiento lo trae escrito
// (`entrada`), porque el concepto se elige de un catálogo. Los ANTERIORES no lo
// traen, y todo lo que no dijera "entrada" se trataba como SALIDA: una
// liquidación vieja de $1,500 se RESTABA de la caja en vez de sumarse, y el
// cierre de la semana quedaba mal por el DOBLE. Aquí se deduce del concepto,
// que es lo único que traen esos movimientos.
//
// Se aplica al LEER: no se reescribe nada. Los movimientos son append-only y su
// rastro queda tal como se guardó.
const ENTRAN = /^(liquidaci|recuperaci|comisi|garant|abono|adelanto|reintegro)/;
function conEntrada(m) {
  if (!m || typeof m.entrada === "boolean") return m;
  const txt = String(m.tipo || m.concepto || m.categoria || "")
    .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return Object.assign({}, m, { entrada: ENTRAN.test(txt) });
}

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
      // Un crédito DADO DE BAJA no cuenta como duplicado: es justo el caso de la
      // renovación con el mismo nombre (se cierra el ciclo viejo y se abre otro
      // "Grupal-Basico"). Antes el alta nueva se tragaba en silencio aquí.
      const ya = arr.some((cl) => String(cl.id) === String(c.clienta.id) &&
        norm2(cl.producto) === norm2(c.clienta.producto) &&
        cl.activa !== false && cl.estatus !== "BAJA");
      // EL SALDO LO MANDA LA PLANTILLA, NO EL ALTA. Monse da de alta desde el
      // tablero a las clientas que acaban de desembolsar y todavía no vienen en
      // su archivo. Pero captura el saldo ORIGINAL, y ese renglón se quedaba
      // CONGELADO: por más plantillas que entraran, nunca volvía a bajarle.
      // Se comprobó el 5-ago en 25 créditos: la diferencia contra la plantilla
      // era exactamente el número de pagos que llevaban según su fecha de
      // desembolso (2 cuotas los del 20-jul, 1 los del 23-24). $21,587 de más.
      // Así que si la base (la plantilla) YA trae ese crédito, de ahí salen los
      // montos; del alta solo se conserva que la clienta existe.
      // EXCEPCIÓN: las RENOVACIONES (`recredito`). Ahí el renglón de la base es
      // el ciclo VIEJO —otro monto, otro plazo— y el bueno es el del alta.
      const dePlantilla = (!c.recredito && !(c.clienta && c.clienta.recredito))
        ? base.find((b) => String(b.id) === String(c.clienta.id)
            && norm2(b.producto) === norm2(c.clienta.producto))
        : null;
      const montos = dePlantilla ? {
        saldo: dePlantilla.saldo, cuota: dePlantilla.cuota, plazo: dePlantilla.plazo,
        desembolso: dePlantilla.desembolso, diaPago: dePlantilla.diaPago,
        centro: dePlantilla.centro, noCentro: dePlantilla.noCentro,
        saldoDelAlta: c.clienta.saldo,
      } : {};
      // `alta_fecha` es indispensable para las RENOVACIONES: la llave de un crédito
      // es socio+producto, y al renovar el nombre es el MISMO. Sin la fecha desde la
      // que existe este ciclo, los pagos del ciclo anterior se le descuentan al
      // nuevo (probado el 29-jul: renovó $10,000 y salía en $8,000 porque le
      // restaron los $2,000 con que liquidó el ciclo viejo).
      if (!ya) arr.push(Object.assign({}, c.clienta, montos,
        { origen: "alta", activa: true, alta_fecha: c.fecha || null }));
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
        // Reasignar el crédito a otro ejecutivo o centro. Se guarda de quién
        // venía: mover cartera deja huella (regla §6.1 del Complemento).
        if (k.ejecutivo) { cl.ejecutivo_anterior = cl.ejecutivo; cl.ejecutivo = k.ejecutivo; }
        if (k.centro) { cl.centro_anterior = cl.centro; cl.centro = k.centro; }
        // FECHA DE DESEMBOLSO y DÍA DE PAGO (Karina, 15-ago). Son los dos datos
        // con los que el sistema decide si un crédito debe y bajo qué día. Sin
        // poder capturarlos DESPUÉS del alta, un crédito que nació sin ellos se
        // quedaba así para siempre.
        if (k.desembolso) { cl.desembolso_anterior = cl.desembolso || null; cl.desembolso = k.desembolso; }
        if (k.diaPago) { cl.diaPago_anterior = cl.diaPago || null; cl.diaPago = String(k.diaPago).toUpperCase(); }
        // PLAZO (25-ago). El endpoint lo aceptaba desde el 19-ago pero este
        // replay nunca lo aplicaba: quedaba en la bitácora sin efecto. Con esta
        // línea, los capturados ese tiempo se aplican solos al re-reproducirse.
        if (k.plazo != null && Number.isFinite(Number(k.plazo))) { cl.plazo_anterior = cl.plazo || null; cl.plazo = Number(k.plazo); }
        // Etiqueta (Recuperación, Renovación…). La cadena vacía SÍ cuenta: es
        // como se quita. Por eso se compara contra undefined y no con un if
        // truthy — con un truthy nunca se podría borrar.
        if (k.etiqueta !== undefined) {
          cl.etiqueta = k.etiqueta || null;
          cl.etiqueta_por = c.por || null; cl.etiqueta_fecha = c.fecha || null;
        }
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
    // Correcciones de Dirección sobre la captura de una ejecutiva (pagos,
    // garantías, arqueo). Append-only: nunca se borra nada, se agrega la
    // corrección encima y queda quién la hizo y por qué.
    await pool.query("CREATE TABLE IF NOT EXISTS cobranza_ajustes (id serial PRIMARY KEY, data jsonb, ts bigint)");
    // Gestión de renovaciones por crédito. Append-only: el estado vigente es
    // el último de cada clave, y el historial queda para saber quién movió qué.
    await pool.query("CREATE TABLE IF NOT EXISTS renov_gestion (id serial PRIMARY KEY, data jsonb, ts bigint)");
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
    const aj = await pool.query("SELECT data FROM cobranza_ajustes ORDER BY ts");
    mem.ajustes = aj.rows.map((r) => r.data);
    const gr = await pool.query("SELECT data FROM renov_gestion ORDER BY ts");
    mem.renov = gr.rows.map((r) => r.data);
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
    try { mem.ajustes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "cobranza_ajustes.json"), "utf8")); } catch { mem.ajustes = []; }
    try { mem.renov = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "renov_gestion.json"), "utf8")); } catch { mem.renov = []; }
    try { mem.sesiones = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sesiones.json"), "utf8")); } catch { mem.sesiones = {}; }
    mem.padron = aplicarCambios(mem.padronBase, mem.cambios);
    console.log(`[store] archivos locales · ${mem.padron.length} clientas (${mem.cambios.length} cambios)`);
  }
}

// ---------- persistencia ----------
// Aplica las correcciones de Dirección a los snapshots de un día. Devuelve
// COPIAS: la captura original de la ejecutiva se conserva intacta en memoria y
// en disco, por si hay que revisar qué capturó ella de verdad.
//
// Un ajuste se ve así:
//   { fecha, ejecutivo, clave, campo: "pago"|"garantia"|"solidario",
//     monto: 0, anula: true, motivo, por, ts }
//   { fecha, ejecutivo, arqueo: {500:2,...} }            ← recuento corregido
// El ÚLTIMO ajuste de cada (clave, campo) es el que manda.
function conAjustes(snapsDelDia, fecha) {
  const mios = mem.ajustes.filter((a) => a && a.fecha === fecha);
  if (!mios.length) return snapsDelDia;
  const out = {};
  for (const ej in snapsDelDia) {
    const rec = snapsDelDia[ej];
    const suyos = mios.filter((a) => a.ejecutivo === ej);
    if (!suyos.length) { out[ej] = rec; continue; }
    let data = rec.snapshot;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { out[ej] = rec; continue; } }
    data = JSON.parse(JSON.stringify(data || {}));
    for (const a of suyos) {
      if (a.arqueo && typeof a.arqueo === "object") { data.arqueo = a.arqueo; continue; }
      if (!a.clave) continue;
      // La clienta puede estar en un centro (reg[centro][clave]) o suelta
      // (regI[clave]). Se busca en las dos, no se adivina.
      const tocar = (nodo) => {
        if (!nodo || typeof nodo !== "object") return false;
        if (nodo[a.clave] && typeof nodo[a.clave] === "object") {
          const r = nodo[a.clave];
          if (a.anula) { r.pago = 0; r.garantia = 0; r.solidario = 0; r._anuladoPorDireccion = true; }
          // La FORMA va primero: es un texto (E/T/D/M/CH), no un monto — la
          // rama genérica la dejaría en 0 y el pago se perdería del cierre.
          else if (a.campo === "forma" && a.valor) r.forma = String(a.valor);
          else if (a.campo) r[a.campo] = Number(a.monto) || 0;
          r._ajustadoPor = a.por || "Dirección";
          return true;
        }
        return false;
      };
      let ok = tocar(data.regI);
      if (!ok) for (const c in (data.reg || {})) if (tocar(data.reg[c])) { ok = true; break; }
    }
    out[ej] = Object.assign({}, rec, { snapshot: data });
  }
  return out;
}

function persistAjuste(a) {
  if (usePg) {
    pool.query("INSERT INTO cobranza_ajustes (data, ts) VALUES ($1,$2)", [a, a.ts])
      .catch((e) => console.error("[store] ajuste cobranza:", e.message));
  } else escribirJSON("cobranza_ajustes.json", mem.ajustes);
}
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
  // Para que el servidor use EXACTAMENTE la misma regla al guardar un
  // movimiento que la que se usa al leerlo. Tenerla en dos lados fue justo lo
  // que dejó una liquidación del lado equivocado.
  entradaPorTexto(txt) {
    return ENTRAN.test(String(txt || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").trim());
  },
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
  // CORRECCIONES DE DIRECCIÓN sobre la captura de una ejecutiva.
  // Monse puede anular un pago mal capturado, quitar una garantía que no fue, o
  // corregir el efectivo contado de un arqueo. Va como CAPA ENCIMA, append-only:
  // la captura original nunca se toca y queda el rastro de quién corrigió y por
  // qué. Y va aquí abajo, en el store, a propósito: si viviera en el servidor
  // habría que acordarse de aplicarla en cada cálculo — y tarde o temprano se
  // olvida uno. Así, TODO lo que lea un snapshot ya lo lee corregido.
  ajustesCobranza() { return mem.ajustes; },

  // ---- GESTIÓN DE RENOVACIONES ----
  // El estado VIGENTE de cada crédito es el último que se guardó. Se devuelve
  // ya resuelto en un mapa clave→estado para que nadie tenga que recorrer el
  // historial: quien pregunta quiere saber en qué va la clienta HOY.
  gestionRenovaciones() {
    const out = {};
    for (const g of mem.renov) if (g && g.clave) out[g.clave] = g;
    return out;
  },
  // Historial completo de una clave (para auditar quién la movió y cuándo).
  historialRenovacion(clave) { return mem.renov.filter((g) => g && g.clave === clave); },
  setGestionRenovacion(g) {
    mem.renov.push(g);
    if (usePg) {
      pool.query("INSERT INTO renov_gestion (data, ts) VALUES ($1,$2)", [g, g.ts])
        .catch((e) => console.error("[store] renov:", e.message));
    } else escribirJSON("renov_gestion.json", mem.renov);
    return g;
  },

  agregarAjusteCobranza(a) {
    mem.ajustes.push(a);
    persistAjuste(a);
    return a;
  },
  snapshotsDeFecha(fecha, crudo) {
    const out = {};
    for (const ej in mem.snapshots) if (mem.snapshots[ej][fecha]) out[ej] = mem.snapshots[ej][fecha];
    return crudo ? out : conAjustes(out, fecha);
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
  // Historial COMPLETO de versiones archivadas. Cada fila es una sincronización
  // que reemplazó a la anterior, así que sirve para estudiar cómo trabajan en
  // campo (a qué hora capturan, cuántas veces guardan, qué corrigen).
  async historialTodo(limite) {
    const tope = limite || 20000;
    if (usePg) {
      const r = await pool.query(
        "SELECT ejecutivo, fecha, data, ts, recibido, archivado FROM snapshots_hist ORDER BY archivado DESC LIMIT $1", [tope]
      );
      return r.rows.map((x) => ({ ejecutivo: x.ejecutivo, fecha: x.fecha, ...x.data, ts: Number(x.ts), archivado: Number(x.archivado) }));
    }
    try {
      const p = path.join(DATA_DIR, "snapshots_hist.jsonl");
      if (!fs.existsSync(p)) return [];
      return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(-tope);
    } catch { return []; }
  },
  respaldo(crudo) {
    if (crudo) return { snapshots: mem.snapshots, movimientos: mem.movimientos };
    const snapshots = {};
    for (const ej in mem.snapshots) {
      snapshots[ej] = {};
      for (const f in mem.snapshots[ej]) {
        const uno = conAjustes({ [ej]: mem.snapshots[ej][f] }, f);
        snapshots[ej][f] = uno[ej];
      }
    }
    return { snapshots, movimientos: mem.movimientos.map(conEntrada) };
  },

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
    return mem.movimientos.filter((m) => m.fecha === fecha).map(conEntrada);
  },
  todosMovimientos() { return mem.movimientos.map(conEntrada); },
  // Marca la hora en que la ejecutiva CERRÓ su día (botón "Enviar arqueo y
  // cerrar captura" o "Cerrar día"). Vive dentro del registro del snapshot,
  // así que persiste y sobrevive reinicios. Monse ve quién cerró y quién no.
  marcarCierre(ejecutivo, fecha, confirmado) {
    mem.snapshots[ejecutivo] = mem.snapshots[ejecutivo] || {};
    let rec = mem.snapshots[ejecutivo][fecha];
    // UN DÍA SIN COBRANZA TAMBIÉN SE CIERRA. Antes, si no había snapshot de ese
    // día, el cierre se tiraba en silencio: devolvía false, el servidor
    // contestaba ok igual, la ejecutiva veía "cerrado" en su teléfono y a Monse
    // le seguía apareciendo abierta. Lo reportó Karina el 7-ago con Julio.
    // Un día sin cobrar es un día válido —no salió a ruta, o todo fue
    // transferencia— y tiene que poder cerrarse.
    if (!rec) {
      rec = { snapshot: {}, ts: Date.now(), recibido: Date.now() };
      mem.snapshots[ejecutivo][fecha] = rec;
    }
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
  // "Capturar todo de nuevo": la ejecutiva decidió que su día cuente desde cero.
  // Archiva la versión actual en el historial (recuperable siempre) y quita el
  // cierre y su foto congelada, para que la siguiente sincronización REEMPLACE
  // el día en lugar de fusionarse (sumarse) con lo anterior.
  reiniciarDia(ejecutivo, fecha) {
    const rec = mem.snapshots[ejecutivo] && mem.snapshots[ejecutivo][fecha];
    if (!rec) return false;
    const copia = Object.assign({}, rec, { archivado: Date.now(), motivo: "reinicio" });
    if (usePg) {
      pool.query(
        "INSERT INTO snapshots_hist (ejecutivo, fecha, data, ts, recibido, archivado) VALUES ($1,$2,$3,$4,$5,$6)",
        [ejecutivo, fecha, copia, copia.ts || 0, copia.recibido || 0, copia.archivado]
      ).catch((e) => console.error("[store] hist reinicio:", e.message));
    } else {
      try {
        const ph = path.join(DATA_DIR, "snapshots_hist.jsonl");
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(ph, JSON.stringify({ ejecutivo, fecha, ...copia }) + "\n");
      } catch (e) { console.error("[store] hist reinicio:", e.message); }
    }
    delete rec.cierre; delete rec.confirmado; delete rec.baseCerrada;
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
  // Corrige la FORMA de un movimiento ya guardado (método y/o número de
  // cheque) sin tocar monto, concepto ni anulado. Nació para los cheques que
  // se guardaban como "efectivo" y descuadraban el arqueo (faltante 25-jul).
  corregirMovimiento(folio, campos) {
    const m = mem.movimientos.find((x) => x.folio === folio);
    if (!m) return false;
    if ("metodo" in campos && campos.metodo) m.metodo = campos.metodo;
    if ("cheque" in campos) m.cheque = campos.cheque || null;
    // A QUÉ CRÉDITO va una liquidación. Se puede corregir después porque los
    // movimientos anteriores al 8-ago-2026 no lo traen: se guardaba sólo el
    // socio y el abono acababa en el crédito equivocado. Queda con quién y por
    // qué lo corrigió — el monto no se toca, sólo se dice a dónde pertenece.
    // EL MONTO ENTREGADO se puede corregir (hoja CORRECCIONES de la Ing.
    // Karina, 24-ago): debe decir exactamente lo que se le entregó a la
    // clienta. Con rastro — cuánto decía, quién y por qué.
    if ("monto" in campos && Number(campos.monto) > 0) {
      m.montoAnterior = m.monto;
      m.monto = Number(campos.monto);
      m.montoCorrigioPor = campos.montoPor || null;
      m.montoCorrigioMotivo = campos.montoMotivo || null;
      m.montoCorrigioTs = Date.now();
    }
    if ("producto" in campos) {
      m.productoAnterior = m.producto || null;
      m.producto = campos.producto || null;
      if (campos.productoPor) m.productoPor = campos.productoPor;
      if (campos.productoMotivo) m.productoMotivo = campos.productoMotivo;
      m.productoTs = Date.now();
    }
    if (usePg) {
      pool.query("UPDATE movimientos SET data=$2 WHERE folio=$1", [folio, m])
        .catch((e) => console.error("[store] corregir:", e.message));
    } else escribirJSON("movimientos.json", mem.movimientos);
    return true;
  },
  // Marca/desmarca un movimiento como ANULADO. Nunca se borra: si la ejecutiva
  // lo quitó en su app, aquí queda el rastro (y deja de contar en los totales).
  // `por` y `motivo` (opcionales): cuando lo anula Dirección desde el tablero
  // queda escrito QUIÉN y POR QUÉ — un movimiento de caja que desaparece sin
  // explicación es justo lo que no puede pasar en una SOFOM.
  setMovimientoAnulado(folio, anulado, por, motivo) {
    const m = mem.movimientos.find((x) => x.folio === folio);
    if (!m || !!m.anulado === !!anulado) return;
    m.anulado = !!anulado;
    m.anuladoTs = anulado ? Date.now() : null;
    m.anuladoPor = anulado ? (por || null) : null;
    m.anuladoMotivo = anulado ? (motivo || null) : null;
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
