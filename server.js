// FOOAX — Sistema Central de Cobranza · esqueleto Fase 0
// Express + almacenamiento local (store.js) intercambiable por PostgreSQL en Railway.
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const store = require("./store");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------- usuarios ----------
// Contraseñas iniciales del esqueleto local; en Railway se cambian y se
// guardan como hash scrypt en la base. rol: ejecutivo | direccion | admin
// Las contraseñas se pueden fijar por variables de entorno en Railway
// (PASS_NERI, PASS_KARINA, …). Si no, usan las de prueba — CÁMBIALAS en producción.
const USUARIOS = {
  neri:        { nombre: "Neri",        rol: "ejecutivo", app: "App_Cobranza_NERI_GERENTE.html", pass: process.env.PASS_NERI        || "neri2026" },
  karina:      { nombre: "Karina",      rol: "ejecutivo", app: "App_Cobranza_KARINA.html",       pass: process.env.PASS_KARINA      || "karina2026" },
  christopher: { nombre: "Christopher", rol: "ejecutivo", app: "App_Cobranza_CHRISTOPHER.html",  pass: process.env.PASS_CHRISTOPHER || "chris2026" },
  monse:       { nombre: "Monserrat",   rol: "admin",     pass: process.env.PASS_MONSE      || "monse2026" },
  anel:        { nombre: "Anel",        rol: "direccion", pass: process.env.PASS_ANEL       || "anel2026" },
  alejandra:   { nombre: "Alejandra",   rol: "admin",     pass: process.env.PASS_ALEJANDRA  || "alejandra2026" },
};

// Fecha de HOY en horario de México (no UTC). Evita que el "día" cambie a las
// 6 PM y la cobranza de la tarde se parta o desaparezca del tablero.
function hoyMX() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

// ---------- sesiones (cookie httpOnly) ----------
// Persistentes vía store: un redespliegue NO desloguea a las ejecutivas a media
// jornada. Antes vivían en un Map en memoria y cada deploy las mataba — y una
// sesión muerta a media jornada era justo lo que hacía fallar la app en campo.
const borrarTelefono = new Set();
function crearSesion(usuario) {
  const sid = crypto.randomBytes(24).toString("hex");
  store.guardarSesion(sid, { usuario, creada: Date.now() });
  return sid;
}
function usuarioDe(req) {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("sid="));
  if (!cookie) return null;
  const ses = store.sesiones()[cookie.slice(4)];
  return ses ? { id: ses.usuario, ...USUARIOS[ses.usuario] } : null;
}
function requiere(...roles) {
  return (req, res, next) => {
    const u = usuarioDe(req);
    if (!u) return res.status(401).json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." });
    if (roles.length && !roles.includes(u.rol)) return res.status(403).json({ error: "No tienes permiso para ver esta sección." });
    req.usuario = u;
    next();
  };
}
// Guardián para PÁGINAS: si la sesión no sirve, manda al login — nunca
// muestra el JSON de error crudo en el navegador (pasaba al recargar /app).
function paginaRequiere(...roles) {
  return (req, res, next) => {
    const u = usuarioDe(req);
    if (!u || (roles.length && !roles.includes(u.rol))) return res.redirect("/");
    req.usuario = u;
    next();
  };
}

// ---------- diagnóstico (sin datos sensibles) ----------
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    almacen: store.modo(),               // "postgres" (persiste) o "archivos" (se borra al reiniciar)
    tieneDATABASE_URL: !!process.env.DATABASE_URL,
    region: process.env.RAILWAY_REPLICA_REGION || process.env.RAILWAY_REGION || "desconocida",
    proyecto: process.env.RAILWAY_PROJECT_NAME || null,
    ambiente: process.env.RAILWAY_ENVIRONMENT_NAME || null,
    conteos: store.conteos(),
  });
});

// ---------- auth ----------
app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body || {};
  const u = USUARIOS[(usuario || "").toLowerCase().trim()];
  if (!u || u.pass !== password) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  const sid = crearSesion((usuario || "").toLowerCase().trim());
  // Max-Age: sin él la cookie muere al cerrar el navegador del celular y les
  // pedía iniciar sesión a cada rato. 60 días; el borrado remoto sigue mandando.
  const segura = (req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=5184000${segura}`);
  res.json({ ok: true, rol: u.rol, nombre: u.nombre });
});
app.post("/api/logout", (req, res) => {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("sid="));
  if (cookie) store.borrarSesion(cookie.slice(4));
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => {
  const u = usuarioDe(req);
  if (!u) return res.status(401).json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." });
  res.json({ usuario: u.id, nombre: u.nombre, rol: u.rol, wipe: borrarTelefono.has(u.id) });
});

// ---------- borrado remoto de datos del teléfono ----------
// Dirección/Admin marca a un ejecutivo (teléfono perdido o dejó de trabajar);
// la próxima vez que ese teléfono abra la app con señal, limpia todos los datos.
app.post("/api/telefono/borrar", requiere("direccion", "admin"), (req, res) => {
  const ejec = String((req.body || {}).usuario || "").toLowerCase().trim();
  if (!USUARIOS[ejec] || USUARIOS[ejec].rol !== "ejecutivo") {
    return res.status(400).json({ error: "Elige un ejecutivo válido." });
  }
  borrarTelefono.add(ejec);
  res.json({ ok: true });
});
// El teléfono confirma que ya borró → se quita la bandera.
app.post("/api/telefono/borrado-hecho", requiere("ejecutivo"), (req, res) => {
  borrarTelefono.delete(req.usuario.id);
  res.json({ ok: true });
});
// Estado (para el tablero): quién está marcado.
app.get("/api/telefono/marcados", requiere("direccion", "admin"), (req, res) => {
  res.json({ marcados: Array.from(borrarTelefono) });
});

// ---------- sincronización ----------
// La app manda su estado completo del día; upsert idempotente por (ejecutivo, fecha).
app.post("/api/sync", requiere("ejecutivo"), (req, res) => {
  const { fecha, snapshot, ts } = req.body || {};
  if (!fecha || !snapshot) return res.status(400).json({ error: "Faltan datos para sincronizar (la fecha o la captura)." });
  store.guardarSnapshot(req.usuario.id, fecha, { snapshot, ts: ts || Date.now() });
  res.json({ ok: true, recibido: new Date().toISOString() });
});

// ---------- consolidado ----------
// Recorre el snapshot buscando registros de pago (pago/garantia/solidario)
// sin depender de la forma exacta del árbol reg/regI.
function acumular(nodo, acc) {
  if (!nodo || typeof nodo !== "object") return;
  if (Array.isArray(nodo)) { nodo.forEach(n => acumular(n, acc)); return; }
  const esPago = ["pago", "garantia", "solidario"].some(k => typeof nodo[k] === "number" && nodo[k] > 0);
  if (esPago) {
    const pago = nodo.pago || 0, gar = nodo.garantia || 0, sol = nodo.solidario || 0;
    const total = pago + gar + sol;
    acc.pago += pago; acc.garantias += gar; acc.solidario += sol;
    acc.clientasPagaron += 1;
    if (nodo.forma === "T") acc.transferencia += total;
    else if (nodo.forma === "M") { acc.efectivo += nodo.mixEfe || 0; acc.transferencia += nodo.mixTr || 0; }
    else acc.efectivo += total; // 'E' o sin forma marcada: efectivo
    return;
  }
  Object.values(nodo).forEach(v => acumular(v, acc));
}

// Vista de los TRES ejecutivos juntos: es información de dirección/administración.
// Un ejecutivo nunca ve los números de sus compañeras (permisos finos, Fase 1).
app.get("/api/consolidado", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const snaps = store.snapshotsDeFecha(fecha);
  const ejecutivos = {};
  for (const id of ["neri", "karina", "christopher"]) {
    const s = snaps[id];
    const acc = { pago: 0, garantias: 0, solidario: 0, efectivo: 0, transferencia: 0, clientasPagaron: 0 };
    let movimientos = 0, ultimaSync = null;
    if (s) {
      let data = s.snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
      acumular(data.reg, acc);
      acumular(data.regI, acc);
      movimientos = Array.isArray(data.movs) ? data.movs.length : 0;
      ultimaSync = s.recibido;
    }
    ejecutivos[id] = { nombre: USUARIOS[id].nombre, ...acc, movimientos, ultimaSync };
  }
  const total = Object.values(ejecutivos).reduce((t, e) => ({
    pago: t.pago + e.pago, garantias: t.garantias + e.garantias,
    efectivo: t.efectivo + e.efectivo, transferencia: t.transferencia + e.transferencia,
  }), { pago: 0, garantias: 0, efectivo: 0, transferencia: 0 });
  res.json({ fecha, ejecutivos, total });
});

// ---------- total de la semana (tablero de dirección) ----------
// Suma la cobranza de lunes → la fecha pedida (default hoy), día por día,
// desde los snapshots ya guardados. Solo dirección/admin.
app.get("/api/semana", requiere("direccion", "admin"), (req, res) => {
  const hasta = req.query.fecha || hoyMX();
  const [y, m, d] = hasta.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() - (dow === 0 ? 6 : dow - 1)); // lunes de esa semana
  const dias = [];
  let totalSemana = 0;
  for (let i = 0; i < 7; i++) {
    const f = new Date(dt); f.setUTCDate(dt.getUTCDate() + i);
    const fecha = f.toISOString().slice(0, 10);
    if (fecha > hasta) break;
    const snaps = store.snapshotsDeFecha(fecha);
    const acc = { pago: 0, garantias: 0, solidario: 0, efectivo: 0, transferencia: 0, clientasPagaron: 0 };
    for (const ej in snaps) {
      let data = snaps[ej].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
      acumular(data.reg, acc); acumular(data.regI, acc);
    }
    const total = acc.pago + acc.garantias;
    totalSemana += total;
    dias.push({ fecha, total, efectivo: acc.efectivo, transferencia: acc.transferencia });
  }
  res.json({ desde: dt.toISOString().slice(0, 10), hasta, dias, totalSemana });
});

// Respaldo en EXCEL de verdad (.xlsx): cobranza detallada + movimientos de caja.
// Lo que Monse puede abrir y usar directo, sin depender de Drive ni nada externo.
const ExcelJS = require("exceljs");

function filasCobranza(snaps) {
  const filas = [];
  for (const ej in snaps) {
    for (const fecha in snaps[ej]) {
      let data = snaps[ej][fecha].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { continue; } }
      const empujar = (nodo, centro, key) => {
        if (!nodo || typeof nodo !== "object") return;
        const pago = nodo.pago || 0, gar = nodo.garantia || 0, sol = nodo.solidario || 0;
        if (pago + gar + sol <= 0) return;
        const p = String(key).split("|");
        const total = pago + gar + sol;
        let efe = 0, tra = 0;
        if (nodo.forma === "T") tra = total;
        else if (nodo.forma === "M") { efe = nodo.mixEfe || 0; tra = nodo.mixTr || 0; }
        else efe = total;
        const formaTxt = nodo.forma === "T" ? "Transferencia" : nodo.forma === "M" ? "Mixto" : "Efectivo";
        filas.push({
          ejecutivo: USUARIOS[ej] ? USUARIOS[ej].nombre : ej, fecha,
          centro: centro || "INDIVIDUAL", clienta: p[2] || "", socio: p[0] || "",
          producto: p[1] || "", pago, garantia: gar, solidario: sol,
          forma: formaTxt, efectivo: efe, transferencia: tra,
        });
      };
      const rec = (st, esCentro) => {
        if (!st || typeof st !== "object") return;
        for (const k in st) {
          const nd = st[k];
          if (nd && typeof nd === "object" && ("pago" in nd || "forma" in nd)) empujar(nd, esCentro ? null : "", k);
          else if (nd && typeof nd === "object") for (const kk in nd) empujar(nd[kk], k, kk);
        }
      };
      rec(data.reg, true); rec(data.regI, false);
    }
  }
  return filas;
}

app.get("/api/respaldo", requiere("direccion", "admin"), async (req, res) => {
  const { snapshots, movimientos } = store.respaldo();
  const wb = new ExcelJS.Workbook();
  wb.creator = "FOOAX";

  const s1 = wb.addWorksheet("Cobranza");
  s1.columns = [
    { header: "Ejecutivo", key: "ejecutivo", width: 14 },
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Centro", key: "centro", width: 22 },
    { header: "Clienta", key: "clienta", width: 30 },
    { header: "Socio", key: "socio", width: 15 },
    { header: "Producto", key: "producto", width: 18 },
    { header: "Pago", key: "pago", width: 11 },
    { header: "Garantía", key: "garantia", width: 11 },
    { header: "Solidario", key: "solidario", width: 11 },
    { header: "Forma", key: "forma", width: 14 },
    { header: "Efectivo", key: "efectivo", width: 11 },
    { header: "Transferencia", key: "transferencia", width: 13 },
  ];
  filasCobranza(snapshots).forEach((f) => s1.addRow(f));
  s1.getRow(1).font = { bold: true };
  ["G", "H", "I", "K", "L"].forEach((c) => { s1.getColumn(c).numFmt = '"$"#,##0.00'; });

  const s2 = wb.addWorksheet("Movimientos de caja");
  s2.columns = [
    { header: "Folio", key: "folio", width: 14 },
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Categoría", key: "categoria", width: 22 },
    { header: "Concepto", key: "concepto", width: 30 },
    { header: "Método", key: "metodo", width: 14 },
    { header: "Monto", key: "monto", width: 12 },
    { header: "Autorizado a", key: "autorizadoA", width: 20 },
    { header: "Registró", key: "registradoPor", width: 14 },
  ];
  (movimientos || []).forEach((m) => s2.addRow(m));
  s2.getRow(1).font = { bold: true };
  s2.getColumn("F").numFmt = '"$"#,##0.00';

  const hoy = hoyMX();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Respaldo FOOAX ${hoy}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---------- padrón / búsqueda de clientas ----------
// Directorio de clientas (nombre, ID, producto, centro, ejecutivo, saldo, cuota,
// mora). Se llena desde el store (PostgreSQL o archivo) en el arranque.
let PADRON = [];
const CUOTA = {}; // cuota por nº de socio (para faltantes/mora del día)
// Re-lee el padrón efectivo (base + altas/bajas) y reconstruye el mapa de cuotas.
function refrescarPadron() {
  PADRON = store.padron();
  for (const k in CUOTA) delete CUOTA[k];
  PADRON.forEach((c) => { if (c.cuota > 0 && !CUOTA[c.id]) CUOTA[c.id] = c.cuota; });
}

// normaliza para buscar sin acentos ni mayúsculas
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------- FASE 1: cartera viva ----------
// Suma lo pagado por cada crédito (socio+producto) en la semana en curso, para
// que el saldo baje solo con cada pago (saldo actual = saldo del padrón − pagado).
function lunesDeLaSemana(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();            // 0=Dom … 6=Sáb
  dt.setUTCDate(dt.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return dt.toISOString().slice(0, 10);
}
function claveCredito(socioOKey, producto) {
  return norm(String(socioOKey).split("|")[0]) + "|" + norm(producto || "");
}
function pagosDeLaSemana() {
  const hoy = hoyMX(), lunes = lunesDeLaSemana(hoy);
  const map = {};
  const snaps = store.respaldo().snapshots || {};
  const sumar = (nodo, key) => {
    if (!nodo || typeof nodo !== "object") return;
    const pago = nodo.pago || 0;
    if (pago > 0) {
      const partes = String(key).split("|");
      const clave = claveCredito(partes[0], partes[1]);
      map[clave] = (map[clave] || 0) + pago;
    }
  };
  for (const ej in snaps) {
    for (const fecha in snaps[ej]) {
      if (fecha < lunes || fecha > hoy) continue;
      let data = snaps[ej][fecha].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { continue; } }
      const rec = (st) => {
        if (!st || typeof st !== "object") return;
        for (const k in st) {
          const nd = st[k];
          if (nd && typeof nd === "object" && ("pago" in nd || "forma" in nd)) sumar(nd, k);
          else if (nd && typeof nd === "object") for (const kk in nd) sumar(nd[kk], kk);
        }
      };
      rec(data.reg); rec(data.regI);
    }
  }
  return map;
}

app.get("/api/clientes", requiere("direccion", "admin", "ejecutivo"), (req, res) => {
  const q = norm(req.query.q).trim();
  if (q.length < 2) return res.json({ total: PADRON.length, resultados: [] });
  const terminos = q.split(/\s+/);
  // ejecutivo solo ve sus clientas; dirección y admin ven todas
  let base = PADRON;
  if (req.usuario.rol === "ejecutivo") base = PADRON.filter(c => norm(c.ejecutivo) === norm(req.usuario.nombre));
  const pagos = pagosDeLaSemana(); // cartera viva
  const res1 = base.filter(c => {
    const heno = norm(c.nombre) + " " + c.id;
    return terminos.every(t => heno.includes(t));
  }).slice(0, 40).map(c => {
    const pagado = pagos[claveCredito(c.id, c.producto)] || 0;
    return { ...c, pagado, saldoActual: Math.max(0, (c.saldo || 0) - pagado) };
  });
  res.json({ total: base.length, resultados: res1 });
});

// ---------- FASE 1: alta y baja de clientas ----------
// La baja marca a la clienta inactiva (no la borra) para que NO salga en el
// pagaré ni en el centro activo, pero conserva su historia. Todo con rastro:
// quién y cuándo. Es justo lo que el sistema anterior nunca permitió.
const MOTIVOS_BAJA = ["Salió del grupo", "No renovó", "Mora / mal historial",
  "Cambió zona / cerró negocio", "Decisión FOOAX", "Otro"];

app.post("/api/clientes/alta", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  const id = String(b.id || "").trim();
  const nombre = (b.nombre || "").trim();
  const centro = (b.centro || "").trim();
  const ejecutivo = (b.ejecutivo || "").trim();
  if (!id) return res.status(400).json({ error: "Falta el número de socio." });
  if (!nombre) return res.status(400).json({ error: "Falta el nombre de la clienta." });
  if (!centro) return res.status(400).json({ error: "Falta el centro." });
  if (!ejecutivo) return res.status(400).json({ error: "Falta el ejecutivo." });
  const clienta = {
    id, nombre, producto: (b.producto || "").trim(), centro, ejecutivo,
    saldo: Number(b.saldo) || 0, cuota: Number(b.cuota) || 0, plazo: Number(b.plazo) || 0,
    mora: 0, estatus: "VIGENTE", semana: 0,
  };
  store.agregarCambioPadron({
    tipo: "alta", id, producto: clienta.producto, clienta,
    fecha: hoyMX(), por: req.usuario.nombre, ts: Date.now(),
  });
  refrescarPadron();
  res.json({ ok: true, clienta });
});

app.post("/api/clientes/baja", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  const id = String(b.id || "").trim();
  const motivo = MOTIVOS_BAJA.includes(b.motivo) ? b.motivo : null;
  if (!id) return res.status(400).json({ error: "Falta el número de socio." });
  if (!motivo) return res.status(400).json({ error: "Elige un motivo de baja válido." });
  store.agregarCambioPadron({
    tipo: "baja", id, producto: (b.producto || "").trim(), motivo,
    fecha: hoyMX(), por: req.usuario.nombre, ts: Date.now(),
  });
  refrescarPadron();
  res.json({ ok: true });
});

// ---------- movimientos de dirección/caja (retiros, gastos, autorizaciones) ----------
const CATEGORIAS = ["Retiro de dirección", "Gasto operativo", "Autorización / préstamo", "Otro"];
const METODOS = ["efectivo", "transferencia"];

app.post("/api/movimiento", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  const monto = Number(b.monto);
  const concepto = (b.concepto || "").trim();
  const categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : null;
  const metodo = METODOS.includes(b.metodo) ? b.metodo : null;
  const fecha = b.fecha || hoyMX();
  if (!(monto > 0)) return res.status(400).json({ error: "El monto debe ser mayor a cero." });
  if (!concepto) return res.status(400).json({ error: "Escribe un concepto para el movimiento." });
  if (!categoria) return res.status(400).json({ error: "Elige una categoría válida." });
  if (!metodo) return res.status(400).json({ error: "Elige el método (efectivo o transferencia)." });

  const delDia = store.movimientosDeFecha(fecha).length;
  const compacta = fecha.slice(8, 10) + fecha.slice(5, 7);
  const folio = "DIR-" + compacta + "-" + String(delDia + 1).padStart(3, "0");
  const mov = {
    folio, fecha, monto, concepto, categoria, metodo,
    autorizadoA: (b.autorizadoA || "").trim() || null,
    registradoPor: req.usuario.nombre, rol: req.usuario.rol, ts: Date.now(),
  };
  store.agregarMovimiento(mov);
  res.json({ ok: true, movimiento: mov });
});

// ---------- ARQUEO consolidado del día ----------
// Reproduce el FORMATO ARQUEO de FOOAX: desglose de billetes/monedas por
// ejecutivo, efectivo total, menos egresos (gastos/retiros), efectivo a
// entregar, depósitos (transferencias) y mora del día (faltantes).
const DENOMS_ARQUEO = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

app.get("/api/arqueo", requiere("direccion", "admin", "ejecutivo"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const snaps = store.snapshotsDeFecha(fecha);
  const ids = req.usuario.rol === "ejecutivo"
    ? [req.usuario.id].filter((x) => USUARIOS[x] && USUARIOS[x].rol === "ejecutivo")
    : ["neri", "karina", "christopher"];

  const porEjec = {};
  for (const id of ids) {
    const denom = {}; DENOMS_ARQUEO.forEach((d) => { denom[d] = 0; });
    const acc = { denom, efectivo: 0, transferencia: 0, garantias: 0, faltantes: 0, clientas: 0 };
    const s = snaps[id];
    if (s) {
      let data = s.snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
      const acumClienta = (n, key) => {
        if (!n || typeof n !== "object") return;
        const pago = n.pago || 0, gar = n.garantia || 0, sol = n.solidario || 0;
        if (pago + gar + sol <= 0 && !n.forma) return;
        const total = pago + gar + sol;
        acc.garantias += gar;
        if (n.forma === "T") acc.transferencia += total;
        else if (n.forma === "M") { acc.efectivo += n.mixEfe || 0; acc.transferencia += n.mixTr || 0; }
        else acc.efectivo += total;
        if (n.desglose) for (const d in n.desglose) denom[d] = (denom[d] || 0) + (n.desglose[d] || 0);
        if (pago > 0) acc.clientas += 1;
        const socio = String(key).split("|")[0];
        const cuota = CUOTA[socio];
        if (cuota && pago > 0 && pago < cuota) acc.faltantes += cuota - pago;
      };
      const recorrer = (store) => {
        if (!store || typeof store !== "object") return;
        for (const k in store) {
          const node = store[k];
          if (node && typeof node === "object" && ("pago" in node || "forma" in node)) acumClienta(node, k);
          else if (node && typeof node === "object") for (const kk in node) acumClienta(node[kk], kk);
        }
      };
      recorrer(data.reg);
      recorrer(data.regI);
    }
    porEjec[id] = { nombre: USUARIOS[id].nombre, ...acc };
  }

  // Totales consolidados de denominaciones y efectivo
  const denomTotal = {}; DENOMS_ARQUEO.forEach((d) => { denomTotal[d] = 0; });
  let efectivo = 0, transferencia = 0, garantias = 0, faltantes = 0;
  for (const id in porEjec) {
    const e = porEjec[id];
    DENOMS_ARQUEO.forEach((d) => { denomTotal[d] += e.denom[d] || 0; });
    efectivo += e.efectivo; transferencia += e.transferencia; garantias += e.garantias; faltantes += e.faltantes;
  }

  // Egresos en efectivo (gastos/retiros de caja) — solo dirección/admin los ven
  const movs = (req.usuario.rol === "ejecutivo") ? [] : store.movimientosDeFecha(fecha);
  const egresosEfectivo = movs.filter((m) => m.metodo === "efectivo").reduce((s, m) => s + m.monto, 0);
  const efectivoAEntregar = efectivo - egresosEfectivo;

  res.json({
    fecha, porEjec, denomTotal, efectivo, transferencia, garantias, faltantes,
    egresosEfectivo, efectivoAEntregar, denominaciones: DENOMS_ARQUEO,
  });
});

// ---------- RESUMEN del día (campanita de alertas para dirección) ----------
function pesos(n) { return "$" + Math.round(n || 0).toLocaleString("es-MX"); }

app.get("/api/resumen", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const snaps = store.snapshotsDeFecha(fecha);
  const movs = store.movimientosDeFecha(fecha);
  let efectivo = 0, transferencia = 0, garantias = 0, faltantes = 0, pagos = 0, clientasFaltan = 0;
  const sinSync = [], conSync = [];
  for (const id of ["neri", "karina", "christopher"]) {
    const s = snaps[id];
    if (!s) { sinSync.push(USUARIOS[id].nombre); continue; }
    let data = s.snapshot;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
    let ef = 0, tr = 0, ga = 0, fa = 0, pa = 0, cf = 0;
    const acum = (n, key) => {
      if (!n || typeof n !== "object") return;
      const p = n.pago || 0, g = n.garantia || 0, so = n.solidario || 0;
      if (p + g + so <= 0 && !n.forma) return;
      const t = p + g + so; ga += g;
      if (n.forma === "T") tr += t;
      else if (n.forma === "M") { ef += n.mixEfe || 0; tr += n.mixTr || 0; }
      else ef += t;
      if (p > 0) pa++;
      const cu = CUOTA[String(key).split("|")[0]];
      if (cu && p > 0 && p < cu) { fa += cu - p; cf++; }
    };
    const rec = (st) => {
      if (!st || typeof st !== "object") return;
      for (const k in st) {
        const nd = st[k];
        if (nd && typeof nd === "object" && ("pago" in nd || "forma" in nd)) acum(nd, k);
        else if (nd && typeof nd === "object") for (const kk in nd) acum(nd[kk], kk);
      }
    };
    rec(data.reg); rec(data.regI);
    efectivo += ef; transferencia += tr; garantias += ga; faltantes += fa; pagos += pa; clientasFaltan += cf;
    conSync.push({ nombre: USUARIOS[id].nombre, hora: new Date(s.recibido).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) });
  }
  const egresosEfectivo = movs.filter((m) => m.metodo === "efectivo").reduce((a, m) => a + m.monto, 0);
  const efectivoAEntregar = efectivo - egresosEfectivo;

  const items = [];
  items.push({ sev: "info", txt: `Cobranza de hoy: ${pesos(efectivo + transferencia + garantias)} · ${pagos} pagos` });
  items.push({ sev: "info", txt: `Efectivo ${pesos(efectivo)} · Transferencia ${pesos(transferencia)}` });
  items.push({ sev: "ok", txt: `Efectivo a entregar: ${pesos(efectivoAEntregar)}` });
  if (garantias > 0) items.push({ sev: "info", txt: `Garantías: ${pesos(garantias)}` });
  if (faltantes > 0) items.push({ sev: "alto", txt: `Mora del día: ${pesos(faltantes)} en ${clientasFaltan} clientas` });
  for (const e of conSync) items.push({ sev: "ok", txt: `${e.nombre} sincronizó a las ${e.hora}` });
  for (const n of sinSync) items.push({ sev: "warn", txt: `${n} aún no sincroniza hoy` });
  if (movs.length) items.push({ sev: "info", txt: `${movs.length} movimiento(s) de caja: ${pesos(movs.reduce((a, m) => a + m.monto, 0))}` });

  const pendientes = sinSync.length + (faltantes > 0 ? 1 : 0);
  res.json({ fecha, items, pendientes });
});

app.get("/api/movimientos", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const lista = store.movimientosDeFecha(fecha).sort((a, b) => b.ts - a.ts);
  const totalEfectivo = lista.filter(m => m.metodo === "efectivo").reduce((s, m) => s + m.monto, 0);
  const totalTransf = lista.filter(m => m.metodo === "transferencia").reduce((s, m) => s + m.monto, 0);
  res.json({ fecha, lista, totalEfectivo, totalTransf, total: totalEfectivo + totalTransf });
});

// ---------- páginas ----------
app.get("/", (req, res) => {
  const u = usuarioDe(req);
  if (!u) return res.sendFile(path.join(__dirname, "public", "login.html"));
  if (u.rol === "ejecutivo") return res.redirect("/app");
  return res.redirect("/tablero");
});
app.get("/app", paginaRequiere("ejecutivo"), (req, res) => {
  const archivo = path.join(__dirname, "apps", req.usuario.app);
  if (!fs.existsSync(archivo)) return res.status(404).send("No se encontró el archivo de la app de este ejecutivo.");
  const html = fs.readFileSync(archivo, "utf8");
  // PWA: manifiesto + service worker (app instalable, offline robusto).
  const cabeza =
    '<link rel="manifest" href="/manifest.json">' +
    '<link rel="apple-touch-icon" href="/img/logo-fooax.jpg">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
    '<meta name="apple-mobile-web-app-title" content="FOOAX">' +
    '<script>if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}</script>';
  // Sincronización y capa de mejoras antes de </body>.
  const inyecciones = '<script src="/sync.js"></script><script src="/captura-agil.js"></script>';
  let out = html.includes("</head>") ? html.replace("</head>", cabeza + "</head>") : cabeza + html;
  out = out.includes("</body>") ? out.replace("</body>", inyecciones + "</body>") : out + inyecciones;
  res.type("html").send(out);
});
app.get("/tablero", paginaRequiere("direccion", "admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tablero.html"));
});
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3789;
store.init().then(() => {
  refrescarPadron();
  console.log(`Padrón cargado: ${PADRON.length} clientas`);
  app.listen(PORT, () => console.log(`FOOAX cobranza · puerto ${PORT}`));
}).catch((e) => { console.error("Error al iniciar el store:", e); process.exit(1); });
