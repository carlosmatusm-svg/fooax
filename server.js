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
};

// ---------- sesiones (cookie httpOnly) ----------
const sesiones = new Map();
function crearSesion(usuario) {
  const sid = crypto.randomBytes(24).toString("hex");
  sesiones.set(sid, { usuario, creada: Date.now() });
  return sid;
}
function usuarioDe(req) {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("sid="));
  if (!cookie) return null;
  const ses = sesiones.get(cookie.slice(4));
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

// ---------- auth ----------
app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body || {};
  const u = USUARIOS[(usuario || "").toLowerCase().trim()];
  if (!u || u.pass !== password) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  const sid = crearSesion((usuario || "").toLowerCase().trim());
  res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
  res.json({ ok: true, rol: u.rol, nombre: u.nombre });
});
app.post("/api/logout", (req, res) => {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("sid="));
  if (cookie) sesiones.delete(cookie.slice(4));
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => {
  const u = usuarioDe(req);
  if (!u) return res.status(401).json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." });
  res.json({ usuario: u.id, nombre: u.nombre, rol: u.rol });
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

app.get("/api/consolidado", requiere("direccion", "admin", "ejecutivo"), (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
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

// Respaldo legible: descarga todo lo sincronizado (Dirección/Admin).
app.get("/api/respaldo", requiere("direccion", "admin"), (req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=respaldo-fooax.json");
  res.json(store.respaldo());
});

// ---------- padrón / búsqueda de clientas ----------
// Directorio de clientas (nombre, ID, producto, centro, ejecutivo, saldo, cuota,
// mora). Se llena desde el store (PostgreSQL o archivo) en el arranque.
let PADRON = [];
const CUOTA = {}; // cuota por nº de socio (para faltantes/mora del día)

// normaliza para buscar sin acentos ni mayúsculas
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
app.get("/api/clientes", requiere("direccion", "admin", "ejecutivo"), (req, res) => {
  const q = norm(req.query.q).trim();
  if (q.length < 2) return res.json({ total: PADRON.length, resultados: [] });
  const terminos = q.split(/\s+/);
  // ejecutivo solo ve sus clientas; dirección y admin ven todas
  let base = PADRON;
  if (req.usuario.rol === "ejecutivo") base = PADRON.filter(c => norm(c.ejecutivo) === norm(req.usuario.nombre));
  const res1 = base.filter(c => {
    const heno = norm(c.nombre) + " " + c.id;
    return terminos.every(t => heno.includes(t));
  }).slice(0, 40);
  res.json({ total: base.length, resultados: res1 });
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
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
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
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
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
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
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
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
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
app.get("/app", requiere("ejecutivo"), (req, res) => {
  const archivo = path.join(__dirname, "apps", req.usuario.app);
  if (!fs.existsSync(archivo)) return res.status(404).send("No se encontró el archivo de la app de este ejecutivo.");
  // inyectar el módulo de sincronización antes de </body>
  const html = fs.readFileSync(archivo, "utf8");
  const inyecciones = '<script src="/sync.js"></script><script src="/captura-agil.js"></script>';
  const conSync = html.includes("</body>")
    ? html.replace("</body>", inyecciones + "</body>")
    : html + inyecciones;
  res.type("html").send(conSync);
});
app.get("/tablero", requiere("direccion", "admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tablero.html"));
});
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3789;
store.init().then(() => {
  PADRON = store.padron();
  PADRON.forEach((c) => { if (c.cuota > 0 && !CUOTA[c.id]) CUOTA[c.id] = c.cuota; });
  console.log(`Padrón cargado: ${PADRON.length} clientas`);
  app.listen(PORT, () => console.log(`FOOAX cobranza · puerto ${PORT}`));
}).catch((e) => { console.error("Error al iniciar el store:", e); process.exit(1); });
