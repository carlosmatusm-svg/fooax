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
  // Alta 28-jul: cartera de Comadre (semanal) y Magnus (mensual, cuota
  // decreciente — apartada de la mora hasta el módulo de intereses).
  julio:       { nombre: "Julio",       rol: "ejecutivo", app: "App_Cobranza_JULIO.html",        pass: process.env.PASS_JULIO       || "julio2026" },
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
// Cuando la app corrige su fecha (estaba pegada en ayer), lo capturado se
// re-etiqueta a HOY y se re-sincroniza. Este endpoint retira el snapshot que
// quedó bajo la fecha EQUIVOCADA (se archiva antes) — sin esto, la tarjeta de
// la semana sumaba ese dinero DOS veces, una por cada fecha.
// La ejecutiva avisa que CERRÓ su día (tocó el botón de enviar arqueo /
// cerrar). Queda la hora en el snapshot: el tablero muestra quién cerró con el
// botón y quién se lo saltó — antes no había forma de saberlo.
app.post("/api/cierre", requiere("ejecutivo"), (req, res) => {
  const b = req.body || {};
  const fecha = String(b.fecha || hoyMX()).trim();
  // GARANTÍA (regla Karina 27-jul): si el sistema dice que CERRÓ, es porque
  // MANDÓ SU ARQUEO. Se valida aquí y no solo en la app, porque el teléfono
  // puede traer una versión vieja o alguien puede llamar la API directo.
  // Si el día no tuvo efectivo (todo transferencia), no hay nada que contar.
  const a = calcularArqueo(fecha, [req.usuario.id]);
  const e = a.porEjec[req.usuario.id] || { denom: {}, efectivo: 0 };
  const contado = Object.entries(e.denom || {}).reduce((s, [d, q]) => s + Number(d) * (Number(q) || 0), 0);
  if ((e.efectivo || 0) > 0 && contado <= 0) {
    return res.status(400).json({
      error: "Para cerrar el día primero tienes que contar tu efectivo en la pestaña Arqueo. Sin el conteo, el día no se puede dar por cerrado.",
      falta: "arqueo",
    });
  }
  const marcado = store.marcarCierre(req.usuario.id, fecha, !!b.confirmado);
  res.json({ ok: true, marcado, fecha, confirmado: !!b.confirmado, contado });
});

// "Capturar TODO de nuevo" tras cerrar: la ejecutiva eligió empezar de cero en
// la pregunta de la app. La versión que había queda archivada (recuperable en
// el tablero) y la siguiente sincronización REEMPLAZA el día en vez de sumarse.
app.post("/api/dia/reinicio", requiere("ejecutivo"), (req, res) => {
  const fecha = String((req.body || {}).fecha || "").trim() || hoyMX();
  const habia = store.reiniciarDia(req.usuario.id, fecha);
  if (habia) console.log(`[reinicio] ${req.usuario.id}: el día ${fecha} contará desde cero (la versión anterior quedó archivada)`);
  res.json({ ok: true, habia });
});

app.post("/api/reetiquetado", requiere("ejecutivo"), (req, res) => {
  const de = String((req.body || {}).de || "").trim();
  const hoy = hoyMX();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de)) return res.status(400).json({ error: "Fecha inválida." });
  if (de === hoy) return res.status(400).json({ error: "No se puede retirar la captura de HOY." });
  const habia = store.retirarSnapshot(req.usuario.id, de);
  if (habia) console.log(`[reetiquetado] ${req.usuario.id}: retirado el snapshot mal fechado de ${de} (archivado en historial)`);
  res.json({ ok: true, retirado: habia, de, hoy });
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
const syncRechazos = {};  // ejecutivo -> { fecha, pagosEnServidor, ts } (sync vacío rechazado)
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
function guardarMovimientosDeEjecutiva(usuario, fecha, snapshot, permitirAnular) {
  // La app manda su lista completa de la sesión. Si un folio ya guardado no
  // viene, la ejecutiva lo BORRÓ → se marca ANULADO (nunca se borra; queda el
  // rastro y deja de contar); si vuelve a venir, revive.
  if (!Array.isArray(snapshot && snapshot.movs)) return;
  const lista = snapshot.movs;
  const prefijo = "EJE-" + usuario.id.toUpperCase() + "-";
  const presentes = new Set(lista.filter((m) => Number(m && m.monto) > 0)
    .map((m) => prefijo + (m.folio || Math.abs(Number(m.monto)) + "-" + String(m.concepto || "").toUpperCase())));
  // ANULAR es PELIGROSO: solo cuando la sincronización es una edición real de la
  // sesión (permitirAnular) Y trae al menos un movimiento. Una lista VACÍA NO
  // anula — casi siempre significa "la app abrió limpia / sync rechazada /
  // arranque del servidor", no "la ejecutiva borró todo". Ese era el bug que
  // anulaba los movimientos del martes en cada deploy y en cada sync vacío.
  if (permitirAnular && lista.length > 0) {
    for (const viejo of store.movimientosDeFecha(fecha)) {
      if (!String(viejo.folio).startsWith(prefijo)) continue;   // solo los SUYOS
      if (!presentes.has(viejo.folio) && !viejo.anulado) store.setMovimientoAnulado(viejo.folio, true);
      if (presentes.has(viejo.folio) && viejo.anulado) store.setMovimientoAnulado(viejo.folio, false);
    }
  }
  for (const m of lista) {
    const monto = Number(m && m.monto);
    if (!(monto > 0)) continue;
    const cve = String(m.concepto || "").toUpperCase();
    const def = CONCEPTOS_EJEC[cve] || { etiqueta: m.concepto || "Otro", categoria: "Otro", entrada: false };
    const quien = [m.clienta, m.socio].filter(Boolean).join(" · ");
    const nuevo = {
      // El folio de la app ya es único por ejecutiva y día; se le antepone el
      // usuario para no chocar nunca con los folios DIR- de dirección. Como
      // agregarMovimiento es append-only por folio, re-sincronizar no duplica.
      folio: "EJE-" + usuario.id.toUpperCase() + "-" + (m.folio || Math.abs(monto) + "-" + cve),
      fecha, monto,
      concepto: def.etiqueta + (quien ? " · " + quien : "") + (m.nota ? " — " + m.nota : ""),
      categoria: def.categoria,
      // CH = CHEQUE: dinero que entra pero NO en billetes — si cayera en
      // "efectivo", el arqueo exigiría en caja billetes que son papeles
      // (el faltante de $2,280 de Neri del sábado 25-jul).
      metodo: m.via === "T" ? "transferencia" : (m.via === "CH" ? "cheque" : "efectivo"),
      cheque: (m.via === "CH" && m.cheque) ? String(m.cheque) : null,
      entrada: def.entrada,
      // socio: para poder ligar una LIQUIDACIÓN al crédito de esa clienta y
      // bajarle el saldo. Antes sólo iba dentro del texto del concepto.
      socio: m.socio ? String(m.socio) : null,
      autorizadoA: m.clienta || null,
      registradoPor: usuario.nombre, rol: usuario.rol, usuario: usuario.id, ts: Date.now(),
    };
    // Red de seguridad para FOLIOS REINICIADOS: la sesión nueva (tras cerrar)
    // vuelve a numerar desde 1, así que un folio puede repetirse con CONTENIDO
    // DISTINTO (otra cantidad/concepto) — es un movimiento NUEVO y se
    // re-etiqueta (folio~2, ~3…) para no perderlo. El MÉTODO no cuenta como
    // contenido: si solo cambia la forma (efectivo→cheque), es el MISMO
    // movimiento y se le CORRIGE la forma — así el rescate del arranque repara
    // los cheques que se guardaron como efectivo, sin duplicarlos.
    const mismo = (x) => Number(x.monto) === monto && String(x.concepto) === nuevo.concepto;
    const choques = store.movimientosDeFecha(fecha)
      .filter((x) => x.folio === nuevo.folio || String(x.folio).indexOf(nuevo.folio + "~") === 0);
    const ya = choques.find(mismo);
    if (ya) {
      if (ya.metodo !== nuevo.metodo || String(ya.cheque || "") !== String(nuevo.cheque || ""))
        store.corregirMovimiento(ya.folio, { metodo: nuevo.metodo, cheque: nuevo.cheque });
      continue;
    }
    if (choques.length) {
      const base = nuevo.folio;
      let i = 2; while (store.movimientosDeFecha(fecha).some((x) => x.folio === base + "~" + i)) i++;
      nuevo.folio = base + "~" + i;
    }
    store.agregarMovimiento(nuevo);
  }
}

// ---------- fusión post-cierre ----------
// CONTRATO: tras el cierre, la app arranca limpia y cada sync manda el estado
// COMPLETO de la sesión nueva (acumulado desde el cierre). La fusión SIEMPRE
// parte de la foto CONGELADA al cierre (baseCerrada) — nunca del último merge —
// para que re-sincronizar la misma sesión sea idempotente. (La familia del bug
// de los $848: tratar fotos como sumas y sumas como fotos.)
function fusionarPagoNodo(vi, nu) {
  // La MISMA clienta pagó otra vez después del cierre: es dinero ADICIONAL, se
  // SUMA (antes lo nuevo pisaba lo de la mañana). Si las formas difieren, el
  // resultado es MIXTO con cada parte en su bolsa (efectivo/banco).
  const tot = (r) => (r.pago || 0) + (r.garantia || 0) + (r.solidario || 0);
  const efeDe = (r) => {
    if (r.forma === "T" || r.forma === "D") return 0;
    if (r.forma === "M") {
      const mt = r.mixTr || 0;
      return (r.mixEfe != null && (mt + (r.mixEfe || 0)) === tot(r)) ? r.mixEfe : tot(r) - mt;
    }
    return tot(r);
  };
  const out = Object.assign({}, nu);
  out.pago = (vi.pago || 0) + (nu.pago || 0);
  out.garantia = (vi.garantia || 0) + (nu.garantia || 0);
  out.solidario = (vi.solidario || 0) + (nu.solidario || 0);
  const fv = vi.forma || "E", fn = nu.forma || "E";
  if (fv === fn && fv !== "M") { out.forma = fv; delete out.mixEfe; delete out.mixTr; }
  else {
    out.forma = "M";
    out.mixEfe = Math.round((efeDe(vi) + efeDe(nu)) * 100) / 100;
    out.mixTr = Math.round(((tot(vi) - efeDe(vi)) + (tot(nu) - efeDe(nu))) * 100) / 100;
  }
  return out;
}
// Dos registros de pago son EL MISMO (no un pago adicional): mismo pago,
// garantía, solidario y forma/mixto. Clave para no duplicar cuando la ejecutiva
// vuelve a ENTRAR y su app re-manda la MISMA captura del día ya cerrado.
function igualPago(a, b) {
  return !!a && !!b &&
    (a.pago || 0) === (b.pago || 0) &&
    (a.garantia || 0) === (b.garantia || 0) &&
    (a.solidario || 0) === (b.solidario || 0) &&
    (a.forma || "E") === (b.forma || "E") &&
    (a.mixEfe || 0) === (b.mixEfe || 0) &&
    (a.mixTr || 0) === (b.mixTr || 0);
}
function fusionarSesion(base, inc) {
  // Fusiona una clienta del envío nuevo contra la base congelada del cierre. Si
  // el nodo es IDÉNTICO al de la base, es la MISMA captura re-enviada (la
  // ejecutiva volvió a entrar): se conserva la base, NO se suma — antes esto
  // duplicaba el día entero al re-entrar aunque solo hubiera registrado una vez.
  // Solo se SUMA cuando el monto/forma es DISTINTO (un pago realmente adicional).
  const fusC = (viejo, nuevo) => !viejo ? nuevo : (igualPago(viejo, nuevo) ? viejo : fusionarPagoNodo(viejo, nuevo));
  const reg = {};
  for (const c in (base.reg || {})) reg[c] = Object.assign({}, base.reg[c]);
  for (const c in (inc.reg || {})) {
    reg[c] = reg[c] || {};
    for (const k in inc.reg[c]) reg[c][k] = fusC(reg[c][k], inc.reg[c][k]);
  }
  const regI = Object.assign({}, base.regI || {});
  for (const k in (inc.regI || {})) regI[k] = fusC(regI[k], inc.regI[k]);
  // Movimientos: la sesión nueva REINICIA su consecutivo. Un folio repetido con
  // el MISMO contenido es el mismo movimiento (idempotente); con contenido
  // DISTINTO es uno NUEVO y se re-etiqueta (antes se descartaba en silencio).
  const movs = (base.movs || []).slice();
  const igual = (a, b) => a && b && String(a.concepto || "") === String(b.concepto || "") &&
    Number(a.monto || 0) === Number(b.monto || 0) && String(a.via || "") === String(b.via || "") &&
    String(a.socio || "") === String(b.socio || "");
  for (const m of (inc.movs || [])) {
    if (!m) continue;
    if (movs.some((x) => igual(x, m) && (x.folio === m.folio || String(x.folio || "").indexOf(m.folio + "~") === 0))) continue;
    let folio = m.folio;
    if (movs.some((x) => x.folio === folio)) {
      let i = 2; while (movs.some((x) => x.folio === folio + "~" + i)) i++;
      folio = folio + "~" + i;
    }
    movs.push(Object.assign({}, m, { folio }));
  }
  // El conteo de billetes es FOTO, no delta (bug de los $848): gana el último
  // conteo con datos; si la sesión nueva no ha contado, se conserva el previo.
  const arqueo = (inc.arqueo && Object.keys(inc.arqueo).length) ? inc.arqueo : (base.arqueo || {});
  return Object.assign({}, inc, { reg, regI, movs, arqueo });
}

app.post("/api/sync", requiere("ejecutivo"), (req, res) => {
  const { fecha, ts } = req.body || {};
  let snapshot = (req.body || {}).snapshot;
  // La app manda su captura como TEXTO (su localStorage tal cual). Se convierte
  // a objeto UNA sola vez para todo el camino. Sin esto, el guardado de "otros
  // movimientos" recibía texto y se regresaba sin guardar nada — los movimientos
  // solo aparecían cuando un redespliegue los rescataba de los snapshots (por
  // eso el 27-jul el tablero amaneció sin los movimientos del día).
  if (typeof snapshot === "string") { try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; } }
  if (!fecha || !snapshot || typeof snapshot !== "object") return res.status(400).json({ error: "Faltan datos para sincronizar (la fecha o la captura)." });
  const hoy = hoyMX();
  const previo = store.snapshotsDeFecha(fecha)[req.usuario.id];
  const antes = previo ? contarPagos(previo.snapshot) : null;
  const ahora = contarPagos(snapshot);
  // BLINDAJE: una captura VACÍA (0 pagos) nunca puede pisar una con cobranza.
  // Es lo que borró el día hoy — la app abrió con localStorage limpiado y
  // sincronizó ceros encima de lo real. Se archiva el intento y se rechaza,
  // devolviendo el conteo real para que la app lo pueda recuperar.
  // EXCEPCIÓN: CORRECCIÓN DEL CONTEO DE BILLETES. Si el día YA está cerrado y
  // la captura trae un conteo nuevo, es una corrección del arqueo (un dedazo al
  // contar), no una captura vacía: tras cerrar, la app queda limpia, así que
  // corregir el conteo SIEMPRE llega sin pagos. Es seguro porque la fusión
  // post-cierre conserva la cobranza y los movimientos de la foto congelada —
  // el conteo es lo único que se reemplaza. Sin esto, un conteo mal tecleado
  // dejaba el día en rojo para siempre (caso Karina 28-jul: $140 de dedazo).
  // Es corrección de conteo SOLO si: el día ya cerró, la captura trae conteo Y
  // NO trae ningún pago. Si trae pagos es una captura tardía normal y tiene que
  // pasar por la fusión (si no, se perderían esos pagos nuevos).
  const traeConteo = !!(snapshot.arqueo && Object.keys(snapshot.arqueo).length);
  const esCorreccionDeConteo = !!(previo && previo.cierre && traeConteo && !(ahora > 0));
  if (antes != null && antes > 0 && (ahora === 0 || ahora == null) && !esCorreccionDeConteo) {
    console.warn(`[sync] RECHAZADO vacío de ${req.usuario.id} para ${fecha}: el servidor tiene ${antes} pagos, la app mandó 0. No se sobrescribe.`);
    syncRechazos[req.usuario.id] = { fecha, pagosEnServidor: antes, ts: Date.now() };
    // Los "otros movimientos" SÍ se guardan (append-only por folio) — pero NO se
    // anula nada: la sincronización viene vacía/rechazada, no es una edición.
    guardarMovimientosDeEjecutiva(req.usuario, fecha, snapshot, false);
    return res.json({ ok: false, rechazado: "vacio_sobre_lleno", pagosEnServidor: antes, hoy });
  }
  // CORRECCIÓN DE CONTEO: se reemplaza SOLO el conteo de billetes y NADA más.
  // No pasa por la fusión a propósito: la fusión reconstruye desde la foto
  // CONGELADA del cierre, así que habría borrado los pagos capturados DESPUÉS
  // de cerrar. Aquí se parte del estado ACTUAL y solo se cambia el arqueo.
  if (esCorreccionDeConteo) {
    let base = previo.snapshot;
    if (typeof base === "string") { try { base = JSON.parse(base); } catch { base = null; } }
    if (base && typeof base === "object") {
      const corregido = Object.assign({}, base, { arqueo: snapshot.arqueo });
      store.guardarSnapshot(req.usuario.id, fecha, { snapshot: corregido, ts: ts || Date.now() });
      console.log(`[conteo] ${req.usuario.id} corrigió su conteo de billetes del ${fecha}`);
      return res.json({ ok: true, correccionConteo: true, hoy });
    }
  }

  // FUSIÓN POST-CIERRE: si el día ya se cerró (enviaron el arqueo) y llega más
  // captura, se SUMA a lo que había en vez de reemplazarlo. Sin esto, capturar
  // después de cerrar (candado al volver / pago tardío) borraba del día todo lo
  // anterior — quedaba en el historial, pero el tablero solo enseñaba lo nuevo.
  let snapFinal = snapshot;
  try {
    if (previo && previo.cierre) {
      // Fusión contra la foto CONGELADA al cierre (idempotente). Días cerrados
      // antes de esta versión no tienen baseCerrada: comportamiento anterior.
      let base = previo.baseCerrada != null ? previo.baseCerrada : previo.snapshot;
      if (typeof base === "string") base = JSON.parse(base);
      let inc = snapshot; if (typeof inc === "string") inc = JSON.parse(inc);
      if (base && typeof base === "object" && inc && typeof inc === "object") {
        if (previo.baseCerrada != null) {
          snapFinal = fusionarSesion(base, inc);
        } else {
          const reg = {}; for (const c in (base.reg || {})) reg[c] = Object.assign({}, base.reg[c]);
          for (const c in (inc.reg || {})) reg[c] = Object.assign({}, reg[c] || {}, inc.reg[c]);
          const regI = Object.assign({}, base.regI || {}, inc.regI || {});
          const folios = new Set((base.movs || []).map((m) => m && m.folio));
          const movs = (base.movs || []).concat((inc.movs || []).filter((m) => m && !folios.has(m.folio)));
          const arq = (inc.arqueo && Object.keys(inc.arqueo).length) ? inc.arqueo : (base.arqueo || {});
          snapFinal = Object.assign({}, inc, { reg, regI, movs, arqueo: arq });
        }
      }
    }
  } catch (e) { snapFinal = snapshot; }
  store.guardarSnapshot(req.usuario.id, fecha, { snapshot: snapFinal, ts: ts || Date.now() });
  // ANULAR solo se permite en la sesión ABIERTA (antes del cierre): ahí sí, si
  // la ejecutiva quitó un movimiento, su envío completo lo omite y se anula. YA
  // CERRADO, los movimientos se acumulan por la fusión y NUNCA se anulan por una
  // sesión nueva que no los reenvíe — si no, los movimientos comprometidos de la
  // mañana desaparecían al capturar en la tarde (misma familia del bug del martes).
  guardarMovimientosDeEjecutiva(req.usuario, fecha, snapFinal, !(previo && previo.cierre));
  if (fecha !== hoy) desfasesFecha[req.usuario.id] = { fecha, hoy, ts: Date.now() };
  else delete desfasesFecha[req.usuario.id];
  const ahoraFinal = (snapFinal === snapshot) ? ahora : contarPagos(snapFinal);
  if (antes != null && ahoraFinal != null && antes - ahoraFinal >= 3) {
    reducciones[req.usuario.id] = { fecha, antes, ahora: ahoraFinal, ts: Date.now() };
  } else if (reducciones[req.usuario.id] && reducciones[req.usuario.id].fecha === fecha && ahoraFinal != null && antes != null && ahoraFinal >= antes) {
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
    // 'D' = DEPÓSITO (Oxxo/tienda): el dinero va directo al banco, NO lo trae
    // el ejecutivo en efectivo. Antes caía en el "else" y se contaba como
    // efectivo: por eso a Monse le cuadraba el total pero no la clasificación.
    if (nodo.forma === "T" || nodo.forma === "D") {
      acc.transferencia += total;
      // subconjunto visible: cuánto de eso fue DEPÓSITO Oxxo/tienda — el
      // reporte de la app los separa y Monse necesita cotejarlos igual.
      if (nodo.forma === "D") acc.deposito = (acc.deposito || 0) + total;
    }
    else if (nodo.forma === "M") {
      // MIXTO: la transferencia es lo capturado y el efectivo es el RESTO —
      // igual que en la app. Antes se leía sólo mixEfe: si la ejecutiva llenaba
      // nada más la transferencia, ese efectivo DESAPARECÍA del total (por eso
      // a Monse no le cuadraba el martes: faltaban $1,008 de clasificación).
      const mt = nodo.mixTr || 0;
      const me = (nodo.mixEfe != null && (mt + (nodo.mixEfe || 0)) === total) ? nodo.mixEfe : (total - mt);
      acc.efectivo += me; acc.transferencia += mt;
    }
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
    ejecutivos[id] = { nombre: USUARIOS[id].nombre, ...acc, movimientos, ultimaSync, cierre: (s && s.cierre) || null };
  }
  const total = Object.values(ejecutivos).reduce((t, e) => ({
    pago: t.pago + e.pago, garantias: t.garantias + e.garantias,
    efectivo: t.efectivo + e.efectivo, transferencia: t.transferencia + e.transferencia,
    deposito: t.deposito + (e.deposito || 0),
  }), { pago: 0, garantias: 0, efectivo: 0, transferencia: 0, deposito: 0 });
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
  let totalSemana = 0, moraSemana = 0;
  const ids = idsEjecutivos(req.usuario);
  for (let i = 0; i < 7; i++) {
    const f = new Date(dt); f.setUTCDate(dt.getUTCDate() + i);
    const fecha = f.toISOString().slice(0, 10);
    if (fecha > hasta) break;
    const snaps = store.snapshotsDeFecha(fecha);
    const acc = { pago: 0, garantias: 0, solidario: 0, efectivo: 0, transferencia: 0, clientasPagaron: 0 };
    const permitidas = new Set(ids);
    for (const ej in snaps) {
      if (!permitidas.has(ej)) continue;
      let data = snaps[ej].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
      acumular(data.reg, acc); acumular(data.regI, acc);
    }
    const total = acc.pago + acc.garantias;
    // Mora ACUMULADA de la semana: se reusa el MISMO cálculo diario del arqueo
    // (cuota − lo que pagó, en quien pagó de menos) sumado día por día, para
    // que Monse pueda comparar varios días contra su control sin re-sumar a mano.
    const mora = calcularArqueo(fecha, ids).faltantes || 0;
    moraSemana += mora;
    totalSemana += total;
    dias.push({ fecha, total, efectivo: acc.efectivo, transferencia: acc.transferencia, mora });
  }
  res.json({ desde: dt.toISOString().slice(0, 10), hasta, dias, totalSemana, moraSemana });
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
const CUOTA = {};        // cuota por socio|producto (para faltantes/mora del día)
const CREDS_SOCIO = {};  // socio -> [cuotas] (fallback cuando el producto no coincide)
// Re-lee el padrón efectivo (base + altas/bajas) y reconstruye el mapa de cuotas.
// PRODUCTOS DE CUOTA VARIABLE (saldos insolutos): la cuota BAJA cada periodo,
// así que la del padrón deja de ser válida al primer pago. Si se comparara el
// pago contra ella saldría MORA FALSA todas las semanas. Mejor no inventar
// mora: se excluyen del mapa de cuotas y el sistema los trata como "sin cuota
// de referencia" (cuotaDe → null), que ya es un caso soportado.
// Hoy solo MAGNUS (CCF03). El cálculo correcto llega con el módulo de intereses.
const CUOTA_VARIABLE = /magnus|ccf0?3/i;
function esCuotaVariable(producto) { return CUOTA_VARIABLE.test(String(producto || "")); }
function refrescarPadron() {
  PADRON = store.padron();
  for (const k in CUOTA) delete CUOTA[k];
  for (const k in CREDS_SOCIO) delete CREDS_SOCIO[k];
  PADRON.forEach((c) => {
    if (!(c.cuota > 0) || esCuotaVariable(c.producto)) return;
    CUOTA[c.id + "|" + nprod(c.producto)] = c.cuota;
    (CREDS_SOCIO[c.id] = CREDS_SOCIO[c.id] || []).push(c.cuota);
  });
}
// Cuota del crédito EXACTO de una captura ("socio|producto|..."). Antes el mapa
// era solo por socio y se quedaba con la cuota del PRIMER crédito: a una
// clienta con Básico y Micro se le comparaba el pago del Micro contra la cuota
// del Básico y salía mora FALSA — el 23-jul, $6,777.50 de los $7,141.50 de
// "mora" de Neri eran de este bug. Si el producto no coincide y el socio tiene
// varios créditos, mejor no inventar mora (null).
function cuotaDe(key) {
  const partes = String(key).split("|");
  const socio = partes[0], prod = partes[1] || "";
  const exacta = CUOTA[socio + "|" + nprod(prod)];
  if (exacta != null) return exacta;
  const lista = CREDS_SOCIO[socio] || [];
  return lista.length === 1 ? lista[0] : null;
}

// normaliza para buscar sin acentos ni mayúsculas
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
// Producto normalizado: sin acentos, espacios ni puntuación (conserva números).
// "Foxi Plus - 2" y "Foxi Plus 2" son el mismo producto.
function nprod(s) { return norm(s).replace(/[^a-z0-9]/g, ""); }

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
  // El producto se compara SIN espacios ni puntuación: la app y el padrón a
  // veces lo escriben distinto ("Foxi Plus 2" vs "Foxi Plus - 2") y eso hacía
  // que un pago no encontrara su crédito y cayera en "sin asignar" aunque el
  // socio fuera el mismo. Se conservan los números (Individual 1 ≠ Individual 2).
  return norm(String(socioOKey).split("|")[0]) + "|" + nprod(producto);
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
function pagosDeLaSemana(usuario, desde, hastaOpt) {
  // Sin `desde`: la ventana semanal de siempre (lunes → hoy). Con `desde`: el
  // acumulado desde esa fecha — lo usan los SALDOS, que deben descontar TODO lo
  // abonado desde el corte de plantillas, no solo esta semana (los lunes la
  // semana se reinicia y "lo que se le debe" regresaba al saldo viejo: el bug
  // del viernes de Neri que se notó el lunes 27-jul). `hastaOpt` cierra la
  // ventana antes de hoy (para mirar un solo día).
  const hoy = hastaOpt || hoyMX(), lunes = desde || lunesDeLaSemana(hoyMX());
  const pago = {}, gar = {}, detalle = {}, porFecha = {};
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
    // Desglose por DÍA: lo necesitan las renovaciones. Como la llave es
    // socio+producto y al renovar el nombre es el mismo, el ciclo nuevo solo debe
    // contar los pagos hechos DESDE su alta (ver `alta_fecha`).
    if (fecha) {
      const pf = porFecha[clave] || (porFecha[clave] = {});
      const b = pf[fecha] || (pf[fecha] = { p: 0, g: 0 });
      b.p += p; b.g += g;
    }
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
  return { pago, gar, detalle, porFecha };
}

// Liquidaciones y recuperaciones de la semana, por socio: abonos al crédito
// FUERA de la cuota que también bajan el saldo. Antes esto vivía SOLO dentro
// del Excel; por eso el tablero (búsqueda y panel) no las restaba y una clienta
// que liquidó seguía mostrando su saldo viejo.
// `fechasOut` (opcional): se llena con {socio: {fecha:true}} para poder decir EN
// QUÉ DÍA se liquidó. Sin esto la columna "Días de pago" del Excel salía vacía en
// las liquidaciones y recuperaciones — que son justo la mitad del problema (las 6
// de Neri del 25-jul eran todas liquidaciones). Lo cachó Karina el 29-jul.
function liquidacionesDeLaSemana(usuario, desde, fechasOut) {
  const hoy = hoyMX(), lunes = desde || lunesDeLaSemana(hoy);
  const liqPorSocio = {};
  const d0 = new Date(lunes + "T12:00:00");
  // Tope 400 días: con `desde` (corte de saldos) la ventana puede ser larga.
  for (let i = 0; i < (desde ? 400 : 7); i++) {
    const f = new Date(d0); f.setDate(d0.getDate() + i);
    const fISO = f.toISOString().slice(0, 10);
    if (fISO > hoy) break;
    for (const m of movsDeFecha(fISO, usuario)) {
      const tipo = String(m.concepto || "").split(" · ")[0].split(" — ")[0].trim() || m.categoria || "Otro";
      if (!/^(liquidaci|recuperaci)/i.test(tipo)) continue;
      const soc = socioDeMov(m);
      if (soc) {
        liqPorSocio[soc] = (liqPorSocio[soc] || 0) + m.monto;
        // Guarda el MONTO por día (no solo la fecha): las renovaciones necesitan
        // saber cuánto se liquidó en cada día para no darle al ciclo nuevo lo del
        // anterior. Las fechas se siguen leyendo con Object.keys().
        if (fechasOut) {
          const fo = fechasOut[soc] = fechasOut[soc] || {};
          fo[fISO] = (fo[fISO] || 0) + m.monto;
        }
      }
    }
  }
  return liqPorSocio;
}
// CARTERA VIVA · fuente ÚNICA del saldo actual por crédito, para que el Excel y
// el tablero siempre cuadren. Para cada crédito activo: lo pagado y lo liquidado
// esta semana, y saldoActual = saldo − pago − liquidación. La liquidación es por
// SOCIO y se agota entre sus créditos en un orden fijo (ejecutivo, centro,
// nombre), el mismo que usa el Excel.
// CORTE DE SALDOS: la fecha desde la que los saldos descuentan lo abonado.
// Es el día en que Monse cargó las plantillas (saldos frescos). Cuando cargue
// plantillas nuevas, Anel/Monse actualizan el corte en el tablero — si no,
// lo ya descontado en la plantilla se restaría DOBLE.
const CORTE_SALDOS_DEFECTO = "2026-07-21";   // plantillas nuevas del 21-jul
function corteSaldos() {
  const cortes = store.cambiosPadron().filter((c) => c.tipo === "corte" && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || ""));
  return cortes.length ? cortes[cortes.length - 1].fecha : CORTE_SALDOS_DEFECTO;
}
// SEMÁNTICA DEL CORTE (decidido el 29-jul, después de comprobarlo con Karina):
// el corte es el PRIMER DÍA CUYOS ABONOS SÍ SE DESCUENTAN — se cuenta ese día
// incluido. Se intentó cambiarlo a "el último día que la plantilla ya trae
// descontado" para que la cobranza del sábado no reapareciera el lunes, y se
// DESECHÓ: habría desplazado un día de cobranza en TODOS los cortes, también los
// viejos, y Karina comprobó que el Excel del sábado ya mostraba los pagos del
// sábado (o sea, las plantillas se han venido cortando ANTES del sábado y los
// saldos han salido bien así).
// Para dejar un día fuera NO se toca código: Anel o Monse mueven el corte al día
// siguiente desde el tablero. Ej.: plantilla que ya trae el sábado 25 → corte 26.
// Con hora no se puede y no hace falta: las capturas guardan fecha, no hora, y
// nadie captura después de cerrar su día.

function carteraViva(usuario) {
  // Saldos = saldo de plantilla − TODO lo abonado desde el corte (no solo la
  // semana: los lunes la ventana semanal se vacía y los saldos "rebotaban").
  const corte = corteSaldos();
  const { pago: pagos, gar: garantias, porFecha } = pagosDeLaSemana(usuario, corte);
  const fechasLiq = {};   // socio → día → monto liquidado/recuperado
  const liqRestante = Object.assign({}, liquidacionesDeLaSemana(usuario, corte, fechasLiq));
  const activos = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA")
    .sort((a, b) => String(a.ejecutivo).localeCompare(String(b.ejecutivo)) ||
      String(a.centro).localeCompare(String(b.centro)) || String(a.nombre).localeCompare(String(b.nombre)));
  const porCredito = new Map();
  for (const c of activos) {
    const clave = claveCredito(c.id, c.producto);
    const soc = String(c.id);
    // RENOVACIONES. La llave de un crédito es socio+producto y al renovar el nombre
    // es el MISMO, así que los abonos del ciclo anterior se le restaban al nuevo:
    // probado el 29-jul, renovó $10,000 y el tablero lo mostraba en $8,000 porque le
    // descontó los $2,000 con que liquidó el ciclo viejo.
    // NO se resuelve por fecha: la clienta suele liquidar y renovar el MISMO día, y
    // las capturas solo guardan fecha, no hora. Se resuelve con lo exacto: al hacer
    // el recrédito se anota cuánto llevaba abonado el ciclo que se cerró (`previo`),
    // y ese monto se descuenta aquí. Solo vale mientras no se mueva el corte —
    // cuando se mueve, los acumulados arrancan de cero y el descuento ya no aplica.
    const prev = (c.previo && c.previo.corte === corte) ? c.previo : null;
    const pagado = Math.max(0, (pagos[clave] || 0) - (prev ? (prev.pago || 0) : 0));
    const garan = Math.max(0, (garantias[clave] || 0) - (prev ? (prev.gar || 0) : 0));
    // Las liquidaciones son por SOCIO y se reparten entre sus créditos en orden
    // fijo. Lo que ya consumió el ciclo cerrado se aparta antes de repartir.
    const usado = liqRestante["__usado__" + soc] || (liqRestante["__usado__" + soc] = 0);
    const bolsa = Object.values(fechasLiq[soc] || {}).reduce((a, b) => a + b, 0);
    const disp = Math.max(0, bolsa - usado - (prev ? (prev.liq || 0) : 0));
    const liquidado = Math.min(disp, Math.max(0, (c.saldo || 0) - pagado));
    if (liquidado > 0) liqRestante["__usado__" + soc] = usado + liquidado;
    porCredito.set(clave, { pagado, liquidado, garantia: garan,
      saldoActual: Math.max(0, (c.saldo || 0) - pagado - liquidado),
      // Solo se anotan los días de la liquidación si a ESTE crédito le tocó algo.
      fechasLiq: liquidado > 0 ? Object.keys(fechasLiq[soc] || {}) : [] });
  }
  return { porCredito, pagos, garantias };
}
function infoCredito(cv, c) {
  return cv.porCredito.get(claveCredito(c.id, c.producto)) ||
    { pagado: 0, liquidado: 0, garantia: 0, saldoActual: Math.max(0, c.saldo || 0) };
}

// ---------- SALDOS ACTUALIZADOS de la semana en Excel ----------
// La plantilla que Monse hace a mano: saldo inicial − pagado esta semana =
// saldo actualizado, por crédito. Generada sola. Solo dirección/admin.
app.get("/api/semana/excel", requiere("direccion", "admin"), async (req, res) => {
  // Los SALDOS descuentan TODO lo abonado desde el corte de plantillas (si solo
  // restaran la semana, cada lunes "rebotaban" al saldo viejo — el viernes de
  // Neri se perdía). detalle/garantías van con la misma ventana del corte.
  const corte = corteSaldos();
  const { gar: garantias, detalle } = pagosDeLaSemana(req.usuario, corte);
  const hoy = hoyMX(), lunes = lunesDeLaSemana(hoy);
  const usadas = new Set();
  const wb = new ExcelJS.Workbook(); wb.creator = "FOOAX";
  const s = wb.addWorksheet("Saldos actualizados");
  const AURORA = "FFF1228E", RIO = "FF324AB6";
  s.mergeCells("A1:N1");
  const t = s.getCell("A1");
  // Dice ACUMULADO y con el día del corte incluido, porque eso es lo que hace: el
  // reporte no es "lo de esta semana", es todo lo abonado desde el corte. Por eso
  // la cobranza del sábado reaparece cada lunes y Monse creía que no se había
  // contado (29-jul). La columna "Días de pago" es la que resuelve la duda.
  t.value = `FOOAX · SALDOS ACTUALIZADOS · ACUMULADO desde el ${corte} (ese día incluido) · al ${hoy}`;
  t.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
  t.alignment = { horizontal: "center", vertical: "middle" }; s.getRow(1).height = 24;
  // "Días de pago" dice EN QUÉ FECHAS se abonó. Sin ella, el acumulado desde el
  // corte es un solo número y no hay forma de saber si ya se recibió o es nuevo:
  // así se armó la confusión del sábado 25-jul (Monse buscó $15,232 en el arqueo
  // del lunes y del martes, cuando eran del sábado).
  const head = [["Ejecutivo", 13], ["Centro", 22], ["Clienta", 32], ["Socio", 15], ["Producto", 18],
    ["Saldo al corte", 13], ["Abonado", 13], ["Liquid./recup.", 13], ["Saldo actualizado", 16], ["Garantía", 11],
    ["Días de pago", 20], ["Cuota", 10], ["Mora", 11], ["Estatus", 12]];
  const hr = s.getRow(2);
  head.forEach(([h2, w], i) => { const c = hr.getCell(i + 1); c.value = h2; s.getColumn(i + 1).width = w;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    c.alignment = { horizontal: i >= 5 ? "center" : "left", wrapText: true }; });
  const dinero = '"$"#,##0';
  let fila = 3;
  const rows = PADRON.filter(c => c.activa !== false && c.estatus !== "BAJA")
    .sort((a, b) => String(a.ejecutivo).localeCompare(String(b.ejecutivo)) || String(a.centro).localeCompare(String(b.centro)) || String(a.nombre).localeCompare(String(b.nombre)));
  // Movimientos de la semana. Se calculan ANTES de las filas porque una
  // LIQUIDACIÓN baja el saldo de la clienta por el monto registrado.
  let movEntradas = 0, movSalidas = 0;
  const porTipoMov = {};
  {
    const d0 = new Date(lunes + "T12:00:00");
    for (let i = 0; i < 7; i++) {
      const f = new Date(d0); f.setDate(d0.getDate() + i);
      const fISO = f.toISOString().slice(0, 10);
      if (fISO > hoy) break;
      for (const m of movsDeFecha(fISO, req.usuario)) {
        const tipo = String(m.concepto || "").split(" · ")[0].split(" — ")[0].trim() || m.categoria || "Otro";
        porTipoMov[tipo] = porTipoMov[tipo] || { entra: 0, sale: 0 };
        if (m.entrada) { movEntradas += m.monto; porTipoMov[tipo].entra += m.monto; }
        else { movSalidas += m.monto; porTipoMov[tipo].sale += m.monto; }
      }
    }
  }
  // Saldos vivos (pago + liquidación) desde la fuente ÚNICA: el mismo cálculo que
  // ve el tablero, para que el Excel y el panel siempre cuadren.
  const cv = carteraViva(req.usuario);

  let tIni = 0, tPag = 0, tAct = 0, tGar = 0, tLiq = 0, tMora = 0;
  for (const c of rows) {
    const clave = claveCredito(c.id, c.producto);
    usadas.add(clave);
    const info = infoCredito(cv, c);
    const pagado = info.pagado, garan = garantias[clave] || 0;
    const ini = c.saldo || 0;
    const liquidado = info.liquidado;
    const act = info.saldoActual;
    tIni += ini; tPag += pagado; tAct += act; tGar += garan; tLiq += liquidado;
    const r = s.getRow(fila++);
    r.getCell(1).value = c.ejecutivo || ""; r.getCell(2).value = c.centro || "";
    r.getCell(3).value = c.nombre || ""; r.getCell(4).value = c.id; r.getCell(5).value = c.producto || "";
    r.getCell(6).value = ini; r.getCell(7).value = pagado || null; r.getCell(8).value = liquidado || null;
    r.getCell(9).value = act; r.getCell(10).value = garan || null;
    // Días en que se abonó, de lo más viejo a lo más nuevo (ej. "25-jul, 28-jul").
    // Es lo que le permite a Monse distinguir "esto ya lo recibí" de "esto es nuevo"
    // sin tener que cruzar contra los arqueos a mano.
    // Se juntan las DOS fuentes: los pagos/garantías (vienen del snapshot, por
    // crédito) y las liquidaciones/recuperaciones (vienen de movimientos, por
    // socio). Si falta una, la columna miente por omisión.
    const fs = Object.assign({}, (detalle[clave] || {}).fechas || {});
    (info.fechasLiq || []).forEach((f) => { fs[f] = true; });
    const dias = Object.keys(fs).sort().map((f) => {
      const p = f.split("-");
      return Number(p[2]) + "-" + ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(p[1]) - 1];
    });
    r.getCell(11).value = dias.length ? dias.join(", ") : "";
    r.getCell(11).alignment = { horizontal: "center" };
    r.getCell(12).value = c.cuota || 0;
    const mora = Number(c.mora) > 0 ? Number(c.mora) : 0; tMora += mora;
    r.getCell(13).value = mora || null;
    r.getCell(14).value = (c.estatus && c.estatus !== "VIGENTE" && c.estatus !== "BAJA") ? c.estatus : "";
    [6, 7, 8, 9, 10, 12, 13].forEach(i => r.getCell(i).numFmt = dinero);
    if (pagado > 0) r.getCell(7).font = { bold: true, color: { argb: "FF0B7247" } };
    if (liquidado > 0) r.getCell(8).font = { bold: true, color: { argb: "FF0B7247" } };
    if (act <= 0 && (pagado > 0 || liquidado > 0)) r.getCell(9).font = { bold: true, color: { argb: "FF0B7247" } };
    if (garan > 0) r.getCell(10).font = { bold: true, color: { argb: "FF8A5A00" } };
    if (mora > 0) r.getCell(13).font = { bold: true, color: { argb: "FFB00020" } };
    if (esVencido(c)) r.getCell(14).font = { bold: true, color: { argb: "FFB00020" } };
    if ((fila - 3) % 2 === 1) r.eachCell({ includeEmpty: true }, c2 => { if (!c2.fill || c2.fill.type !== "pattern") c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F1F8" } }; });
  }
  const tr = s.getRow(fila);
  tr.getCell(5).value = "TOTAL"; tr.getCell(5).font = { bold: true };
  tr.getCell(6).value = tIni; tr.getCell(7).value = tPag; tr.getCell(8).value = tLiq;
  tr.getCell(9).value = tAct; tr.getCell(10).value = tGar; tr.getCell(13).value = tMora || null;
  [6, 7, 8, 9, 10, 13].forEach(i => { tr.getCell(i).numFmt = dinero; tr.getCell(i).font = { bold: true, color: { argb: AURORA } }; });
  fila++;

  // Cuadre explícito — SIEMPRE con la ventana SEMANAL (lunes → hoy), aunque
  // las columnas de saldos sean acumuladas desde el corte: la cobranza de la
  // semana es la que cuadra con la tarjeta del tablero y con el arqueo.
  fila++;
  const sem = pagosDeLaSemana(req.usuario);
  const wPag = Object.values(sem.pago).reduce((a, b) => a + b, 0);
  const wGar = Object.values(sem.gar).reduce((a, b) => a + b, 0);
  const cobranzaSemana = wPag + wGar;
  const totalCaja = cobranzaSemana + movEntradas - movSalidas;
  const cuadre = [
    ["Pagos de ESTA semana", wPag, false],
    ["+ Garantías de ESTA semana (no bajan saldo)", wGar, false],
    ["= Cobranza de la semana (cuadra con la tarjeta del tablero)", cobranzaSemana, true],
    ["", null, false],
    ["+ Otros movimientos — entradas (comisiones, liquidaciones…)", movEntradas, false],
    ["− Otros movimientos — salidas (gastos, desembolsos)", movSalidas ? -movSalidas : 0, false],
    ["= Total en caja de la semana (cuadra con el arqueo)", totalCaja, true],
  ];
  for (const [txt, val, fuerte] of cuadre) {
    const r = s.getRow(fila++);
    if (!txt) continue;
    r.getCell(5).value = txt; r.getCell(5).alignment = { horizontal: "right" };
    if (val != null) { r.getCell(6).value = val; r.getCell(6).numFmt = dinero; }
    r.getCell(5).font = { bold: fuerte };
    r.getCell(6).font = { bold: true, color: { argb: fuerte ? AURORA : "FF333333" } };
  }

  // Detalle de otros movimientos por tipo (para que Monse vea los ~$10k).
  const tiposMov = Object.keys(porTipoMov).filter(t => porTipoMov[t].entra > 0 || porTipoMov[t].sale > 0);
  if (tiposMov.length) {
    fila += 2;
    const av = s.getRow(fila++);
    av.getCell(1).value = "OTROS MOVIMIENTOS DE LA SEMANA (por tipo)";
    av.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    av.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    s.mergeCells(`A${fila - 1}:K${fila - 1}`);
    const hh = s.getRow(fila++);
    ["Tipo", "Entradas", "Salidas"].forEach((h2, i) => {
      const c = hh.getCell(i + 1); c.value = h2;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
      c.alignment = { horizontal: i === 0 ? "left" : "center" };
    });
    for (const t of tiposMov) {
      const r = s.getRow(fila++);
      r.getCell(1).value = t;
      r.getCell(2).value = porTipoMov[t].entra || null; r.getCell(2).numFmt = dinero;
      r.getCell(3).value = porTipoMov[t].sale || null; r.getCell(3).numFmt = dinero;
    }
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
    s.mergeCells(`A${fila - 1}:K${fila - 1}`);
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
  const cv = carteraViva(req.usuario); // cartera viva (pago + liquidación)
  const res1 = base.filter(c => {
    const heno = norm(c.nombre) + " " + c.id;
    return terminos.every(t => heno.includes(t));
  }).slice(0, 40).map(c => {
    const i = infoCredito(cv, c);
    return { ...c, pagado: i.pagado, liquidado: i.liquidado, saldoActual: i.saldoActual };
  });
  res.json({ total: base.length, resultados: res1 });
});

// ---------- FASE 1: alta y baja de clientas ----------
// La baja marca a la clienta inactiva (no la borra) para que NO salga en el
// pagaré ni en el centro activo, pero conserva su historia. Todo con rastro:
// quién y cuándo. Es justo lo que el sistema anterior nunca permitió.
const MOTIVOS_BAJA = ["Salió del grupo", "No renovó", "Mora / mal historial",
  "Cambió zona / cerró negocio", "Decisión FOOAX", "Otro"];

// ---------- centros ----------
// Lista de centros REALES (del padrón activo + los registrados desde el
// tablero). Sirve para que el alta de clientas elija de una lista en vez de
// texto libre: un dedazo creaba un "centro fantasma" que partía los reportes.
function listaCentros() {
  const mapa = new Map();
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    const nom = String(c.centro || "").trim();
    if (!nom || /^c-?0$/i.test(nom)) continue;   // C-0 = créditos individuales
    const e = mapa.get(nom) || { centro: nom, clientas: 0, ejecutivos: new Set() };
    e.clientas++; if (c.ejecutivo) e.ejecutivos.add(c.ejecutivo);
    mapa.set(nom, e);
  }
  for (const cb of store.cambiosPadron()) {
    if (cb.tipo === "centro" && cb.centro && !mapa.has(cb.centro))
      mapa.set(cb.centro, { centro: cb.centro, clientas: 0, ejecutivos: new Set(cb.ejecutivo ? [cb.ejecutivo] : []) });
  }
  return [...mapa.values()]
    .map((x) => ({ centro: x.centro, clientas: x.clientas, ejecutivos: [...x.ejecutivos] }))
    .sort((a, b) => a.centro.localeCompare(b.centro, "es"));
}
// Productos (tipos de crédito) que EXISTEN en el padrón, del más usado al menos.
// El producto dejó de ser texto libre por la misma razón que el centro: la llave
// de un crédito es socio+producto, así que un dedazo lo manda a un crédito que
// no existe y el pago no cuadra. En el padrón ya quedó la prueba: "Foxi Plus - 2"
// y "Foxi Plus 2" son el MISMO producto escrito de dos formas.
function listaProductos() {
  const cuenta = new Map();
  for (const c of PADRON) {
    const p = String(c.producto || "").trim();
    if (!p) continue;
    cuenta.set(p, (cuenta.get(p) || 0) + 1);
  }
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .map(([producto, creditos]) => ({ producto, creditos }));
}
// Si lo que se escribió es un producto que YA existe pero con otra puntuación o
// espaciado ("Foxi Plus 2" vs "Foxi Plus - 2"), se devuelve el nombre que ya usa
// el padrón. Así no nacen dos versiones del mismo tipo de crédito.
function productoCanonico(nombre) {
  const limpio = String(nombre || "").trim();
  if (!limpio) return limpio;
  const igual = PADRON.find((c) => c.producto && nprod(c.producto) === nprod(limpio));
  return igual ? String(igual.producto).trim() : limpio;
}
app.get("/api/centros", requiere("direccion", "admin"), (req, res) => {
  res.json({
    centros: listaCentros(),
    ejecutivos: idsEjecutivos(req.usuario).map((id) => ({ id, nombre: USUARIOS[id].nombre })),
    productos: listaProductos(),
  });
});
// Alta de un CENTRO nuevo (con bitácora de quién y cuándo).
app.post("/api/centros", requiere("direccion", "admin"), (req, res) => {
  if (req.usuario.test) return res.status(400).json({ error: "La cuenta de PRUEBA no puede tocar el padrón real." });
  const b = req.body || {};
  const numero = String(b.numero || "").trim();
  const nombre = String(b.nombre || "").trim().toUpperCase();
  const ejecutivo = String(b.ejecutivo || "").trim();
  if (!/^\d{1,3}$/.test(numero)) return res.status(400).json({ error: "Número de centro inválido (ej. 86)." });
  if (nombre.length < 3) return res.status(400).json({ error: "Escribe el nombre del centro." });
  const nombresEjec = idsEjecutivos(req.usuario).map((id) => USUARIOS[id].nombre);
  if (!nombresEjec.includes(ejecutivo)) return res.status(400).json({ error: "Elige la ejecutiva del centro." });
  if (listaCentros().some((c) => norm(c.centro) === norm(nombre)))
    return res.status(400).json({ error: "Ese centro ya existe: elígelo de la lista." });
  if (store.cambiosPadron().some((cb) => cb.tipo === "centro" && String(cb.numero) === numero))
    return res.status(400).json({ error: "Ese número de centro ya está usado." });
  store.agregarCambioPadron({ tipo: "centro", numero, centro: nombre, ejecutivo,
    dia: String(b.dia || "").trim(), fecha: hoyMX(), por: req.usuario.nombre, ts: Date.now() });
  res.json({ ok: true, centro: nombre, numero });
});

app.post("/api/clientes/alta", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  // El socio se limpia de espacios y guiones antes de validar: al copiarlo de
  // otra hoja a veces viene "1111 3077 777" o "1111-3077-777".
  const id = String(b.id || "").replace(/[\s\-.]/g, "").trim();
  const nombre = (b.nombre || "").trim();
  const centro = (b.centro || "").trim();
  const ejecutivo = (b.ejecutivo || "").trim();
  // La cuenta de prueba NO toca el padrón real (probar el alta metía
  // clientas falsas al padrón de verdad).
  if (req.usuario.test) return res.status(400).json({ error: "La cuenta de PRUEBA no puede dar de alta en el padrón real." });
  if (!id) return res.status(400).json({ error: "Falta el número de socio." });
  // Solo dígitos: un socio con letras o espacios jamás hará match con sus
  // pagos (la llave de crédito es socio+producto) — sería basura en el padrón.
  if (!/^\d{5,15}$/.test(id)) return res.status(400).json({ error: "El número de socio debe ser solo dígitos (ej. 11113075182)." });
  if (!nombre) return res.status(400).json({ error: "Falta el nombre de la clienta." });
  if (!centro) return res.status(400).json({ error: "Falta el centro." });
  if (!ejecutivo) return res.status(400).json({ error: "Falta el ejecutivo." });
  // El centro debe EXISTIR (evita centros fantasma por dedazo). "C-0" = individual.
  if (!/^c-?0$/i.test(centro) && !listaCentros().some((c) => norm(c.centro) === norm(centro)))
    return res.status(400).json({ error: "Ese centro no existe. Elígelo de la lista o regístralo con \"Centro nuevo\"." });
  // Duplicado exacto: mismo socio + mismo producto ya activo. Antes el alta se
  // IGNORABA en silencio y parecía que sí se registró. El mensaje dice DÓNDE
  // está el crédito que choca y cómo seguir — clave en reestructuras, donde la
  // clienta suele existir ya con su crédito original.
  // Si escribieron un producto que ya existe con otra puntuación, se guarda con
  // el nombre que ya usa el padrón (no nace un "Foxi Plus 2" al lado del
  // "Foxi Plus - 2" que ya estaba).
  const productoAlta = productoCanonico(b.producto);
  if (!productoAlta) return res.status(400).json({ error: "Elige el tipo de crédito." });
  const choca = PADRON.find((c) => c.activa !== false && c.estatus !== "BAJA" && String(c.id) === id && nprod(c.producto) === nprod(productoAlta));
  if (choca) {
    const donde = [choca.centro, choca.ejecutivo].filter(Boolean).join(" · ");
    return res.status(400).json({
      error: "La clienta " + choca.nombre + " (socio " + id + ") YA tiene un crédito \"" + choca.producto + "\"" +
        (donde ? " en " + donde : "") + ". Si está RENOVANDO ese mismo crédito, no la des de alta: usa \"Re-dar crédito\" en Créditos y saldos — ahí sí puede conservar el mismo nombre. " +
        "Si es un crédito DISTINTO (ej. una reestructura aparte), ponle otro nombre de producto (ej. \"" + productoAlta + " 2\").",
    });
  }
  const clienta = {
    id, nombre, producto: productoAlta, centro, ejecutivo,
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
  if (req.usuario.test) return res.status(400).json({ error: "La cuenta de PRUEBA no puede dar de baja en el padrón real." });
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

// ---------- CRÉDITOS Y SALDOS · solo Anel y Monse ----------
// Manejo de cartera reservado a las dos personas de confianza (regla Karina):
// marcar morosas (VENCIDO + mora), re-dar crédito a las que liquidaron, y
// ajustar saldos. Todo deja rastro en la capa de cambios del padrón. La cuenta
// de prueba nunca toca el padrón real.
function soloAnelMonse(req, res, next) {
  const u = usuarioDe(req);
  if (!u) return res.status(401).json({ error: "Tu sesión expiró. Vuelve a iniciar sesión." });
  if (u.id !== "anel" && u.id !== "monse")
    return res.status(403).json({ error: "Solo Anel y Monse pueden mover créditos y saldos." });
  req.usuario = u;
  next();
}
// Crédito exacto (socio + producto) del padrón activo, con su saldo actual.
function creditoActivo(id, producto) {
  const sid = String(id || "").replace(/[\s\-.]/g, "").trim();
  return PADRON.find((c) => c.activa !== false && c.estatus !== "BAJA" &&
    String(c.id) === sid && (producto == null || nprod(c.producto) === nprod(String(producto || ""))));
}
// Lista de créditos para el panel: liquidadas (saldo 0), vencidas, o por texto.
// ---------- FASE 2 · CARTERA, MORA Y SEMÁFORO ----------
// Nº DE PAGO ("13 de 18"): el padrón NO trae el número de semana (viene en 0 en
// los 638 créditos) ni la fecha de otorgamiento, así que se DERIVA:
//   pagos restantes = saldo actual ÷ cuota   →   pago actual = plazo − restantes
// Verificado contra el padrón real: 559 de 588 créditos dan entero exacto. Si
// los restantes exceden el plazo, el PLAZO del padrón está mal capturado (8
// casos): no se inventa un número, se marca para que Monse lo corrija.
// VENCIDO = crédito que NUNCA pagó (dictado de Karina/Monse, 29-jul). Por eso la
// plantilla les pone cuota 0 y plazo 0: no traen calendario de pagos, están en
// recuperación. Se comprobó en el padrón: los 26 "VENCIDO" tienen cuota=0 Y
// plazo=0, los 26 sin excepción. La palabra la pone la plantilla, así que se
// reconoce por el nombre; el mapeo fino de los 7 estatus lo dicta Monse.
function esVencido(c) { return /vencid/i.test(String(c && c.estatus || "")); }
function numeroDePago(c, saldoActual) {
  const cuota = Number(c.cuota) || 0, plazo = Number(c.plazo) || 0;
  if (esCuotaVariable(c.producto)) return null;   // cuota decreciente: no se puede derivar
  // A un vencido no se le puede ni se le debe derivar el nº de pago: no hay
  // calendario. Antes salían como "plazo mal capturado" y se le pedía a Monse un
  // dato que no existe — 22 de los 38 de esa lista eran esto.
  if (esVencido(c)) return null;
  if (!(cuota > 0) || !(plazo > 0)) return null;
  const restantes = Math.round((saldoActual || 0) / cuota);
  if (restantes > plazo) return { pago: null, plazo, restantes, inconsistente: true };
  return { pago: plazo - restantes, plazo, restantes, inconsistente: false };
}
// SEMÁFORO provisional — se calcula con lo que HAY hoy (abono de la semana
// contra su cuota). ⚠️ La definición oficial de mora la dicta Monse (ficha de
// mora, mora-semana vs recuperación, cartera activa vs total); cuando llegue,
// aquí se cambia la regla, no la estructura.
function semaforoDe(c, info, pagoSemana) {
  // Antes preguntaba por `estatus === "VENCIDA"` (con A) y esa palabra NO EXISTE
  // en la plantilla: dice "VENCIDO", "CREDITO VENCIDO A RECUPERAR". Resultado: 29
  // vencidos no se marcaban como vencidos (solo los cachaba la mora capturada).
  if (esVencido(c) || Number(c.mora) > 0) return "vencida";
  if (info.saldoActual <= 0) return "liquidada";
  // Cuota VARIABLE (Magnus): su cuota baja cada periodo, así que compararla
  // contra la del padrón daría un semáforo falso. Se aparta hasta que exista
  // el módulo de intereses.
  if (esCuotaVariable(c.producto)) return "cuotaVariable";
  const cuota = Number(c.cuota) || 0;
  // "pendiente" NO es mora: cada centro cobra en su día, y el lunes casi nadie
  // ha pagado todavía. Se cuenta aparte para no leer 590 morosas cada lunes.
  if (pagoSemana <= 0) return "pendiente";
  if (cuota > 0 && pagoSemana + 0.01 < cuota) return "parcial";
  return "alCorriente";
}
app.get("/api/cartera", requiere("direccion", "admin"), (req, res) => {
  const cv = carteraViva(req.usuario);
  const sem = pagosDeLaSemana(req.usuario);          // ventana semanal (lunes → hoy)
  const activos = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA");
  const acc = { cartera: 0, moraMonto: 0, moraCreditos: 0, saldoPromedio: 0, liquidadas: 0 };
  const semaforo = { alCorriente: 0, parcial: 0, pendiente: 0, vencida: 0, liquidada: 0, cuotaVariable: 0 };
  const porEjec = {}, inconsistentes = [], vencidas = [];
  let conSaldo = 0, esperado = 0;
  for (const c of activos) {
    const info = infoCredito(cv, c);
    const clave = claveCredito(c.id, c.producto);
    const pagoSemana = sem.pago[clave] || 0;
    const s = semaforoDe(c, info, pagoSemana);
    semaforo[s]++;
    acc.cartera += info.saldoActual;
    if (info.saldoActual > 0) {
      conSaldo++;
      // Lo que DEBÍA entrar esta semana por ese crédito: su cuota, o el saldo
      // si ya le falta menos de una cuota para liquidar. Los de cuota VARIABLE
      // no suman: su cuota del padrón ya no es la vigente. Los VENCIDOS tampoco:
      // dictado de Monse (29-jul) "mora = los faltantes de pago de los créditos
      // ACTIVOS". Un vencido ya no tiene cuota que esperar, está en recuperación
      // — y lo que entre de él es RECUPERACIÓN, no cobranza de la semana.
      if (!esCuotaVariable(c.producto) && !esVencido(c)) esperado += Math.min(Number(c.cuota) || 0, info.saldoActual);
    }
    if (info.saldoActual <= 0) acc.liquidadas++;
    const mora = Number(c.mora) > 0 ? Number(c.mora) : 0;
    if (mora > 0) { acc.moraMonto += mora; acc.moraCreditos++; vencidas.push({ socio: String(c.id), nombre: c.nombre, centro: c.centro, ejecutivo: c.ejecutivo, producto: c.producto, mora, saldoActual: info.saldoActual }); }
    const np = numeroDePago(c, info.saldoActual);
    if (np && np.inconsistente) inconsistentes.push({ socio: String(c.id), nombre: c.nombre, producto: c.producto, ejecutivo: c.ejecutivo, saldo: c.saldo || 0, cuota: c.cuota || 0, plazoPadron: np.plazo, plazoReal: np.restantes });
    const e = porEjec[c.ejecutivo || "—"] || (porEjec[c.ejecutivo || "—"] = { nombre: c.ejecutivo || "—", creditos: 0, cartera: 0, mora: 0, esperado: 0, cobrado: 0, alCorriente: 0, parcial: 0, pendiente: 0, vencida: 0, liquidada: 0, cuotaVariable: 0 });
    e.creditos++; e.cartera += info.saldoActual; e.mora += mora; e[s]++;
    if (info.saldoActual > 0 && !esCuotaVariable(c.producto) && !esVencido(c)) e.esperado += Math.min(Number(c.cuota) || 0, info.saldoActual);
    e.cobrado += pagoSemana;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const cobrado = Object.values(sem.pago).reduce((a, b) => a + b, 0);
  // RECUPERACIÓN de la semana: liquidaciones y recuperaciones registradas como
  // "otros movimientos" — dinero del crédito que entra FUERA de la cuota.
  const recuperacion = Object.values(liquidacionesDeLaSemana(req.usuario)).reduce((a, b) => a + b, 0);
  res.json({
    corte: corteSaldos(), hoy: hoyMX(), lunes: lunesDeLaSemana(hoyMX()),
    creditosActivos: activos.length, conSaldo,
    cartera: r2(acc.cartera),
    saldoPromedio: conSaldo ? r2(acc.cartera / conSaldo) : 0,
    moraMonto: r2(acc.moraMonto), moraCreditos: acc.moraCreditos,
    moraPorcentaje: acc.cartera > 0 ? r2((acc.moraMonto / acc.cartera) * 100) : 0,
    liquidadas: acc.liquidadas,
    // MORA DE LA SEMANA vs RECUPERACIÓN (corazón de la Fase 2, versión
    // provisional hasta el dictado de Monse): esperado = suma de cuotas de los
    // créditos con saldo; mora = lo que faltó de ese esperado.
    esperadoSemana: r2(esperado),
    cobradoSemana: r2(cobrado),
    moraSemana: r2(Math.max(0, esperado - cobrado)),
    recuperacionSemana: r2(recuperacion),
    cumplimiento: esperado > 0 ? r2((cobrado / esperado) * 100) : 0,
    semaforo,
    porEjec: Object.values(porEjec).map((e) => ({ ...e, cartera: r2(e.cartera), mora: r2(e.mora),
      esperado: r2(e.esperado), cobrado: r2(e.cobrado), moraSemana: r2(Math.max(0, e.esperado - e.cobrado)),
      cumplimiento: e.esperado > 0 ? r2((e.cobrado / e.esperado) * 100) : 0 })),
    inconsistentes, vencidas: vencidas.sort((a, b) => b.mora - a.mora).slice(0, 50),
    // el dictado de Monse sigue pendiente: se declara para que el tablero lo diga
    definicionMoraPendiente: true,
  });
});

// ---------- FASE 2 · TENDENCIAS (evolución semana a semana) ----------
// Recorre TODA la historia guardada una sola vez y la agrupa por semana.
// La cartera de una semana pasada se reconstruye así: saldo de plantilla menos
// lo abonado ACUMULADO hasta el cierre de esa semana. Solo tiene sentido desde
// el corte de saldos (antes de esa fecha no sabemos el saldo de referencia).
function seriesSemanales(usuario) {
  const permitidas = new Set(idsEjecutivos(usuario));
  const snaps = store.respaldo().snapshots || {};
  const semanas = {};   // lunes -> { pago, gar, clientas:Set, porClave:{}, recuperacion, porSocio:{} }
  const w = (f) => lunesDeLaSemana(f);
  const bucket = (f) => (semanas[w(f)] = semanas[w(f)] || { pago: 0, gar: 0, clientas: new Set(), porClave: {}, recuperacion: 0, porSocio: {} });
  for (const ej in snaps) {
    if (!permitidas.has(ej)) continue;
    for (const fecha in snaps[ej]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
      let data = snaps[ej][fecha].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { continue; } }
      const b = bucket(fecha);
      const sumar = (nodo, key) => {
        if (!nodo || typeof nodo !== "object") return;
        const p = nodo.pago || 0, g = nodo.garantia || 0;
        if (p <= 0 && g <= 0) return;
        const partes = String(key).split("|");
        const clave = claveCredito(partes[0], partes[1]);
        b.pago += p; b.gar += g;
        if (p > 0) { b.porClave[clave] = (b.porClave[clave] || 0) + p; b.clientas.add(partes[0]); }
      };
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
  // Liquidaciones y recuperaciones (bajan saldo) por semana y por socio
  for (const m of store.todosMovimientos()) {
    if (m.anulado || !/^\d{4}-\d{2}-\d{2}$/.test(m.fecha || "")) continue;
    const id = usuarioDeMov(m);
    const u = id && USUARIOS[id];
    if (!!(u && u.test) !== !!(usuario && usuario.test)) continue;   // misma burbuja
    const tipo = String(m.concepto || "").split(" · ")[0].split(" — ")[0].trim() || m.categoria || "Otro";
    if (!/^(liquidaci|recuperaci)/i.test(tipo)) continue;
    const b = bucket(m.fecha);
    b.recuperacion += m.monto;
    const soc = socioDeMov(m);
    if (soc) b.porSocio[soc] = (b.porSocio[soc] || 0) + m.monto;
  }
  return semanas;
}
app.get("/api/tendencias", requiere("direccion", "admin"), (req, res) => {
  const corte = corteSaldos();
  const semanas = seriesSemanales(req.usuario);
  // Serie CONTINUA: de la primera semana con captura hasta la actual, sin
  // huecos. Una semana sin cobranza es información (se ve el bache en la
  // gráfica); si se omitiera, la línea mentiría uniendo dos semanas lejanas.
  const conDatos = Object.keys(semanas).sort();
  const lunes = [];
  if (conDatos.length) {
    const fin = lunesDeLaSemana(hoyMX());
    let cur = conDatos[0];
    while (cur <= fin) {
      lunes.push(cur);
      if (!semanas[cur]) semanas[cur] = { pago: 0, gar: 0, clientas: new Set(), porClave: {}, recuperacion: 0, porSocio: {} };
      const d = new Date(cur + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 7);
      cur = d.toISOString().slice(0, 10);
    }
  }
  const activos = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA")
    .sort((a, b) => String(a.ejecutivo).localeCompare(String(b.ejecutivo)) ||
      String(a.centro).localeCompare(String(b.centro)) || String(a.nombre).localeCompare(String(b.nombre)));
  const acumClave = {}, acumSocio = {};
  const r2 = (n) => Math.round(n * 100) / 100;
  const serie = [];
  for (const L of lunes) {
    const s = semanas[L];
    for (const k in s.porClave) acumClave[k] = (acumClave[k] || 0) + s.porClave[k];
    for (const k in s.porSocio) acumSocio[k] = (acumSocio[k] || 0) + s.porSocio[k];
    // Cartera al cierre de ESTA semana, con lo acumulado hasta aquí.
    let cartera = 0, esperado = 0, conSaldo = 0;
    if (L >= corte) {
      const liqRestante = Object.assign({}, acumSocio);
      for (const c of activos) {
        const clave = claveCredito(c.id, c.producto);
        const pagado = acumClave[clave] || 0;
        const ini = c.saldo || 0;
        const disp = liqRestante[String(c.id)] || 0;
        const liq = Math.min(disp, Math.max(0, ini - pagado));
        if (liq > 0) liqRestante[String(c.id)] = disp - liq;
        const saldo = Math.max(0, ini - pagado - liq);
        cartera += saldo;
        if (saldo > 0) { conSaldo++; esperado += Math.min(Number(c.cuota) || 0, saldo); }
      }
    }
    serie.push({
      semana: L,
      cobrado: r2(s.pago), garantias: r2(s.gar), recuperacion: r2(s.recuperacion),
      clientas: s.clientas.size,
      cartera: L >= corte ? r2(cartera) : null,
      creditosConSaldo: L >= corte ? conSaldo : null,
      // esperado/mora de la semana SIGUIENTE: la cartera al cierre es la que
      // debe cobrarse la semana que entra.
      esperadoProxima: L >= corte ? r2(esperado) : null,
    });
  }
  // mora de cada semana = lo que se esperaba (según el cierre anterior) − lo cobrado
  for (let i = 1; i < serie.length; i++) {
    const esp = serie[i - 1].esperadoProxima;
    if (esp == null) { serie[i].esperado = null; serie[i].mora = null; serie[i].cumplimiento = null; continue; }
    serie[i].esperado = esp;
    serie[i].mora = r2(Math.max(0, esp - serie[i].cobrado));
    serie[i].cumplimiento = esp > 0 ? r2((serie[i].cobrado / esp) * 100) : null;
  }
  if (serie.length) { serie[0].esperado = null; serie[0].mora = null; serie[0].cumplimiento = null; }
  res.json({ corte, hoy: hoyMX(), semanaActual: lunesDeLaSemana(hoyMX()), serie });
});

app.get("/api/creditos", soloAnelMonse, (req, res) => {
  const estado = String(req.query.estado || "").toLowerCase();
  const q = norm(req.query.q).trim();
  const cv = carteraViva(req.usuario);
  let base = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA");
  const conSaldo = base.map((c) => ({ ...c, ...infoCredito(cv, c) }));
  let lista = conSaldo;
  if (estado === "liquidadas") lista = conSaldo.filter((c) => (c.saldo || 0) > 0 && c.saldoActual <= 0);
  // esVencido(): reconoce "VENCIDO" y "CREDITO VENCIDO A RECUPERAR" como los
  // escribe la plantilla. Antes comparaba contra "VENCIDA" y este filtro devolvía
  // SIEMPRE vacío, aunque hubiera 29 vencidos reales (29-jul).
  else if (estado === "vencidas") lista = conSaldo.filter((c) => esVencido(c) || Number(c.mora) > 0);
  else if (q.length >= 2) {
    const t = q.split(/\s+/);
    lista = conSaldo.filter((c) => { const h = norm(c.nombre) + " " + c.id; return t.every((x) => h.includes(x)); });
  } else lista = [];
  lista = lista.sort((a, b) => String(a.centro).localeCompare(String(b.centro), "es") || String(a.nombre).localeCompare(String(b.nombre), "es")).slice(0, 120);
  res.json({ total: base.length, resultados: lista });
});

// Marcar / quitar VENCIDO con su mora (y, si hace falta, corregir el saldo).
app.post("/api/creditos/mora", soloAnelMonse, (req, res) => {
  const b = req.body || {};
  const c = creditoActivo(b.id, b.producto);
  if (!c) return res.status(400).json({ error: "No encuentro ese crédito activo (revisa socio y producto)." });
  const mora = Number(b.mora);
  if (!Number.isFinite(mora) || mora < 0) return res.status(400).json({ error: "La mora debe ser un monto válido (0 la quita)." });
  // "VENCIDO", no "VENCIDA": es la palabra que usa la plantilla de Monse. Antes
  // escribía "VENCIDA" y con eso el sistema inventaba un 8º estatus ajeno a su
  // vocabulario — y encima nada lo reconocía después (29-jul).
  const campos = { mora, estatus: mora > 0 ? "VENCIDO" : "VIGENTE" };
  if (b.saldo != null && b.saldo !== "" && Number.isFinite(Number(b.saldo))) campos.saldo = Number(b.saldo);
  store.agregarCambioPadron({
    tipo: "ajuste", id: c.id, producto: c.producto, campos,
    motivo: mora > 0 ? ("Vencida · mora " + mora) : "Se quita la mora",
    fecha: hoyMX(), por: req.usuario.nombre, ts: Date.now(),
  });
  refrescarPadron();
  res.json({ ok: true, clienta: creditoActivo(c.id, c.producto) });
});

// Ajustar el SALDO (y opcionalmente la cuota) de un crédito, con motivo obligatorio.
app.post("/api/creditos/ajuste", soloAnelMonse, (req, res) => {
  const b = req.body || {};
  const c = creditoActivo(b.id, b.producto);
  if (!c) return res.status(400).json({ error: "No encuentro ese crédito activo (revisa socio y producto)." });
  const saldo = Number(b.saldo);
  if (!Number.isFinite(saldo) || saldo < 0) return res.status(400).json({ error: "El nuevo saldo debe ser un monto válido." });
  const motivo = String(b.motivo || "").trim();
  if (motivo.length < 3) return res.status(400).json({ error: "Escribe el motivo del ajuste (queda en la bitácora)." });
  const campos = { saldo };
  if (b.cuota != null && b.cuota !== "" && Number.isFinite(Number(b.cuota)) && Number(b.cuota) >= 0) campos.cuota = Number(b.cuota);
  // Reasignar el crédito a otro ejecutivo (mover cartera). Solo nombres reales.
  if (b.ejecutivo) {
    const nombres = idsEjecutivos(req.usuario).map((id) => USUARIOS[id].nombre);
    const ok = nombres.find((n) => norm(n) === norm(String(b.ejecutivo)));
    if (!ok) return res.status(400).json({ error: "Ese ejecutivo no existe. Elige uno de: " + nombres.join(", ") });
    campos.ejecutivo = ok;
  }
  store.agregarCambioPadron({
    tipo: "ajuste", id: c.id, producto: c.producto, campos, motivo,
    saldoAnterior: c.saldo || 0, fecha: hoyMX(), por: req.usuario.nombre, ts: Date.now(),
  });
  refrescarPadron();
  res.json({ ok: true, clienta: creditoActivo(c.id, c.producto) });
});

// Re-dar crédito a una clienta que LIQUIDÓ: crédito NUEVO (monto+cuota), mismo
// grupo, con nombre de producto distinto. El crédito anterior queda en el
// historial (no se toca). Reusa la protección de socio y centro del alta.
app.post("/api/creditos/recredito", soloAnelMonse, (req, res) => {
  const b = req.body || {};
  const id = String(b.id || "").replace(/[\s\-.]/g, "").trim();
  if (!/^\d{5,15}$/.test(id)) return res.status(400).json({ error: "Número de socio inválido (solo dígitos)." });
  const previa = PADRON.find((c) => String(c.id) === id);
  if (!previa) return res.status(400).json({ error: "Ese socio no está en el padrón. Si es clienta nueva, usa \"Dar de alta\"." });
  const nombre = String(b.nombre || previa.nombre || "").trim();
  const centro = String(b.centro || previa.centro || "").trim();
  // EJECUTIVO DE LA RENOVACIÓN (regla Karina 25-jul): al re-dar el crédito se
  // CONFIRMA o se REASIGNA a quién le toca cobrarlo. Se valida contra las
  // ejecutivas reales: un nombre a mano ("Nery", "neri ") mandaba el crédito a
  // un ejecutivo que no existe y no le aparecía a nadie en su app.
  const ejecutivo = String(b.ejecutivo || previa.ejecutivo || "").trim();
  const nombresEjec = idsEjecutivos(req.usuario).map((x) => USUARIOS[x].nombre);
  const ejecOK = nombresEjec.find((n) => norm(n) === norm(ejecutivo));
  if (!ejecOK) {
    return res.status(400).json({
      error: "Elige a quién le toca cobrar este crédito. Ejecutivos válidos: " + nombresEjec.join(", ") + ".",
    });
  }
  // Mismo criterio que el alta: se respeta el nombre que ya usa el padrón.
  const producto = productoCanonico(b.producto);
  if (!producto) return res.status(400).json({ error: "Elige el tipo de crédito de la lista." });
  const saldo = Number(b.saldo), cuota = Number(b.cuota);
  if (!Number.isFinite(saldo) || saldo <= 0) return res.status(400).json({ error: "El monto del crédito nuevo debe ser mayor a 0." });
  if (!Number.isFinite(cuota) || cuota <= 0) return res.status(400).json({ error: "La cuota del crédito nuevo debe ser mayor a 0." });
  if (!/^c-?0$/i.test(centro) && !listaCentros().some((x) => norm(x.centro) === norm(centro)))
    return res.status(400).json({ error: "Ese centro no existe. Elígelo de la lista." });
  const cv = carteraViva(req.usuario);
  // RENOVAR CON EL MISMO NOMBRE (regla Karina 25-jul): si la clienta renueva su
  // "Grupal-Basico", debe poder llamarse igual — no "Grupal-Basico 2". Como la
  // llave de un crédito es socio+producto, no pueden convivir DOS activos con el
  // mismo nombre: los pagos del ciclo nuevo se le abonarían al viejo. Entonces,
  // si el ciclo anterior ya está liquidado, se CIERRA aquí mismo y el nombre
  // queda libre. Si todavía debe, se bloquea como antes: ahí sí son dos créditos
  // de verdad y necesitan nombres distintos para no revolver los pagos.
  const choca = PADRON.find((c) => c.activa !== false && c.estatus !== "BAJA" && String(c.id) === id && nprod(c.producto) === nprod(producto));
  if (choca && infoCredito(cv, choca).saldoActual > 0) {
    return res.status(400).json({
      error: "\"" + choca.producto + "\" todavía tiene saldo de " + infoCredito(cv, choca).saldoActual.toFixed(2) +
        ". Si de verdad es un crédito APARTE, ponle otro nombre (ej. \"" + producto + " 2\"). Si es la renovación, primero liquídalo.",
    });
  }
  // Aviso (no bloqueo): si aún debe en otro crédito, se informa — la decisión es
  // de Anel/Monse. La regla es re-dar cuando ya llegó a 0. El ciclo que se está
  // renovando no cuenta: ya está en cero.
  const debeEnOtros = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA" && String(c.id) === id && c !== choca)
    .reduce((s, c) => s + infoCredito(cv, c).saldoActual, 0);
  // Se guarda el nombre CANÓNICO (el de USUARIOS), no el que llegó tecleado:
  // la app de cada ejecutiva se arma comparando este nombre.
  // `previo`: cuánto llevaba abonado el ciclo que se está cerrando. Como el ciclo
  // nuevo hereda la MISMA llave (socio+producto), sin esto el tablero le restaría
  // esos abonos al crédito nuevo. Se guarda con el corte vigente porque los
  // acumulados se miden desde ahí: si el corte cambia, el descuento ya no aplica.
  const infoPrev = choca ? infoCredito(cv, choca) : null;
  const previo = infoPrev
    ? { pago: infoPrev.pagado || 0, gar: infoPrev.garantia || 0, liq: infoPrev.liquidado || 0, corte: corteSaldos() }
    : null;
  const clienta = { id, nombre, producto, centro, ejecutivo: ejecOK, saldo, cuota, plazo: Number(b.plazo) || 0,
    mora: 0, estatus: "VIGENTE", semana: 0, recredito: true, recreditoDe: (choca || previa).producto || null, previo,
    reasignadoDe: (choca && norm(choca.ejecutivo) !== norm(ejecOK)) ? choca.ejecutivo : null };
  // El cierre va ANTES del alta y con timestamp menor: los cambios se reproducen
  // en orden de ts, y si empataran, el cierre podría caerle encima al crédito
  // nuevo y dejarlo dado de baja el mismo día que se abrió.
  const ts = Date.now();
  if (choca) {
    store.agregarCambioPadron({ tipo: "baja", id, producto: choca.producto,
      motivo: "Liquidó y renovó (recrédito)", porRecredito: true,
      fecha: hoyMX(), por: req.usuario.nombre, ts });
  }
  store.agregarCambioPadron({ tipo: "alta", id, producto, clienta, recredito: true,
    fecha: hoyMX(), por: req.usuario.nombre, ts: ts + 1 });
  refrescarPadron();
  res.json({ ok: true, clienta, avisoDeuda: debeEnOtros > 0 ? debeEnOtros : 0,
    cerroAnterior: choca ? choca.producto : null,
    ejecutivo: ejecOK, reasignadoDe: clienta.reasignadoDe });
});

// Corte de saldos: verlo (dirección/admin) y moverlo (solo Anel y Monse, al
// cargar plantillas nuevas). Queda en la bitácora del padrón con quién y cuándo.
app.get("/api/saldos/corte", requiere("direccion", "admin"), (req, res) => {
  // `desde` = el primer día cuyos abonos se descuentan, que es el corte MISMO.
  // Va explícito para que el tablero se lo pueda decir a Monse con palabras y no
  // haya que adivinar si el día del corte cuenta o no.
  res.json({ corte: corteSaldos(), desde: corteSaldos() });
});
app.post("/api/saldos/corte", soloAnelMonse, (req, res) => {
  const fecha = String((req.body || {}).fecha || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha inválida (usa AAAA-MM-DD)." });
  if (fecha > hoyMX()) return res.status(400).json({ error: "El corte no puede ser una fecha futura." });
  store.agregarCambioPadron({ tipo: "corte", fecha, por: req.usuario.nombre, ts: Date.now() });
  res.json({ ok: true, corte: fecha });
});

// ---------- movimientos de dirección/caja (retiros, gastos, autorizaciones) ----------
const CATEGORIAS = ["Retiro de dirección", "Gasto operativo", "Autorización / préstamo", "Otro"];
const METODOS = ["efectivo", "transferencia", "cheque"];

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
// A qué usuario pertenece un movimiento: el sello `usuario`, o —para los
// anteriores al sello— el ID dentro del folio "EJE-<ID>-...".
function usuarioDeMov(m) {
  if (m.usuario && USUARIOS[m.usuario]) return m.usuario;
  const mm = /^EJE-([^-]+)-/.exec(String(m.folio || ""));
  if (mm && USUARIOS[mm[1].toLowerCase()]) return mm[1].toLowerCase();
  return null;
}
// Socio ligado a un movimiento (para bajarle el saldo en una liquidación).
// Los movimientos nuevos lo traen como campo; los viejos sólo dentro del texto.
function socioDeMov(m) {
  if (m.socio) return String(m.socio);
  const mm = String(m.concepto || "").match(/·\s*(\d{6,})/);
  return mm ? mm[1] : null;
}
function movsDeFecha(fecha, usuario, conAnulados) {
  const enPruebas = !!(usuario && usuario.test);
  return store.movimientosDeFecha(fecha).filter((m) => {
    if (m.anulado && !conAnulados) return false;   // anulado = no cuenta
    const id = usuarioDeMov(m);
    const u = id && USUARIOS[id];
    return !!(u && u.test) === enPruebas;
  });
}
// Reparte "Otros movimientos" a cada ejecutivo del arqueo: entradas
// (recuperaciones) y salidas (gastos) que registró, junto a su efectivo.
function repartirMovsPorEjecutivo(porEjec, movs) {
  for (const m of movs) {
    const id = usuarioDeMov(m);
    if (!id || !porEjec[id]) continue;
    const e = porEjec[id];
    if (m.entrada) e.movEntradas = (e.movEntradas || 0) + m.monto;
    else e.movSalidas = (e.movSalidas || 0) + m.monto;
    // SOLO el efectivo afecta el arqueo de billetes: una transferencia va al
    // banco, no a la caja. Sin esto, un gasto por transferencia bajaba el
    // efectivo a entregar y descuadraba la caja sin razón. egresoEfectivo =
    // lo que SALE en efectivo menos lo que ENTRA en efectivo.
    if (m.metodo === "efectivo") e.egresoEfectivo = (e.egresoEfectivo || 0) + (m.entrada ? -m.monto : m.monto);
  }
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

// ANULAR un movimiento de caja. Nunca se borra: queda tachado, con quién lo
// anuló y por qué, y deja de contar en los totales y en el arqueo. Nació el
// 30-jul: Karina registró un gasto de prueba de $100 desde el tablero y NO HABÍA
// forma de quitarlo — el día quedaba marcando "sobran $100" para siempre. Los
// movimientos que captura la ejecutiva se anulan solos al borrarlos en su app;
// los que registra Dirección (folio DIR-…) no tenían salida.
app.post("/api/movimiento/anular", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  const folio = String(b.folio || "").trim();
  const motivo = String(b.motivo || "").trim();
  const anular = b.anular !== false;   // por omisión anula; con false se revive
  if (!folio) return res.status(400).json({ error: "Falta el folio del movimiento." });
  // El motivo es obligatorio al anular: es lo que Monse va a leer cuando pregunte
  // por qué la caja de ese día cambió.
  if (anular && !motivo) return res.status(400).json({ error: "Escribe por qué se anula (queda en el rastro)." });
  const m = store.movimientosDeFecha(b.fecha || hoyMX()).find((x) => x.folio === folio) ||
    store.todosMovimientos().find((x) => x.folio === folio);
  if (!m) return res.status(400).json({ error: "No encuentro ese movimiento." });
  store.setMovimientoAnulado(folio, anular, req.usuario.nombre, motivo || null);
  res.json({ ok: true, folio, anulado: anular });
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
    // El desglose por clienta (cómo pagó UNA clienta) se junta aparte: NO se
    // suma al conteo, porque los billetes de ese pago YA están dentro del
    // conteo físico del día. Sumar los dos contaba el mismo dinero dos veces
    // (bug del 28-jul: IRMA NORA traía desglose de $140 y a Karina le
    // "sobraban" $140 que nunca le sobraron).
    const desglosePorClienta = {};
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
        // 'D' = depósito: va al banco, no es efectivo a entregar (ver acumular()).
        if (n.forma === "T" || n.forma === "D") {
          acc.transferencia += total;
          if (n.forma === "D") acc.deposito = (acc.deposito || 0) + total;
        }
        else if (n.forma === "M") {
          const mt = n.mixTr || 0;
          const me = (n.mixEfe != null && (mt + (n.mixEfe || 0)) === total) ? n.mixEfe : (total - mt);
          acc.efectivo += me; acc.transferencia += mt;
        }
        else acc.efectivo += total;
        if (n.desglose) for (const d in n.desglose) desglosePorClienta[d] = (desglosePorClienta[d] || 0) + (n.desglose[d] || 0);
        if (pago > 0) acc.clientas += 1;
        const cuota = cuotaDe(key);
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
      const tieneArqueo = data.arqueo && typeof data.arqueo === "object" && Object.keys(data.arqueo).length > 0;
      if (tieneArqueo) {
        for (const v in data.arqueo) {
          const val = Number(v), q = Number(data.arqueo[v]) || 0;
          if (!isNaN(val) && q > 0) denom[val] = (denom[val] || 0) + q;
        }
      } else {
        // Días viejos que solo traían el desglose por clienta (antes de que
        // existiera la pestaña Arqueo): ahí sí es la única fuente del conteo.
        for (const v in desglosePorClienta) {
          const val = Number(v), q = Number(desglosePorClienta[v]) || 0;
          if (!isNaN(val) && q > 0) denom[val] = (denom[val] || 0) + q;
        }
      }
    }
    porEjec[id] = { nombre: USUARIOS[id].nombre, ...acc };
  }

  // Totales consolidados de denominaciones y efectivo
  const denomTotal = {}; DENOMS_ARQUEO.forEach((d) => { denomTotal[d] = 0; });
  let efectivo = 0, transferencia = 0, garantias = 0, faltantes = 0, deposito = 0;
  for (const id in porEjec) {
    const e = porEjec[id];
    DENOMS_ARQUEO.forEach((d) => { denomTotal[d] += e.denom[d] || 0; });
    efectivo += e.efectivo; transferencia += e.transferencia; garantias += e.garantias; faltantes += e.faltantes;
    deposito += e.deposito || 0;
  }

  return { porEjec, denomTotal, efectivo, transferencia, garantias, faltantes, deposito };
}

app.get("/api/arqueo", requiere("direccion", "admin", "ejecutivo"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const ids = req.usuario.rol === "ejecutivo"
    ? [req.usuario.id].filter((x) => USUARIOS[x] && USUARIOS[x].rol === "ejecutivo")
    : idsEjecutivos(req.usuario);
  const a = calcularArqueo(fecha, ids);
  // La ejecutiva ve SUS PROPIOS movimientos (no los de las demás). Antes se le
  // mandaba una lista VACÍA: su "efectivo a entregar" no le restaba sus gastos
  // ni le sumaba sus liquidaciones, así que a Monse le salía un número y a ella
  // otro del MISMO día. Dirección/admin siguen viendo todos.
  const todos = movsDeFecha(fecha, req.usuario);
  const movs = (req.usuario.rol === "ejecutivo")
    ? todos.filter((m) => usuarioDeMov(m) === req.usuario.id)
    : todos;
  const egresosEfectivo = egresosEnEfectivo(movs);
  repartirMovsPorEjecutivo(a.porEjec, movs);
  // Cuadre POR EJECUTIVA: lo que contó de billetes vs lo que debe entregar
  // (su efectivo + sus entradas − sus salidas). Antes solo existía el
  // consolidado, así que no se veía CUÁL ejecutiva estaba descuadrada.
  for (const id in a.porEjec) {
    const e = a.porEjec[id];
    e.contado = Math.round(Object.entries(e.denom).reduce((s, [d, q]) => s + Number(d) * (Number(q) || 0), 0) * 100) / 100;
    // A entregar = su efectivo cobrado − lo que salió en efectivo (gastos) + lo
    // que entró en efectivo (recuperaciones/liquidaciones). Solo efectivo: la
    // transferencia va al banco y no toca la caja.
    e.aEntregar = Math.round((e.efectivo - (e.egresoEfectivo || 0)) * 100) / 100;
    e.dif = Math.round((e.contado - e.aEntregar) * 100) / 100;
  }
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
  repartirMovsPorEjecutivo(a.porEjec, movs);
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
      // dn puede traer decimales (la moneda de 50 centavos): sin esto el Excel
      // imprimía "Moneda $0.5".
      r.getCell(1).value = (dn >= 20 ? "Billete $" : "Moneda $") + (dn % 1 ? dn.toFixed(2) : dn);
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
  // La caja se compara contra el EFECTIVO A ENTREGAR (cobranza + otros
  // movimientos en efectivo), no contra la cobranza sola: la ejecutiva trae en
  // la mano las dos cosas. Antes se comparaba contra la cobranza y los otros
  // movimientos salían como un "sobrante" falso — a Monse le aparecían $6,768
  // de más cuando la diferencia real era de $848.
  const aEntregar = a.efectivo - egresosEfectivo;
  const sinDesglosar = Math.round((aEntregar - totalEfe) * 100) / 100;
  if (Math.abs(sinDesglosar) >= 0.01) {
    const r = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c = r.getCell(1);
    // Si SÍ contaron la caja y no cuadra, es una diferencia de caja real
    // (falta o sobra efectivo), no un tema de formato. Se dice con todas sus
    // letras: es el número por el que Monse tiene que preguntar.
    const falta = sinDesglosar > 0;
    c.value = totalEfe > 0
      ? "⚠ DIFERENCIA DE CAJA · a entregar $" + aEntregar.toLocaleString("es-MX") +
        " (cobranza $" + a.efectivo.toLocaleString("es-MX") +
        (egresosEfectivo ? (egresosEfectivo < 0 ? " + otros $" + (-egresosEfectivo).toLocaleString("es-MX") : " − otros $" + egresosEfectivo.toLocaleString("es-MX")) : "") +
        ") vs contado $" + totalEfe.toLocaleString("es-MX") + " → " + (falta ? "FALTAN" : "SOBRAN")
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
  // para poder compararlos lado a lado sin traducir nada. egresosEfectivo es el
  // NETO: si es negativo, la caja recibió más de lo que gastó (recuperaciones).
  // "Total contado" se imprime SIEMPRE que hayan contado: sin él, arriba quedaban
  // unas denominaciones que suman una cosa y un "TOTAL EFECTIVO" que dice otra
  // (el cobrado), y parecía un error de suma. Ahora los dos números están a la
  // vista y se entiende que uno es lo que cobró y el otro lo que trae en la mano.
  if (totalEfe > 0) linea("Total contado (billetes y monedas)", totalEfe);
  if (egresosEfectivo >= 0) linea("− Gastos y retiros en efectivo", -egresosEfectivo);
  else linea("+ Entradas de caja (recuperaciones, etc.)", -egresosEfectivo);
  linea("Efectivo a entregar", a.efectivo - egresosEfectivo);
  if (a.deposito > 0) {
    linea("Transferencias", a.transferencia - a.deposito);
    linea("Depósitos Oxxo / tienda", a.deposito);
  } else {
    linea("Depósitos / transferencias", a.transferencia);
  }
  linea("Garantías", a.garantias);
  const rm = s.getRow(fila++); rm.getCell(1).value = "Mora del día (faltantes)";
  const cm = rm.getCell(4); cm.value = a.faltantes; cm.numFmt = dinero;
  cm.font = { bold: true, color: { argb: a.faltantes > 0 ? "FFB00020" : "FF000000" } };
  fila++;
  // por ejecutiva: efectivo, transferencia y sus otros movimientos, igual que el tablero
  const rh = s.getRow(fila++); rh.getCell(1).value = "Por ejecutiva"; rh.getCell(1).font = { bold: true, color: { argb: RIO } };
  const pesos = (n) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  for (const id in a.porEjec) { const e = a.porEjec[id];
    if (e.efectivo <= 0 && e.transferencia <= 0 && !e.movEntradas && !e.movSalidas) continue;
    const r = s.getRow(fila++); r.getCell(1).value = e.nombre;
    r.getCell(2).value = "efectivo"; r.getCell(2).alignment = { horizontal: "right" };
    r.getCell(3).value = e.efectivo; r.getCell(3).numFmt = dinero;
    const extra = [];
    if (e.transferencia) extra.push("transf. " + pesos(e.transferencia));
    if (e.movEntradas) extra.push("otros +" + pesos(e.movEntradas));
    if (e.movSalidas) extra.push("otros −" + pesos(e.movSalidas));
    r.getCell(4).value = extra.join(" · ");
    r.getCell(4).alignment = { horizontal: "right" }; }

  // DETALLE DE GASTOS Y MOVIMIENTOS. Antes el Excel decía "− Gastos $450" y nada
  // más: Monse veía el monto pero no DE QUÉ fue, y tenía que preguntar por cada
  // uno. Aquí van renglón por renglón, con quién lo capturó y su nota. Los
  // ANULADOS también se listan (tachados en gris): si alguien borró un gasto de
  // $2,000 eso tiene que verse, no desaparecer.
  const movsDia = (movs || []).filter((m) => Number(m.monto) > 0);
  if (movsDia.length) {
    fila++;
    const rt = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 4);
    const ct2 = rt.getCell(1);
    ct2.value = "GASTOS Y MOVIMIENTOS DE CAJA DEL DÍA";
    ct2.font = { bold: true, color: { argb: "FFFFFFFF" } };
    ct2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NARANJA } };
    const rh2 = s.getRow(fila++);
    ["Concepto", "Quién / nota", "Forma", "Monto"].forEach((h, i) => {
      const c = rh2.getCell(i + 1); c.value = h;
      c.font = { bold: true, color: { argb: "FF2A1F35" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECE6F1" } };
      c.alignment = { horizontal: i === 3 ? "right" : "left" };
    });
    // Los campos son los que guarda el servidor: `registradoPor`, `metodo` y
    // `autorizadoA` (no `ejecutivo`/`via`/`nota`, que son los de la app).
    const via = { E: "Efectivo", T: "Transferencia", D: "Depósito", CH: "Cheque",
      efectivo: "Efectivo", transferencia: "Transferencia", deposito: "Depósito", cheque: "Cheque" };
    for (const m of movsDia) {
      const r = s.getRow(fila++);
      const entra = !!m.entrada;
      r.getCell(1).value = String(m.concepto || m.categoria || "Movimiento");
      r.getCell(2).value = [m.registradoPor || m.usuario || "",
        m.autorizadoA ? "a " + m.autorizadoA : ""].filter(Boolean).join(" · ");
      const mt = String(m.metodo || m.via || "efectivo");
      r.getCell(3).value = via[mt] || via[mt.toUpperCase()] || mt;
      const cmn = r.getCell(4);
      // Con signo: entra en positivo, sale en negativo. Así la columna se puede
      // sumar y da exactamente el neto que aparece arriba.
      cmn.value = entra ? Number(m.monto) : -Number(m.monto);
      cmn.numFmt = dinero;
      const gris = { argb: "FF9A93A6" };
      if (m.anulado) {
        [1, 2, 3, 4].forEach((i) => { r.getCell(i).font = { strike: true, color: gris }; });
        r.getCell(2).value = (r.getCell(2).value ? r.getCell(2).value + " · " : "") + "ANULADO";
      } else {
        cmn.font = { bold: true, color: { argb: entra ? "FF0B7247" : "FFB00020" } };
      }
    }
    const rtot = s.getRow(fila++);
    rtot.getCell(1).value = "Neto de caja (así se movió el efectivo a entregar)";
    rtot.getCell(1).font = { bold: true };
    const ctt = rtot.getCell(4);
    ctt.value = -egresosEfectivo; ctt.numFmt = dinero;
    ctt.font = { bold: true, color: { argb: AURORA } };
  }

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Arqueo FOOAX ${fecha}.xlsx"`);
  res.send(Buffer.from(buf));
});

// ---------- RESUMEN del día (campanita de alertas para dirección) ----------
// Con CENTAVOS: las garantías traen medios pesos (57.50, 40.50) y este texto los
// redondeaba a peso entero, así que la campanita y el resumen de WhatsApp decían
// $58 donde la captura era $57.50 (reportado por Monse el 29-jul). El dato
// guardado siempre estuvo bien; era solo el texto. Centavos solo si existen.
function pesos(n) {
  const v = Math.round((n || 0) * 100) / 100;
  return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: (v % 1) ? 2 : 0, maximumFractionDigits: 2 });
}

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
      if (n.forma === "T" || n.forma === "D") { tr += t; movido += t; }
      else if (n.forma === "M") {
        // misma regla del RESTO que en acumular(): el efectivo es total − transf
        const mt = n.mixTr || 0;
        const me = (n.mixEfe != null && (mt + (n.mixEfe || 0)) === t) ? n.mixEfe : (t - mt);
        ef += me; tr += mt; movido += me + mt;
      }
      else { ef += t; movido += t; }
      if (p > 0) pa++;
      const cu = cuotaDe(key);
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

// ---------- RECUPERAR COBRANZA DE UN DÍA ----------
// Cada vez que un snapshot se sobrescribe, la versión anterior queda archivada.
// Aquí Dirección puede VER esas versiones y restaurar la correcta, sin depender
// de nadie. Nació del incidente del 21-jul: la cobranza se borró y, al
// restaurarla, había dos versiones con el MISMO dinero total pero distinto
// reparto efectivo/transferencia — por eso el criterio desempata por la MÁS
// RECIENTE, no solo por el monto.
function cifrasDeSnapshot(snap) {
  try {
    let d = snap; if (typeof d === "string") d = JSON.parse(d);
    const acc = { pago: 0, garantias: 0, solidario: 0, efectivo: 0, transferencia: 0, clientasPagaron: 0 };
    acumular(d && d.reg, acc); acumular(d && d.regI, acc);
    return {
      pago: acc.pago, garantias: acc.garantias, efectivo: acc.efectivo,
      transferencia: acc.transferencia, clientas: acc.clientasPagaron,
      total: acc.pago + acc.garantias + acc.solidario,
    };
  } catch { return null; }
}
// Ordena candidatas: primero la que trae MÁS dinero; si empatan, la MÁS RECIENTE.
function mejorPrimero(a, b) {
  return (b.cifras.total - a.cifras.total) || ((b.archivado || 0) - (a.archivado || 0));
}
app.get("/api/recuperar", requiere("direccion", "admin"), async (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const ids = idsEjecutivos(req.usuario);
  const actuales = store.snapshotsDeFecha(fecha);
  let hist = [];
  try { hist = await store.historialDeFecha(fecha); } catch (e) { hist = []; }
  const ejecutivos = {};
  for (const id of ids) {
    const actual = actuales[id] ? cifrasDeSnapshot(actuales[id].snapshot) : null;
    // Las capturas se archivan a cada rato MIENTRAS la ejecutiva va capturando:
    // decenas de versiones "a medias". Un HITO es una versión final de sesión:
    // la última antes de una pausa larga, la última antes de que el total BAJARA
    // (algo se reemplazó o reinició), o la más reciente. Antes se ordenaba por
    // "más dinero primero" y las versiones a medias/dobladas llenaban los 15
    // lugares — la versión CERRADA correcta no aparecía (pasó el 24-jul).
    const propias = hist.filter((x) => x.ejecutivo === id)
      .map((h) => ({ archivado: h.archivado || 0, cifras: cifrasDeSnapshot(h.snapshot) }))
      .filter((x) => x.cifras && x.cifras.total > 0)
      .sort((a, b) => a.archivado - b.archivado);
    const HITO_PAUSA = 30 * 60 * 1000;
    const hitos = [], resto = [];
    for (let i = 0; i < propias.length; i++) {
      const cur = propias[i], sig = propias[i + 1];
      const esHito = !sig || (sig.archivado - cur.archivado > HITO_PAUSA) || (sig.cifras.total < cur.cifras.total);
      (esHito ? hitos : resto).push(cur);
    }
    const vistas = new Set();
    const versiones = [];
    for (const v of hitos.sort((a, b) => b.archivado - a.archivado).concat(resto.sort(mejorPrimero))) {
      const c = v.cifras;
      const clave = [c.pago, c.garantias, c.efectivo, c.transferencia].join("|");
      if (vistas.has(clave)) continue;             // misma cifra: sólo una vez
      vistas.add(clave);
      versiones.push({ archivado: v.archivado, cifras: c });
      if (versiones.length >= 15) break;
    }
    // La FOTO DEL CIERRE (baseCerrada) es la captura correcta ANTES de cualquier
    // re-entrada/fusión. Se ofrece como opción "al cerrar": si al re-entrar la
    // app duplicó el día, esta es la buena y la versión actual no.
    const rec = actuales[id];
    let alCerrar = null;
    if (rec && rec.baseCerrada != null) {
      const cb = cifrasDeSnapshot(rec.baseCerrada);
      if (cb && cb.total > 0) alCerrar = cb;
    }
    ejecutivos[id] = {
      nombre: USUARIOS[id].nombre,
      actual,
      alCerrar,
      // ya vienen ordenadas: HITOS primero (los más recientes arriba), luego el
      // resto por monto — no se reordena para que la cerrada no se hunda.
      versiones,
    };
  }
  res.json({ fecha, ejecutivos });
});
app.post("/api/recuperar", requiere("direccion", "admin"), async (req, res) => {
  const b = req.body || {};
  const fecha = String(b.fecha || "").trim();
  const ejec = String(b.ejec || "").trim();
  if (!fecha || !ejec) return res.status(400).json({ error: "Falta la fecha o el ejecutivo." });
  if (!idsEjecutivos(req.usuario).includes(ejec)) return res.status(400).json({ error: "Ejecutivo no válido." });
  // Opción especial: restaurar la FOTO DEL CIERRE (la captura correcta antes de
  // re-entrar). Es la que arregla el descuadre por re-captura duplicada.
  if (String(b.archivado) === "alCerrar") {
    const rec = store.snapshotsDeFecha(fecha)[ejec];
    const base = rec && rec.baseCerrada;
    const cif = base != null ? cifrasDeSnapshot(base) : null;
    if (!base || !cif || cif.total <= 0) return res.status(404).json({ error: "No hay foto del cierre para ese día." });
    store.guardarSnapshot(ejec, fecha, { snapshot: base, ts: Date.now() });
    return res.json({ ok: true, ejec, fecha, cifras: cif, archivado: "alCerrar" });
  }
  let hist = [];
  try { hist = await store.historialDeFecha(fecha); } catch (e) { hist = []; }
  const candidatas = hist.filter((x) => x.ejecutivo === ejec)
    .map((h) => ({ h, cifras: cifrasDeSnapshot(h.snapshot), archivado: h.archivado }))
    .filter((x) => x.cifras && x.cifras.total > 0);
  if (!candidatas.length) return res.status(404).json({ error: "No hay versiones guardadas de ese día." });
  let elegida;
  if (b.archivado) elegida = candidatas.find((x) => String(x.archivado) === String(b.archivado));
  else elegida = candidatas.sort(mejorPrimero)[0];   // automático: más dinero, desempata la más reciente
  if (!elegida) return res.status(404).json({ error: "No encontré esa versión." });
  // guardarSnapshot archiva la versión actual antes de reemplazarla: si esto se
  // hace por error, la de ahora también queda recuperable.
  store.guardarSnapshot(ejec, fecha, { snapshot: elegida.h.snapshot, ts: Date.now() });
  res.json({ ok: true, ejec, fecha, cifras: elegida.cifras, archivado: elegida.archivado });
});

app.get("/api/movimientos", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  // La lista trae también los anulados (marcados) para que quede el rastro a la
  // vista; los totales solo suman los vivos.
  const lista = movsDeFecha(fecha, req.usuario, true).sort((a, b) => b.ts - a.ts);
  const vivos = lista.filter(m => !m.anulado);
  const totalEfectivo = vivos.filter(m => m.metodo === "efectivo").reduce((s, m) => s + m.monto, 0);
  const totalTransf = vivos.filter(m => m.metodo === "transferencia").reduce((s, m) => s + m.monto, 0);
  // Cheques: dinero que entra pero NO en billetes — se reporta aparte para que
  // Monse sepa qué papeles esperar (y el arqueo no los exija en caja).
  const totalCheques = vivos.filter(m => m.metodo === "cheque").reduce((s, m) => s + m.monto, 0);
  // Separa lo que entra de lo que sale, para que el total no mezcle una
  // recuperación (entra) con un gasto (sale) en una sola cifra engañosa.
  const entradas = vivos.filter(m => m.entrada).reduce((s, m) => s + m.monto, 0);
  const salidas = vivos.filter(m => !m.entrada).reduce((s, m) => s + m.monto, 0);
  // NETO por forma de pago (entradas − salidas). Los `total*` de arriba suman
  // TODO sin importar la dirección, así que un gasto de $100 en efectivo SUMABA
  // $100: al lado de "Entradas +$6,686 · Salidas −$100" aparecía "efectivo
  // $6,786" cuando el efectivo de verdad se movió $6,586. Karina lo cachó el
  // 30-jul haciendo una prueba de $100. Es lo mismo que el propio comentario de
  // arriba quería evitar: una cifra que mezcla lo que entra con lo que sale.
  const neto = (met) => vivos.filter((m) => m.metodo === met)
    .reduce((s, m) => s + (m.entrada ? m.monto : -m.monto), 0);
  res.json({ fecha, lista, totalEfectivo, totalTransf, totalCheques, total: totalEfectivo + totalTransf,
    entradas, salidas,
    netoEfectivo: neto("efectivo"), netoTransf: neto("transferencia"), netoCheques: neto("cheque") });
});

// ---------- páginas ----------
app.get("/", (req, res) => {
  const u = usuarioDe(req);
  if (!u) return res.sendFile(path.join(__dirname, "public", "login.html"));
  if (u.rol === "ejecutivo") return res.redirect("/app");
  return res.redirect("/tablero");
});
// Altas hechas desde el tablero (clientas/centros nuevos) que le tocan a esta
// ejecutiva. Se inyectan en su app al abrir para que APAREZCAN y les pueda
// cobrar el mismo día — antes solo salían en los reportes de dirección, no en
// la app, así que la clienta nueva quedaba sin poder cobrarse.
function altasParaApp(nombreEjec) {
  const centros = {};
  for (const cb of store.cambiosPadron())
    if (cb.tipo === "centro" && cb.centro) centros[norm(cb.centro)] = "C-" + cb.numero + " · " + cb.centro;
  // Se arma desde el PADRÓN YA APLICADO, no desde la lista cruda de cambios.
  // Antes se leían los cambios tal cual, y eso traía dos fallas: (1) un crédito
  // dado de baja seguía inyectándose, y (2) el monto era el del día del alta,
  // ignorando los ajustes de saldo posteriores. Con la renovación con el mismo
  // nombre la (1) se volvía grave: el ciclo VIEJO ganaba (la app no duplica por
  // socio+producto, se queda con el primero) y la ejecutiva cobraba el saldo
  // anterior. `origen === "alta"` = las que nacieron en el tablero; las del
  // padrón base ya vienen escritas dentro del HTML de cada app.
  const mia = (c) => norm(c.ejecutivo) === norm(nombreEjec);
  const viva = (c) => c.activa !== false && c.estatus !== "BAJA";
  const altas = PADRON
    .filter((c) => c.origen === "alta" && viva(c) && mia(c))
    .map((c) => ({ id: String(c.id), nombre: c.nombre, producto: c.producto, centro: c.centro,
      saldo: c.saldo || 0, cuota: c.cuota || 0 }));
  // QUITAR: créditos de esta ejecutiva que ya se dieron de baja (liquidados y
  // renovados, o reasignados a otra). Sin esto el crédito viejo se le quedaba
  // pegado en el teléfono: los montos viven EMBEBIDOS en el HTML de cada app,
  // así que darlo de baja en el servidor no lo borraba de su pantalla.
  const quitar = PADRON
    .filter((c) => !viva(c) && mia(c))
    .map((c) => ({ id: String(c.id), producto: c.producto }));
  return { altas, centros, quitar };
}
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
  // Script que mete las altas del tablero en CENTROS/INDIVIDUALES de la app.
  const dA = altasParaApp(req.usuario.nombre);
  const scriptAltas = (dA.altas.length || dA.quitar.length) ? (
    "<script>(function(){try{" +
    "var _A=" + JSON.stringify(dA.altas) + ";var _CN=" + JSON.stringify(dA.centros) + ";" +
    "var _Q=" + JSON.stringify(dA.quitar) + ";" +
    "function _n(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,' ').trim();}" +
    "function _ind(c,p){var n=_n(c);return !n||n==='c-0'||n==='0'||n==='individual'||/individual|foxi/.test(_n(p));}" +
    // QUITAR VA PRIMERO, SIEMPRE. Al renovar con el mismo nombre y el mismo
    // ejecutivo, el crédito viejo (de baja) y el nuevo comparten socio+producto:
    // si se agregara antes de quitar, el "quitar" borraría el crédito NUEVO y la
    // clienta desaparecería de la app. Se saca en el lugar (splice) para no
    // romper referencias que la app ya tenga a esos arreglos.
    "var _rm=function(arr){if(!arr||!arr.length)return;for(var i=arr.length-1;i>=0;i--){var c=arr[i];" +
    "if(_Q.some(function(q){return String(c.f)===String(q.id)&&_n(c.sub)===_n(q.producto);}))arr.splice(i,1);}};" +
    "if(_Q.length){for(var _qk in CENTROS)_rm(CENTROS[_qk]);if(typeof INDIVIDUALES!=='undefined')_rm(INDIVIDUALES);}" +
    "var _bn={};for(var k in CENTROS){_bn[_n(String(k).split('·').pop())]=k;}" +
    "_A.forEach(function(a){" +
    "var cl={n:a.nombre,f:String(a.id),sub:a.producto,k:a.id+'|'+a.producto+'|'+a.nombre+'|0',imp:a.saldo||0,saldo:a.saldo||0,esp:a.cuota||0,impOrig:a.saldo||0,mora:0,sug:Math.round((a.saldo||0)*1.2),des:'',dia:'',_nueva:true};" +
    "if(_ind(a.centro,a.producto)){if(!INDIVIDUALES.some(function(c){return String(c.f)===String(a.id)&&_n(c.sub)===_n(a.producto);}))INDIVIDUALES.push(cl);}" +
    "else{var nm=_n(a.centro);var lv=_bn[nm];if(!lv){lv=_CN[nm]||a.centro;CENTROS[lv]=CENTROS[lv]||[];_bn[nm]=lv;}" +
    "if(!CENTROS[lv].some(function(c){return String(c.f)===String(a.id)&&_n(c.sub)===_n(a.producto);}))CENTROS[lv].push(cl);}" +
    "});" +
    "if(typeof fillCentros==='function')try{fillCentros();}catch(e){}" +
    "if(typeof renderIndiv==='function')try{renderIndiv();}catch(e){}" +
    "if(typeof render==='function')try{render();}catch(e){}" +
    "}catch(e){}})();</script>"
  ) : "";
  const inyecciones = '<script src="/sync.js"></script><script src="/captura-agil.js"></script>' + scriptAltas;
  let out = html.includes("</head>") ? html.replace("</head>", cabeza + "</head>") : cabeza + html;
  out = out.includes("</body>") ? out.replace("</body>", inyecciones + "</body>") : out + inyecciones;
  res.type("html").send(out);
});
app.get("/tablero", paginaRequiere("direccion", "admin"), (req, res) => {
  // El tablero vive FUERA de public/: express.static servía /tablero.html a
  // cualquiera sin sesión (fuga del código y la estructura del panel de
  // Dirección). Ahora solo se entrega por esta ruta, ya con sesión validada.
  res.sendFile(path.join(__dirname, "vistas", "tablero.html"));
});
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3789;
// Recupera los "Otros movimientos" que las ejecutivas capturaron ANTES de que
// la sincronización los subiera: vivían enterrados en los snapshots ya
// guardados. Como agregarMovimiento es idempotente por folio, correr esto en
// cada arranque no duplica nada. Así lo de días pasados también le aparece a
// Anel y Monse, no solo lo de hoy en adelante.
function recuperarMovimientosHistoricos() {
  const snaps = store.respaldo().snapshots || {};
  let n = 0;
  for (const ejId in snaps) {
    const u = USUARIOS[ejId]; if (!u) continue;
    for (const fecha in snaps[ejId]) {
      let data = snaps[ejId][fecha].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { continue; } }
      const antes = store.movimientosDeFecha(fecha).length;
      guardarMovimientosDeEjecutiva({ ...u, id: ejId }, fecha, data, false);
      n += store.movimientosDeFecha(fecha).length - antes;
    }
  }
  if (n > 0) console.log(`[movimientos] recuperados ${n} de campo que estaban solo en snapshots`);
}

// Reparación de los ANULADOS FALSOS: hasta este fix, la anulación corría con
// lista vacía (sync rechazada / arranque) y marcaba ANULADO movimientos que
// NADIE borró — por eso el martes se descuadró. Corregida ya la causa, esto
// des-anula los que quedaron marcados ANTES del corte (todos los falsos). Una
// anulación LEGÍTIMA futura (posterior al corte) trae anuladoTs mayor y se
// respeta. Es idempotente: una vez des-anulado, ya no hay nada que tocar.
const REPARACION_ANULADOS_CORTE = 1784920524523; // 2026-07-24 ~19:15 UTC
function repararAnuladosFalsos() {
  let n = 0;
  for (const m of store.todosMovimientos()) {
    if (m.anulado && (!m.anuladoTs || m.anuladoTs < REPARACION_ANULADOS_CORTE)) {
      store.setMovimientoAnulado(m.folio, false);
      n++;
    }
  }
  if (n > 0) console.log(`[reparación] des-anulados ${n} movimientos que el bug marcó ANULADO por error`);
}

// Reparación ÚNICA de la captura de Karina del 24-jul-2026: su app NUNCA
// alcanzó a subir la versión correcta (el tablero solo tenía la doblada por
// re-entrada). Reconstruida desde sus CSV y verificada contra su reporte:
// cobranza $24,736.50 · 48 pagos · efectivo a entregar $40,876.50.
// v2: además de reconstruir la cobranza, DEJA LOS MOVIMIENTOS EXACTOS del día:
// anula CUALQUIER movimiento de Karina del 24-jul que NO sea una de las 9
// liquidaciones correctas (el día doblado había dejado movimientos basura que
// inflaban "otros" a $37,992 en vez de $16,380). Nada se borra: los extras
// quedan ANULADOS (con rastro) y dejan de contar. Corre una sola vez (centinela).
function repararCapturaKarina24jul() {
  const CENTINELA = "MIGR-KARINA-2026-07-24-v2";
  if (store.todosMovimientos().some((m) => m.folio === CENTINELA)) return;   // ya aplicada
  const FECHA = "2026-07-24", EJ = "karina";
  let datos;
  try { datos = JSON.parse(fs.readFileSync(path.join(__dirname, "migraciones", "karina_24jul.json"), "utf8")); }
  catch (e) { console.error("[reparación Karina] no pude leer la reconstrucción:", e.message); return; }
  const snapshot = { reg: datos.reg, regI: {}, movs: [], arqueo: datos.arqueo, fecha: FECHA };
  store.guardarSnapshot(EJ, FECHA, { snapshot, ts: Date.now() });
  store.marcarCierre(EJ, FECHA, true);   // baseCerrada = esta versión buena
  const LIQ = [
    ["KAR-2407-04", 2352, "11112754934", "ALEJANDRA MAYTE ESPINOZA DIEZO"],
    ["KAR-2407-05", 960, "11112626649", "ALI OSMAR CHAVEZ ARANGO"],
    ["KAR-2407-07", 960, "11112622956", "ANDRES DANIEL CHAVEZ ARANGO"],
    ["KAR-2407-08", 2352, "11112658700", "ANGELA ARANGO FLORES"],
    ["KAR-2407-09", 2352, "11112748267", "JUANA ARANGO FLORES"],
    ["KAR-2407-10", 2352, "11113022524", "MARIA TERESA DIEZO MORENO"],
    ["KAR-2407-11", 2352, "11113101306", "SOFIA LOPEZ HERNANDEZ"],
    ["KAR-2407-12", 1080, "11113116034", "WENDI EDITH AVENDAÑO ZEPEDA"],
    ["KAR-2407-13", 1620, "11113315176", "ITZEL ZUZUNAGA SOSA"],
  ];
  const foliosOK = new Set(LIQ.map(([f]) => "EJE-KARINA-" + f));
  // 1) Anula los movimientos BASURA de Karina del día (los que no son de los 9);
  //    revive los 9 correctos por si alguno quedó anulado.
  let anulados = 0;
  for (const m of store.movimientosDeFecha(FECHA)) {
    if (usuarioDeMov(m) !== EJ) continue;                 // solo los de Karina
    if (m.folio === CENTINELA) continue;
    if (foliosOK.has(m.folio)) { if (m.anulado) store.setMovimientoAnulado(m.folio, false); }
    else if (!m.anulado) { store.setMovimientoAnulado(m.folio, true); anulados++; }
  }
  // 2) Asegura que las 9 correctas existan (idempotente por folio).
  let addl = 0;
  for (const [f, monto, socio, clienta] of LIQ) {
    const folio = "EJE-KARINA-" + f;
    if (store.todosMovimientos().some((m) => m.folio === folio)) continue;
    store.agregarMovimiento({
      folio, fecha: FECHA, monto, concepto: "Liquidación · " + clienta + " · " + socio,
      categoria: "Otro", metodo: "efectivo", entrada: true, socio,
      registradoPor: "Karina", rol: "ejecutivo", usuario: EJ, ts: Date.now(),
    });
    addl++;
  }
  // Que el teléfono de Karina suelte su sesión (para que no re-suba la doblada).
  try { borrarTelefono.add(EJ); } catch (e) {}
  store.agregarMovimiento({ folio: CENTINELA, fecha: "2000-01-01", monto: 0, concepto: "migración", anulado: true, usuario: EJ, ts: Date.now() });
  console.log(`[reparación] Karina 24-jul: cobranza reconstruida · ${addl} liquidaciones agregadas · ${anulados} movimientos basura anulados`);
}

// Corrección ÚNICA de la cartera de Julio (29-jul). Al cargar su plantilla, las
// dos clientas de COMADRE quedaron a nombre de Christopher —la plantilla traía
// la columna "PROVENIENCIA: PLANTILLA CHRISTOPHER" y se tomó como el ejecutivo—
// y a JUANA RITA se le capturó el saldo de ANTES del pago de esa semana
// ($19,789 en vez de $16,962: exactamente una cuota de más).
// Confirmado por Karina: son de Julio, y el saldo correcto es $16,962.
function repararCarteraJulio() {
  const CENTINELA = "MIGR-JULIO-COMADRE-2026-07-29";
  if (store.todosMovimientos().some((m) => m.folio === CENTINELA)) return;
  const CAMBIOS = [
    { id: "11112931059", producto: "Comadre", campos: { ejecutivo: "Julio" },
      motivo: "Cartera de Julio: venía marcada como de Christopher por la columna de proveniencia" },
    { id: "11113014663", producto: "Comadre", campos: { ejecutivo: "Julio", saldo: 16962 },
      motivo: "Cartera de Julio + saldo corregido a $16,962 (se había capturado el de antes del pago)" },
  ];
  let n = 0;
  for (const c of CAMBIOS) {
    const actual = PADRON.find((x) => String(x.id) === c.id && nprod(x.producto) === nprod(c.producto) && x.activa !== false);
    if (!actual) { console.warn("[reparación Julio] no encontré", c.id); continue; }
    store.agregarCambioPadron({ tipo: "ajuste", id: c.id, producto: actual.producto, campos: c.campos,
      motivo: c.motivo, fecha: hoyMX(), por: "Karina (corrección de carga)", ts: Date.now() });
    n++;
  }
  if (n) {
    refrescarPadron();
    store.agregarMovimiento({ folio: CENTINELA, fecha: "2000-01-01", monto: 0, concepto: "migración", anulado: true, usuario: "julio", ts: Date.now() });
    console.log(`[reparación] cartera de Julio corregida: ${n} créditos de Comadre reasignados`);
  }
}

store.init().then(() => {
  refrescarPadron();
  console.log(`Padrón cargado: ${PADRON.length} clientas`);
  recuperarMovimientosHistoricos();
  repararAnuladosFalsos();
  repararCapturaKarina24jul();
  repararCarteraJulio();
  app.listen(PORT, () => console.log(`FOOAX cobranza · puerto ${PORT}`));
}).catch((e) => { console.error("Error al iniciar el store:", e); process.exit(1); });
