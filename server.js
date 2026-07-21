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
  prueba:      { nombre: "Prueba",      rol: "ejecutivo", test: true, app: "App_Cobranza_PRUEBA.html", pass: process.env.PASS_PRUEBA     || "PruebaFOOAX2026" },
  pruebadir:   { nombre: "Prueba Dir",  rol: "direccion", test: true, pass: process.env.PASS_PRUEBADIR   || "PruebaFOOAX2026" },
};

// Quiénes cuentan como ejecutivas para consolidado/arqueo/resumen.
// Se deriva de USUARIOS: si mañana entra una ejecutiva nueva (sucursales),
// aparece sola en el tablero y en el arqueo. Antes estaba escrita a mano y
// su cobranza habría quedado invisible.
// Las cuentas de prueba viven en su propia burbuja: un usuario de prueba solo
// ve ejecutivas de prueba, y uno real solo ve las reales. Así lo falso nunca
// se mezcla con el arqueo de Anel.
function idsEjecutivos(usuario) {
  const enPruebas = !!(usuario && usuario.test);
  return Object.keys(USUARIOS).filter(
    (id) => USUARIOS[id].rol === "ejecutivo" && !!USUARIOS[id].test === enPruebas
  );
}

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
const SESION_MAX_MS = 60 * 24 * 60 * 60 * 1000; // 60 días, igual que la cookie
// Corte del 15-jul-2026 (noche): invalida TODAS las sesiones anteriores para
// obligar a entrar de nuevo UNA vez — así cada teléfono toma la versión nueva
// (tour, cerrar captura, protecciones). Las sesiones nuevas duran 60 días.
const SESIONES_VALIDAS_DESDE = 1784157167380;
function usuarioDe(req) {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("sid="));
  if (!cookie) return null;
  const sid = cookie.slice(4);
  const ses = store.sesiones()[sid];
  if (!ses) return null;
  if (Date.now() - (ses.creada || 0) > SESION_MAX_MS) { store.borrarSesion(sid); return null; }
  if ((ses.creada || 0) < SESIONES_VALIDAS_DESDE) { store.borrarSesion(sid); return null; }
  return { id: ses.usuario, ...USUARIOS[ses.usuario] };
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
// Freno anti fuerza-bruta: máx 8 intentos fallidos por IP cada 10 minutos.
// Un intento exitoso limpia el contador. En memoria: se reinicia con el
// servidor, suficiente para frenar adivinanza de contraseñas.
const intentosLogin = new Map(); // ip -> { n, desde }
function ipDe(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
}
app.post("/api/login", (req, res) => {
  const ip = ipDe(req);
  const reg = intentosLogin.get(ip);
  if (reg && Date.now() - reg.desde < 10 * 60 * 1000 && reg.n >= 8) {
    return res.status(429).json({ error: "Demasiados intentos. Espera 10 minutos e intenta de nuevo." });
  }
  if (reg && Date.now() - reg.desde >= 10 * 60 * 1000) intentosLogin.delete(ip);
  const { usuario, password } = req.body || {};
  const u = USUARIOS[(usuario || "").toLowerCase().trim()];
  if (!u || u.pass !== password) {
    const r = intentosLogin.get(ip) || { n: 0, desde: Date.now() };
    r.n++; intentosLogin.set(ip, r);
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  intentosLogin.delete(ip);
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
  // hoy: la fecha oficial del servidor (hora de México) — la app la compara
  // con la suya y alerta si el teléfono quedó pegado en un día viejo.
  res.json({ usuario: u.id, nombre: u.nombre, rol: u.rol, wipe: borrarTelefono.has(u.id), hoy: hoyMX() });
});

// ---------- borrado remoto de datos del teléfono ----------
// Dirección/Admin marca a un ejecutivo (teléfono perdido o dejó de trabajar);
// la próxima vez que ese teléfono abra la app con señal, limpia todos los datos.
app.post("/api/telefono/borrar", requiere("direccion", "admin"), (req, res) => {
  const ejec = String((req.body || {}).usuario || "").toLowerCase().trim();
  // Solo dentro de la misma burbuja: una cuenta de PRUEBA no puede borrarle el
  // teléfono a una ejecutiva real (borrar es destructivo e irreversible).
  if (!idsEjecutivos(req.usuario).includes(ejec)) {
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
  // Devuelve también a QUIÉNES se puede borrar. El tablero traía la lista
  // escrita a mano: una ejecutiva nueva no aparecía (y su teléfono perdido no
  // se podía borrar), y una cuenta de prueba veía a las ejecutivas reales.
  const permitidas = idsEjecutivos(req.usuario);
  res.json({
    marcados: Array.from(borrarTelefono).filter((id) => permitidas.includes(id)),
    ejecutivos: permitidas.map((id) => ({ id, nombre: USUARIOS[id].nombre })),
  });
});

// ---------- sincronización ----------
// La app manda su estado completo del día; upsert idempotente por (ejecutivo, fecha).
// Si la fecha del snapshot NO es hoy (teléfono pegado en un día viejo), se acepta
// igual (el historial protege lo previo) pero se registra el desfase para que el
// tablero de Dirección lo alerte, y se le responde a la app la fecha correcta.
const desfasesFecha = {}; // ejecutivo -> { fecha, hoy, ts } (último desfase visto hoy)
const reducciones = {};   // ejecutivo -> { fecha, antes, ahora, ts } (sync que REDUJO pagos)
// Cuenta cuántas clientas pagaron dentro de un snapshot (para detectar cuando
// un teléfono incompleto aplasta un día que ya tenía más cobranza).
function contarPagos(snap) {
  try {
    let data = snap;
    if (typeof data === "string") data = JSON.parse(data);
    const acc = { pago: 0, garantias: 0, solidario: 0, efectivo: 0, transferencia: 0, clientasPagaron: 0 };
    acumular(data.reg, acc); acumular(data.regI, acc);
    return acc.clientasPagaron;
  } catch { return null; }
}
// Sube a la caja los movimientos que la ejecutiva capturó en "Otros
// movimientos". Antes se quedaban enterrados dentro del snapshot: Anel y Monse
// NO los veían en el tablero, ni entraban al arqueo, ni salían en el respaldo
// (la hoja de Movimientos estaba vacía aunque en campo sí se capturaban).
function guardarMovimientosDeEjecutiva(usuario, fecha, snapshot) {
  const lista = Array.isArray(snapshot && snapshot.movs) ? snapshot.movs : [];
  for (const m of lista) {
    const monto = Number(m && m.monto);
    if (!(monto > 0)) continue;
    const cve = String(m.concepto || "").toUpperCase();
    const def = CONCEPTOS_EJEC[cve] || { etiqueta: m.concepto || "Otro", categoria: "Otro", entrada: false };
    const quien = [m.clienta, m.socio].filter(Boolean).join(" · ");
    store.agregarMovimiento({
      // El folio de la app ya es único por ejecutiva y día; se le antepone el
      // usuario para no chocar nunca con los folios DIR- de dirección. Como
      // agregarMovimiento es append-only por folio, re-sincronizar no duplica.
      folio: "EJE-" + usuario.id.toUpperCase() + "-" + (m.folio || Math.abs(monto) + "-" + cve),
      fecha, monto,
      concepto: def.etiqueta + (quien ? " · " + quien : "") + (m.nota ? " — " + m.nota : ""),
      categoria: def.categoria,
      metodo: m.via === "T" ? "transferencia" : "efectivo",
      entrada: def.entrada,
      autorizadoA: m.clienta || null,
      registradoPor: usuario.nombre, rol: usuario.rol, usuario: usuario.id, ts: Date.now(),
    });
  }
}

app.post("/api/sync", requiere("ejecutivo"), (req, res) => {
  const { fecha, snapshot, ts } = req.body || {};
  if (!fecha || !snapshot) return res.status(400).json({ error: "Faltan datos para sincronizar (la fecha o la captura)." });
  const hoy = hoyMX();
  const previo = store.snapshotsDeFecha(fecha)[req.usuario.id];
  const antes = previo ? contarPagos(previo.snapshot) : null;
  const ahora = contarPagos(snapshot);
  store.guardarSnapshot(req.usuario.id, fecha, { snapshot, ts: ts || Date.now() });
  guardarMovimientosDeEjecutiva(req.usuario, fecha, snapshot);
  if (fecha !== hoy) desfasesFecha[req.usuario.id] = { fecha, hoy, ts: Date.now() };
  else delete desfasesFecha[req.usuario.id];
  if (antes != null && ahora != null && antes - ahora >= 3) {
    reducciones[req.usuario.id] = { fecha, antes, ahora, ts: Date.now() };
  } else if (reducciones[req.usuario.id] && reducciones[req.usuario.id].fecha === fecha && ahora != null && antes != null && ahora >= antes) {
    delete reducciones[req.usuario.id];
  }
  res.json({ ok: true, recibido: new Date().toISOString(), hoy, fechaRecibida: fecha, desfase: fecha !== hoy });
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
  for (const id of idsEjecutivos(req.usuario)) {
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
    const permitidas = new Set(idsEjecutivos(req.usuario));
    for (const ej in snaps) {
      if (!permitidas.has(ej)) continue;
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
  const crudo = store.respaldo();
  // Misma burbuja que el resto: una cuenta de prueba NO se lleva el respaldo
  // con la cobranza real de todas las clientas.
  const permitidas = new Set(idsEjecutivos(req.usuario));
  const snapshots = {};
  for (const ej in crudo.snapshots || {}) if (permitidas.has(ej)) snapshots[ej] = crudo.snapshots[ej];
  const movimientos = crudo.movimientos || [];
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
// usuario: para respetar la burbuja de pruebas. Sin él, cuenta solo a las
// ejecutivas reales — así una captura de prueba nunca entra a los saldos.
// Devuelve { pago, gar, detalle }:
//  - pago: lo que ABONA al crédito (baja el saldo)
//  - gar : garantía cobrada — es dinero que entra a caja pero NO baja el saldo.
//          Por eso el tablero (pago+garantía) y los saldos (solo pago) dan
//          distinto: los dos están bien, miden cosas distintas.
//  - detalle: quién pagó cada clave, para poder señalar los pagos que no
//          casan con ningún crédito del padrón en vez de perderlos en silencio.
function pagosDeLaSemana(usuario) {
  const hoy = hoyMX(), lunes = lunesDeLaSemana(hoy);
  const pago = {}, gar = {}, detalle = {};
  const permitidas = new Set(idsEjecutivos(usuario));
  const snaps = store.respaldo().snapshots || {};
  const sumar = (nodo, key, ej, fecha) => {
    if (!nodo || typeof nodo !== "object") return;
    const p = nodo.pago || 0, g = nodo.garantia || 0;
    if (p <= 0 && g <= 0) return;
    const partes = String(key).split("|");
    const clave = claveCredito(partes[0], partes[1]);
    if (p > 0) pago[clave] = (pago[clave] || 0) + p;
    if (g > 0) gar[clave] = (gar[clave] || 0) + g;
    const d = detalle[clave] || (detalle[clave] = { socio: partes[0], producto: partes[1] || "", pago: 0, gar: 0, ejec: {}, fechas: {} });
    d.pago += p; d.gar += g;
    if (ej) d.ejec[ej] = true;
    if (fecha) d.fechas[fecha] = true;
  };
  for (const ej in snaps) {
    if (!permitidas.has(ej)) continue;
    for (const fecha in snaps[ej]) {
      if (fecha < lunes || fecha > hoy) continue;
      let data = snaps[ej][fecha].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { continue; } }
      const rec = (st) => {
        if (!st || typeof st !== "object") return;
        for (const k in st) {
          const nd = st[k];
          if (nd && typeof nd === "object" && ("pago" in nd || "forma" in nd)) sumar(nd, k, ej, fecha);
          else if (nd && typeof nd === "object") for (const kk in nd) sumar(nd[kk], kk, ej, fecha);
        }
      };
      rec(data.reg); rec(data.regI);
    }
  }
  return { pago, gar, detalle };
}

// ---------- SALDOS ACTUALIZADOS de la semana en Excel ----------
// La plantilla que Monse hace a mano: saldo inicial − pagado esta semana =
// saldo actualizado, por crédito. Generada sola. Solo dirección/admin.
app.get("/api/semana/excel", requiere("direccion", "admin"), async (req, res) => {
  const { pago: pagos, gar: garantias, detalle } = pagosDeLaSemana(req.usuario);
  const hoy = hoyMX(), lunes = lunesDeLaSemana(hoy);
  const usadas = new Set();
  const wb = new ExcelJS.Workbook(); wb.creator = "FOOAX";
  const s = wb.addWorksheet("Saldos actualizados");
  const AURORA = "FFF1228E", RIO = "FF324AB6";
  s.mergeCells("A1:J1");
  const t = s.getCell("A1");
  t.value = `FOOAX · SALDOS ACTUALIZADOS · semana ${lunes} → ${hoy}`;
  t.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
  t.alignment = { horizontal: "center", vertical: "middle" }; s.getRow(1).height = 24;
  const head = [["Ejecutivo", 13], ["Centro", 22], ["Clienta", 32], ["Socio", 15], ["Producto", 18],
    ["Saldo inicial", 13], ["Pagó semana", 13], ["Saldo actualizado", 16], ["Garantía", 11], ["Cuota", 10]];
  const hr = s.getRow(2);
  head.forEach(([h2, w], i) => { const c = hr.getCell(i + 1); c.value = h2; s.getColumn(i + 1).width = w;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    c.alignment = { horizontal: i >= 5 ? "center" : "left", wrapText: true }; });
  const dinero = '"$"#,##0';
  let fila = 3;
  const rows = PADRON.filter(c => c.activa !== false && c.estatus !== "BAJA")
    .sort((a, b) => String(a.ejecutivo).localeCompare(String(b.ejecutivo)) || String(a.centro).localeCompare(String(b.centro)) || String(a.nombre).localeCompare(String(b.nombre)));
  let tIni = 0, tPag = 0, tAct = 0, tGar = 0;
  for (const c of rows) {
    const clave = claveCredito(c.id, c.producto);
    usadas.add(clave);
    const pagado = pagos[clave] || 0, garan = garantias[clave] || 0;
    const ini = c.saldo || 0, act = Math.max(0, ini - pagado);
    tIni += ini; tPag += pagado; tAct += act; tGar += garan;
    const r = s.getRow(fila++);
    r.getCell(1).value = c.ejecutivo || ""; r.getCell(2).value = c.centro || "";
    r.getCell(3).value = c.nombre || ""; r.getCell(4).value = c.id; r.getCell(5).value = c.producto || "";
    r.getCell(6).value = ini; r.getCell(7).value = pagado || null; r.getCell(8).value = act;
    r.getCell(9).value = garan || null; r.getCell(10).value = c.cuota || 0;
    [6, 7, 8, 9, 10].forEach(i => r.getCell(i).numFmt = dinero);
    if (pagado > 0) r.getCell(7).font = { bold: true, color: { argb: "FF0B7247" } };
    if (garan > 0) r.getCell(9).font = { bold: true, color: { argb: "FF8A5A00" } };
    if ((fila - 3) % 2 === 1) r.eachCell({ includeEmpty: true }, c2 => { if (!c2.fill || c2.fill.type !== "pattern") c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F1F8" } }; });
  }
  const tr = s.getRow(fila);
  tr.getCell(5).value = "TOTAL"; tr.getCell(5).font = { bold: true };
  tr.getCell(6).value = tIni; tr.getCell(7).value = tPag; tr.getCell(8).value = tAct; tr.getCell(9).value = tGar;
  [6, 7, 8, 9].forEach(i => { tr.getCell(i).numFmt = dinero; tr.getCell(i).font = { bold: true, color: { argb: AURORA } }; });
  fila++;

  // Cuadre explícito contra el tablero. Sin esto, el tablero (que suma pago +
  // garantía, o sea el dinero que entró) y este Excel (solo pago, lo que abona
  // al crédito) parecen no cuadrar, y no es cierto: miden cosas distintas.
  fila++;
  const cuadre = [
    ["Pagos aplicados al saldo", tPag],
    ["+ Garantías recibidas (no bajan saldo)", tGar],
    ["= Total recibido en la semana (debe cuadrar con el tablero)", tPag + tGar],
  ];
  for (const [txt, val] of cuadre) {
    const r = s.getRow(fila++);
    r.getCell(5).value = txt; r.getCell(5).alignment = { horizontal: "right" };
    r.getCell(6).value = val; r.getCell(6).numFmt = dinero;
    const ultima = txt.startsWith("=");
    r.getCell(5).font = { bold: ultima };
    r.getCell(6).font = { bold: true, color: { argb: ultima ? AURORA : "FF333333" } };
  }

  // Pagos que NO casan con ningún crédito del padrón. Antes se perdían en
  // silencio: no salían en ninguna fila ni en el total. Si una clienta se dio
  // de baja de la plantilla y siguió pagando, su dinero desaparecía del Excel.
  const huerfanos = Object.keys(detalle).filter(k => !usadas.has(k) && (detalle[k].pago > 0 || detalle[k].gar > 0));
  if (huerfanos.length) {
    fila += 2;
    const av = s.getRow(fila++);
    av.getCell(1).value = "⚠ PAGOS SIN CRÉDITO ASIGNADO — se cobraron pero no bajan ningún saldo. Revisar.";
    av.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    av.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB00020" } };
    s.mergeCells(`A${fila - 1}:J${fila - 1}`);
    const hh = s.getRow(fila++);
    ["Ejecutivo(s)", "Fecha(s)", "Socio", "Producto", "Pago", "Garantía"].forEach((h2, i) => {
      const c = hh.getCell(i + 1); c.value = h2;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    });
    for (const k of huerfanos) {
      const d = detalle[k];
      const r = s.getRow(fila++);
      r.getCell(1).value = Object.keys(d.ejec).join(", ");
      r.getCell(2).value = Object.keys(d.fechas).sort().join(", ");
      r.getCell(3).value = d.socio; r.getCell(4).value = d.producto;
      r.getCell(5).value = d.pago || null; r.getCell(6).value = d.gar || null;
      [5, 6].forEach(i => r.getCell(i).numFmt = dinero);
    }
  }
  s.views = [{ state: "frozen", ySplit: 2 }];

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Saldos actualizados FOOAX ${hoy}.xlsx"`);
  res.send(Buffer.from(buf));
});

app.get("/api/clientes", requiere("direccion", "admin", "ejecutivo"), (req, res) => {
  const q = norm(req.query.q).trim();
  if (q.length < 2) return res.json({ total: PADRON.length, resultados: [] });
  const terminos = q.split(/\s+/);
  // ejecutivo solo ve sus clientas; dirección y admin ven todas
  let base = PADRON;
  if (req.usuario.rol === "ejecutivo") base = PADRON.filter(c => norm(c.ejecutivo) === norm(req.usuario.nombre));
  const { pago: pagos } = pagosDeLaSemana(req.usuario); // cartera viva
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

// Movimientos que capturan las EJECUTIVAS en la pestaña "Otros movimientos".
// Unos meten dinero a la caja (comisión, recuperación, garantía, liquidación) y
// otros lo sacan (gasto, desembolso). El signo importa: si se tratan todos como
// salida, el efectivo a entregar sale mal.
const CONCEPTOS_EJEC = {
  COMISION:     { etiqueta: "Comisión de desembolso",   categoria: "Otro",            entrada: true },
  RECUPERACION: { etiqueta: "Recuperación / adelanto",  categoria: "Otro",            entrada: true },
  GARANTIA:     { etiqueta: "Garantía (ahorro)",        categoria: "Otro",            entrada: true },
  LIQUIDACION:  { etiqueta: "Liquidación",              categoria: "Otro",            entrada: true },
  DESEMBOLSO:   { etiqueta: "Desembolso (crédito nuevo)", categoria: "Autorización / préstamo", entrada: false },
  GASTO:        { etiqueta: "Gasto",                    categoria: "Gasto operativo", entrada: false },
};
// Efectivo que SALE de la caja. Un movimiento marcado como entrada resta aquí
// (mete dinero), por eso no se puede sumar a secas.
function egresosEnEfectivo(movs) {
  return movs.filter((m) => m.metodo === "efectivo")
    .reduce((s, m) => s + (m.entrada ? -m.monto : m.monto), 0);
}
// Los movimientos también viven en su burbuja: los de una cuenta de prueba no
// se cuelan al arqueo ni al tablero reales. Un movimiento viejo sin `usuario`
// se considera real (así eran todos los de dirección antes de esto).
function movsDeFecha(fecha, usuario) {
  const enPruebas = !!(usuario && usuario.test);
  return store.movimientosDeFecha(fecha).filter((m) => {
    let u = m.usuario && USUARIOS[m.usuario];
    // Movimientos anteriores al sello: el folio de los de campo trae el
    // usuario ("EJE-<ID>-..."), así que de ahí se deduce a qué burbuja
    // pertenecen. Sin eso, un movimiento de prueba viejo contaría como real.
    if (!u) {
      const mm = /^EJE-([^-]+)-/.exec(String(m.folio || ""));
      if (mm) u = USUARIOS[mm[1].toLowerCase()];
    }
    return !!(u && u.test) === enPruebas;
  });
}

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
    registradoPor: req.usuario.nombre, rol: req.usuario.rol, usuario: req.usuario.id, ts: Date.now(),
  };
  store.agregarMovimiento(mov);
  res.json({ ok: true, movimiento: mov });
});

// ---------- ARQUEO consolidado del día ----------
// Reproduce el FORMATO ARQUEO de FOOAX: desglose de billetes/monedas por
// ejecutivo, efectivo total, menos egresos (gastos/retiros), efectivo a
// entregar, depósitos (transferencias) y mora del día (faltantes).
const DENOMS_ARQUEO = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

// Cálculo del arqueo de un día (reusado por /api/arqueo y por el Excel).
function calcularArqueo(fecha, ids) {
  const snaps = store.snapshotsDeFecha(fecha);
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
      // Conteo de billetes de la pestaña ARQUEO de la app: {valor: cantidad}.
      // Es el conteo físico de la caja que hace la ejecutiva una vez al día.
      // Antes solo se leía el desglose por clienta (n.desglose), que nadie
      // llena, y por eso el arqueo de Dirección salía en ceros.
      if (data.arqueo && typeof data.arqueo === "object") {
        for (const v in data.arqueo) {
          const val = Number(v), q = Number(data.arqueo[v]) || 0;
          if (!isNaN(val) && q > 0) denom[val] = (denom[val] || 0) + q;
        }
      }
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

  return { porEjec, denomTotal, efectivo, transferencia, garantias, faltantes };
}

app.get("/api/arqueo", requiere("direccion", "admin", "ejecutivo"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const ids = req.usuario.rol === "ejecutivo"
    ? [req.usuario.id].filter((x) => USUARIOS[x] && USUARIOS[x].rol === "ejecutivo")
    : idsEjecutivos(req.usuario);
  const a = calcularArqueo(fecha, ids);
  const movs = (req.usuario.rol === "ejecutivo") ? [] : movsDeFecha(fecha, req.usuario);
  const egresosEfectivo = egresosEnEfectivo(movs);
  res.json({
    fecha, ...a, egresosEfectivo, efectivoAEntregar: a.efectivo - egresosEfectivo,
    denominaciones: DENOMS_ARQUEO,
  });
});

// ---------- ARQUEO DE CAJA en Excel (formato de la ficha física) ----------
// Botón para Monse: cuenta el efectivo por denominación (billetes/monedas),
// subtotal y total, del día elegido. Solo dirección/admin.
app.get("/api/arqueo/excel", requiere("direccion", "admin"), async (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const a = calcularArqueo(fecha, idsEjecutivos(req.usuario));
  const movs = movsDeFecha(fecha, req.usuario);
  const egresosEfectivo = egresosEnEfectivo(movs);
  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const [y, m, d] = fecha.split("-").map(Number);
  const nomDia = dias[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

  const wb = new ExcelJS.Workbook(); wb.creator = "FOOAX";
  const s = wb.addWorksheet("Arqueo", { properties: { defaultColWidth: 16 } });
  const AURORA = "FFF1228E", RIO = "FF324AB6", NARANJA = "FFFD6E29", RIQUEZA = "FFF2BB06";
  s.getColumn(1).width = 20; s.getColumn(2).width = 12; s.getColumn(3).width = 14; s.getColumn(4).width = 16;
  s.mergeCells("A1:D1");
  const tit = s.getCell("A1");
  tit.value = "FOOAX · ARQUEO DE CAJA · " + nomDia.toUpperCase() + " " + fecha;
  tit.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  tit.alignment = { horizontal: "center", vertical: "middle" };
  tit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
  s.getRow(1).height = 26;
  s.mergeCells("A2:D2");
  s.getCell("A2").value = "Efectivo recibido este día, por denominación.";
  s.getCell("A2").font = { italic: true, size: 10, color: { argb: RIO } };
  s.getCell("A2").alignment = { horizontal: "center" };

  const head = ["DENOMINACIÓN", "CANTIDAD", "VALOR UNIT.", "SUBTOTAL"];
  const hr = s.getRow(4);
  head.forEach((h2, i) => { const c = hr.getCell(i + 1); c.value = h2;
    c.font = { bold: true, color: { argb: "FF2A1F35" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECE6F1" } };
    c.alignment = { horizontal: i === 0 ? "left" : "center" }; });
  const dinero = '"$"#,##0.00';
  let fila = 5, totalEfe = 0;
  const seccion = (nombre, color, denoms) => {
    s.mergeCells(fila, 1, fila, 4);
    const c = s.getCell(fila, 1); c.value = nombre;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    fila++;
    for (const dn of denoms) {
      const cant = a.denomTotal[dn] || 0, sub = dn * cant; totalEfe += sub;
      const r = s.getRow(fila);
      r.getCell(1).value = (dn >= 20 ? "Billete $" : "Moneda $") + dn;
      const cc = r.getCell(2); cc.value = cant || null; cc.alignment = { horizontal: "center" };
      if (cant > 0) cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIQUEZA } };
      cc.font = { bold: true };
      r.getCell(3).value = dn; r.getCell(3).numFmt = dinero;
      r.getCell(4).value = sub; r.getCell(4).numFmt = dinero;
      fila++;
    }
  };
  // Igual que la tarjeta de arqueo del tablero: solo salen las denominaciones
  // que de verdad se contaron. Antes se imprimía la lista completa en ceros y
  // parecía un arqueo vacío aunque hubiera dinero.
  const conConteo = (lista) => lista.filter((dn) => (a.denomTotal[dn] || 0) > 0);
  const billetes = conConteo([1000, 500, 200, 100, 50, 20]);
  const monedas = conConteo([10, 5, 2, 1, 0.5]);
  if (billetes.length) seccion("BILLETES", RIO, billetes);
  if (monedas.length) seccion("MONEDAS", NARANJA, monedas);
  if (!billetes.length && !monedas.length) {
    s.mergeCells(fila, 1, fila, 4);
    const c = s.getCell(fila, 1);
    c.value = "Este día no se capturó el conteo por denominación.";
    c.font = { italic: true, color: { argb: "FF666666" } };
    c.alignment = { horizontal: "center" };
    fila++;
  }
  // TOTAL EFECTIVO = el efectivo REALMENTE cobrado, no la suma de los billetes.
  // Antes se sumaban las denominaciones: si las ejecutivas no capturaron el
  // conteo de billetes (que es lo normal), el arqueo decía "TOTAL EFECTIVO
  // $0.00" un día en que entraron $31,389. Un arqueo en cero cuando sí hubo
  // dinero es justo lo que no puede pasar.
  s.mergeCells(fila, 1, fila, 3);
  const ct = s.getCell(fila, 1); ct.value = "TOTAL EFECTIVO " + nomDia.toUpperCase();
  ct.font = { bold: true, color: { argb: "FFFFFFFF" } };
  ct.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NARANJA } };
  const cv = s.getCell(fila, 4); cv.value = a.efectivo; cv.numFmt = dinero;
  cv.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
  fila++;
  // Qué parte de ese efectivo trae conteo de billetes y qué parte no.
  const sinDesglosar = Math.round((a.efectivo - totalEfe) * 100) / 100;
  if (Math.abs(sinDesglosar) >= 0.01) {
    const r = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c = r.getCell(1);
    // Si SÍ contaron la caja y no cuadra, es una diferencia de caja real
    // (falta o sobra efectivo), no un tema de formato. Se dice con todas sus
    // letras: es el número por el que Monse tiene que preguntar.
    const falta = sinDesglosar > 0;
    c.value = totalEfe > 0
      ? "⚠ DIFERENCIA DE CAJA · cobrado $" + a.efectivo.toLocaleString("es-MX") +
        " vs contado $" + totalEfe.toLocaleString("es-MX") + " → " + (falta ? "FALTAN" : "SOBRAN")
      : "⚠ Este día no se capturó el conteo de billetes — el efectivo de arriba viene de los pagos registrados";
    const color = totalEfe > 0 ? "FFB00020" : "FF8A5A00";
    c.font = { bold: true, color: { argb: color } };
    c.alignment = { wrapText: true };
    const cd = r.getCell(4); cd.value = Math.abs(sinDesglosar); cd.numFmt = dinero;
    cd.font = { bold: true, color: { argb: color } };
  }
  fila += 2;
  // desglose de cierre
  const linea = (lbl, val) => { const r = s.getRow(fila++); r.getCell(1).value = lbl;
    const c = r.getCell(4); c.value = val; c.numFmt = dinero; c.font = { bold: true }; };
  // Mismos renglones y mismos números que la tarjeta de arqueo del tablero,
  // para poder compararlos lado a lado sin traducir nada.
  linea("− Gastos y retiros en efectivo", -egresosEfectivo);
  linea("Efectivo a entregar", a.efectivo - egresosEfectivo);
  linea("Depósitos / transferencias", a.transferencia);
  linea("Garantías", a.garantias);
  const rm = s.getRow(fila++); rm.getCell(1).value = "Mora del día (faltantes)";
  const cm = rm.getCell(4); cm.value = a.faltantes; cm.numFmt = dinero;
  cm.font = { bold: true, color: { argb: a.faltantes > 0 ? "FFB00020" : "FF000000" } };
  fila++;
  // por ejecutiva: efectivo Y transferencia, igual que en el tablero
  const rh = s.getRow(fila++); rh.getCell(1).value = "Por ejecutiva"; rh.getCell(1).font = { bold: true, color: { argb: RIO } };
  for (const id in a.porEjec) { const e = a.porEjec[id]; if (e.efectivo <= 0 && e.transferencia <= 0) continue;
    const r = s.getRow(fila++); r.getCell(1).value = e.nombre;
    r.getCell(2).value = "efectivo"; r.getCell(2).alignment = { horizontal: "right" };
    r.getCell(3).value = e.efectivo; r.getCell(3).numFmt = dinero;
    r.getCell(4).value = e.transferencia ? "transf. " + e.transferencia.toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "";
    r.getCell(4).alignment = { horizontal: "right" }; }

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Arqueo FOOAX ${fecha}.xlsx"`);
  res.send(Buffer.from(buf));
});

// ---------- RESUMEN del día (campanita de alertas para dirección) ----------
function pesos(n) { return "$" + Math.round(n || 0).toLocaleString("es-MX"); }

app.get("/api/resumen", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const snaps = store.snapshotsDeFecha(fecha);
  const movs = movsDeFecha(fecha, req.usuario);
  let efectivo = 0, transferencia = 0, garantias = 0, faltantes = 0, pagos = 0, clientasFaltan = 0;
  const sinSync = [], conSync = [], descuadres = [];
  for (const id of idsEjecutivos(req.usuario)) {
    const s = snaps[id];
    if (!s) { sinSync.push(USUARIOS[id].nombre); continue; }
    let data = s.snapshot;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
    let ef = 0, tr = 0, ga = 0, fa = 0, pa = 0, cf = 0, cobrado = 0, movido = 0;
    const acum = (n, key) => {
      if (!n || typeof n !== "object") return;
      const p = n.pago || 0, g = n.garantia || 0, so = n.solidario || 0;
      if (p + g + so <= 0 && !n.forma) return;
      const t = p + g + so; ga += g;
      cobrado += t; // lo que dijo que cobró
      if (n.forma === "T") { tr += t; movido += t; }
      else if (n.forma === "M") { ef += n.mixEfe || 0; tr += n.mixTr || 0; movido += (n.mixEfe || 0) + (n.mixTr || 0); }
      else { ef += t; movido += t; }
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
    // descuadre por ejecutiva: lo que dijo que cobró vs cómo lo repartió (mixto mal capturado)
    if (Math.abs(cobrado - movido) >= 1) descuadres.push({ nombre: USUARIOS[id].nombre, dif: cobrado - movido });
    conSync.push({ nombre: USUARIOS[id].nombre, hora: new Date(s.recibido).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) });
  }
  const egresosEfectivo = egresosEnEfectivo(movs);
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
  // DESCUADRE: un pago mixto donde efectivo+transferencia no suma lo cobrado
  // (típico: se capturó mal el mixto). El efectivo a entregar no cuadraría.
  for (const d of descuadres) {
    items.unshift({ sev: "alto", txt: `⚠ Descuadre en ${d.nombre}: lo cobrado y lo repartido (efectivo/transferencia) difieren en ${pesos(Math.abs(d.dif))}. Revisa un pago MIXTO mal capturado.` });
  }
  // día (teléfono pegado en el día viejo) — la causa de la cobranza "perdida".
  let desfases = 0;
  for (const id in desfasesFecha) {
    const d = desfasesFecha[id];
    if (d.hoy === fecha) {
      desfases++;
      items.unshift({ sev: "alto", txt: `⚠ ${USUARIOS[id] ? USUARIOS[id].nombre : id} sincronizó HOY pero con fecha ${d.fecha} — su app está en el día equivocado. Pídele cerrar y abrir la app.` });
    }
  }
  // Sync que REDUJO pagos de un día (teléfono incompleto aplastando uno bueno,
  // o una corrección deliberada): avisar; la versión anterior quedó archivada.
  for (const id in reducciones) {
    const rdx = reducciones[id];
    if (Date.now() - rdx.ts < 24 * 60 * 60 * 1000) {
      desfases++;
      items.unshift({ sev: "alto", txt: `⚠ La sincronización de ${USUARIOS[id] ? USUARIOS[id].nombre : id} para el ${rdx.fecha} bajó de ${rdx.antes} a ${rdx.ahora} pagos. Si no fue una corrección, avísale a Karina — la versión anterior quedó archivada.` });
    }
  }

  const pendientes = sinSync.length + (faltantes > 0 ? 1 : 0) + desfases + descuadres.length;
  res.json({ fecha, items, pendientes });
});

app.get("/api/movimientos", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const lista = movsDeFecha(fecha, req.usuario).sort((a, b) => b.ts - a.ts);
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
    // Registro del service worker CON auto-actualización: revisa si hay versión
    // nueva al abrir y cada 2 min, y recarga sola cuando el SW nuevo toma el
    // control. Así el teléfono ya no se queda pegado en una versión vieja.
    '<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js").then(function(reg){' +
    'reg.update();setInterval(function(){reg.update();},120000);' +
    'reg.addEventListener("updatefound",function(){var nw=reg.installing;if(nw)nw.addEventListener("statechange",function(){' +
    'if(nw.state==="installed"&&navigator.serviceWorker.controller){nw.postMessage("skip");}});});' +
    '}).catch(function(){});' +
    'var _rc=false;navigator.serviceWorker.addEventListener("controllerchange",function(){if(_rc)return;_rc=true;location.reload();});}</script>';
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
