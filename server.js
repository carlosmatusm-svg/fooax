// FOOAX — Sistema Central de Cobranza · esqueleto Fase 0
// Express + almacenamiento local (store.js) intercambiable por PostgreSQL en Railway.
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const store = require("./store");
// Misma carpeta de datos que usa el store (DATA_DIR la cambia en pruebas).
const DATA_DIR_APP = process.env.DATA_DIR || path.join(__dirname, "data");

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
  // Si por lo que sea no se pudo marcar, NO se contesta "ok": la app diría que
  // cerró y a Dirección le seguiría apareciendo abierta (el bug del 7-ago).
  if (!marcado) {
    return res.status(500).json({
      error: "No se pudo cerrar el día en el servidor. Vuelve a intentarlo con señal; si sigue igual, avisa a Dirección.",
      marcado: false, fecha,
    });
  }
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
      // El TIPO va dentro del concepto ("Gasto · Gasolina — nota") para que se
      // lea igual en el tablero, en el Excel y en el respaldo. El primer
      // segmento sigue siendo el concepto, que es lo que miran los filtros.
      concepto: def.etiqueta
        + (cve === "GASTO" && tipoGastoCanonico(m.tipoGasto) ? " · " + tipoGastoCanonico(m.tipoGasto) : "")
        + (quien ? " · " + quien : "") + (m.nota ? " — " + m.nota : ""),
      categoria: def.categoria,
      // El TIPO explícito: así no depende de cómo quedó redactado el concepto.
      tipo: def.etiqueta,
      tipoGasto: cve === "GASTO" ? tipoGastoCanonico(m.tipoGasto) : null,
      // CH = CHEQUE: dinero que entra pero NO en billetes — si cayera en
      // "efectivo", el arqueo exigiría en caja billetes que son papeles
      // (el faltante de $2,280 de Neri del sábado 25-jul).
      metodo: m.via === "T" ? "transferencia" : (m.via === "CH" ? "cheque" : "efectivo"),
      cheque: (m.via === "CH" && m.cheque) ? String(m.cheque) : null,
      entrada: def.entrada,
      // socio: para poder ligar una LIQUIDACIÓN al crédito de esa clienta y
      // bajarle el saldo. Antes sólo iba dentro del texto del concepto.
      socio: m.socio ? String(m.socio) : null,
      // producto: CUÁL de sus créditos. La llave de un crédito es socio+producto
      // y ~146 socias tienen más de uno. La app SIEMPRE mostró el crédito en el
      // selector ("NOMBRE (Grupal-Micro)"), pero al guardar se quedaba solo con
      // el socio y tiraba `sub`: la liquidación se repartía al primer crédito en
      // orden alfabético, no al que la clienta liquidó. El sábado 8-ago entraron
      // así y le bajaron el saldo al crédito equivocado (lo cachó Karina).
      producto: m.producto ? String(m.producto) : null,
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
  // CRUDO a propósito: este blindaje compara captura contra captura. Con el
  // snapshot ya corregido por Dirección, un pago anulado se vería como "menos
  // pagos que antes" y rechazaría una sincronización perfectamente buena.
  const previo = store.snapshotsDeFecha(fecha, true)[req.usuario.id];
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
// El motor de reglas: los intereses se calculan con lo que Dirección escribe en
// data/reglas-productos.json, no con números metidos en este archivo.
const motor = require("./motor-reglas");

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
// DÍA DE COBRO por crédito. Vive en las apps desde el origen (cada clienta trae
// su día) pero NO subía al padrón del servidor: solo 141 de 627 lo tenían, y por
// eso el tablero no podía distinguir a quien ya venció de quien todavía no le
// toca. Este archivo lo puentea; cuando la plantilla de Monse traiga la columna,
// se toma de ahí y esto se puede retirar.
let DIAS_COBRO = {};
try { DIAS_COBRO = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "dias_cobro.json"), "utf8")); }
catch { DIAS_COBRO = {}; }
const DIAS_SEMANA = { LUNES: 1, MARTES: 2, MIERCOLES: 3, "MIÉRCOLES": 3, JUEVES: 4, VIERNES: 5, SABADO: 6, "SÁBADO": 6, DOMINGO: 7 };
// Lunes = 1 … domingo = 7, para poder comparar "ya pasó su día" con un número.
function idxDia(d) { return DIAS_SEMANA[String(d || "").trim().toUpperCase()] || 0; }
function idxHoy() { const n = new Date(hoyMX() + "T12:00:00").getDay(); return n === 0 ? 7 : n; }
function refrescarPadron() {
  PADRON = store.padron();
  // Se sella el día de cobro en cada crédito que no lo traiga de la plantilla.
  PADRON.forEach((c) => {
    if (!c.diaPago) { const d = DIAS_COBRO[claveCredito(c.id, c.producto)]; if (d) c.diaPago = d; }
  });
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

// LA LLAVE CON LA QUE UN PAGO ENCUENTRA SU CRÉDITO.
// `claveCredito` ya perdona la puntuación ("Foxi Plus 2" = "Foxi Plus - 2"),
// pero NO un producto distinto. El 7-ago se perdieron $200 de MARIA MAGDALENA
// (socio 11112908183): Julio la capturó a mano ANTES de que Monse la diera de
// alta, escribió "Individual" y el crédito quedó como "Individual 1". Mismo
// socio, distinto producto: el pago no le bajó el saldo a nadie y se fue a
// "cobranza sin crédito", donde nadie lo vio.
//
// Regla: si la llave exacta no existe pero la socia tiene UN SOLO crédito
// activo, el pago es de ese. Con dos o más NO se adivina — se queda en el aviso
// de cobranza sin crédito, que para eso está.
function claveDelPago(socioOKey, producto) {
  const directa = claveCredito(socioOKey, producto);
  const viva = (c) => c.activa !== false && c.estatus !== "BAJA";
  if (PADRON.some((c) => viva(c) && claveCredito(c.id, c.producto) === directa)) return directa;
  const socio = norm(String(socioOKey).split("|")[0]);
  const suyos = PADRON.filter((c) => viva(c) && norm(c.id) === socio);
  return suyos.length === 1 ? claveCredito(suyos[0].id, suyos[0].producto) : directa;
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
    const clave = claveDelPago(partes[0], partes[1]);
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
// Liquidaciones y recuperaciones que NO traen clienta: entran a la caja pero
// NO le bajan el saldo a nadie, en silencio. La app ya lo impide, pero un
// movimiento capturado desde el tablero de Dirección no lleva socio, y los
// movimientos viejos tampoco. Se detectan para poder avisar (4-ago).
// COBRANZA QUE NO LE BAJÓ EL SALDO A NADIE. La llave de un crédito es
// socio+producto: si una ficha llega con un producto que esa clienta no tiene, o
// con un socio que no está en el padrón, el dinero SÍ entra al arqueo pero no
// baja ningún saldo — y antes eso pasaba en silencio. Es el último hueco que
// impedía decir que los saldos se actualizan solos (Karina, 5-ago).
function cobranzaSinCredito(usuario, desde) {
  const { detalle } = pagosDeLaSemana(usuario, desde || corteSaldos());
  // Solo los créditos ACTIVOS pueden recibir un abono. Antes se comparaba contra
  // TODO el padrón, así que un cobro a una clienta DADA DE BAJA empataba, no se
  // avisaba, y aun así no le bajaba el saldo a nadie: el dinero desaparecía en
  // silencio y la conciliación decía que el día cuadraba. Lo encontró una prueba
  // adversarial el 5-ago.
  const vivas = new Set(PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA")
    .map((c) => claveCredito(c.id, c.producto)));
  const out = [];
  for (const clave in detalle) {
    const d = detalle[clave];
    if ((d.pago || 0) + (d.gar || 0) <= 0) continue;
    if (vivas.has(clave)) continue;
    const otros = PADRON.filter((c) => String(c.id) === String(d.socio));
    const activos = otros.filter((c) => c.activa !== false && c.estatus !== "BAJA");
    // El mismo crédito, pero dado de baja: no es un dedazo, es una clienta que
    // se cerró y a la que le siguieron cobrando.
    const deBaja = otros.find((c) => claveCredito(c.id, c.producto) === clave);
    out.push({
      socio: d.socio, producto: d.producto,
      pago: Math.round((d.pago || 0) * 100) / 100, garantia: Math.round((d.gar || 0) * 100) / 100,
      ejecutivo: Object.keys(d.ejec || {})[0] || null,
      fechas: Object.keys(d.fechas || {}).sort(),
      // Si la clienta SÍ existe con otros productos, casi siempre es un dedazo
      // en el nombre del producto y se puede decir cuáles son los buenos.
      clienta: otros.length ? otros[0].nombre : null,
      productosQueSiTiene: activos.map((c) => c.producto),
      estaDeBaja: !!deBaja,
      motivoBaja: deBaja ? (deBaja.motivo_baja || deBaja.estatus || null) : null,
    });
  }
  return out.sort((a, b) => b.pago - a.pago);
}
function liquidacionesSinClienta(usuario, desde) {
  const hoy = hoyMX(), inicio = desde || lunesDeLaSemana(hoy);
  const d0 = new Date(inicio + "T12:00:00");
  const out = [];
  for (let i = 0; i < (desde ? 400 : 7); i++) {
    const f = new Date(d0); f.setDate(d0.getDate() + i);
    const fISO = f.toISOString().slice(0, 10);
    if (fISO > hoy) break;
    for (const m of movsDeFecha(fISO, usuario)) {
      const tipo = tipoDeMov(m);
      if (!/^(liquidaci|recuperaci)/i.test(tipo)) continue;
      if (socioDeMov(m)) continue;
      out.push({ folio: m.folio, fecha: m.fecha, monto: m.monto, concepto: m.concepto,
        registradoPor: m.registradoPor || m.usuario || "" });
    }
  }
  return out;
}
function liquidacionesDeLaSemana(usuario, desde, fechasOut) {
  const hoy = hoyMX(), lunes = desde || lunesDeLaSemana(hoy);
  const liqPorSocio = {};
  const sumar = (m, fISO) => {
    const tipo = tipoDeMov(m) || "Otro";
    if (!/^(liquidaci|recuperaci)/i.test(tipo)) return;
    const soc = socioDeMov(m);
    if (!soc) return;
    liqPorSocio[soc] = (liqPorSocio[soc] || 0) + m.monto;
    // Guarda el MONTO por día (no solo la fecha): las renovaciones necesitan
    // saber cuánto se liquidó en cada día para no darle al ciclo nuevo lo del
    // anterior. Las fechas se siguen leyendo con Object.keys().
    if (fechasOut) {
      const fo = fechasOut[soc] = fechasOut[soc] || {};
      fo[fISO] = (fo[fISO] || 0) + m.monto;
    }
  };
  const d0 = new Date(lunes + "T12:00:00");
  // Tope 400 días: con `desde` (corte de saldos) la ventana puede ser larga.
  for (let i = 0; i < (desde ? 400 : 7); i++) {
    const f = new Date(d0); f.setDate(d0.getDate() + i);
    const fISO = f.toISOString().slice(0, 10);
    if (fISO > hoy) break;
    for (const m of movsDeFecha(fISO, usuario)) sumar(m, fISO);
  }
  // ABONOS CON FECHA ATRASADA. Lo normal es no contar nada anterior al corte:
  // el saldo de la plantilla ya lo trae. Pero si alguien captura HOY un
  // movimiento y le pone la fecha del viernes, ese abono NO pudo estar en la
  // plantilla —se registró después— y antes desaparecía en silencio: entraba a
  // la caja y no le bajaba el saldo a nadie. Lo pidió arreglar Karina el 5-ago.
  // Se distingue por la HORA DE CAPTURA (`ts`) contra la hora en que se fijó el
  // corte: capturado después del corte = la plantilla no lo tenía = sí cuenta.
  for (const m of movsAtrasadosQueSiCuentan(usuario, desde)) sumar(m, String(m.fecha));
  return liqPorSocio;
}
// Cuándo se fijó el corte vigente. Sirve para saber si un movimiento con fecha
// vieja se capturó ANTES (y entonces ya venía en la plantilla) o DESPUÉS.
function corteTs() {
  const cortes = store.cambiosPadron().filter((c) => c.tipo === "corte" && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || ""));
  return cortes.length ? (Number(cortes[cortes.length - 1].ts) || 0) : 0;
}
// Movimientos con FECHA anterior al corte pero CAPTURADOS después de fijarlo.
// La plantilla no pudo traerlos, así que sí tienen que descontar.
function movsAtrasadosQueSiCuentan(usuario, desde) {
  if (!desde) return [];
  const ts0 = corteTs();
  if (!ts0) return [];
  const out = [];
  const d0 = new Date(desde + "T12:00:00");
  for (let i = 1; i <= 120; i++) {                  // hasta 4 meses hacia atrás
    const f = new Date(d0); f.setDate(d0.getDate() - i);
    const fISO = f.toISOString().slice(0, 10);
    for (const m of movsDeFecha(fISO, usuario)) {
      if (Number(m.ts) > ts0) out.push({ ...m, fecha: fISO });
    }
  }
  return out;
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
// EL CORTE VIAJA CON LA PLANTILLA. Antes era un ajuste aparte que alguien tenía
// que acordarse de mover, y si no se movía pasaban las tres cosas que reportó
// Monse el 4-ago: los saldos no se actualizaban, un crédito terminado seguía
// apareciendo semanas después, y el Excel arrastraba el viernes y el sábado a la
// semana siguiente. Las tres son el mismo problema.
// Ahora cada plantilla trae su fecha de corte en `data/padron_corte.json` y el
// sistema la toma sola: cargar la plantilla YA mueve el corte. Si Anel o Monse
// fijan uno a mano después, ese manda (se toma el más reciente de los dos).
function cortePlantilla() {
  try {
    const f = path.join(DATA_DIR_APP, "padron_corte.json");
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    return /^\d{4}-\d{2}-\d{2}$/.test(d.corte || "") ? d.corte : null;
  } catch { return null; }
}
function corteSaldos() {
  const cortes = store.cambiosPadron().filter((c) => c.tipo === "corte" && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || ""));
  return cortes.length ? cortes[cortes.length - 1].fecha : CORTE_SALDOS_DEFECTO;
}
// Al arrancar: si la plantilla trae un corte MÁS NUEVO que el último registrado,
// se registra solo. Así cargar la plantilla ya mueve el corte —que es lo que
// pidió Monse— pero queda como un cambio más, así que Anel o Monse pueden
// moverlo después en cualquier dirección desde el tablero. Si mandara siempre la
// plantilla, no habría manera de corregirlo a mano.
function aplicarCorteDeLaPlantilla() {
  const plant = cortePlantilla();
  if (!plant) return;
  if (corteSaldos() >= plant) return;                       // ya está igual o después
  if (store.cambiosPadron().some((c) => c.tipo === "corte" && c.dePlantilla === plant)) return;
  store.agregarCambioPadron({ tipo: "corte", fecha: plant, dePlantilla: plant,
    por: "plantilla", motivo: "Corte que viene con la plantilla cargada", ts: Date.now() });
  console.log("[corte] la plantilla lo movió a " + plant);
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

// CUÁNTO DEL CICLO CERRADO SIGUE VISIBLE BAJO EL CORTE DE HOY.
//
// Al renovar, el ciclo nuevo hereda la MISMA llave (socio+producto), así que los
// abonos del ciclo viejo se le cargarían al nuevo. Por eso el recrédito anota en
// `previo` cuánto llevaba abonado el que se cerró, para descontarlo.
//
// El problema era que ese apunte venía sellado con el corte de ese día: al mover
// el corte dejaba de valer y el crédito nuevo amanecía con los abonos del viejo
// encima (le pasó a doña Alma Rosario el 10-ago: $5,440 de más).
//
// Aquí se recalcula contra el corte de HOY, y la regla es la que sí se sostiene:
// los abonos del ciclo cerrado son los que tienen FECHA ANTERIOR O IGUAL al día
// de la renovación. Se recorren de más viejo a más nuevo y se toman hasta
// completar lo que `previo` dice — nunca más, así que si el corte tapó parte de
// esos abonos, tampoco se descuenta de más.
function previoVigente(c, corte, porFecha, fechasLiq) {
  const p = c && c.previo;
  if (!p) return null;
  const hasta = p.fecha || c.alta_fecha || null;
  const tomar = (mapa, tope, leer) => {
    if (!(tope > 0) || !mapa) return 0;
    let queda = tope, suma = 0;
    for (const f of Object.keys(mapa).sort()) {
      if (queda <= 0) break;
      if (f < corte) continue;              // ese día ya lo trae descontado la plantilla
      if (hasta && f > hasta) break;        // de aquí en adelante ya es del ciclo NUEVO
      const v = leer(mapa[f]);
      const usa = Math.min(queda, v);
      suma += usa; queda -= usa;
    }
    return Math.round(suma * 100) / 100;
  };
  // Con desglose por día no hay que adivinar: se suma lo que quedó dentro del
  // corte de hoy.
  //
  // Y se COTEJA contra los abonos de verdad de esa llave hasta el día de la
  // renovación, quedándose con el mayor de cada día. Dos razones: (1) repara
  // los desgloses que quedaron mal escritos el 10-ago —le pegaban el monto a
  // una fecha anterior al corte, que después se ignora, y por eso a SOCORRO
  // MIGUEL se le volvieron a restar sus $320—, y (2) todo abono con fecha
  // anterior o igual a la renovación es, por definición, del ciclo que se
  // cerró: el nuevo nació ese día.
  if (p.dias || p.diasLiq) {
    const clave0 = claveCredito(c.id, c.producto);
    const real = porFecha[clave0] || {};
    // El cotejo solo alcanza a los días ESTRICTAMENTE ANTERIORES a la renovación.
    // El día mismo manda el desglose guardado y nada más: ahí conviven el último
    // abono del ciclo viejo y el primero del nuevo, y si se cotejara también ese
    // día, el primer pago del crédito nuevo se tomaría por del viejo y dejaría de
    // bajarle el saldo. Lo cachó la prueba de la sección 53.
    const suma = (mapa, leerReal) => {
      let t = 0;
      const fechas = new Set(Object.keys(mapa || {}));
      if (leerReal) for (const f in real) if (!hasta || f < hasta) fechas.add(f);
      for (const f of fechas) {
        if (f < corte) continue;                 // ya viene descontado en la plantilla
        if (hasta && f > hasta) continue;        // de ahí en adelante es del ciclo NUEVO
        const guardado = (mapa || {})[f] || 0;
        const cotejo = (leerReal && hasta && f < hasta) ? leerReal(real[f] || {}) : 0;
        t += Math.max(guardado, cotejo);
      }
      return Math.round(t * 100) / 100;
    };
    return {
      pago: suma(p.dias, (x) => x.p || 0),
      gar: suma(p.diasGar, (x) => x.g || 0),
      liq: suma(p.diasLiq, null),   // van por socio: solo vale lo que se apartó
    };
  }
  // Apuntes viejos (sin desglose): se deduce por fecha. No es exacto el día de
  // la renovación, pero es muchísimo mejor que perder la protección entera.
  const clave = claveCredito(c.id, c.producto);
  return {
    pago: tomar(porFecha[clave], p.pago || 0, (x) => x.p || 0),
    gar: tomar(porFecha[clave], p.gar || 0, (x) => x.g || 0),
    liq: tomar(fechasLiq[String(c.id)], p.liq || 0, (x) => x || 0),
  };
}

function carteraViva(usuario) {
  // Saldos = saldo de plantilla − TODO lo abonado desde el corte (no solo la
  // semana: los lunes la ventana semanal se vacía y los saldos "rebotaban").
  const corte = corteSaldos();
  const { pago: pagos, gar: garantias, porFecha } = pagosDeLaSemana(usuario, corte);
  const fechasLiq = {};   // socio → día → monto liquidado/recuperado
  const liqRestante = Object.assign({}, liquidacionesDeLaSemana(usuario, corte, fechasLiq));
  // LO QUE YA DICE A QUÉ CRÉDITO VA. Desde el 8-ago-2026 el movimiento guarda el
  // producto, así que la liquidación le baja al crédito que la clienta liquidó y
  // no al primero de la lista. Lo de antes (sin producto) se sigue repartiendo
  // igual que siempre: cambiarles la regla movería saldos de toda la cartera.
  const ligadas = liquidacionesLigadas(usuario, corte);
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
    // y ese monto se descuenta aquí.
    //
    // ANTES ESTO SE CAÍA AL MOVER EL CORTE (`previo.corte === corte`), y el 7-ago
    // pasó de verdad: Monse renovó a doña Alma Rosario por $29,184, después movió
    // el corte al lunes, y el crédito NUEVO amaneció con $5,440 descontados — los
    // del ciclo que ya había liquidado. Ahora el descuento se vuelve a calcular
    // contra el corte de hoy, así que moverlo ya no lo desactiva.
    const prev = previoVigente(c, corte, porFecha, fechasLiq);
    const pagado = Math.max(0, (pagos[clave] || 0) - (prev ? (prev.pago || 0) : 0));
    const garan = Math.max(0, (garantias[clave] || 0) - (prev ? (prev.gar || 0) : 0));
    // Las liquidaciones son por SOCIO y se reparten entre sus créditos en orden
    // fijo. Lo que ya consumió el ciclo cerrado se aparta antes de repartir.
    const usado = liqRestante["__usado__" + soc] || (liqRestante["__usado__" + soc] = 0);
    const bolsa = Object.values(fechasLiq[soc] || {}).reduce((a, b) => a + b, 0);
    // Lo que ya tiene crédito escrito sale del reparto: es de ESE crédito. Sin
    // apartarlo se contaría dos veces (una en su crédito y otra en la bolsa).
    const bolsaLibre = Math.max(0, bolsa - (ligadas.porSocio[soc] || 0));
    const suyosVivos = activos.filter((x) => String(x.id) === soc).length;
    const tope = Math.max(0, (c.saldo || 0) - pagado);
    // RENOVAR DESPUÉS DE LIQUIDAR. El ciclo nuevo hereda la MISMA llave
    // (socio+producto), así que la liquidación con la que se cerró el ANTERIOR
    // le caería encima y nacería liquidado. `prev.liq` dice cuánto se llevó ese
    // ciclo; se descuenta PRIMERO de lo que está ligado a esta llave y sólo el
    // resto se le pide a la bolsa del reparto. Sin esto, una clienta que liquidó
    // $2,000 y renovó por $5,000 aparecía con $3,000 y se le caía de la app
    // (lo reportó Karina el 9-ago, y era regresión del cambio del 8-ago).
    const prevLiq = prev ? (prev.liq || 0) : 0;
    const ligadoAqui = ligadas.porClave[clave] || 0;
    const exacto = Math.min(Math.max(0, ligadoAqui - prevLiq), tope);
    const prevRestante = Math.max(0, prevLiq - ligadoAqui);
    // UNA LIQUIDACIÓN ES EXCLUSIVAMENTE DEL CRÉDITO QUE LIQUIDAN (Karina, 10-ago:
    // «sin afectar los demás activos»). Si la socia tiene MÁS DE UN crédito vivo
    // y el abono no dice cuál, ya no se reparte: repartir era adivinar, y
    // adivinaba mal — le bajaba el saldo al que no era. Se queda sin aplicar y
    // sale en el aviso de «liquidaciones sin crédito» del tablero, donde Monse
    // le pone el crédito y entonces sí le baja al que debe.
    //
    // Con UN SOLO crédito activo no hay a quién equivocarle: ahí sí se aplica.
    const disp = suyosVivos > 1 ? 0 : Math.max(0, bolsaLibre - usado - prevRestante);
    const repartido = Math.min(disp, Math.max(0, tope - exacto));
    const liquidado = exacto + repartido;
    if (repartido > 0) liqRestante["__usado__" + soc] = usado + repartido;
    porCredito.set(clave, { pagado, liquidado, garantia: garan,
      saldoActual: Math.max(0, (c.saldo || 0) - pagado - liquidado),
      // Solo se anotan los días de la liquidación si a ESTE crédito le tocó algo.
      fechasLiq: liquidado > 0 ? Object.keys(fechasLiq[soc] || {}) : [] });
  }
  return { porCredito, pagos, garantias };
}
// CONCILIACIÓN: ¿todo lo que se cobró bajó de algún saldo?
// Es el control que sustituye al "pedirle el Excel a Monse para comparar". Si
// cuadra, los saldos del sistema son los buenos y no hace falta cotejar con
// nadie. Si no cuadra, dice EXACTAMENTE cuánto y por qué. Pedido por Karina el
// 5-ago: «me preocupa que la otra semana tenga que pedir exceles».
function conciliacionDeSaldos(usuario) {
  const corte = corteSaldos();
  const cv = carteraViva(usuario);
  const { pago: pagos, gar: garantias } = pagosDeLaSemana(usuario, corte);
  const suma = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const cobradoFichas = suma(pagos);
  const cobradoGarantias = suma(garantias);
  const fechasLiq = {};
  liquidacionesDeLaSemana(usuario, corte, fechasLiq);
  const cobradoLiq = Object.values(fechasLiq).reduce((a, d) => a + suma(d), 0);
  let bajoPorFichas = 0, bajoPorLiq = 0;
  for (const v of cv.porCredito.values()) { bajoPorFichas += v.pagado || 0; bajoPorLiq += v.liquidado || 0; }
  // Lo que NO bajó ningún saldo, con su razón.
  const sinCredito = cobranzaSinCredito(usuario, corte)
    .reduce((a, x) => a + (x.pago || 0), 0);
  const sinClienta = liquidacionesSinClienta(usuario, corte)
    .reduce((a, x) => a + (x.monto || 0), 0);
  const r = (n) => Math.round(n * 100) / 100;
  // Un abono mayor al saldo se topa: el resto es sobrante, no dinero perdido.
  const topado = r(Math.max(0, (cobradoFichas - sinCredito - bajoPorFichas)
    + (cobradoLiq - sinClienta - bajoPorLiq)));
  const cobrado = r(cobradoFichas + cobradoLiq);
  const bajo = r(bajoPorFichas + bajoPorLiq);
  const explicado = r(sinCredito + sinClienta + topado);
  const sinExplicar = r((cobrado - bajo) - explicado);
  return {
    desde: corte,
    cobrado, bajoDeSaldos: bajo,
    // La GARANTÍA respalda el crédito: entra a la caja y no abona al saldo. NUNCA
    // se le llama ahorro — una SOFOM E.N.R. no está autorizada a captar ahorro y
    // nombrarlo así expone a FOOAX (regla Karina, 5-ago-2026).
    garantias: r(cobradoGarantias),
    diferencia: r(cobrado - bajo),
    porque: {
      cobrosSinCredito: r(sinCredito),
      liquidacionesSinClienta: r(sinClienta),
      // Un abono mayor al saldo se topa: es sobrante, no dinero perdido.
      abonoMayorAlSaldo: topado,
      sinExplicar,
    },
    // CUADRA solo si CADA PESO cobrado llegó a un saldo. El dinero huérfano
    // —sin crédito o sin clienta— tiene explicación pero NO está aplicado: es un
    // problema que hay que arreglar, no una razón para dar el día por bueno.
    // Un abono que se pasó del saldo sí es normal: la clienta pagó de más.
    cuadra: Math.abs(sinExplicar) < 1 && r(sinCredito + sinClienta) === 0,
    porArreglar: r(sinCredito + sinClienta),
  };
}
function infoCredito(cv, c) {
  return cv.porCredito.get(claveCredito(c.id, c.producto)) ||
    { pagado: 0, liquidado: 0, garantia: 0, saldoActual: Math.max(0, c.saldo || 0) };
}

// ---------- SALDOS ACTUALIZADOS de la semana en Excel ----------
// La plantilla que Monse hace a mano: saldo inicial − pagado esta semana =
// saldo actualizado, por crédito. Generada sola. Solo dirección/admin.
// ===================================================================
// MOVIMIENTO DEL PERIODO — el reporte que NO depende del corte.
//
// Pedido por Karina el 7-ago: «un Excel que no tenga que ver con el corte, para
// que tengamos mejor control de lo que se va, que se pueda ocupar de lunes a
// domingo».
//
// El Excel de saldos contesta «¿cuánto debe cada clienta?», y para eso el corte
// es imprescindible: marca desde dónde descontar sin contar dos veces lo que la
// plantilla ya traía. El problema es que ese mismo corte hace que la cobranza
// de días anteriores desaparezca del reporte, y entonces no sirve para la otra
// pregunta: «¿cuánto entró y cuánto salió esta semana?».
//
// Esto contesta la segunda, y NO MIRA EL CORTE NI UNA VEZ. Es dinero que se
// movió entre dos fechas, punto. Cualquier rango: lunes a domingo, un día, un
// mes. Así el control del dinero deja de depender de dónde esté parado el corte.
// ===================================================================
// Cómo se pagó, en palabras. La app guarda la letra (E/T/M/D) y Dirección
// guarda el nombre completo; aquí se aceptan las dos.
const FORMA_TXT = { E: "Efectivo", T: "Transferencia", M: "Mixto", D: "Depósito", CH: "Cheque",
  efectivo: "Efectivo", transferencia: "Transferencia", deposito: "Depósito", cheque: "Cheque" };
function movimientoDelPeriodo(usuario, desde, hasta) {
  const permitidas = new Set(idsEjecutivos(usuario));
  const snaps = store.respaldo().snapshots || {};      // ya con las correcciones aplicadas
  const ajustes = store.ajustesCobranza();
  const corregido = new Set(ajustes.map((a) => a.fecha + "|" + a.ejecutivo + "|" + a.clave));
  const anulado = new Set(ajustes.filter((a) => a.anula).map((a) => a.fecha + "|" + a.ejecutivo + "|" + a.clave));
  const porClave = {};
  for (const c of PADRON) porClave[claveCredito(c.id, c.producto)] = c;

  const cobranza = [];
  for (const ej in snaps) {
    if (!permitidas.has(ej)) continue;
    for (const fecha in snaps[ej]) {
      if (fecha < desde || fecha > hasta) continue;
      let data = snaps[ej][fecha].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { continue; } }
      const meter = (nodo, key, centro) => {
        if (!nodo || typeof nodo !== "object") return;
        const p = nodo.pago || 0, g = nodo.garantia || 0, so = nodo.solidario || 0;
        if (p <= 0 && g <= 0 && so <= 0) return;
        const partes = String(key).split("|");
        const cred = porClave[claveDelPago(partes[0], partes[1])];
        const marca = fecha + "|" + ej + "|" + key;
        cobranza.push({
          fecha, ejecutivo: (USUARIOS[ej] || {}).nombre || ej,
          socio: partes[0], clienta: partes[2] || (cred || {}).nombre || "—",
          producto: partes[1] || "", centro: centro || (cred || {}).centro || "Individual",
          pago: p, garantia: g, solidario: so, total: p + g + so,
          forma: FORMA_TXT[nodo.forma] || nodo.forma || "Efectivo",
          corregido: corregido.has(marca), anulado: anulado.has(marca),
        });
      };
      for (const k in (data.regI || {})) meter(data.regI[k], k, null);
      for (const cen in (data.reg || {}))
        for (const k in (data.reg[cen] || {})) meter(data.reg[cen][k], k, cen);
    }
  }

  // Otros movimientos: liquidaciones, recuperaciones, gastos, retiros. Se
  // recorren por fecha porque `movsDeFecha` ya filtra anulados y burbuja.
  const otros = [];
  for (let f = new Date(desde + "T12:00:00"); f.toISOString().slice(0, 10) <= hasta; f.setDate(f.getDate() + 1)) {
    const fISO = f.toISOString().slice(0, 10);
    // CON ANULADOS. El 12-ago se buscó una liquidación de YOALI KAREN que la
    // ejecutiva sí registró el lunes y ya no estaba: un re-sync de su app la
    // anuló, y como los anulados no salían en este reporte, era INVISIBLE —
    // parecía que nunca se registró. Ahora salen marcados ANULADO (sin contar
    // en ningún total), para poder ver qué pasó.
    for (const m of movsDeFecha(fISO, usuario, true)) {
      otros.push({
        fecha: fISO, folio: m.folio, tipo: tipoDeMov(m) || m.categoria || "Otro",
        anulado: !!m.anulado, producto: m.producto || "",
        entrada: !!m.entrada, concepto: m.concepto || "", monto: Number(m.monto) || 0,
        metodo: m.metodo || "efectivo", socio: socioDeMov(m) || "",
        clienta: (porClave[claveCredito(socioDeMov(m) || "", "")] || {}).nombre
          || (PADRON.find((c) => String(c.id) === String(socioDeMov(m) || "")) || {}).nombre || "",
        ejecutivo: (USUARIOS[ejecutivoDeMov(m)] || {}).nombre || "",
        registradoPor: m.registradoPor || "",
      });
    }
  }

  // Día por día: lo que entró y lo que salió, sin mirar el corte.
  const dias = {};
  const dia = (f) => dias[f] || (dias[f] = { fecha: f, pago: 0, garantia: 0, solidario: 0,
    entradas: 0, salidas: 0, clientas: new Set() });
  for (const c of cobranza) {
    const d = dia(c.fecha);
    d.pago += c.pago; d.garantia += c.garantia; d.solidario += c.solidario;
    if (c.total > 0) d.clientas.add(c.socio);
  }
  for (const m of otros) { if (m.anulado) continue; const d = dia(m.fecha); if (m.entrada) d.entradas += m.monto; else d.salidas += m.monto; }
  const porDia = Object.values(dias).sort((a, b) => a.fecha.localeCompare(b.fecha)).map((d) => ({
    fecha: d.fecha, pago: d.pago, garantia: d.garantia, solidario: d.solidario,
    entradas: d.entradas, salidas: d.salidas, clientas: d.clientas.size,
    neto: d.pago + d.garantia + d.solidario + d.entradas - d.salidas,
  }));

  const suma = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) * 100) / 100;
  cobranza.sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.ejecutivo).localeCompare(String(b.ejecutivo)));
  otros.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { desde, hasta, cobranza, otros, porDia, total: {
    pago: suma(cobranza, (x) => x.pago), garantia: suma(cobranza, (x) => x.garantia),
    solidario: suma(cobranza, (x) => x.solidario),
    entradas: suma(otros.filter((x) => x.entrada && !x.anulado), (x) => x.monto),
    salidas: suma(otros.filter((x) => !x.entrada && !x.anulado), (x) => x.monto),
  } };
}

// Rango por omisión: la semana en curso, LUNES A DOMINGO (Karina lo pidió así:
// el sábado y el domingo sí entra dinero — recuperaciones y atrasados).
function rangoPeriodo(q) {
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  let desde = fecha(q.desde), hasta = fecha(q.hasta);
  if (!desde) desde = lunesDeLaSemana(hoyMX());
  if (!hasta) {
    const d = new Date(desde + "T12:00:00"); d.setDate(d.getDate() + 6);
    hasta = d.toISOString().slice(0, 10);
  }
  if (hasta < desde) { const t = desde; desde = hasta; hasta = t; }
  return { desde, hasta };
}

// ===================================================================
// MORA DE LA SEMANA, POR DÍA DE COBRO — el método de la Ing. Monse.
//
// Pedido por Karina el 10-ago con el archivo «MORA SEMANA 03 AL 07 DE AGOSTO»:
// «la mora no nos dio la semana pasada; ves que dice día lunes, martes, etc.,
// de las plantillas, así quiero que lo saques por ese approach».
//
// Su regla, sacada de cotejar SUS números contra las cuotas del padrón:
//
//     faltante = cuota − lo que pagó esa semana
//
// y las clientas se agrupan por el DÍA DE COBRO que trae la plantilla. Se
// comprobó en los casos donde el faltante NO era la cuota entera: MARIA DEL
// ROSARIO (cuota $576, faltante $126 → pagó $450) y LUCIA CASTRO (cuota $432,
// faltante $132 → pagó $300). En los demás, faltante = cuota exacta = no pagó.
//
// NO MIRA EL CORTE. Es de la semana: lo que se abonó entre lunes y domingo. Por
// eso da un número distinto al del semáforo de cartera, que mide otra cosa
// (el acumulado desde el corte) — y por eso «no nos dio».
// ===================================================================
const NOMBRE_DIA = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
// Cuántas veces cae el día de cobro de una clienta entre dos fechas (ambas
// incluidas). Es la pieza del método de la Ing. Monse (14-ago): cada día de
// cobro vencido desde el corte exige una cuota.
// ¿Cuándo NACIÓ el crédito vigente de esta clave? (alta o re-crédito). Es el
// respaldo cuando no capturaron desembolso: un crédito dado de alta el jueves
// no puede deber la cuota del lunes anterior. Solo cuenta el ÚLTIMO nacimiento
// (una renovación reinicia las obligaciones).
function fechaNacimientoCredito(id, producto) {
  let f = null;
  for (const cb of store.cambiosPadron()) {
    if ((cb.tipo === "alta" || cb.tipo === "recredito") &&
        String(cb.id) === String(id) && nprod(cb.producto) === nprod(producto) &&
        /^\d{4}-\d{2}-\d{2}$/.test(cb.fecha || "")) f = cb.fecha;
  }
  return f;
}

// El arranque real de las obligaciones: SOLO la fecha de desembolso. Devuelve
// el día SIGUIENTE (la primera cuota es el primer día de cobro DESPUÉS de
// recibir el dinero), o null si no se capturó.
//
// NO se usa la fecha del alta como respaldo (se intentó el 14-ago y salió
// caro): Monse da de alta en el sistema clientas que YA traían su crédito
// corriendo desde antes, y tratarlas como créditos recién nacidos las dejaba
// EXENTAS de mora. El 15-ago eso sacó del reporte a NUBIA, HILARIA, SILVIA y
// varias más que no habían abonado un peso desde el corte. Si falta el
// desembolso, se mide desde el corte como todas: es lo conservador.
function inicioObligaciones(c) {
  const des = String(c.desembolso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(des)) return null;
  const dv = new Date(des + "T12:00:00"); dv.setDate(dv.getDate() + 1);
  return dv.toISOString().slice(0, 10);
}

// EL ARRANQUE DE LA CUENTA: el día siguiente al corte. Desde ahí se cuentan
// las cuotas que vencen Y los abonos que entran — las dos con LA MISMA VARA.
//
// Que sea la misma es lo que importa. El 15-ago las cuotas empezaban después
// del corte pero los abonos se contaban DESDE el corte, y esa asimetría
// regalaba una cuota: quien pagó EL DÍA DEL CORTE estaba liquidando su cuota
// ANTERIOR (la plantilla ya la traía pendiente en el saldo) y el sistema se la
// acreditaba a la cuota de esta semana. Así se cayeron del reporte ELVIRA,
// GUIE y ARELI, que sí debían.
function diaSiguiente(fISO) {
  const d = new Date(fISO + "T12:00:00"); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function vencimientosEntre(diaIdx, desdeISO, hastaISO) {
  if (!diaIdx || !desdeISO || !hastaISO || hastaISO < desdeISO) return 0;
  let n = 0;
  const d = new Date(desdeISO + "T12:00:00");
  const fin = new Date(hastaISO + "T12:00:00");
  while (d <= fin) {
    const g = d.getDay();
    if ((g === 0 ? 7 : g) === diaIdx) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function nombreDia(fechaISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaISO || ""))) return "";
  return NOMBRE_DIA[new Date(fechaISO + "T12:00:00").getDay()] || "";
}
function moraDeLaSemana(usuario, lunesOpt) {
  const lunes = /^\d{4}-\d{2}-\d{2}$/.test(String(lunesOpt || "")) ? lunesOpt : lunesDeLaSemana(hoyMX());
  const dom = new Date(lunes + "T12:00:00"); dom.setDate(dom.getDate() + 6);
  const domingo = dom.toISOString().slice(0, 10);
  // Lo abonado ESA semana, crédito por crédito. Solo el pago: la garantía y el
  // solidario no cubren la cuota.
  const { porFecha } = pagosDeLaSemana(usuario, lunes, domingo);
  // DOS MEDIDAS, NO UNA. `pagoSemana` es todo lo que abonó de lunes a domingo;
  // `pagoDelDia` es lo que abonó EL DÍA QUE LE TOCA. Sin las dos no se puede
  // contestar «¿cuántos pagaron el lunes?»: una clienta de lunes que paga el
  // miércoles está al corriente en la semana pero NO pagó su día, y meterlas en
  // el mismo saco esconde a las que van tarde aunque acaben pagando.
  const pagoSemana = {}, porClaveFecha = {};
  for (const clave in porFecha) {
    porClaveFecha[clave] = porFecha[clave];
    for (const f in porFecha[clave])
      if (f >= lunes && f <= domingo) pagoSemana[clave] = (pagoSemana[clave] || 0) + (porFecha[clave][f].p || 0);
  }
  // TODOS los abonos desde el corte, clave por clave y FECHA por fecha: fichas
  // de las ejecutivas y dinero entregado en oficina. Se guarda con su fecha
  // para poder sumar desde el arranque propio de cada crédito (su primer día
  // de cobro después del corte) y no desde el corte a secas.
  const corteM = corteSaldos();
  const abonoPorFecha = {};
  {
    const { porFecha: pfC } = pagosDeLaSemana(usuario, corteM, domingo);
    for (const clave in pfC)
      for (const f in pfC[clave])
        (abonoPorFecha[clave] = abonoPorFecha[clave] || {})[f] =
          ((abonoPorFecha[clave] || {})[f] || 0) + (pfC[clave][f].p || 0);
    const d0 = new Date(corteM + "T12:00:00");
    for (let k = 0; k < 400; k++) {
      const dd = new Date(d0); dd.setDate(d0.getDate() + k);
      const fISO = dd.toISOString().slice(0, 10);
      if (fISO > domingo) break;
      for (const m of movsDeFecha(fISO, usuario)) {
        if (!/^(liquidaci|recuperaci)/i.test(tipoDeMov(m) || "")) continue;
        const soc = socioDeMov(m); if (!soc) continue;
        let prod = productoDeMov(m);
        if (!prod) {
          const suyos = PADRON.filter((x) => x.activa !== false && x.estatus !== "BAJA" && String(x.id) === String(soc));
          if (suyos.length === 1) prod = suyos[0].producto;
        }
        if (!prod) continue;
        const cl = claveCredito(soc, prod);
        (abonoPorFecha[cl] = abonoPorFecha[cl] || {})[fISO] =
          ((abonoPorFecha[cl] || {})[fISO] || 0) + (Number(m.monto) || 0);
      }
    }
  }
  const abonadoDesde = (clave, desdeISO) => {
    let t = 0;
    for (const f in (abonoPorFecha[clave] || {})) if (f >= desdeISO) t += abonoPorFecha[clave][f];
    return Math.round(t * 100) / 100;
  };
  const fechaDelDia = (dia) => {
    const d = new Date(lunes + "T12:00:00"); d.setDate(d.getDate() + (idxDia(dia) - 1));
    return d.toISOString().slice(0, 10);
  };
  // LO QUE LA CLIENTA ENTREGÓ POR CAJA ESA SEMANA TAMBIÉN CUBRE SU CUOTA.
  // (12-ago, al cotejar contra el archivo rectificado de Monse.) Si paga en la
  // oficina y Dirección lo registra como liquidación o recuperación, ese dinero
  // le bajaba el saldo pero la mora NO lo contaba — solo contaba las fichas de
  // las ejecutivas, y la clienta salía debiendo una cuota que ya entregó.
  // Con varios créditos y sin decir cuál, no se adivina: queda en el aviso.
  for (let f = new Date(lunes + "T12:00:00"); ; f.setDate(f.getDate() + 1)) {
    const fISO = f.toISOString().slice(0, 10);
    if (fISO > domingo || fISO > hoyMX()) break;
    for (const m of movsDeFecha(fISO, usuario)) {
      if (!/^(liquidaci|recuperaci)/i.test(tipoDeMov(m) || "")) continue;
      const soc = socioDeMov(m); if (!soc) continue;
      let prod = productoDeMov(m);
      if (!prod) {
        const suyos = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA" && String(c.id) === String(soc));
        if (suyos.length === 1) prod = suyos[0].producto;
      }
      if (!prod) continue;
      const clave = claveCredito(soc, prod);
      pagoSemana[clave] = (pagoSemana[clave] || 0) + (Number(m.monto) || 0);
      const pf = porClaveFecha[clave] || (porClaveFecha[clave] = {});
      const b = pf[fISO] || (pf[fISO] = { p: 0, g: 0 });
      b.p += Number(m.monto) || 0;
    }
  }

  const cv = carteraViva(usuario);
  const mios = new Set(idsEjecutivos(usuario).map((id) => norm(USUARIOS[id].nombre)));
  const dias = {};
  const fueraDeCuenta = { sinCuota: 0, cuotaVariable: 0, sinDia: 0, liquidados: 0, sinDesembolsar: 0, vencidos: 0 };
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    if (!mios.has(norm(c.ejecutivo))) continue;
    // Un crédito ya liquidado no debe nada esa semana.
    if (infoCredito(cv, c).saldoActual <= 0.009) { fueraDeCuenta.liquidados++; continue; }
    // MAGNUS y los de cuota decreciente quedan fuera: su cuota cambia cada
    // periodo y la del padrón deja de servir al primer pago. Marcarles mora con
    // ella sería inventarla. Se cuentan aparte para que no desaparezcan en silencio.
    if (esCuotaVariable(c.producto)) { fueraDeCuenta.cuotaVariable++; continue; }
    // UN VENCIDO NO VA EN LA MORA SEMANAL. Es la regla que la Ing. Monse dictó
    // el 4-ago: el dinero de un crédito vencido cuenta SOLO como recuperación.
    // Y su archivo lo confirma (12-ago): DAFNE SINAI está VENCIDA en su propia
    // plantilla y por eso no la lista en la mora de la semana — nosotros sí la
    // listábamos, y era una de las diferencias.
    if (/vencid/i.test(String(c.estatus || ""))) { fueraDeCuenta.vencidos++; continue; }
    const cuota = Number(c.cuota) || 0;
    if (cuota <= 0) { fueraDeCuenta.sinCuota++; continue; }
    // TODAVÍA NO LE HAN DADO EL DINERO: no puede deber. Si el desembolso es
    // POSTERIOR a la semana que se está midiendo, el crédito no existía. Sin
    // esto se les cobraba mora a clientas que aún no reciben su préstamo — hay
    // 3 en el padrón con fecha de desembolso adelantada.
    const dia = String(c.diaPago || "").trim().toUpperCase();
    if (!idxDia(dia)) { fueraDeCuenta.sinDia++; continue; }
    const suFecha = fechaDelDia(dia);
    const desem = String(c.desembolso || "").slice(0, 10);
    // Se compara contra SU DÍA de esa semana, no contra el domingo. Una clienta
    // desembolsada el MARTES no podía deber el LUNES: comparando contra el
    // domingo se colaba y se le marcaba mora de un día en que su crédito ni
    // existía. Lo destapó Karina el 12-ago al ver que el arqueo del lunes y
    // esta mora no cuadraban ($700 de diferencia en la batería).
    if (/^\d{4}-\d{2}-\d{2}$/.test(desem) && desem > suFecha) { fueraDeCuenta.sinDesembolsar++; continue; }
    const clave = claveCredito(c.id, c.producto);
    const pagado = Math.round((pagoSemana[clave] || 0) * 100) / 100;
    const pagadoSuDia = Math.round((((porClaveFecha[clave] || {})[suFecha] || {}).p || 0) * 100) / 100;
    // EL MÉTODO DE MONSE, COMPLETO (validado por ella el 14-ago con ARIELA,
    // LUCIA y LA CONSENTIDA). "Cuota − lo pagado esta semana" se quedaba corto
    // en tres casos: la que ADELANTÓ la semana pasada salía debiendo (ARIELA),
    // la que pagó ANTES de su día en la misma semana también, y a la que le
    // queda menos saldo que una cuota se le exigía la cuota entera (LUCIA, a
    // la que le quedan $442).
    //
    // Regla completa: desde el corte, cada día de cobro vencido exige una
    // cuota; TODO lo abonado desde el corte cuenta, venga del día que venga;
    // lo que falta se acota a UNA cuota (los atrasos viejos no inflan la
    // semana) y NUNCA pasa del saldo que le queda.
    const infoM = infoCredito(cv, c);
    // LA MISMA VARA PARA LAS DOS COSAS. La cuenta arranca en el PRIMER DÍA DE
    // COBRO de la clienta después del corte, y desde ahí se cuentan sus cuotas
    // Y sus abonos. Si un crédito no ha sido desembolsado a esa altura, arranca
    // después de su desembolso.
    let desdeV = diaSiguiente(corteM);
    const iniOb = inicioObligaciones(c);
    if (iniOb && iniOb > desdeV) desdeV = iniOb;
    const venc = vencimientosEntre(idxDia(dia), desdeV, suFecha);
    const abonadoDesdeCorte = abonadoDesde(clave, desdeV);
    let faltante0 = Math.max(0, Math.min(cuota, cuota * venc - abonadoDesdeCorte));
    // EL PLAZO TERMINÓ (el caso LUCIA, $442): cuando ya corrieron todos sus
    // pagos, lo exigible es TODO lo que queda — el último pago absorbe los
    // centavos y lo atrasado, por eso puede ser mayor que la cuota.
    // El plazo terminado exige TODO el saldo SOLO cuando lo que queda es el
    // pico final (menos de dos cuotas — el caso LUCIA, $442). Si "terminó" y
    // aún debe medio crédito, el PLAZO está mal capturado (error conocido del
    // padrón): exigirle todo marcaba en mora a EPIFANIA con $5,616 habiendo
    // pagado su cuota completa ese mismo día (14-ago).
    const plazoM = Number(c.plazo) || 0;
    if (plazoM > 0 && iniOb && infoM.saldoActual < cuota * 2 &&
        vencimientosEntre(idxDia(dia), iniOb, suFecha) >= plazoM)
      faltante0 = infoM.saldoActual;
    const faltante = Math.round(Math.min(faltante0, infoM.saldoActual) * 100) / 100;
    // El día se abre SIEMPRE, pague o no: hace falta saber cuántas SÍ pagaron
    // para leer la mora. «$34,040 de mora» no dice nada sin «de 90 créditos».
    const g = dias[dia] || (dias[dia] = { dia, fecha: null, filas: [], total: 0,
      creditos: 0, alCorriente: 0, alCorrienteSuDia: 0, pagaronAlgo: 0,
      cobrado: 0, cobradoSuDia: 0 });
    g.creditos++;
    g.cobrado = Math.round((g.cobrado + pagado) * 100) / 100;
    g.cobradoSuDia = Math.round((g.cobradoSuDia + pagadoSuDia) * 100) / 100;
    if (pagado > 0) g.pagaronAlgo++;
    // Pagó COMPLETO el día que le tocaba: es el número que de verdad mide la
    // disciplina del centro. Los que completan después también cuentan, pero
    // aparte, porque no es lo mismo.
    if (pagadoSuDia >= cuota - 0.009) g.alCorrienteSuDia++;
    if (faltante <= 0) { g.alCorriente++; continue; }
    g.filas.push({ ejecutivo: c.ejecutivo || "—", centro: c.centro || "Individual",
      socio: String(c.id), clienta: c.nombre, producto: c.producto,
      cuota, pagado, pagadoSuDia, suFecha, faltante,
      desembolso: desem || null,
      // El día de la semana en que se desembolsó. Karina lo pidió así porque en
      // las plantillas los días vienen por nombre, no por fecha. NO es el que
      // agrupa —eso lo manda el DÍA DE PAGO— y en 3 de cada 11 no coinciden:
      // hay quien desembolsó en miércoles y cobra los lunes.
      diaDesembolso: nombreDia(desem),
      diaPago: dia,
      saldo: infoCredito(cv, c).saldoActual });
    g.total = Math.round((g.total + faltante) * 100) / 100;
  }
  // La fecha real de cada día dentro de esa semana, como la pone Monse.
  const lista = Object.values(dias).sort((a, b) => idxDia(a.dia) - idxDia(b.dia));
  const hoy = hoyMX();
  for (const g of lista) {
    const d = new Date(lunes + "T12:00:00"); d.setDate(d.getDate() + (idxDia(g.dia) - 1));
    g.fecha = d.toISOString().slice(0, 10);
    // MORA vs POR VENCER (12-ago, al cotejar contra el archivo de Monse de la
    // semana 10-14: el suyo solo trae los días que YA PASARON). Un día cuyo
    // cobro todavía no llega no es mora — es cobranza por venir. Sumarlo al
    // total era justo lo que hacía que "no cuadrara" contra el de ella: el
    // miércoles nuestro reporte ya cargaba jueves y viernes completos.
    g.vencido = g.fecha <= hoy;
    g.filas.sort((a, b) => String(a.centro).localeCompare(String(b.centro))
      || String(a.clienta).localeCompare(String(b.clienta)));
  }
  const sum = (f) => Math.round(lista.reduce((s, g) => s + f(g), 0) * 100) / 100;
  const sumV = (f) => Math.round(lista.filter((g) => g.vencido).reduce((s, g) => s + f(g), 0) * 100) / 100;
  return { lunes, domingo, dias: lista,
    total: sum((g) => g.total),
    // Lo VENCIDO a hoy es el número comparable con el archivo de Monse: solo
    // los días cuyo cobro ya pasó. Lo demás es "por vencer", no mora.
    totalVencido: sumV((g) => g.total),
    totalPorVencer: Math.round((sum((g) => g.total) - sumV((g) => g.total)) * 100) / 100,
    clientas: new Set(lista.flatMap((g) => g.filas.map((f) => f.socio))).size,
    creditos: sum((g) => g.creditos),
    alCorriente: sum((g) => g.alCorriente),
    alCorrienteSuDia: sum((g) => g.alCorrienteSuDia),
    cobradoSuDia: sum((g) => g.cobradoSuDia),
    pagaronAlgo: sum((g) => g.pagaronAlgo),
    cobrado: sum((g) => g.cobrado),
    fueraDeCuenta };
}

app.get("/api/mora", requiere("direccion", "admin"), (req, res) => {
  // ?porQue=<socio> dice POR QUÉ un crédito no aparece en la mora. Nació el
  // 12-ago persiguiendo una diferencia de $700 entre este reporte y el arqueo:
  // sin esto, un total que no cuadra no se puede perseguir.
  const soc = String(req.query.porQue || "").trim();
  if (soc) {
    const m = moraDeLaSemana(req.usuario, req.query.lunes);
    const cv = carteraViva(req.usuario);
    const mios = new Set(idsEjecutivos(req.usuario).map((id) => USUARIOS[id].nombre).map(norm));
    const out = [];
    for (const c of PADRON) {
      if (String(c.id) !== soc) continue;
      const r = { producto: c.producto, ejecutivo: c.ejecutivo, estatus: c.estatus,
        activa: c.activa, cuota: c.cuota, diaPago: c.diaPago, desembolso: c.desembolso,
        saldoActual: infoCredito(cv, c).saldoActual };
      // Los abonos que el sistema le está viendo, día por día, en la ventana
      // de la semana: es lo que decide si sale o no en la mora.
      {
        const lunesD = m.lunes;
        const fin = new Date(lunesD + "T12:00:00"); fin.setDate(fin.getDate() + 6);
        const { porFecha: pf } = pagosDeLaSemana(req.usuario, lunesD, fin.toISOString().slice(0, 10));
        const cl = claveCredito(c.id, c.producto);
        r.clave = cl;
        r.abonos = pf[cl] || {};
        r.pagoSemana = Object.values(r.abonos).reduce((t, x) => t + (x.p || 0), 0);
      }
      r.motivo =
        (c.activa === false || c.estatus === "BAJA") ? "dado de baja"
        : !mios.has(norm(c.ejecutivo)) ? "su ejecutivo no está en esta burbuja: " + c.ejecutivo
        : infoCredito(cv, c).saldoActual <= 0.009 ? "ya liquidado (saldo 0)"
        : /vencid/i.test(String(c.estatus || "")) ? "vencido (va en recuperación)"
        : esCuotaVariable(c.producto) ? "cuota variable"
        : !(Number(c.cuota) > 0) ? "sin cuota capturada"
        : !idxDia(String(c.diaPago || "").trim().toUpperCase()) ? "sin día de cobro"
        : "sí entra";
      out.push(r);
    }
    return res.json({ socio: soc, lunes: m.lunes, creditos: out });
  }
  res.json(moraDeLaSemana(req.usuario, req.query.lunes));
});

// El Excel con el MISMO acomodo que usa la Ing. Monse: un bloque por día, con
// EJECUTIVO · CENTRO · ID · CLIENTE · PRODUCTO · FALTANTE DE PAGO, y su total.
app.get("/api/mora/excel", requiere("direccion", "admin"), async (req, res) => {
  const d = moraDeLaSemana(req.usuario, req.query.lunes);
  const wb = new ExcelJS.Workbook(); wb.creator = "FOOAX";
  const s = wb.addWorksheet("Mora de la semana");
  const AURORA = "FFF1228E", RIO = "FF324AB6", ROJO = "FF8E0019", LAV = "FFF3F0FA";
  const MONEDA = '"$"#,##0.00';
  [14, 22, 15, 34, 18, 18, 18, 13, 16, 13, 15, 17].forEach((w, i) => (s.getColumn(i + 1).width = w));
  s.mergeCells("A1:L1");
  const t = s.getCell("A1");
  t.value = "FOOAX · MORA DE LA SEMANA · del " + d.lunes + " al " + d.domingo;
  t.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  s.getRow(1).height = 24;
  let f = 3;
  for (const g of d.dias) {
    // Renglón del día, como su archivo: DIA · LUNES · (fecha)
    const rd = s.getRow(f++);
    rd.getCell(1).value = "DIA";
    rd.getCell(2).value = g.dia;
    rd.getCell(3).value = g.fecha;
    if (!g.vencido) rd.getCell(4).value = "AÚN NO VENCE — cobranza por venir, no es mora";
    for (let i = 1; i <= 12; i++) {
      rd.getCell(i).font = { bold: true, color: { argb: "FFFFFFFF" } };
      rd.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    }
    const rh = s.getRow(f++);
    ["EJECUTIVO", "CENTRO", "ID", "CLIENTE", "PRODUCTO", "DÍA DEL DESEMBOLSO", "FECHA DE DESEMBOLSO",
     "DÍA DE COBRO", "FALTANTE DE PAGO", "Cuota", "Pagó ese día", "Pagó en la semana"]
      .forEach((h, i) => { const c = rh.getCell(i + 1); c.value = h;
        c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LAV } }; });
    for (const x of g.filas) {
      const r = s.getRow(f++);
      [x.ejecutivo, x.centro, x.socio, x.clienta, x.producto,
       x.diaDesembolso || "—", x.desembolso || "—", x.diaPago]
        .forEach((v, i) => (r.getCell(i + 1).value = v));
      // Si desembolsó en un día y cobra en otro, se marca: es lo que explica
      // que su día de cobro no sea el que uno esperaría por el desembolso.
      if (x.diaDesembolso && x.diaDesembolso !== x.diaPago)
        r.getCell(6).font = { color: { argb: ROJO } };
      const cf = r.getCell(9); cf.value = x.faltante; cf.numFmt = MONEDA;
      cf.font = { bold: true, color: { argb: ROJO } };
      const cc = r.getCell(10); cc.value = x.cuota; cc.numFmt = MONEDA;
      const cd = r.getCell(11); cd.value = x.pagadoSuDia; cd.numFmt = MONEDA;
      const cp = r.getCell(12); cp.value = x.pagado; cp.numFmt = MONEDA;
    }
    const rt = s.getRow(f++);
    rt.getCell(4).value = "TOTAL " + g.dia + "  ·  " + g.alCorrienteSuDia + " de " + g.creditos
      + " pagaron ESE DÍA"
      + (g.alCorriente > g.alCorrienteSuDia ? "  (+" + (g.alCorriente - g.alCorrienteSuDia) + " completaron después)" : "")
      + "  ·  cobrado ese día " + g.cobradoSuDia.toFixed(2);
    rt.getCell(4).font = { bold: true };
    const ct = rt.getCell(9); ct.value = g.total; ct.numFmt = MONEDA;
    ct.font = { bold: true, color: { argb: ROJO } };
    f++;
  }
  const rg = s.getRow(f++);
  rg.getCell(4).value = "MORA VENCIDA A HOY (días que ya pasaron)";
  rg.getCell(4).font = { bold: true, size: 12 };
  const cg = rg.getCell(9); cg.value = d.totalVencido; cg.numFmt = MONEDA;
  cg.font = { bold: true, size: 12, color: { argb: ROJO } };
  const rg2 = s.getRow(f++);
  rg2.getCell(4).value = "Por vencer en la semana (días que faltan)";
  rg2.getCell(4).font = { bold: true };
  const cg2 = rg2.getCell(9); cg2.value = d.totalPorVencer; cg2.numFmt = MONEDA;
  cg2.font = { bold: true };
  // Lo que NO entró en la cuenta, dicho con todas sus letras: un reporte de mora
  // que calla lo que dejó fuera se lee como si hubiera medido todo.
  f++;
  const fc = d.fueraDeCuenta;
  const notas = [
    "Fuera de esta cuenta:",
    "· " + fc.cuotaVariable + " créditos de cuota variable (MAGNUS): su cuota cambia cada periodo y la del padrón deja de servir al primer pago.",
    "· " + fc.sinCuota + " créditos sin cuota capturada en el padrón.",
    "· " + fc.sinDia + " créditos sin día de cobro.",
    "· " + fc.liquidados + " créditos ya liquidados (no deben nada esta semana).",
    "· " + fc.sinDesembolsar + " créditos cuya fecha de desembolso es POSTERIOR a esta semana: todavía no reciben el dinero, no pueden deber.",
    "· " + fc.vencidos + " créditos VENCIDOS: van en recuperación, no en la mora semanal (regla de la Ing. Monse, 4-ago).",
    "Faltante = cuota − lo que abonó entre el " + d.lunes + " y el " + d.domingo + ". No depende del corte.",
    "Los bloques se agrupan por el DÍA DE COBRO de la plantilla, no por el día en que se desembolsó: "
      + "se comprobó contra el archivo de la Ing. Monse y empata en 11 de 11, mientras que el día del desembolso "
      + "solo empata en 8 de 11 (hay quien desembolsó en miércoles y cobra los lunes). "
      + "Cuando los dos días NO coinciden, el del desembolso va marcado en rojo.",
    "Los pagos por CAJA (liquidaciones y recuperaciones registradas por Dirección) también cubren la cuota de la semana.",
    "«Pagó ese día» es lo que abonó EL DÍA que le toca; «pagó en la semana» incluye lo que completó después. "
      + "El faltante se calcula con la SEMANA: si completó el jueves, ya no debe. La columna del día es para ver quién va tarde aunque acabe pagando.",
  ];
  for (const n of notas) {
    const r = s.getRow(f++);
    s.mergeCells("A" + r.number + ":L" + r.number);
    r.getCell(1).value = n;
    r.getCell(1).font = { italic: true, size: 10, color: { argb: "FF6B6480" } };
  }
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Mora FOOAX ${d.lunes} al ${d.domingo}.xlsx"`);
  res.end(Buffer.from(buf));
});

// ══════════════════════════════════════════════════════════════════════
// RENOVACIONES — la pregunta de Karina (14-ago): «las renovaciones pendientes
// o las que NO renovaron, de los ejecutivos, en el de Anel».
//
// Son dos preguntas distintas y por eso van en dos listas:
//   · YA TERMINARON Y NO HAN RENOVADO — pagaron todo y siguen sin crédito
//     nuevo. Cada día que pasa es cartera que se enfría (y clienta que la
//     competencia puede levantar). El dato que manda es CUÁNTOS DÍAS llevan.
//   · ESTÁN POR TERMINAR — les quedan 3 cuotas o menos. Es la lista de
//     trabajo: a estas hay que ofrecerles la renovación ANTES de que cierren.
//
// Lo que NO entra se cuenta y se dice, nunca se calla: un VENCIDO no es
// renovación (va a recuperación, regla de la Ing. Monse del 4-ago), y los de
// cuota variable (MAGNUS) no se pueden proyectar con la cuota del padrón.
function reporteRenovaciones(usuario, avisoSemanas, mesPedido) {
  const cv = carteraViva(usuario);
  const mios = new Set(idsEjecutivos(usuario).map((id) => norm(USUARIOS[id].nombre)));
  const hoy = hoyMX();
  const corte = corteSaldos();
  const semanasAviso = Number(avisoSemanas) > 0 ? Number(avisoSemanas) : 3;
  // EL MES (Karina, 14-ago: «si de las renovaciones quiero ver de todo el
  // mes»). El mes NO recorta la lista de pendientes —la que terminó en junio y
  // no ha vuelto sigue urgiendo en agosto— sino que arma el CORTE DEL MES:
  // cuántas cerraron ciclo y cuántas volvieron a salir.
  const mes = /^\d{4}-\d{2}$/.test(String(mesPedido || "")) ? String(mesPedido) : hoy.slice(0, 7);

  // FECHA EN QUE LE CAERÁ SU ÚLTIMA CUOTA: se cuentan sus días de cobro hacia
  // adelante. Es lo que permite preguntar "¿quiénes terminan en septiembre?".
  const fechaDeLaUltima = (diaPago, cuotasFaltan) => {
    const idx = idxDia(String(diaPago || "").trim().toUpperCase());
    if (!idx || !(cuotasFaltan > 0)) return null;
    const d = new Date(hoy + "T12:00:00");
    let vistos = 0;
    for (let k = 0; k < 800 && vistos < cuotasFaltan; k++) {
      d.setDate(d.getDate() + 1);
      const g = d.getDay();
      if ((g === 0 ? 7 : g) === idx) vistos++;
    }
    return vistos === cuotasFaltan ? d.toISOString().slice(0, 10) : null;
  };

  // ¿Qué socias tienen HOY dinero prestado vivo? Si una terminó su crédito
  // pero ya trae otro corriendo, NO está sin renovar — ya se le volvió a dar.
  const conCreditoVivo = new Set();
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    if (infoCredito(cv, c).saldoActual > 0.009) conCreditoVivo.add(String(c.id));
  }

  // ÚLTIMO DÍA EN QUE ABONÓ: es la fecha en que terminó de pagar. Sale de los
  // mismos pagos que usa el saldo (desde el corte) más las liquidaciones de
  // caja, para que el número de días no dependa de dónde se capturó.
  const pf = pagosDeLaSemana(usuario, corte).porFecha || {};
  const ultimoAbono = {};
  for (const clave in pf)
    for (const f in pf[clave])
      if (((pf[clave][f] || {}).p || 0) > 0 && (!ultimoAbono[clave] || f > ultimoAbono[clave]))
        ultimoAbono[clave] = f;
  const ultimaLiq = {};
  for (const m of (store.respaldo().movimientos || [])) {
    if (m.anulado || !/^(liquidaci|recuperaci)/i.test(tipoDeMov(m))) continue;
    const soc = socioDeMov(m);
    if (!soc || !/^\d{4}-\d{2}-\d{2}$/.test(String(m.fecha || ""))) continue;
    if (!ultimaLiq[soc] || m.fecha > ultimaLiq[soc]) ultimaLiq[soc] = m.fecha;
  }
  const diasEntre = (a, b) => Math.max(0, Math.round(
    (new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000));

  const sinRenovar = [], porTerminar = [];
  const fuera = { vencidos: 0, cuotaVariable: 0, sinCuota: 0 };
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    if (!mios.has(norm(c.ejecutivo))) continue;
    const info = infoCredito(cv, c);
    const clave = claveCredito(c.id, c.producto);
    const comun = { ejecutivo: c.ejecutivo, centro: c.centro, clienta: c.nombre,
      socio: String(c.id), producto: c.producto, diaPago: c.diaPago || null };

    if ((c.saldo || 0) > 0 && info.saldoActual <= 0.009) {
      // TERMINÓ DE PAGAR. Si ya trae otro crédito vivo, no está pendiente.
      if (conCreditoVivo.has(String(c.id))) continue;
      // Un vencido que se liquidó fue RECUPERACIÓN, no una renovación normal:
      // se marca para que Dirección lo trate distinto, pero no se esconde.
      const venc = esVencido(c);
      const fin = [ultimoAbono[clave] || "", ultimaLiq[String(c.id)] || ""].sort().pop() || null;
      sinRenovar.push({ ...comun, monto: Number(c.saldo) || 0,
        fechaFin: fin, dias: fin ? diasEntre(fin, hoy) : null,
        eraVencido: venc, cuota: Number(c.cuota) || 0 });
      continue;
    }
    if (info.saldoActual <= 0.009) continue;          // sin saldo original: nada que renovar
    if (esVencido(c)) { fuera.vencidos++; continue; }  // va a recuperación, no a renovación
    if (esCuotaVariable(c.producto)) { fuera.cuotaVariable++; continue; }
    const cuota = Number(c.cuota) || 0;
    if (cuota <= 0) { fuera.sinCuota++; continue; }
    const faltan = Math.ceil((info.saldoActual - 0.009) / cuota);
    if (faltan > semanasAviso) continue;
    const fEstimada = fechaDeLaUltima(c.diaPago, faltan);
    porTerminar.push({ ...comun, saldoActual: Math.round(info.saldoActual * 100) / 100,
      cuota, semanas: faltan, monto: Number(c.saldo) || 0,
      fechaEstimada: fEstimada, terminaEnElMes: !!fEstimada && fEstimada.slice(0, 7) === mes });
  }

  // La que lleva MÁS tiempo sin renovar va primero: es la que más urge.
  sinRenovar.sort((a, b) => (b.dias || 0) - (a.dias || 0) || String(a.clienta).localeCompare(String(b.clienta), "es"));
  porTerminar.sort((a, b) => a.semanas - b.semanas || String(a.clienta).localeCompare(String(b.clienta), "es"));

  // LAS QUE SÍ RENOVARON EN EL MES: cada re-crédito queda asentado en la
  // bitácora del padrón con su fecha, así que el dato ya existe — solo hay que
  // leerlo. Sin esto, el mes solo enseñaría lo malo y no la tasa.
  const renovaron = [];
  for (const cb of store.cambiosPadron()) {
    if (cb.tipo !== "alta" || !cb.recredito) continue;
    if (String(cb.fecha || "").slice(0, 7) !== mes) continue;
    const cl = cb.clienta || {};
    if (!mios.has(norm(cl.ejecutivo))) continue;
    renovaron.push({ ejecutivo: cl.ejecutivo, centro: cl.centro, clienta: cl.nombre,
      socio: String(cl.id || cb.id), producto: cl.producto || cb.producto,
      monto: Number(cl.saldo) || 0, fecha: cb.fecha });
  }
  renovaron.sort((a2, b2) => String(b2.fecha).localeCompare(String(a2.fecha)));

  // Las que TERMINARON dentro del mes y siguen sin volver. La tasa compara
  // esas dos: de las que cerraron ciclo en el mes, cuántas volvieron a salir.
  const terminaronEnElMes = sinRenovar.filter((x) => String(x.fechaFin || "").slice(0, 7) === mes);
  const cerraronCiclo = renovaron.length + terminaronEnElMes.length;
  // HASTA DÓNDE ALCANZA LA VISTA. El saldo de cada clienta es la foto del día
  // del corte: quien terminó de pagar ANTES ya venía en cero, así que el
  // sistema no puede saber que cerró ciclo ese mes. Pedir julio con el corte
  // en agosto daba «0 cerraron ciclo» y una tasa de 100% que no significa
  // nada. Se dice, y NO se calcula tasa: un porcentaje falso es peor que
  // ninguno, porque se toman decisiones con él.
  const mesDelCorte = corte.slice(0, 7);
  const antesDelCorte = mes < mesDelCorte;
  const esFuturo = mes > hoy.slice(0, 7);

  const porEjecutivo = {};
  const cuenta = (lista, campo, montoCampo) => {
    for (const x of lista) {
      const e = x.ejecutivo || "—";
      porEjecutivo[e] = porEjecutivo[e] || { ejecutivo: e, sinRenovar: 0, montoSinRenovar: 0,
        porTerminar: 0, montoPorTerminar: 0, renovaron: 0, montoRenovado: 0, terminaronEnElMes: 0 };
      porEjecutivo[e][campo]++;
      porEjecutivo[e][montoCampo] = Math.round((porEjecutivo[e][montoCampo] + (x.monto || 0)) * 100) / 100;
    }
  };
  cuenta(sinRenovar, "sinRenovar", "montoSinRenovar");
  cuenta(porTerminar, "porTerminar", "montoPorTerminar");
  cuenta(renovaron, "renovaron", "montoRenovado");
  cuenta(terminaronEnElMes, "terminaronEnElMes", "montoSinRenovarDelMes");
  // La tasa por ejecutivo se calcula al final, ya con las dos cuentas hechas.
  for (const g of Object.values(porEjecutivo)) {
    const cierra = g.renovaron + g.terminaronEnElMes;
    g.tasa = (!antesDelCorte && cierra > 0) ? Math.round((g.renovaron / cierra) * 100) : null;
  }

  const suma = (l) => Math.round(l.reduce((a, x) => a + (x.monto || 0), 0) * 100) / 100;
  return {
    hoy, corte, semanasAviso, mes,
    sinRenovar, porTerminar, renovaron,
    delMes: {
      mes,
      renovaron: renovaron.length,
      montoRenovado: Math.round(renovaron.reduce((a2, x) => a2 + (x.monto || 0), 0) * 100) / 100,
      // Antes del corte no se puede afirmar quién cerró ciclo: va en null, no
      // en cero. Cero significa «no hubo»; null significa «no se puede saber».
      terminaronSinRenovar: antesDelCorte ? null : terminaronEnElMes.length,
      montoTerminaronSinRenovar: antesDelCorte ? null
        : Math.round(terminaronEnElMes.reduce((a2, x) => a2 + (x.monto || 0), 0) * 100) / 100,
      cerraronCiclo: antesDelCorte ? null : cerraronCiclo,
      tasa: (!antesDelCorte && cerraronCiclo > 0) ? Math.round((renovaron.length / cerraronCiclo) * 100) : null,
      // La proyección mira hacia adelante: en un mes que ya pasó no aplica.
      terminanEnElMes: mes < hoy.slice(0, 7) ? null : porTerminar.filter((x) => x.terminaEnElMes).length,
      // Lo que les FALTA POR PAGAR a las que terminan en el mes: es la cobranza
      // que está por cerrarse — y cada una, una renovación por ofrecer.
      montoTerminanEnElMes: mes < hoy.slice(0, 7) ? null
        : Math.round(porTerminar.filter((x) => x.terminaEnElMes)
            .reduce((a2, x) => a2 + (x.saldoActual || 0), 0) * 100) / 100,
      antesDelCorte, esFuturo, corte,
      sinMovimiento: renovaron.length === 0 && (antesDelCorte || terminaronEnElMes.length === 0),
    },
    porEjecutivo: Object.values(porEjecutivo).sort((a, b) => String(a.ejecutivo).localeCompare(String(b.ejecutivo), "es")),
    totales: {
      sinRenovar: sinRenovar.length, montoSinRenovar: suma(sinRenovar),
      porTerminar: porTerminar.length, montoPorTerminar: suma(porTerminar),
    },
    fuera,
  };
}

app.get("/api/renovaciones", requiere("direccion", "admin"), (req, res) => {
  res.json(reporteRenovaciones(req.usuario, req.query.semanas, req.query.mes));
});

app.get("/api/renovaciones/excel", requiere("direccion", "admin"), async (req, res) => {
  const d = reporteRenovaciones(req.usuario, req.query.semanas, req.query.mes);
  const wb = new ExcelJS.Workbook(); wb.creator = "FOOAX";
  const AURORA = "FFF1228E", RIO = "FF324AB6", ROJO = "FF8E0019";
  const MONEDA = '"$"#,##0.00';
  const hoja = (nombre, titulo, cols) => {
    const s = wb.addWorksheet(nombre);
    const ultima = String.fromCharCode(64 + cols.length);
    s.mergeCells("A1:" + ultima + "1");
    const t = s.getCell("A1");
    t.value = titulo;
    t.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
    t.alignment = { horizontal: "center", vertical: "middle" };
    s.getRow(1).height = 24;
    const hr = s.getRow(2);
    cols.forEach(([h, w], i) => {
      const cc = hr.getCell(i + 1); cc.value = h; s.getColumn(i + 1).width = w;
      cc.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
      cc.alignment = { horizontal: "center", wrapText: true };
    });
    return s;
  };

  const s1 = hoja("No renovaron", "FOOAX · YA TERMINARON Y NO HAN RENOVADO (todas, sin importar el mes) · al " + d.hoy,
    [["Ejecutivo", 14], ["Centro", 22], ["Clienta", 32], ["Socio", 15], ["Producto", 18],
     ["Monto del crédito que terminó", 18], ["Terminó de pagar el", 16], ["Días sin renovar", 14], ["Nota", 26]]);
  let f = 3;
  for (const x of d.sinRenovar) {
    const r = s1.getRow(f++);
    [x.ejecutivo, x.centro, x.clienta, x.socio, x.producto].forEach((v, i) => (r.getCell(i + 1).value = v));
    r.getCell(6).value = x.monto; r.getCell(6).numFmt = MONEDA;
    r.getCell(7).value = x.fechaFin || "—";
    r.getCell(8).value = x.dias == null ? "—" : x.dias;
    r.getCell(9).value = x.eraVencido ? "Era crédito VENCIDO: fue recuperación" : "";
    // Más de un mes sin renovar se ve en rojo: es la que se está enfriando.
    if ((x.dias || 0) >= 30) r.getCell(8).font = { bold: true, color: { argb: ROJO } };
  }
  const t1 = s1.getRow(f++);
  t1.getCell(5).value = "TOTAL · " + d.totales.sinRenovar + " clientas";
  t1.getCell(6).value = d.totales.montoSinRenovar; t1.getCell(6).numFmt = MONEDA;
  [5, 6].forEach((i) => (t1.getCell(i).font = { bold: true }));

  const s2 = hoja("Por terminar", "FOOAX · POR TERMINAR — RENOVACIÓN PENDIENTE (" + d.semanasAviso + " cuotas o menos) · al " + d.hoy,
    [["Ejecutivo", 14], ["Centro", 22], ["Clienta", 32], ["Socio", 15], ["Producto", 18],
     ["Día de cobro", 13], ["Saldo que le queda", 16], ["Cuota", 12], ["Cuotas que le faltan", 14],
     ["Termina (estimado)", 15]]);
  f = 3;
  for (const x of d.porTerminar) {
    const r = s2.getRow(f++);
    [x.ejecutivo, x.centro, x.clienta, x.socio, x.producto, x.diaPago || "—"]
      .forEach((v, i) => (r.getCell(i + 1).value = v));
    r.getCell(7).value = x.saldoActual; r.getCell(7).numFmt = MONEDA;
    r.getCell(8).value = x.cuota; r.getCell(8).numFmt = MONEDA;
    r.getCell(9).value = x.semanas;
    r.getCell(10).value = x.fechaEstimada || "—";
    if (x.semanas <= 1) r.getCell(9).font = { bold: true, color: { argb: ROJO } };
    if (x.terminaEnElMes) r.getCell(10).font = { bold: true, color: { argb: RIO } };
  }
  const t2 = s2.getRow(f++);
  t2.getCell(5).value = "TOTAL · " + d.totales.porTerminar + " clientas";
  t2.getCell(7).value = Math.round(d.porTerminar.reduce((a2, x) => a2 + (x.saldoActual || 0), 0) * 100) / 100;
  t2.getCell(7).numFmt = MONEDA;
  [5, 7].forEach((i) => (t2.getCell(i).font = { bold: true }));

  // EL MES: quién renovó, cuándo y por cuánto. Es la hoja que contesta
  // «¿cómo nos fue este mes?» sin tener que contar a mano.
  const sm = hoja("Renovaciones del mes", "FOOAX · RENOVACIONES DADAS EN " + d.mes,
    [["Fecha", 12], ["Ejecutivo", 14], ["Centro", 22], ["Clienta", 32], ["Socio", 15],
     ["Producto", 18], ["Monto del crédito nuevo", 18]]);
  f = 3;
  for (const x of d.renovaron) {
    const r = sm.getRow(f++);
    [x.fecha, x.ejecutivo, x.centro, x.clienta, x.socio, x.producto]
      .forEach((v, i) => (r.getCell(i + 1).value = v));
    r.getCell(7).value = x.monto; r.getCell(7).numFmt = MONEDA;
  }
  const tm = sm.getRow(f++);
  tm.getCell(4).value = "TOTAL · " + d.delMes.renovaron + " renovaciones";
  tm.getCell(7).value = d.delMes.montoRenovado; tm.getCell(7).numFmt = MONEDA;
  [4, 7].forEach((i) => (tm.getCell(i).font = { bold: true }));
  const tr = sm.getRow(f + 1);
  tr.getCell(1).value = "De los " + d.delMes.cerraronCiclo + " créditos que cerraron ciclo en " + d.mes
    + ", renovaron " + d.delMes.renovaron + " y siguen sin volver " + d.delMes.terminaronSinRenovar
    + (d.delMes.tasa == null ? "." : " — tasa de renovación " + d.delMes.tasa + "%.");
  tr.font = { bold: true, color: { argb: RIO } };

  const s3 = hoja("Por ejecutivo", "FOOAX · RENOVACIONES POR EJECUTIVO · " + d.mes + " · al " + d.hoy,
    [["Ejecutivo", 16], ["Renovó en el mes", 14], ["Monto renovado", 16], ["Cerró y no volvió (mes)", 15],
     ["Tasa de renovación", 14], ["No renovaron (todas)", 15], ["Monto que terminó", 17],
     ["Por terminar", 13], ["Monto por terminar", 17]]);
  f = 3;
  for (const g of d.porEjecutivo) {
    const r = s3.getRow(f++);
    r.getCell(1).value = g.ejecutivo;
    r.getCell(2).value = g.renovaron;
    r.getCell(3).value = g.montoRenovado; r.getCell(3).numFmt = MONEDA;
    r.getCell(4).value = g.terminaronEnElMes;
    r.getCell(5).value = g.tasa == null ? "—" : g.tasa + "%";
    if (g.tasa != null && g.tasa < 50) r.getCell(5).font = { bold: true, color: { argb: ROJO } };
    r.getCell(6).value = g.sinRenovar;
    r.getCell(7).value = g.montoSinRenovar; r.getCell(7).numFmt = MONEDA;
    r.getCell(8).value = g.porTerminar;
    r.getCell(9).value = g.montoPorTerminar; r.getCell(9).numFmt = MONEDA;
  }
  // Lo que quedó fuera se DICE, no se calla: si el total no cuadra con la
  // cartera, aquí está la explicación.
  const rf = s3.getRow(f + 1);
  rf.getCell(1).value = "Fuera de esta cuenta: " + d.fuera.vencidos + " vencidos (van en recuperación, no en renovación), "
    + d.fuera.cuotaVariable + " de cuota variable (MAGNUS: su cuota cambia cada periodo) y "
    + d.fuera.sinCuota + " sin cuota capturada.";
  rf.font = { italic: true, color: { argb: ROJO } };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Renovaciones FOOAX ${d.hoy}.xlsx"`);
  res.end(Buffer.from(buf));
});

app.get("/api/periodo", requiere("direccion", "admin"), (req, res) => {
  const { desde, hasta } = rangoPeriodo(req.query);
  res.json(movimientoDelPeriodo(req.usuario, desde, hasta));
});

app.get("/api/periodo/excel", requiere("direccion", "admin"), async (req, res) => {
  const { desde, hasta } = rangoPeriodo(req.query);
  const d = movimientoDelPeriodo(req.usuario, desde, hasta);
  const wb = new ExcelJS.Workbook(); wb.creator = "FOOAX";
  const AURORA = "FFF1228E", RIO = "FF324AB6", VERDE = "FF0B7247", ROJO = "FF8E0019";
  const MONEDA = '"$"#,##0.00';
  const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const nomDia = (f) => { const [y, m, dd] = f.split("-").map(Number);
    return DIAS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]; };

  const hoja = (nombre, titulo, cols) => {
    const s = wb.addWorksheet(nombre);
    const ultima = String.fromCharCode(64 + cols.length);
    s.mergeCells("A1:" + ultima + "1");
    const t = s.getCell("A1");
    t.value = titulo;
    t.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
    t.alignment = { horizontal: "center", vertical: "middle" };
    s.getRow(1).height = 24;
    const hr = s.getRow(2);
    cols.forEach(([h, w], i) => {
      const c = hr.getCell(i + 1); c.value = h; s.getColumn(i + 1).width = w;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    s.getRow(2).height = 22;
    s.views = [{ state: "frozen", ySplit: 2 }];
    return s;
  };
  const rotulo = "del " + desde + " al " + hasta;

  // ---- 1. RESUMEN DÍA POR DÍA. Es la hoja que contesta "¿cuánto se fue?".
  const r = hoja("Resumen por día", "FOOAX · MOVIMIENTO " + rotulo.toUpperCase() + " · SIN CORTE",
    [["Día", 12], ["Fecha", 12], ["Clientas", 10], ["Cobranza", 14], ["Garantías", 13],
     ["Solidario", 13], ["Otras entradas", 15], ["Salidas", 14], ["Neto del día", 15]]);
  let f = 3;
  for (const x of d.porDia) {
    const fila = r.getRow(f++);
    fila.getCell(1).value = nomDia(x.fecha);
    fila.getCell(2).value = x.fecha;
    fila.getCell(3).value = x.clientas;
    [x.pago, x.garantia, x.solidario, x.entradas, x.salidas, x.neto].forEach((v, i) => {
      const c = fila.getCell(4 + i); c.value = v; c.numFmt = MONEDA;
    });
    fila.getCell(8).font = { color: { argb: ROJO } };
    fila.getCell(9).font = { bold: true, color: { argb: x.neto < 0 ? ROJO : VERDE } };
  }
  const tot = r.getRow(f + 1);
  tot.getCell(1).value = "TOTAL";
  tot.getCell(1).font = { bold: true };
  [d.total.pago, d.total.garantia, d.total.solidario, d.total.entradas, d.total.salidas,
   d.total.pago + d.total.garantia + d.total.solidario + d.total.entradas - d.total.salidas]
    .forEach((v, i) => { const c = tot.getCell(4 + i); c.value = v; c.numFmt = MONEDA; c.font = { bold: true }; });

  // ---- 2. COBRANZA CLIENTA POR CLIENTA, con su día.
  const c2 = hoja("Cobranza", "FOOAX · COBRANZA CLIENTA POR CLIENTA " + rotulo,
    [["Fecha", 12], ["Día", 11], ["Ejecutivo", 13], ["Centro", 20], ["Clienta", 30], ["Socio", 15],
     ["Producto", 16], ["Pago", 13], ["Garantía", 12], ["Solidario", 12], ["Total", 13],
     ["Forma", 14], ["Corregido por Dirección", 20]]);
  f = 3;
  for (const x of d.cobranza) {
    const fila = c2.getRow(f++);
    [x.fecha, nomDia(x.fecha), x.ejecutivo, x.centro, x.clienta, x.socio, x.producto].forEach((v, i) => (fila.getCell(i + 1).value = v));
    [x.pago, x.garantia, x.solidario, x.total].forEach((v, i) => { const c = fila.getCell(8 + i); c.value = v; c.numFmt = MONEDA; });
    fila.getCell(12).value = x.forma;
    fila.getCell(13).value = x.anulado ? "ANULADA" : x.corregido ? "Corregida" : "";
    if (x.corregido || x.anulado) fila.getCell(13).font = { bold: true, color: { argb: ROJO } };
  }

  // ---- 3. OTROS MOVIMIENTOS: lo que entra fuera de la ficha y todo lo que sale.
  const c3 = hoja("Entradas y salidas", "FOOAX · ENTRADAS Y SALIDAS " + rotulo,
    [["Fecha", 12], ["Día", 11], ["Entra/Sale", 11], ["Tipo", 24], ["Concepto", 34],
     ["Clienta", 28], ["Socio", 15], ["Crédito", 16], ["Ejecutivo", 13], ["Monto", 14], ["Método", 14],
     ["Registró", 14], ["Folio", 16], ["ANULADO", 12]]);
  f = 3;
  for (const x of d.otros) {
    const fila = c3.getRow(f++);
    [x.fecha, nomDia(x.fecha), x.entrada ? "ENTRA" : "SALE", x.tipo, x.concepto,
     x.clienta, x.socio, x.producto || "", x.ejecutivo].forEach((v, i) => (fila.getCell(i + 1).value = v));
    const c = fila.getCell(10); c.value = x.monto; c.numFmt = MONEDA;
    c.font = { bold: true, color: { argb: x.entrada ? VERDE : ROJO } };
    fila.getCell(3).font = { bold: true, color: { argb: x.entrada ? VERDE : ROJO } };
    fila.getCell(11).value = x.metodo;
    fila.getCell(12).value = x.registradoPor;
    fila.getCell(13).value = x.folio;
    if (x.anulado) {
      // Anulado: se ve, no cuenta. Gris y con su letrero, para que nadie lo sume.
      fila.getCell(14).value = "ANULADO";
      fila.getCell(14).font = { bold: true, color: { argb: ROJO } };
      for (let i = 1; i <= 13; i++) fila.getCell(i).font = { ...(fila.getCell(i).font || {}), color: { argb: "FF9A93AC" }, strike: true };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Movimiento FOOAX ${desde} al ${hasta}.xlsx"`);
  res.end(Buffer.from(buf));
});

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
        const tipo = tipoDeMov(m) || "Otro";
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
    // `carteraViva` solo calcula los créditos ACTIVOS, y la llave es
    // socio+producto: al renovar, el crédito viejo comparte llave con el nuevo
    // y heredaba SUS números. Por eso el 10-ago la tarjeta del crédito de baja
    // de BLANCA VERONICA decía «pagó $288 esta sem.» de un ciclo ya cerrado.
    // Un crédito de baja no tiene abonos vivos: su historia va en «Ver pagos».
    if (c.activa === false || c.estatus === "BAJA")
      return { ...c, pagado: 0, liquidado: 0, saldoActual: c.saldo || 0 };
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
  const lista = [...mapa.values()]
    .map((x) => ({ centro: x.centro, clientas: x.clientas, ejecutivos: [...x.ejecutivos] }))
    .sort((a, b) => a.centro.localeCompare(b.centro, "es"));
  // C-0 = CRÉDITO INDIVIDUAL. Arriba se salta al armar el mapa —no es un grupo
  // de verdad— pero tiene que estar en la lista para poder dar de alta una
  // clienta individual. Sin él, el alta la rechazaba con "ese centro no existe"
  // aunque la validación sí lo acepte. Lo cachó Karina el 7-ago.
  const individuales = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA"
    && /^c-?0$/i.test(String(c.centro || "").trim())).length;
  lista.unshift({ centro: "C-0", clientas: individuales, ejecutivos: [], individual: true });
  return lista;
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
  // FECHA DE DESEMBOLSO (Karina, 12-ago). Sin ella el sistema no puede saber
  // que un crédito futuro aún no debe: PILAR PEREZ se renovó con desembolso al
  // 28-ago, el re-crédito no cargó la fecha y salió en la mora tres semanas
  // antes de recibir el dinero. Puede ser futura — ese es justo el caso.
  const desembolso = String(b.desembolso || "").slice(0, 10);
  if (desembolso && !/^\d{4}-\d{2}-\d{2}$/.test(desembolso))
    return res.status(400).json({ error: "La fecha de desembolso no se entiende (usa el calendario)." });
  // DÍA DE PAGO: el que digan, o el del centro. Sin día la clienta queda fuera
  // de la mora semanal (invisible) — es justo lo que no debe pasar.
  const diaPagoAlta = String(b.diaPago || "").trim().toUpperCase();
  if (diaPagoAlta && !idxDia(diaPagoAlta))
    return res.status(400).json({ error: "Ese día de pago no existe (Lunes a Sábado)." });
  const clienta = {
    id, nombre, producto: productoAlta, centro, ejecutivo,
    saldo: Number(b.saldo) || 0, cuota: Number(b.cuota) || 0, plazo: Number(b.plazo) || 0,
    mora: 0, estatus: "VIGENTE", semana: 0,
    desembolso: desembolso || null,
    diaPago: diaPagoAlta || diaDelCentro(centro) || null,
  };
  store.agregarCambioPadron({
    tipo: "alta", id, producto: clienta.producto, clienta,
    fecha: hoyMX(), por: req.usuario.nombre, ts: Date.now(),
  });
  refrescarPadron();
  // AVISO DE COBROS QUE YA TRAÍA. Cuando se da de alta a una clienta a la que la
  // ejecutiva YA le cobró (el caso de "Agregar clienta nueva" en la app), hay
  // dos formas de equivocarse y ninguna se ve:
  //   1. capturar el saldo que debe HOY en vez del ORIGINAL → el sistema le
  //      resta el pago otra vez y la clienta queda debiendo de menos;
  //   2. escribir el producto distinto al del cobro → el pago se queda huérfano.
  // Se contesta con lo que de verdad quedó, para que se vea en el momento.
  const yaCobrado = cobranzaSinCredito(req.usuario, corteSaldos())
    .filter((x) => String(x.socio) === id);
  const info = infoCredito(carteraViva(req.usuario), clienta);
  res.json({ ok: true, clienta,
    saldoCapturado: clienta.saldo,
    yaLePagaron: Math.round((info.pagado || 0) * 100) / 100,
    saldoQuedaEn: Math.round((info.saldoActual || 0) * 100) / 100,
    // Cobros de ESE socio que siguen sin empatar: casi siempre el producto se
    // escribió distinto.
    cobrosQueSiguenSueltos: yaCobrado.map((x) => ({ producto: x.producto, monto: x.pago })),
  });
});

app.post("/api/clientes/baja", requiere("direccion", "admin"), (req, res) => {
  if (req.usuario.test) return res.status(400).json({ error: "La cuenta de PRUEBA no puede dar de baja en el padrón real." });
  const b = req.body || {};
  const id = String(b.id || "").trim();
  const motivo = MOTIVOS_BAJA.includes(b.motivo) ? b.motivo : null;
  if (!id) return res.status(400).json({ error: "Falta el número de socio." });
  if (!motivo) return res.status(400).json({ error: "Elige un motivo de baja válido." });
  // El crédito tiene que EXISTIR. Antes se guardaba el cambio a ciegas: una baja
  // con el producto mal escrito no tocaba a nadie y aun así contestaba "ok", así
  // que quien la dio se quedaba creyendo que la clienta salió (5-ago).
  const prodBaja = (b.producto || "").trim();
  const objetivo = PADRON.filter((c) => String(c.id) === id
    && (!prodBaja || norm(c.producto) === norm(prodBaja)));
  if (!objetivo.length) return res.status(400).json({
    error: prodBaja ? "No encuentro ese crédito (revisa socio y producto)." : "No encuentro esa clienta." });
  store.agregarCambioPadron({
    tipo: "baja", id, producto: prodBaja, motivo,
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
// OJO: ya existe un `cuotaDe(key)` que busca por llave de captura. Este es otro:
// toma el CRÉDITO. Nombres distintos a propósito — el choque dejó `faltantes` en 0.
function cuotaDelCredito(c) { return Number(c.cuota) || 0; }
// TERMINÓ: la clienta ya no debe nada. Monse pidió el 4-ago que la app «aplique
// el término del crédito y no lo siga reflejando semanas siguientes a su
// término». Un crédito en cero deja de esperar cuota, sale del semáforo activo y
// del cálculo de mora — ya no hay nada que cobrarle.
// Cuándo debía terminar de pagar: fecha de desembolso + plazo. La plantilla del
// 4-ago ya trae las dos cosas en el 100% de los créditos.
function finDelPlazo(c) {
  const d = String(c.desembolso || "").slice(0, 10);
  const pl = Number(c.plazo) || 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || pl <= 0) return null;
  const f = new Date(d + "T12:00:00");
  // Los semanales van en semanas; MAGNUS y los mensuales, en meses.
  if (/mes/i.test(String(c.unidad || "")) || esCuotaVariable(c.producto)) f.setMonth(f.getMonth() + pl);
  else f.setDate(f.getDate() + pl * 7);
  return f.toISOString().slice(0, 10);
}
// ATRASO EN NÚMERO DE PAGOS. Corrección del 4-ago: el PLAZO NO ES UNA FECHA
// LÍMITE, es un NÚMERO DE PAGOS. Si una clienta falta tres semanas, su crédito
// de 24 pagos se recorre a 27 semanas — no «se venció». Lo aclaró la Ing. Monse
// al cotejar las fechas de desembolso: le coincidían, y tenía razón.
// Lo que sí mide un atraso real es comparar pagos CONTRA pagos:
//   restantes = saldo ÷ cuota      (la misma derivación del «pago 13 de 18»)
//   hechos    = plazo − restantes
//   debió     = min(plazo, periodos transcurridos desde el desembolso)
//   ATRASO    = debió − hechos
// OJO: esto supone que la fecha de desembolso es la del CICLO ACTUAL. Si al
// renovar se conserva la del crédito original, los periodos salen de más y el
// atraso se infla. Falta confirmarlo con Monse; por eso se reporta como dato a
// verificar y no como un veredicto de cartera vencida.
function atrasoEnPagos(c, info) {
  const d = String(c.desembolso || "").slice(0, 10);
  const pl = Number(c.plazo) || 0, q = cuotaDelCredito(c);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || pl <= 0 || q <= 0) return null;
  if (!info || info.saldoActual <= 0.009) return null;
  const dias = Math.round((new Date(hoyMX() + "T12:00") - new Date(d + "T12:00")) / 86400000);
  if (dias < 0) return null;
  const mensual = /mes/i.test(String(c.unidad || "")) || esCuotaVariable(c.producto);
  const transcurridos = mensual ? Math.floor(dias / 30.44) : Math.floor(dias / 7);
  const restantes = Math.round(info.saldoActual / q);
  const hechos = pl - restantes;
  const debio = Math.min(pl, transcurridos);
  return { atraso: debio - hechos, hechos, debio, restantes, transcurridos, plazo: pl };
}
// TODAVÍA NO LE ENTREGAN EL DINERO: no puede deber, no se le espera cuota.
// (Karina, 12-ago: «asegúrate que sincronice con la mora en el tablero y lo
// demás».) La mora semanal ya excluía estos créditos; la CARTERA no: sumaban a
// lo esperado y a pendiente de cobro, y si su día ya había pasado, el semáforo
// los pintaba EN MORA — tres semanas antes del desembolso.
// EL DÍA DE PAGO DEL CENTRO, para heredarlo en las altas (Karina, 12-ago:
// «cuando den de alta traiga ese dato y no nos falle la mora»). Primero el que
// se registró con el centro; si no, el día ÚNICO de sus créditos activos (48 de
// 50 centros cobran todos el mismo día). Si el centro cobra en días mezclados,
// no se adivina: se pide en el formulario.
function diaDelCentro(centro) {
  const n0 = norm(String(centro || "").split("·").pop());
  if (!n0) return "";
  for (const cb of store.cambiosPadron())
    if (cb.tipo === "centro" && norm(cb.centro) === n0 && idxDia(cb.dia)) return String(cb.dia).toUpperCase();
  const dias = new Set();
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    if (norm(String(c.centro || "").split("·").pop()) !== n0) continue;
    const d = String(c.diaPago || "").trim().toUpperCase();
    if (idxDia(d)) dias.add(d);
  }
  return dias.size === 1 ? [...dias][0] : "";
}
function aunNoDesembolsa(c) {
  const d = String(c.desembolso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > hoyMX();
}
function estaTerminado(c, info) {
  if (/termino|liquidad/i.test(String(c.estatus || ""))) return true;
  return !!info && (info.saldoActual || 0) <= 0.009;
}
function semaforoDe(c, info, pagoSemana) {
  // Antes preguntaba por `estatus === "VENCIDA"` (con A) y esa palabra NO EXISTE
  // en la plantilla: dice "VENCIDO", "CREDITO VENCIDO A RECUPERAR". Resultado: 29
  // vencidos no se marcaban como vencidos (solo los cachaba la mora capturada).
  // Terminado gana sobre cualquier otro estado: si ya no debe, no está vencida
  // ni en mora aunque traiga la marca de antes.
  if (estaTerminado(c, info)) return "liquidada";
  if (esVencido(c) || Number(c.mora) > 0) return "vencida";
  if (info.saldoActual <= 0) return "liquidada";
  // Cuota VARIABLE (Magnus): su cuota baja cada periodo, así que compararla
  // contra la del padrón daría un semáforo falso. Se aparta hasta que exista
  // el módulo de intereses.
  if (esCuotaVariable(c.producto)) return "cuotaVariable";
  // Aún no desembolsa: no es mora ni parcial — está pendiente de que le
  // entreguen su dinero, no de que pague.
  if (aunNoDesembolsa(c)) return "pendiente";
  // "pendiente" NO es mora: cada centro cobra en su día, y el lunes casi nadie
  // ha pagado todavía. Ahora que el crédito trae su DÍA, se puede separar de
  // verdad (lo pidió Anel el 4-ago): si su día ya PASÓ y no cubrió, eso sí es
  // mora; si todavía no le toca —o le toca hoy—, es pendiente de cobro.
  const dc = idxDia(c.diaPago), hy = idxHoy();
  if (pagoSemana <= 0) return (dc > 0 && dc < hy) ? "enMora" : "pendiente";
  if (dc > 0 && dc < hy && cuotaDelCredito(c) > 0 && pagoSemana + 0.01 < cuotaDelCredito(c)) return "enMora";
  if (cuotaDelCredito(c) > 0 && pagoSemana + 0.01 < cuotaDelCredito(c)) return "parcial";
  return "alCorriente";
}
// VERIFICADOR DE DESGLOSE (Karina, 12-ago: «checa si pasó con otras más —
// necesito que lo prevés»). El hoyo de YOALI se notó porque lo APLICADO al
// saldo no se podía LISTAR en Ver pagos. Esto revisa esa igualdad para TODOS
// los créditos de una pasada: lo que carteraViva aplicó vs lo que el historial
// alcanza a mostrar. Si vuelven a divergir por cualquier rincón, aquí truena.
function verificarDesglose(usuario) {
  const corte = corteSaldos();
  const cv = carteraViva(usuario);
  const { porFecha } = pagosDeLaSemana(usuario, corte);
  const listable = {};
  for (const clave in porFecha)
    for (const f in porFecha[clave])
      if (f >= corte) listable[clave] = (listable[clave] || 0) + (porFecha[clave][f].p || 0);
  const ts0 = corteTs();
  const vivosPorSocio = {};
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    (vivosPorSocio[String(c.id)] = vivosPorSocio[String(c.id)] || []).push(c);
  }
  for (const m of store.todosMovimientos()) {
    if (m.anulado) continue;
    if (!/^(liquidaci|recuperaci)/i.test(tipoDeMov(m) || "")) continue;
    if (!(String(m.fecha) >= corte || (Number(m.ts) || 0) > ts0)) continue;
    const soc = socioDeMov(m); if (!soc) continue;
    const monto = Number(m.monto) || 0;
    if (m.producto) listable[claveCredito(soc, m.producto)] = (listable[claveCredito(soc, m.producto)] || 0) + monto;
    else for (const cr of (vivosPorSocio[soc] || []))
      listable[claveCredito(cr.id, cr.producto)] = (listable[claveCredito(cr.id, cr.producto)] || 0) + monto;
  }
  let revisados = 0;
  const rotos = [];
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    const info = infoCredito(cv, c);
    const aplicado = Math.round(((info.pagado || 0) + (info.liquidado || 0)) * 100) / 100;
    if (aplicado <= 0.009) continue;
    revisados++;
    const lst = Math.round((listable[claveCredito(c.id, c.producto)] || 0) * 100) / 100;
    if (lst + 0.01 < aplicado)
      rotos.push({ socio: String(c.id), nombre: c.nombre, producto: c.producto,
        ejecutivo: c.ejecutivo, aplicado, listable: lst,
        faltaEnLaLista: Math.round((aplicado - lst) * 100) / 100 });
  }
  return { revisados, rotos };
}
// ===================================================================
// MOTOR DE REGLAS · intereses por producto (Fase 3)
// El cálculo NO vive aquí: vive en data/reglas-productos.json, que edita
// Dirección. Estas rutas solo lo exponen.
// ===================================================================
app.get("/api/reglas", requiere("direccion", "admin"), (req, res) => {
  const R = motor.reglas(true);   // relee al vuelo: si acaban de editar una tasa, se ve
  const listos = [], esperando = [];
  for (const p of R.productos || []) {
    const fila = { clave: p.clave, nombre: p.nombre, metodo: p.metodo,
      periodicidad: p.periodicidad, tasaMensual: p.tasaMensual,
      montoMin: p.montoMin || null, montoMax: p.montoMax || null,
      plazos: p.plazos || null, fuente: p.fuente || null,
      advertencia: p.advertencia || null, faltaPara: p.faltaPara || null };
    (p.pendiente || p.tasaMensual == null ? esperando : listos).push(fila);
  }
  res.json({ version: R.version, vigenteDesde: R.vigenteDesde, iva: R.iva,
    redondeo: R.redondeo, moratorio: R.moratorio,
    listos, esperando, autoprueba: motor.autoprueba() });
});

// Simula un crédito y devuelve su tabla de amortización completa.
app.get("/api/reglas/simular", requiere("direccion", "admin"), (req, res) => {
  const q = req.query || {};
  const dias = String(q.diasPorPeriodo || "").trim();
  const t = motor.tablaAmortizacion({
    producto: q.producto, monto: Number(q.monto), plazo: Number(q.plazo),
    dias: Number(q.dias) || 0,
    diasPorPeriodo: dias ? dias.split(",").map((x) => Number(x.trim())) : null,
  });
  if (!t.ok) return res.status(400).json(t);
  res.json(t);
});

app.get("/api/desglose", requiere("direccion", "admin"), (req, res) => {
  res.json(verificarDesglose(req.usuario));
});

// QUIÉNES SON (Karina, 14-ago: «que pueda tocar estos y vea qué clientas
// son»). La lista de cada color del semáforo. Usa EXACTAMENTE el mismo
// clasificador que cuenta los chips (semaforoDe con los mismos insumos), así
// el número del chip y el largo de la lista no pueden diferir jamás.
app.get("/api/cartera/semaforo", requiere("direccion", "admin"), (req, res) => {
  const estado = String(req.query.estado || "");
  const validos = ["alCorriente", "parcial", "pendiente", "enMora", "vencida", "liquidada", "cuotaVariable"];
  if (!validos.includes(estado))
    return res.status(400).json({ error: "Estado desconocido. Usa: " + validos.join(", ") });
  const cv = carteraViva(req.usuario);
  const sem = pagosDeLaSemana(req.usuario);
  const r2 = (n) => Math.round(n * 100) / 100;
  const filas = [];
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    const info = infoCredito(cv, c);
    const pagoSemana = sem.pago[claveCredito(c.id, c.producto)] || 0;
    if (semaforoDe(c, info, pagoSemana) !== estado) continue;
    const cuota = Number(c.cuota) || 0;
    filas.push({ socio: String(c.id), nombre: c.nombre, centro: c.centro, ejecutivo: c.ejecutivo,
      producto: c.producto, diaPago: c.diaPago || null, cuota,
      pagoSemana: r2(pagoSemana), saldoActual: r2(info.saldoActual),
      faltante: r2(Math.max(0, Math.min(cuota || Infinity, cuota) - pagoSemana)),
      cuotasSinPagar: Number(c.mora) > 0 ? Number(c.mora) : 0 });
  }
  // Orden por lo que DECIDE en cada color: en mora y parcial, lo que falta;
  // vencidas y las demás, el dinero en juego; al corriente, por nombre.
  if (estado === "enMora" || estado === "parcial") filas.sort((a2, b2) => b2.faltante - a2.faltante);
  else if (estado === "alCorriente") filas.sort((a2, b2) => String(a2.nombre).localeCompare(String(b2.nombre), "es"));
  else filas.sort((a2, b2) => b2.saldoActual - a2.saldoActual);
  res.json({ estado, total: filas.length, filas });
});

app.get("/api/cartera", requiere("direccion", "admin"), (req, res) => {
  const cv = carteraViva(req.usuario);
  const sem = pagosDeLaSemana(req.usuario);          // ventana semanal (lunes → hoy)
  const activos = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA");
  const acc = { cartera: 0, moraMonto: 0, moraCreditos: 0, saldoPromedio: 0, liquidadas: 0 };
  const semaforo = { alCorriente: 0, parcial: 0, pendiente: 0, enMora: 0, vencida: 0, liquidada: 0, cuotaVariable: 0 };
  const porEjec = {}, inconsistentes = [], vencidas = [];
  let conSaldo = 0, esperado = 0;
  // A LA FECHA vs SEMANA COMPLETA. El cumplimiento se medía contra la semana
  // entera, así que un martes marcaba 10% aunque la cobranza fuera perfecta:
  // comparaba dos días contra cinco. Ahora se mide contra lo que YA debió entrar.
  let esperadoHoy = 0, moraReal = 0, pendienteCobro = 0;
  const HOY_IDX = idxHoy();
  // Un crédito está EN RECUPERACIÓN si trae cuotas sin pagar (columna `mora` de
  // la plantilla, que Monse definió como «las cuotas que no ha pagado el
  // cliente») o si ya está vencido. Su dinero cuenta SOLO como recuperación.
  const enRecuperacion = (c) => Number(c.mora) > 0 || esVencido(c);
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
      if (!esCuotaVariable(c.producto) && !esVencido(c) && !aunNoDesembolsa(c)) {
        const cu = Math.min(Number(c.cuota) || 0, info.saldoActual);
        esperado += cu;
        const d = idxDia(c.diaPago);
        // Su día ya llegó (o es hoy) → cuenta en lo esperado A LA FECHA.
        // Sin día registrado se cuenta también: es lo conservador, no esconde nada.
        if (d === 0 || d <= HOY_IDX) esperadoHoy += cu;
        const falta = Math.max(0, cu - pagoSemana);
        // MORA REAL = su día ya PASÓ y no cubrió su cuota.
        if (d > 0 && d < HOY_IDX) moraReal += falta;
        else pendienteCobro += falta;   // aún no le toca, o le toca hoy
      }
    }
    if (info.saldoActual <= 0) acc.liquidadas++;
    const mora = Number(c.mora) > 0 ? Number(c.mora) : 0;
    // LA COLUMNA `mora` DEL PADRÓN ES UN CONTEO, no pesos: «las cuotas que no
    // ha pagado el cliente» (Monse). En el padrón real vale 12, 21, 63, 229 —
    // con cuotas de $320. Sumarla y pintarla como "$21 de mora" era enseñar un
    // número falso. El DINERO en riesgo es otro: el saldo vivo de ese crédito.
    if (mora > 0) { acc.moraMonto += mora; acc.moraCreditos++; vencidas.push({ socio: String(c.id), nombre: c.nombre, centro: c.centro, ejecutivo: c.ejecutivo, producto: c.producto, cuotasSinPagar: mora, saldoActual: info.saldoActual }); }
    if (enRecuperacion(c)) acc.enRiesgo = (acc.enRiesgo || 0) + info.saldoActual;
    const np = numeroDePago(c, info.saldoActual);
    if (np && np.inconsistente) inconsistentes.push({ socio: String(c.id), nombre: c.nombre, producto: c.producto, ejecutivo: c.ejecutivo, saldo: c.saldo || 0, cuota: c.cuota || 0, plazoPadron: np.plazo, plazoReal: np.restantes });
    const e = porEjec[c.ejecutivo || "—"] || (porEjec[c.ejecutivo || "—"] = { nombre: c.ejecutivo || "—", creditos: 0, cartera: 0, mora: 0, esperado: 0, esperadoALaFecha: 0, pendiente_: 0, cobrado: 0, alCorriente: 0, parcial: 0, pendiente: 0, enMora: 0, vencida: 0, liquidada: 0, cuotaVariable: 0 });
    e.creditos++; e.cartera += info.saldoActual; e.moraAcum = (e.moraAcum || 0) + mora; e[s]++;
    if (info.saldoActual > 0 && !esCuotaVariable(c.producto) && !esVencido(c) && !aunNoDesembolsa(c)) {
      const cuE = Math.min(Number(c.cuota) || 0, info.saldoActual);
      const dE = idxDia(c.diaPago);
      e.esperado += cuE;
      if (dE === 0 || dE <= HOY_IDX) e.esperadoALaFecha += cuE;
      if (dE > 0 && dE < HOY_IDX) e.mora += Math.max(0, cuE - pagoSemana);
      else e.pendiente_ += Math.max(0, cuE - pagoSemana);
    }
    // Mismo criterio por ejecutiva: lo de un crédito en mora o vencido va a su
    // recuperación, no a su cobranza.
    if (enRecuperacion(c)) e.recuperacion = (e.recuperacion || 0) + pagoSemana;
    else e.cobrado += pagoSemana;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  // LA MORA DE LA TARJETA ES LA MISMA DEL EXCEL (Karina, 15-ago: «tiene que
  // llevar la mora lo que tenemos en los exceles»). Antes esta tarjeta la
  // calculaba aparte —cuota menos lo pagado ESTA semana— y el reporte usaba el
  // método de Monse —arrastre desde el corte, topado a una cuota y al saldo—.
  // Con pagos reales los dos números se separan: la que adelantó la semana
  // pasada salía debiendo aquí y no allá. Ahora el reporte MANDA y la tarjeta
  // lo muestra, así no puede haber dos verdades.
  //   · "mora · ya venció"  = lo vencido a la fecha (lo comparable con Monse)
  //   · "aún no vence"      = los días de la semana que todavía no llegan
  const mw = moraDeLaSemana(req.usuario);
  const moraPorEjec = {};
  for (const g of (mw.dias || [])) {
    if (!g.vencido) continue;
    for (const x of (g.filas || []))
      moraPorEjec[x.ejecutivo || "—"] = r2((moraPorEjec[x.ejecutivo || "—"] || 0) + (x.faltante || 0));
  }
  moraReal = mw.totalVencido;
  pendienteCobro = mw.totalPorVencer;
  // COBRANZA vs RECUPERACIÓN (dictado de Monse, 4-ago, opción A):
  // «recuperación es todo lo entrante, tanto de créditos de mora como de créditos
  // vencidos», y ese dinero cuenta SOLO como recuperación — NO se suma también a
  // la cobranza. Antes la recuperación se definía por la ETIQUETA que ponía la
  // ejecutiva; ahora la define el ESTADO del crédito, que es lo que ella dictó.
  // Un crédito está «en mora» cuando trae cuotas sin pagar (columna `mora` de la
  // plantilla = «las cuotas que no ha pagado el cliente», también opción A).
  let cobrado = 0, recupPagos = 0;
  for (const c of activos) {
    const pw = sem.pago[claveCredito(c.id, c.producto)] || 0;
    if (enRecuperacion(c)) recupPagos += pw;   // NO entra a cobranza: solo recuperación
    else cobrado += pw;
  }
  // Las liquidaciones y recuperaciones registradas como movimiento siguen
  // contando en recuperación, como siempre: es dinero del crédito que entra
  // FUERA de la cuota. No se tocan — lo único que cambió es que los PAGOS de un
  // crédito en mora o vencido ahora también son recuperación y ya no cobranza.
  const recuperacion = recupPagos + Object.values(liquidacionesDeLaSemana(req.usuario)).reduce((a, b) => a + b, 0);
  res.json({
    corte: corteSaldos(), hoy: hoyMX(), lunes: lunesDeLaSemana(hoyMX()),
    creditosActivos: activos.length, conSaldo,
    cartera: r2(acc.cartera),
    saldoPromedio: conSaldo ? r2(acc.cartera / conSaldo) : 0,
    // `moraMonto`/`moraPorcentaje` mezclaban unidades (cuotas entre pesos) y ya
    // no se enseñan; quedan por compatibilidad. Los buenos son estos dos:
    moraCuotasTotal: acc.moraMonto, moraCreditos: acc.moraCreditos,
    carteraEnRiesgo: r2(acc.enRiesgo || 0),
    riesgoPorcentaje: acc.cartera > 0 ? r2(((acc.enRiesgo || 0) / acc.cartera) * 100) : 0,
    moraMonto: r2(acc.moraMonto),
    moraPorcentaje: acc.cartera > 0 ? r2((acc.moraMonto / acc.cartera) * 100) : 0,
    liquidadas: acc.liquidadas,
    // MORA DE LA SEMANA vs RECUPERACIÓN (corazón de la Fase 2, versión
    // provisional hasta el dictado de Monse): esperado = suma de cuotas de los
    // créditos con saldo; mora = lo que faltó de ese esperado.
    esperadoSemana: r2(esperado),
    // Lo que YA debió entrar a la fecha: solo los centros cuyo día ya llegó.
    esperadoALaFecha: r2(esperadoHoy),
    cobradoSemana: r2(cobrado),
    // PENDIENTE DE COBRO ≠ MORA (corrección de Anel, 4-ago). Pendiente es la
    // amortización cuyo día no ha llegado o llega hoy: operación normal. Mora es
    // la que YA venció sin cubrirse: ese es el número de riesgo.
    pendienteSemana: r2(pendienteCobro),
    moraSemana: r2(moraReal),
    // De dónde sale la mora: el MISMO reporte que baja en Excel. Si algún día
    // vuelven a divergir, este campo delata cuál se movió.
    moraFuente: "reporte de la semana (método Monse)",
    moraCreditosSemana: (mw.dias || []).reduce((n, g) => n + (g.vencido ? (g.filas || []).length : 0), 0),
    moraLunes: mw.lunes,
    // Se conserva el cálculo anterior con su nombre viejo para no romper nada que
    // lo lea, pero el tablero ya no lo muestra como "mora".
    esperadoMenosCobrado: r2(Math.max(0, esperado - cobrado)),
    recuperacionSemana: r2(recuperacion),
    // El cumplimiento se mide contra lo esperado A LA FECHA, no contra la semana
    // completa: si no, siempre se ve mal hasta el viernes.
    cumplimiento: esperadoHoy > 0 ? r2((cobrado / esperadoHoy) * 100) : 0,
    cumplimientoSemana: esperado > 0 ? r2((cobrado / esperado) * 100) : 0,
    semaforo,
    porEjec: Object.values(porEjec).map((e) => ({ ...e, cartera: r2(e.cartera), mora: r2(e.moraAcum || 0),
      esperado: r2(e.esperado), esperadoALaFecha: r2(e.esperadoALaFecha), cobrado: r2(e.cobrado),
      moraSemana: moraPorEjec[e.nombre] || 0, pendienteSemana: r2(e.pendiente_),
      cumplimiento: e.esperadoALaFecha > 0 ? r2((e.cobrado / e.esperadoALaFecha) * 100) : 0 })),
    inconsistentes, vencidas: vencidas.sort((a, b) => b.saldoActual - a.saldoActual).slice(0, 50),
    // Liquidaciones que entraron a la caja pero no le bajaron el saldo a nadie.
    liquidacionesSinClienta: liquidacionesSinClienta(req.usuario, corteSaldos()),
    // Las que SÍ traen clienta pero no dicen de cuál de sus créditos: el sistema
    // las reparte en orden y le baja el saldo al que no es. Son las de antes del
    // 8-ago; se listan para corregirlas una por una (Karina, 8-ago).
    liquidacionesSinCredito: liquidacionesSinCredito(req.usuario, corteSaldos()),
    // Abonos capturados DESPUÉS del corte pero con fecha anterior a él. Ya
    // descuentan (antes se perdían en silencio), pero se avisan: mueven saldos
    // de días que la plantilla daba por cerrados, y eso Monse tiene que verlo.
    // Fichas cobradas que no empatan con ningún crédito: el dinero está en la
    // caja pero no le bajó el saldo a nadie.
    cobranzaSinCredito: cobranzaSinCredito(req.usuario, corteSaldos()),
    // ¿Todo lo cobrado bajó de algún saldo? Es el control que sustituye a pedir
    // el Excel de Monse para comparar.
    conciliacion: conciliacionDeSaldos(req.usuario),
    movsAtrasados: movsAtrasadosQueSiCuentan(req.usuario, corteSaldos())
      .filter((m) => /^(liquidaci|recuperaci)/i.test(tipoDeMov(m)))
      .map((m) => { const s = socioDeMov(m); const cl = s && PADRON.find((c) => String(c.id) === String(s));
        return { folio: m.folio, fecha: m.fecha, monto: m.monto, socio: s || null,
          clienta: cl ? cl.nombre : null, registradoPor: m.registradoPor || null,
          capturado: new Date(Number(m.ts)).toISOString().slice(0, 10) }; })
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    // Créditos ATRASADOS EN NÚMERO DE PAGOS. Sustituye al aviso de «plazo
    // vencido» del 4-ago, que estaba mal planteado: trataba el plazo como fecha
    // límite cuando es un número de pagos. Ver atrasoEnPagos(). Se listan de 4
    // pagos de atraso en adelante para no marcar a la que trae una o dos
    // semanas flojas, que es normal y ya la cacha el semáforo.
    atrasados: activos.map((c) => {
      const info = infoCredito(cv, c);
      const a = atrasoEnPagos(c, info);
      if (!a || a.atraso < 4) return null;
      return { socio: String(c.id), nombre: c.nombre, producto: c.producto, ejecutivo: c.ejecutivo,
        centro: c.centro, saldo: r2(info.saldoActual), desembolso: String(c.desembolso).slice(0, 10),
        atraso: a.atraso, hechos: a.hechos, debio: a.debio, plazo: a.plazo };
    }).filter(Boolean).sort((a, b) => b.atraso - a.atraso),
    // El dictado de Monse LLEGÓ el 4-ago y ya está programado: mora = cuotas no
    // pagadas · recuperación por estado del crédito, contada una sola vez ·
    // activo recuperable, vigente y activo mora son ACTIVOS. Lo único que sigue
    // sin definir es dónde va CUENTA IRREGULAR REESTRUCTURA (1 crédito), y por
    // eso se nombra aparte en vez de dejar todo marcado como provisional.
    definicionMoraPendiente: false,
    definicionMoraFecha: "2026-08-04",
    estatusSinClasificar: [...new Set(activos
      .filter((c) => /irregular|reestructura/i.test(String(c.estatus || "")))
      .map((c) => String(c.estatus)))],
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
        const clave = claveDelPago(partes[0], partes[1]);
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
    const tipo = tipoDeMov(m) || "Otro";
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

// HISTORIAL DE PAGOS de un crédito: qué pagó, en qué fecha y quién lo capturó.
// Pedido por Karina el 5-ago: «cuando le piquen a una clienta que sepa lo que
// pagó y en qué fecha, para asegurarme de que sí se está bajando».
//
// Sirve además para explicar el saldo que «se le olvida» y regresa: el saldo
// vivo NO descuenta todo lo que la clienta ha pagado en su vida, sino lo pagado
// DESDE EL CORTE — porque el saldo de la plantilla ya trae descontado lo
// anterior. Por eso cada renglón dice si CUENTA o no contra el saldo de hoy: si
// un pago sale como «ya venía en la plantilla» y aun así el saldo no bajó, el
// problema está en la plantilla, no en la captura.
app.get("/api/credito/historial", soloAnelMonse, (req, res) => {
  const id = String(req.query.id || "").trim();
  const producto = String(req.query.producto || "").trim();
  if (!id) return res.status(400).json({ error: "Falta el número de socio." });
  // EL ACTIVO MANDA. Al renovar quedan DOS registros con el mismo socio y el
  // mismo producto —el viejo dado de baja y el nuevo—, y tomar el primero
  // mezclaba los dos: el saldo salía del registro VIEJO y lo abonado del
  // crédito VIVO. Por eso el 10-ago la tarjeta de BLANCA VERONICA decía el
  // disparate «saldo de la plantilla $288 − pagado desde el corte $288 = $2,712».
  const cand = PADRON.filter((x) => String(x.id) === id && (!producto || x.producto === producto));
  const c = cand.find((x) => x.activa !== false && x.estatus !== "BAJA")
    || cand.slice().sort((x, y) => String(y.alta_fecha || "").localeCompare(String(x.alta_fecha || "")))[0];
  if (!c) return res.status(404).json({ error: "No encuentro ese crédito." });
  const corte = corteSaldos();
  const clave = claveCredito(c.id, c.producto);
  const snaps = (store.respaldo().snapshots) || {};
  const permitidas = new Set(idsEjecutivos(req.usuario));
  const filas = [];
  const acum = (nodo, key, fecha, ejec) => {
    if (!nodo || typeof nodo !== "object") return;
    const p = nodo.pago || 0, g = nodo.garantia || 0, s = nodo.solidario || 0;
    if (p <= 0 && g <= 0 && s <= 0) return;
    const partes = String(key).split("|");
    if (claveDelPago(partes[0], partes[1]) !== clave) return;
    filas.push({ fecha, tipo: "pago", ejecutivo: ejec, pago: p, garantia: g, solidario: s,
      forma: nodo.forma || "E", cuenta: fecha >= corte });
  };
  for (const ej in snaps) {
    if (!permitidas.has(ej)) continue;
    for (const fecha in snaps[ej]) {
      let data = snaps[ej][fecha].snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
      // EN DOS NIVELES, como pagosDeLaSemana. `reg` guarda centro → clienta →
      // pago, y este recorrido era PLANO: le pasaba el CENTRO entero a acum(),
      // que no le encontraba pago y lo tiraba. Resultado: los pagos capturados
      // dentro de un centro NUNCA salían en «Ver pagos» — solo los individuales.
      // Lo destapó Karina el 12-ago con YOALI KAREN: su pago del lunes ($576,
      // centro OSHER) no aparecía, aunque el saldo sí lo descontaba.
      const acumPlano = (st) => {
        if (!st || typeof st !== "object") return;
        for (const k in st) {
          const nd = st[k];
          if (nd && typeof nd === "object" && ("pago" in nd || "forma" in nd))
            acum(nd, k, fecha, USUARIOS[ej] ? USUARIOS[ej].nombre : ej);
          else if (nd && typeof nd === "object")
            for (const kk in nd) acum(nd[kk], kk, fecha, USUARIOS[ej] ? USUARIOS[ej].nombre : ej);
        }
      };
      acumPlano(data && data.reg); acumPlano(data && data.regI);
    }
  }
  // Liquidaciones y recuperaciones: van por SOCIO, no por crédito.
  for (const m of (store.respaldo().movimientos || [])) {
    if (m.anulado || socioDeMov(m) !== String(c.id)) continue;
    const tipo = tipoDeMov(m);
    if (!/^(liquidaci|recuperaci)/i.test(tipo)) continue;
    // LA LIQUIDACIÓN ES DE SU CRÉDITO, NO DE TODOS (Karina, 12-ago): la de
    // YOALI ($2,880, Grupal-Basico 2) salía también en el «Ver pagos» de su
    // Grupal-Adicional, aunque ahí no descontó un peso. Si el movimiento dice
    // de cuál crédito es, solo se muestra en ese. Los viejos sin crédito se
    // siguen mostrando en todos: no hay forma de saber de cuál eran.
    if (m.producto && nprod(m.producto) !== nprod(c.producto)) continue;
    filas.push({ fecha: m.fecha, tipo: "liquidacion", ejecutivo: m.registradoPor || "—",
      pago: m.monto, garantia: 0, solidario: 0, forma: m.metodo || "efectivo",
      // Cuenta si es del corte en adelante O si se capturó DESPUÉS de fijar el
      // corte (fecha atrasada): la plantilla no pudo traerlo, así que sí baja
      // el saldo — y la tarjeta debe decirlo igual que lo aplica carteraViva.
      cuenta: String(m.fecha) >= corte || (Number(m.ts) || 0) > corteTs(), folio: m.folio });
  }
  // LO QUE LE CORRIGIÓ DIRECCIÓN, con su motivo (Karina, 7-ago). Un pago
  // anulado desaparece del historial —queda en cero y deja de sumar—, así que
  // sin esto la clienta se veía como si nunca hubiera pagado y nadie podía
  // explicar por qué. Aquí queda dicho: qué capturó la ejecutiva, en qué quedó,
  // quién lo cambió y por qué.
  const correcciones = [];
  for (const a of store.ajustesCobranza()) {
    if (!permitidas.has(a.ejecutivo)) continue;
    const p = String(a.clave).split("|");
    if (claveCredito(p[0], p[1]) !== clave) continue;
    const buscar = (d) => {
      if (!d) return null;
      if (d.regI && d.regI[a.clave]) return d.regI[a.clave];
      for (const cc in (d.reg || {})) if (d.reg[cc] && d.reg[cc][a.clave]) return d.reg[cc][a.clave];
      return null;
    };
    const leer = (crudo) => {
      const rec = store.snapshotsDeFecha(a.fecha, crudo)[a.ejecutivo];
      let d = rec && rec.snapshot;
      if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } }
      const n = buscar(d);
      return n ? { pago: n.pago || 0, garantia: n.garantia || 0, solidario: n.solidario || 0 } : null;
    };
    correcciones.push({
      fecha: a.fecha,
      ejecutivo: USUARIOS[a.ejecutivo] ? USUARIOS[a.ejecutivo].nombre : a.ejecutivo,
      anula: !!a.anula, campo: a.campo, monto: a.monto,
      capturo: leer(true),    // lo que capturó ella en su teléfono
      quedo: leer(false),     // en qué quedó ya con todas las correcciones
      motivo: a.motivo, por: a.por, ts: a.ts,
    });
  }
  correcciones.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const info = infoCredito(carteraViva(req.usuario), c);
  // EL DESCUADRE SE ANUNCIA SOLO (Karina, 12-ago: «si lo dan de alta tiene que
  // aparecer — chécalo»). El hoyo de YOALI se notó porque el resumen decía
  // $3,456 y los renglones sumaban $2,880: dinero aplicado que la lista no
  // enseñaba. Ese cotejo ahora lo hace la propia tarjeta en cada carga: si lo
  // aplicado es MÁS de lo que se alcanza a listar, viene `descuadre` con el
  // monto y el tablero lo pinta en rojo. Así el próximo hoyo de esta familia
  // no espera a que alguien lo note: se denuncia solo.
  const sumaListada = Math.round(filas.filter((x) => x.cuenta)
    .reduce((t, x) => t + (x.pago || 0), 0) * 100) / 100;
  const aplicado = Math.round(((info.pagado || 0) + (info.liquidado || 0)) * 100) / 100;
  const descuadre = (sumaListada + 0.01 < aplicado)
    ? Math.round((aplicado - sumaListada) * 100) / 100 : 0;
  res.json({
    socio: String(c.id), nombre: c.nombre, producto: c.producto, centro: c.centro,
    ejecutivo: c.ejecutivo, cuota: c.cuota || 0, corte,
    saldoPlantilla: c.saldo || 0, pagadoDesdeElCorte: info.pagado, liquidado: info.liquidado,
    saldoActual: info.saldoActual,
    // Lo pagado ANTES del corte no baja el saldo de hoy: ya venía descontado en
    // la plantilla. Se devuelve aparte para poder decirlo con todas sus letras.
    pagadoAntesDelCorte: Math.round(filas.filter((x) => !x.cuenta).reduce((s, x) => s + x.pago, 0) * 100) / 100,
    historial: filas,
    correcciones,
    descuadre,
  });
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
// ETIQUETA DE LA CLIENTA. Pedida por Karina el 7-ago: «meterle una etiqueta que
// diga RECUPERACIÓN para que puedan clasificar mejor la clienta». No cambia un
// solo peso — es una marca para saber de qué tipo es cada crédito, y viaja al
// teléfono de la ejecutiva para que ella también la vea.
const ETIQUETAS = ["Recuperación", "Renovación", "Reestructura", "Nueva", "Seguimiento especial"];
app.get("/api/etiquetas", requiere("direccion", "admin"), (req, res) => res.json({ etiquetas: ETIQUETAS }));
app.post("/api/creditos/etiqueta", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  const c = creditoActivo(b.id, b.producto);
  if (!c) return res.status(400).json({ error: "No encuentro ese crédito activo (revisa socio y producto)." });
  const cruda = String(b.etiqueta == null ? "" : b.etiqueta).trim();
  // Vacío = quitar la etiqueta. Es la única forma de deshacerlo.
  const etiqueta = cruda ? ETIQUETAS.find((e) => norm(e) === norm(cruda)) : "";
  if (cruda && !etiqueta)
    return res.status(400).json({ error: "Esa etiqueta no existe. Elige una de: " + ETIQUETAS.join(", ") });
  store.agregarCambioPadron({
    tipo: "ajuste", id: c.id, producto: c.producto, campos: { etiqueta },
    motivo: etiqueta ? ("Etiqueta: " + etiqueta) : "Se le quitó la etiqueta",
    fecha: hoyMX(), por: req.usuario.nombre, ts: Date.now(),
  });
  refrescarPadron();
  res.json({ ok: true, clienta: creditoActivo(c.id, c.producto) });
});

app.post("/api/creditos/ajuste", soloAnelMonse, (req, res) => {
  const b = req.body || {};
  const c = creditoActivo(b.id, b.producto);
  if (!c) return res.status(400).json({ error: "No encuentro ese crédito activo (revisa socio y producto)." });
  // El saldo es OPCIONAL: si viene vacío no se toca. Antes era obligatorio, así
  // que para solo REASIGNAR un crédito a otro ejecutivo había que volver a
  // teclear el saldo — y un dedazo ahí le cambiaba el dinero a la clienta.
  // Mover cartera y corregir un saldo son dos cosas distintas (30-jul).
  const traeSaldo = b.saldo != null && String(b.saldo).trim() !== "";
  const saldo = Number(b.saldo);
  if (traeSaldo && (!Number.isFinite(saldo) || saldo < 0)) return res.status(400).json({ error: "El nuevo saldo debe ser un monto válido." });
  const motivo = String(b.motivo || "").trim();
  if (motivo.length < 3) return res.status(400).json({ error: "Escribe el motivo del ajuste (queda en la bitácora)." });
  const campos = {};
  if (traeSaldo) campos.saldo = saldo;
  if (b.cuota != null && b.cuota !== "" && Number.isFinite(Number(b.cuota)) && Number(b.cuota) >= 0) campos.cuota = Number(b.cuota);
  // Reasignar el crédito a otro ejecutivo (mover cartera). Solo nombres reales.
  if (b.ejecutivo) {
    const nombres = idsEjecutivos(req.usuario).map((id) => USUARIOS[id].nombre);
    const ok = nombres.find((n) => norm(n) === norm(String(b.ejecutivo)));
    if (!ok) return res.status(400).json({ error: "Ese ejecutivo no existe. Elige uno de: " + nombres.join(", ") });
    campos.ejecutivo = ok;
  }
  if (!Object.keys(campos).length) return res.status(400).json({ error: "No hay nada que cambiar: pon el saldo nuevo, la cuota o el ejecutivo." });
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
  // `fecha` es el día de la renovación: es lo que permite separar los abonos del
  // ciclo viejo (fecha <= ese día) de los del nuevo. `corte` se conserva solo
  // para los apuntes que ya existían con el formato anterior.
  // Se guarda el DESGLOSE POR DÍA de lo que abonó el ciclo que se cierra, no solo
  // el total. Con el total había que adivinar después qué abono era de cuál
  // ciclo, y el día de la renovación son indistinguibles (se liquida y se
  // renueva el mismo día). Con el desglose no hay nada que adivinar: son los
  // montos tal como estaban en este momento, y el ciclo nuevo nace en cero.
  // La ventana se abre MUY atrás a propósito: el desglose no debe depender del
  // corte, que es justo lo que se está arreglando.
  // SE GUARDA SIEMPRE, HAYA O NO UN CRÉDITO ACTIVO QUE CERRAR. Cuando el ciclo
  // anterior ya está dado de BAJA no hay `choca`, así que antes no se guardaba
  // nada y los abonos de ese ciclo volvían a caerle al crédito nuevo — justo el
  // caso de SOCORRO MIGUEL y BLANCA VERONICA, que quedaron con los dos créditos
  // de baja. El razonamiento no depende de que exista el activo: el ciclo NUEVO
  // nace hoy, así que todo lo que esa llave abonó antes es de un ciclo pasado.
  let previo = null;
  {
    const atras = new Date(hoyMX() + "T12:00:00"); atras.setDate(atras.getDate() - 395);
    const orig = atras.toISOString().slice(0, 10);
    const { porFecha: pfTodo } = pagosDeLaSemana(req.usuario, orig);
    const liqTodo = {};
    liquidacionesDeLaSemana(req.usuario, orig, liqTodo);
    // La llave del ciclo que se cierra es la MISMA que va a tener el nuevo
    // (socio + producto). Se arma con el producto que se está re-dando, no con
    // el del registro que se encontró: `previa` puede ser cualquier crédito de
    // esa socia —hasta de otro producto— cuando ya no queda ninguno activo.
    const claveVieja = claveCredito(id, producto);
    // LOS ABONOS DE LA FICHA SON TODOS DEL CICLO VIEJO, SIN TOPE. El crédito
    // nuevo nace en este momento, así que TODO lo que esa llave abonó hasta hoy
    // es del ciclo que se cierra. El primer intento los recortaba al total que
    // se veía bajo el corte de ese día y los repartía sobre la ventana ancha:
    // el monto acababa pegado a la fecha equivocada —una anterior al corte, que
    // luego se ignora— y el abono de ESTA semana volvía a caerle al crédito
    // nuevo. Le pasó a SOCORRO MIGUEL el 10-ago: sus $320 del ciclo viejo se le
    // restaron al crédito recién dado.
    const todos = (mapa, leer) => {
      const out = {};
      for (const f in (mapa || {})) {
        const v = leer(mapa[f]);
        if (v > 0) out[f] = Math.round(v * 100) / 100;
      }
      return out;
    };
    // Las LIQUIDACIONES sí llevan tope: van por SOCIO y se reparten entre sus
    // créditos, así que solo es del ciclo cerrado la parte que le tocó. Se
    // toman de la MÁS RECIENTE hacia atrás, que es la que lo cerró.
    const recorta = (mapa, tope, leer) => {
      const out = {};
      if (!(tope > 0) || !mapa) return out;
      let queda = tope;
      for (const f of Object.keys(mapa).sort().reverse()) {
        if (queda <= 0) break;
        const usa = Math.min(queda, leer(mapa[f]));
        if (usa > 0) { out[f] = Math.round(usa * 100) / 100; queda -= usa; }
      }
      return out;
    };
    // Sin crédito activo que cerrar (el anterior ya estaba de baja) no hay
    // `infoPrev`: la liquidación que lo cerró se toma de lo que quedó apuntado
    // en ese registro, y si tampoco lo hay, de lo que la socia liquidó desde el
    // corte. Los abonos de ficha no lo necesitan: se toman completos.
    const cerrado = choca || PADRON.filter((c) => String(c.id) === id && nprod(c.producto) === nprod(producto))
      .sort((a, b) => String(b.alta_fecha || "").localeCompare(String(a.alta_fecha || "")))[0] || null;
    const liqPrev = infoPrev ? (infoPrev.liquidado || 0)
      : (cerrado ? Number(cerrado.saldo) || 0 : 0);
    previo = {
      pago: infoPrev ? (infoPrev.pagado || 0) : 0,
      gar: infoPrev ? (infoPrev.garantia || 0) : 0,
      liq: liqPrev,
      corte: corteSaldos(), fecha: hoyMX(),
      dias: todos(pfTodo[claveVieja], (x) => x.p || 0),
      diasGar: todos(pfTodo[claveVieja], (x) => x.g || 0),
      diasLiq: recorta(liqTodo[id], liqPrev, (x) => x || 0),
    };
  }
  const desembolsoRc = String(b.desembolso || "").slice(0, 10);
  if (desembolsoRc && !/^\d{4}-\d{2}-\d{2}$/.test(desembolsoRc))
    return res.status(400).json({ error: "La fecha de desembolso no se entiende (usa el calendario)." });
  const diaPagoRc = String(b.diaPago || "").trim().toUpperCase();
  if (diaPagoRc && !idxDia(diaPagoRc))
    return res.status(400).json({ error: "Ese día de pago no existe (Lunes a Sábado)." });
  const clienta = { id, nombre, producto, centro, ejecutivo: ejecOK, saldo, cuota, plazo: Number(b.plazo) || 0,
    mora: 0, estatus: "VIGENTE", semana: 0, recredito: true, recreditoDe: (choca || previa).producto || null, previo,
    desembolso: desembolsoRc || null,
    diaPago: diaPagoRc || String((choca || previa).diaPago || "").toUpperCase() || diaDelCentro(centro) || null,
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
// CATÁLOGO DE MOVIMIENTOS DE DIRECCIÓN. Antes el concepto era texto libre y el
// movimiento SIEMPRE se guardaba como salida: una liquidación capturada aquí le
// bajaba el saldo a la clienta (bien) pero además RESTABA del efectivo a
// entregar (mal). Con $1,000 el error era de $2,000, porque ese dinero entró.
// Lo cachó la Ing. Monse el 6-ago: «liquidación y recuperación solo son
// aplicables para ingresos, no egresos». Ahora el concepto se elige de lista y
// él decide si el dinero ENTRA o SALE, igual que en la app de las ejecutivas.
const CONCEPTOS_DIR = {
  // ENTRADAS · dinero que LLEGA a la caja
  "Liquidación":                 { entrada: true,  categoria: "Otro", clienta: "obliga" },
  "Recuperación / adelanto":     { entrada: true,  categoria: "Otro", clienta: "obliga" },
  "Comisión de desembolso":      { entrada: true,  categoria: "Otro", clienta: "sugiere" },
  "Garantía":                    { entrada: true,  categoria: "Otro", clienta: "sugiere" },
  // SALIDAS · dinero que SALE de la caja
  "Gasto operativo":             { entrada: false, categoria: "Gasto operativo" },
  "Retiro de dirección":         { entrada: false, categoria: "Retiro de dirección" },
  "Autorización / préstamo":     { entrada: false, categoria: "Autorización / préstamo" },
  // "Desembolso (crédito nuevo)" queda FUERA de esta lista (Karina, 6-ago): el
  // crédito nuevo se abre con "Dar de alta" o "Re-dar crédito", que además le
  // ponen su ancla y su plazo. Registrarlo aquí como movimiento suelto lo dejaba
  // en la caja sin crear el crédito, y nadie lo usó nunca (0 de 303 movimientos
  // en producción). Si hace falta sacar el efectivo, va como "Autorización /
  // préstamo".
  "Otro":                        { entrada: false, categoria: "Otro" },
};
const METODOS = ["efectivo", "transferencia", "cheque"];

// Movimientos que capturan las EJECUTIVAS en la pestaña "Otros movimientos".
// Unos meten dinero a la caja (comisión, recuperación, garantía, liquidación) y
// otros lo sacan (gasto, desembolso). El signo importa: si se tratan todos como
// salida, el efectivo a entregar sale mal.
// TIPOS DE GASTO de campo. Antes la ejecutiva solo podía poner "Gasto" y el
// detalle vivía en la nota, así que el arqueo no podía decir en QUÉ se fue el
// dinero: todo caía en "Gasto operativo". Pedido por Karina el 5-ago.
const TIPOS_GASTO = ["Gasolina", "Casetas / transporte", "Papelería", "Alimentos",
  "Mensajería", "Mantenimiento", "Otro"];
// Se empata SIN acentos ni mayúsculas: la app manda el texto del select, y un
// "Papeleria" contra "Papelería" mandaba el gasto al cajón genérico en silencio.
function tipoGastoCanonico(t) {
  const n = norm(t);
  return TIPOS_GASTO.find((x) => norm(x) === n) || null;
}
const CONCEPTOS_EJEC = {
  COMISION:     { etiqueta: "Comisión de desembolso",   categoria: "Otro",            entrada: true },
  RECUPERACION: { etiqueta: "Recuperación / adelanto",  categoria: "Otro",            entrada: true },
  GARANTIA:     { etiqueta: "Garantía",                 categoria: "Otro",            entrada: true },
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
// Lo que los "otros movimientos" mueven POR CADA FORMA que no es efectivo.
// El efectivo ya va por egresosEnEfectivo(); esto es lo demás. Nació el 5-ago:
// una recuperación que la ejecutiva capturó POR TRANSFERENCIA no aparecía en el
// renglón de Transferencias del arqueo —solo en su "otros +"— así que el dinero
// que llegó al banco quedaba sin sumar donde Monse lo busca.
// Entrada suma, salida resta: un gasto pagado por transferencia SACA del banco.
// EN QUÉ SE FUE EL DINERO. Desglosa los gastos del día por tipo y marca los
// riesgos que en cobranza de campo cuestan caro:
//   • un gasto que deja a la ejecutiva entregando MENOS de lo que cobró en
//     efectivo, o incluso en negativo — hay que verlo el mismo día;
//   • el MISMO gasto capturado por la ejecutiva Y por Dirección: se resta dos
//     veces y a nadie le cuadra la caja.
function gastosDelDia(movs, porEjec) {
  const gastos = (movs || []).filter((m) => !m.entrada && !m.anulado);
  const porTipo = {};
  for (const m of gastos) {
    const t = m.tipoGasto || (String(m.categoria || "").trim() || "Otro");
    porTipo[t] = Math.round(((porTipo[t] || 0) + Number(m.monto || 0)) * 100) / 100;
  }
  // Posible doble captura: mismo monto y misma forma el mismo día, uno de campo
  // (folio EJE-) y otro de Dirección (folio DIR-).
  const dobles = [];
  for (const a of gastos.filter((m) => String(m.folio).startsWith("EJE-"))) {
    for (const b of gastos.filter((m) => String(m.folio).startsWith("DIR-"))) {
      if (Math.abs(Number(a.monto) - Number(b.monto)) < 0.01 && a.metodo === b.metodo)
        dobles.push({ monto: Number(a.monto), metodo: a.metodo,
          enCampo: a.folio, enDireccion: b.folio,
          concepto: String(a.concepto || "").slice(0, 60) });
    }
  }
  // Ejecutivas cuyo gasto en efectivo se comió lo que cobraron.
  const sobregiro = [];
  for (const id in (porEjec || {})) {
    const e = porEjec[id];
    const aEntregar = (e.efectivo || 0) - (e.egresoEfectivo || 0);
    if ((e.egresoEfectivo || 0) > 0 && aEntregar < 0)
      sobregiro.push({ ejecutivo: e.nombre, cobro: Math.round((e.efectivo || 0) * 100) / 100,
        gastos: Math.round((e.egresoEfectivo || 0) * 100) / 100,
        aEntregar: Math.round(aEntregar * 100) / 100 });
  }
  return { porTipo, total: Math.round(gastos.reduce((a, m) => a + Number(m.monto || 0), 0) * 100) / 100,
    posiblesDobles: dobles, sobregiro };
}
// Cuánto de los "otros movimientos" son GARANTÍAS. Normalmente la garantía viene
// dentro de la ficha que captura la ejecutiva, pero si una clienta la paga en la
// oficina, Dirección la registra suelta. Antes ese dinero sumaba al efectivo a
// entregar y NO aparecía en el renglón de Garantías: Monse veía dinero de más
// sin concepto que lo explicara. Lo destapó Karina el 6-ago preguntando por qué
// la garantía estaba en la lista.
function garantiasDeMovs(movs) {
  return Math.round((movs || []).reduce((a, m) => {
    if (m.anulado) return a;
    const tipo = String(m.tipo || m.concepto || "").split(" · ")[0].split(" — ")[0].trim();
    if (!/^garant/i.test(tipo)) return a;
    return a + (m.entrada ? Number(m.monto) : -Number(m.monto));
  }, 0) * 100) / 100;
}
function netoMovsPorMetodo(movs) {
  const out = { transferencia: 0, cheque: 0 };
  for (const m of movs || []) {
    const k = String(m.metodo || "efectivo");
    if (!(k in out)) continue;
    out[k] += m.entrada ? Number(m.monto) : -Number(m.monto);
  }
  out.transferencia = Math.round(out.transferencia * 100) / 100;
  out.cheque = Math.round(out.cheque * 100) / 100;
  return out;
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
// DE QUIÉN ES el movimiento (distinto de QUIÉN LO CAPTURÓ). Nació el 5-ago
// porque Karina cachó que un gasto de Julio capturado desde el tablero no
// sumaba en «otros movimientos» de nadie: se guardaba a nombre de Dirección, y
// como Dirección no es ejecutiva, repartirMovsPorEjecutivo lo tiraba. En
// efectivo al menos bajaba el «efectivo a entregar» del día, así que el dinero
// se seguía viendo; POR TRANSFERENCIA no toca la caja y desaparecía de todos
// los totales. Ahora Dirección elige a quién pertenece y ese es el dueño.
function ejecutivoDeMov(m) {
  const e = m.ejecutivo;
  if (e && USUARIOS[e] && USUARIOS[e].rol === "ejecutivo") return e;
  const u = usuarioDeMov(m);
  return u && USUARIOS[u].rol === "ejecutivo" ? u : null;
}
// Socio ligado a un movimiento (para bajarle el saldo en una liquidación).
// Los movimientos nuevos lo traen como campo; los viejos sólo dentro del texto.
// DE QUÉ TIPO ES UN MOVIMIENTO. Antes se adivinaba leyendo el texto que
// escribió quien lo capturó: si en vez de "Liquidación…" ponía "Pago final de
// Emma", el dinero entraba a la caja y el saldo de la clienta NUNCA bajaba, en
// silencio. Lo cachó Karina el 6-ago preguntando «¿seguro que sí va a bajar?».
// Ahora manda el TIPO que se eligió del menú; el texto libre es solo el
// respaldo para los movimientos viejos, que no lo traen.
function tipoDeMov(m) {
  if (m && m.tipo) return String(m.tipo).trim();
  return String((m && m.concepto) || "").split(" · ")[0].split(" — ")[0].trim()
    || (m && m.categoria) || "";
}
function socioDeMov(m) {
  if (m.socio) return String(m.socio);
  const mm = String(m.concepto || "").match(/·\s*(\d{6,})/);
  return mm ? mm[1] : null;
}
// CUÁL de los créditos de esa socia. Los movimientos nuevos lo traen; los de
// antes del 8-ago-2026 no, y por eso su liquidación se repartía entre todos sus
// créditos en orden fijo en vez de bajarle al que la clienta liquidó.
function productoDeMov(m) {
  return m && m.producto ? String(m.producto) : null;
}
// Liquidaciones/recuperaciones LIGADAS a un crédito exacto (socio+producto).
// Devuelve { porClave: {clave: monto}, porSocio: {socio: monto} } — el segundo
// sirve para apartar del reparto lo que ya tiene dueño y que no se cuente doble.
function liquidacionesLigadas(usuario, desde) {
  const hoy = hoyMX(), lunes = desde || lunesDeLaSemana(hoy);
  const porClave = {}, porSocio = {};
  const sumar = (m) => {
    if (!/^(liquidaci|recuperaci)/i.test(tipoDeMov(m) || "")) return;
    const soc = socioDeMov(m), prod = productoDeMov(m);
    if (!soc || !prod) return;                      // sin crédito: va al reparto viejo
    const clave = claveCredito(soc, prod);
    porClave[clave] = (porClave[clave] || 0) + m.monto;
    porSocio[soc] = (porSocio[soc] || 0) + m.monto;
  };
  const d0 = new Date(lunes + "T12:00:00");
  for (let i = 0; i < (desde ? 400 : 7); i++) {
    const f = new Date(d0); f.setDate(d0.getDate() + i);
    const fISO = f.toISOString().slice(0, 10);
    if (fISO > hoy) break;
    for (const m of movsDeFecha(fISO, usuario)) sumar(m);
  }
  for (const m of movsAtrasadosQueSiCuentan(usuario, desde)) sumar(m);
  return { porClave, porSocio };
}
// Liquidaciones de socias que tienen MÁS DE UN crédito y llegaron SIN decir cuál.
// Son las que el sistema tiene que adivinar, y adivina mal: le baja el saldo al
// primer crédito en orden, no al que la clienta liquidó. Se listan para que el
// tablero las pueda señalar y se corrijan una por una.
function liquidacionesSinCredito(usuario, desde) {
  const hoy = hoyMX(), inicio = desde || lunesDeLaSemana(hoy);
  const d0 = new Date(inicio + "T12:00:00");
  const out = [];
  for (let i = 0; i < (desde ? 400 : 7); i++) {
    const f = new Date(d0); f.setDate(d0.getDate() + i);
    const fISO = f.toISOString().slice(0, 10);
    if (fISO > hoy) break;
    for (const m of movsDeFecha(fISO, usuario)) {
      if (!/^(liquidaci|recuperaci)/i.test(tipoDeMov(m) || "")) continue;
      const soc = socioDeMov(m);
      if (!soc || productoDeMov(m)) continue;        // sin socia ya se avisa aparte
      const suyos = PADRON.filter((c) => String(c.id).split("|")[0] === String(soc)
        && c.activa !== false && c.estatus !== "BAJA");
      if (suyos.length < 2) continue;                // con un solo crédito no hay duda
      out.push({ folio: m.folio, fecha: m.fecha, monto: m.monto, socio: soc,
        clienta: suyos[0].nombre, concepto: m.concepto,
        registradoPor: m.registradoPor || m.usuario || "",
        candidatos: suyos.map((c) => c.producto) });
    }
  }
  return out;
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
    const id = ejecutivoDeMov(m);
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
  // El TIPO manda: de él salen `entrada` y la categoría. Se acepta el catálogo
  // nuevo y, por compatibilidad, la categoría suelta de los movimientos viejos.
  const tipo = CONCEPTOS_DIR[String(b.tipo || "").trim()] || null;
  const categoria = tipo ? tipo.categoria : (CATEGORIAS.includes(b.categoria) ? b.categoria : null);
  const metodo = METODOS.includes(b.metodo) ? b.metodo : null;
  const fecha = b.fecha || hoyMX();
  // La fecha del gasto la elige quien captura: antes no había campo y TODO caía
  // en el día de hoy. Al subir los gastos de varios días de golpe, se descontaban
  // del efectivo de uno solo y el arqueo salía en negativo (reportado el 4-ago).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha inválida (usa AAAA-MM-DD)." });
  if (fecha > hoyMX()) return res.status(400).json({ error: "El gasto no puede ser de una fecha futura." });
  if (!(monto > 0)) return res.status(400).json({ error: "El monto debe ser mayor a cero." });
  if (!concepto) return res.status(400).json({ error: "Escribe un concepto para el movimiento." });
  if (!categoria) return res.status(400).json({ error: "Elige de qué es el movimiento." });
  // Una liquidación o recuperación SIN clienta entra a la caja y no le baja el
  // saldo a nadie: por eso aquí se exige, no se sugiere.
  if (tipo && tipo.clienta === "obliga" && !String(b.socio || "").trim())
    return res.status(400).json({ error: "Elige la CLIENTA: una " + String(b.tipo).toLowerCase() + " le baja el saldo a alguien, y sin clienta ese dinero no se aplica." });
  if (!metodo) return res.status(400).json({ error: "Elige el método (efectivo o transferencia)." });
  // A QUIÉN pertenece el gasto. Sin esto el movimiento quedaba a nombre de quien
  // lo capturó (Dirección) y no le sumaba a NINGUNA ejecutiva. Es opcional: un
  // retiro de dirección no es de nadie en particular.
  const ejec = String(b.ejecutivo || "").trim().toLowerCase() || null;
  if (ejec && !(USUARIOS[ejec] && USUARIOS[ejec].rol === "ejecutivo"
      && !!USUARIOS[ejec].test === !!req.usuario.test))
    return res.status(400).json({ error: "Esa ejecutiva no existe." });
  // DE QUÉ CLIENTA es. Sin esto una liquidación capturada por Dirección entraba
  // a la caja pero NO le bajaba el saldo a nadie: el tablero solo podía avisar
  // del hueco ("liquidaciones sin clienta"), no cerrarlo. Ligarla es lo que hace
  // que la clienta quede en cero y desaparezca de la app de su ejecutiva
  // (pedido de Karina, 5-ago).
  const socio = String(b.socio || "").replace(/[\s\-.]/g, "").trim() || null;
  let producto = String(b.producto || "").trim() || null;
  if (socio) {
    const cred = PADRON.filter((c) => String(c.id).split("|")[0] === socio && c.activa !== false && c.estatus !== "BAJA");
    if (!cred.length) return res.status(400).json({ error: "No encuentro una clienta activa con ese número de socio." });
    // DE CUÁL DE SUS CRÉDITOS. Una liquidación baja el saldo de UN crédito, no de
    // la clienta: ~146 socias tienen más de uno. Sin este dato el sistema se lo
    // aplicaba al primero de la lista — el sábado 8-ago le bajó el saldo al
    // crédito equivocado a cuatro clientas. Se exige igual que la clienta.
    if (tipo && tipo.clienta === "obliga") {
      // Con UN solo crédito no hay nada que elegir: se resuelve solo y de todos
      // modos queda escrito en el movimiento. Se exige únicamente cuando la
      // socia tiene varios, que es el caso en que el sistema tendría que adivinar.
      if (!producto && cred.length === 1) producto = cred[0].producto;
      if (!producto)
        return res.status(400).json({ error: "Elige CUÁL de sus créditos se está liquidando. " + cred[0].nombre
          + " tiene " + cred.length + ": " + cred.map((c) => c.producto).join(", ")
          + ". Sin eso el abono le baja el saldo al que no es." });
      const exacto = cred.find((c) => norm(c.producto) === norm(producto));
      if (!exacto) return res.status(400).json({ error: "Esa clienta no tiene un crédito \"" + producto
        + "\" activo. Los suyos son: " + cred.map((c) => c.producto).join(", ") + "." });
      producto = exacto.producto;      // se guarda con el nombre canónico del padrón
    }
  } else {
    producto = null;                   // sin clienta no hay crédito que ligar
  }

  const delDia = store.movimientosDeFecha(fecha).length;
  const compacta = fecha.slice(8, 10) + fecha.slice(5, 7);
  const folio = "DIR-" + compacta + "-" + String(delDia + 1).padStart(3, "0");
  const mov = {
    folio, fecha, monto, concepto, categoria, metodo, ejecutivo: ejec, socio, producto,
    // ENTRADA o SALIDA. Sin esto todo se guardaba como salida.
    // Sin tipo del catálogo NO se da por hecho que sale: se lee el concepto.
    // Escribir `false` a secas mandaba una liquidación al lado de los gastos y
    // el cierre de la semana quedaba mal por el DOBLE del monto.
    tipo: tipo ? String(b.tipo).trim() : null,
    entrada: tipo ? !!tipo.entrada : store.entradaPorTexto(concepto || categoria),
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
// ===================================================================
// CORREGIR LA CAPTURA DE UNA EJECUTIVA (Karina, 7-ago-2026)
// «Hay que darle el poder a Monse de ajustar arqueos de ejecutivos, también
//  anular garantías y pagos de clientes, y que se sincronice con el tablero
//  de ellos.»
//
// Hasta hoy la captura de la ejecutiva era intocable desde el tablero: si
// registraba un pago que no fue, o una garantía de más, la única salida era
// pedirle que lo borrara en su teléfono. Y si ya había cerrado, ni eso.
//
// La corrección NO borra ni pisa lo que ella capturó: se guarda como una capa
// encima (`cobranza_ajustes`, append-only) con quién la hizo y por qué. Se
// aplica en el store, así que la respeta TODO el sistema —arqueo, consolidado,
// saldos, Excel— sin que haya que acordarse en cada cálculo.
//
// Y baja al teléfono: `/api/vivos` manda las correcciones del día y `vivos.js`
// las aplica sobre la captura local de la ejecutiva.
// ===================================================================
const CAMPOS_COBRANZA = { pago: "el pago", garantia: "la garantía", solidario: "el solidario" };

// LA CAPTURA DE UNA EJECUTIVA, clienta por clienta. Es lo que Dirección tiene
// que ver ANTES de corregir: sin esto, corregiría a ciegas.
app.get("/api/captura", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const ejec = String(req.query.ejecutivo || "").trim().toLowerCase();
  const u = USUARIOS[ejec];
  if (!u || u.rol !== "ejecutivo" || !!u.test !== !!req.usuario.test)
    return res.status(404).json({ error: "Esa ejecutiva no existe." });
  const rec = store.snapshotsDeFecha(fecha)[ejec];     // ya viene corregido
  let data = rec && rec.snapshot;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = null; } }
  const clientas = [];
  const meter = (nodo, centro) => {
    for (const clave in (nodo || {})) {
      const r = nodo[clave];
      if (!r || typeof r !== "object") continue;
      if (!("pago" in r) && !("forma" in r)) continue;
      const total = (r.pago || 0) + (r.garantia || 0) + (r.solidario || 0);
      if (total <= 0 && !r._anuladoPorDireccion) continue;
      // El nombre viaja dentro de la llave (socio|producto|nombre|n). Si no,
      // se busca en el padrón: nunca se le enseña una clave pelona a Dirección.
      const partes = String(clave).split("|");
      const enPadron = PADRON.find((c) => String(c.id) === partes[0]);
      clientas.push({
        clave, centro: centro || null,
        nombre: partes[2] || (enPadron && enPadron.nombre) || partes[0],
        producto: partes[1] || (enPadron && enPadron.producto) || "",
        pago: r.pago || 0, garantia: r.garantia || 0, solidario: r.solidario || 0,
        forma: r.forma || "", anulado: !!r._anuladoPorDireccion, ajustadoPor: r._ajustadoPor || null,
      });
    }
  };
  meter(data && data.regI, null);
  for (const c in ((data && data.reg) || {})) meter(data.reg[c], c);
  clientas.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const arq = (data && data.arqueo) || {};
  const arqueo = Object.keys(arq).map((d) => ({ den: Number(d), n: Number(arq[d]) || 0 }))
    .filter((x) => x.n > 0).sort((a, b) => b.den - a.den);
  res.json({ fecha, ejecutivo: ejec, nombre: u.nombre, clientas, arqueo,
    cierre: (rec && rec.cierre) || null,
    ajustes: store.ajustesCobranza().filter((a) => a.fecha === fecha && a.ejecutivo === ejec) });
});

app.post("/api/cobranza/ajuste", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  const fecha = String(b.fecha || "").trim();
  const ejec = String(b.ejecutivo || "").trim().toLowerCase();
  const clave = String(b.clave || "").trim();
  const motivo = String(b.motivo || "").trim();
  const anula = b.anula === true;
  const campo = String(b.campo || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha inválida (usa AAAA-MM-DD)." });
  if (fecha > hoyMX()) return res.status(400).json({ error: "No se puede corregir una fecha futura." });
  const u = USUARIOS[ejec];
  if (!u || u.rol !== "ejecutivo" || !!u.test !== !!req.usuario.test)
    return res.status(400).json({ error: "Esa ejecutiva no existe." });
  if (!clave) return res.status(400).json({ error: "Falta la clienta." });
  // El motivo es OBLIGATORIO: sin él, dentro de un mes nadie sabe por qué el
  // arqueo de ese día no cuadra con lo que la ejecutiva juraba haber cobrado.
  if (motivo.length < 4) return res.status(400).json({ error: "Escribe el motivo de la corrección." });
  if (!anula && !CAMPOS_COBRANZA[campo])
    return res.status(400).json({ error: "Elige qué corregir: el pago, la garantía o el solidario." });
  const monto = Number(b.monto);
  if (!anula && (!Number.isFinite(monto) || monto < 0))
    return res.status(400).json({ error: "El monto debe ser un número válido (0 lo quita)." });

  // Que la clienta EXISTA en la captura de ese día. Sin esta comprobación el
  // ajuste se guardaba, no encontraba a nadie a quien aplicarse y el tablero
  // decía "corregido" sin haber corregido nada.
  const rec = store.snapshotsDeFecha(fecha, true)[ejec];
  let data = rec && rec.snapshot;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = null; } }
  const estaEn = (nodo) => !!(nodo && typeof nodo === "object" && nodo[clave]);
  let existe = estaEn(data && data.regI);
  if (!existe) for (const c in ((data && data.reg) || {})) if (estaEn(data.reg[c])) { existe = true; break; }
  if (!existe) return res.status(404).json({ error: "Esa clienta no aparece en la captura de " + u.nombre + " ese día." });

  const aj = { fecha, ejecutivo: ejec, clave, campo: anula ? null : campo,
    monto: anula ? 0 : monto, anula, motivo,
    por: req.usuario.nombre, usuario: req.usuario.id, ts: Date.now() };
  store.agregarAjusteCobranza(aj);
  res.json({ ok: true, ajuste: aj });
});

// AJUSTAR EL ARQUEO: corregir el recuento de billetes de una ejecutiva.
app.post("/api/arqueo/ajuste", requiere("direccion", "admin"), (req, res) => {
  const b = req.body || {};
  const fecha = String(b.fecha || "").trim();
  const ejec = String(b.ejecutivo || "").trim().toLowerCase();
  const motivo = String(b.motivo || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Fecha inválida (usa AAAA-MM-DD)." });
  if (fecha > hoyMX()) return res.status(400).json({ error: "No se puede corregir una fecha futura." });
  const u = USUARIOS[ejec];
  if (!u || u.rol !== "ejecutivo" || !!u.test !== !!req.usuario.test)
    return res.status(400).json({ error: "Esa ejecutiva no existe." });
  if (motivo.length < 4) return res.status(400).json({ error: "Escribe el motivo de la corrección." });
  // El arqueo es {denominación: cuántas}. Se valida denominación por
  // denominación: un dedazo aquí descuadra la caja del día entero.
  const crudo = b.arqueo && typeof b.arqueo === "object" ? b.arqueo : null;
  if (!crudo) return res.status(400).json({ error: "Manda el recuento de billetes." });
  const arqueo = {};
  for (const k in crudo) {
    const den = Number(k), n = Number(crudo[k]);
    if (!DENOMS_ARQUEO.includes(den)) return res.status(400).json({ error: "Denominación inválida: " + k });
    if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: "La cantidad de $" + den + " debe ser un entero." });
    if (n > 0) arqueo[den] = n;
  }
  if (!store.snapshotsDeFecha(fecha, true)[ejec])
    return res.status(404).json({ error: u.nombre + " no tiene captura de ese día." });
  const aj = { fecha, ejecutivo: ejec, arqueo, motivo,
    por: req.usuario.nombre, usuario: req.usuario.id, ts: Date.now() };
  store.agregarAjusteCobranza(aj);
  res.json({ ok: true, ajuste: aj, contado: Object.entries(arqueo).reduce((a, [d, n]) => a + Number(d) * n, 0) });
});

// El historial de correcciones de un día: qué se tocó, quién y por qué.
app.get("/api/cobranza/ajustes", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  const ids = new Set(idsEjecutivos(req.usuario));
  res.json({ fecha, ajustes: store.ajustesCobranza().filter((a) => a.fecha === fecha && ids.has(a.ejecutivo)) });
});

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
    ? todos.filter((m) => ejecutivoDeMov(m) === req.usuario.id)
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
    // Si lo que le SOBRA coincide con un gasto suyo en efectivo, se nombra: es
    // casi siempre un gasto anotado cuyo dinero todavía no salió de la caja, y
    // así la ejecutiva no tiene que deducirlo (Karina, 5-ago).
    if (e.dif > 0.009) {
      const suyos = movs.filter((m) => !m.entrada && !m.anulado && m.metodo === "efectivo"
        && ejecutivoDeMov(m) === id && Math.abs(Number(m.monto) - e.dif) < 0.01);
      if (suyos.length === 1) e.difPorGasto = suyos[0].tipoGasto
        || String(suyos[0].concepto || "").split(" · ")[0] || "un gasto";
    }
  }
  // Los "otros movimientos" que NO son efectivo también son dinero que llegó (o
  // salió) del banco: van al renglón que les toca, no solo al "otros +" de la
  // ejecutiva. Lo pidió Karina el 5-ago viendo el arqueo.
  const movsMet = netoMovsPorMetodo(movs);
  const garMovs = garantiasDeMovs(movs);
  res.json({
    fecha, ...a, egresosEfectivo, efectivoAEntregar: a.efectivo - egresosEfectivo,
    // Las garantías del renglón son las de FICHA más las capturadas sueltas.
    garantias: Math.round((a.garantias + garMovs) * 100) / 100, garantiasDeMovs: garMovs,
    movsTransferencia: movsMet.transferencia, movsCheque: movsMet.cheque,
    gastos: gastosDelDia(movs, a.porEjec), tiposGasto: TIPOS_GASTO,
    denominaciones: DENOMS_ARQUEO,
  });
});

// ---------- CIERRE DE CAJA DE LA SEMANA ----------
// El arqueo diario contesta "¿cuánto entrega cada ejecutiva hoy?". No contesta
// "¿cuánto efectivo tiene FOOAX el sábado?", y por eso al cierre de semana
// aparecía un excedente sin concepto: los retiros de dirección, las
// bancarizaciones y los desembolsos salían de la caja pero nunca se restaban de
// un acumulado semanal. Pedido por Karina el 5-ago (su urgencia #4).
//
// LA CAJA ARRANCA EN CERO CADA LUNES (regla Karina): no arrastra saldo, así que
// lo que debe quedar el sábado es simplemente lo que entró menos lo que salió.
// El cierre se para el SÁBADO: ninguna clienta tiene ese día de cobro, pero sí
// entra dinero (recuperaciones, liquidaciones, pagos atrasados).
function cierreDeCaja(usuario, lunesOpt) {
  const r2 = (n) => Math.round((n || 0) * 100) / 100;
  const hoy = hoyMX();
  const lunes = lunesOpt || lunesDeLaSemana(hoy);
  const ids = idsEjecutivos(usuario);
  const dias = [];
  let entroCobranza = 0, entroMovs = 0, salio = 0;
  let transferencias = 0, depositos = 0, cheques = 0, garantias = 0;
  // LA COBRANZA COMPLETA, por forma de pago. Sin esto no se podía cuadrar el
  // cierre contra la tarjeta de Cartera: aquí solo entra el EFECTIVO, y la
  // diferencia —transferencias y depósitos— no se veía por ningún lado.
  // Preguntó Karina el 6-ago: «¿de dónde sacas esto? si llevamos $222,843.50».
  let cobTransfer = 0, cobDeposito = 0;
  const entradasPorTipo = {}, salidasPorTipo = {};
  const d0 = new Date(lunes + "T12:00:00");
  for (let i = 0; i < 6; i++) {                     // lunes … sábado
    const f = new Date(d0); f.setDate(d0.getDate() + i);
    const fISO = f.toISOString().slice(0, 10);
    if (fISO > hoy) break;
    const a = calcularArqueo(fISO, ids);
    // OJO: `a.efectivo` YA trae adentro las garantías y el solidario cobrados en
    // efectivo (ver acumular()). Sumar `a.garantias` aparte sería contar doble.
    const cob = a.efectivo || 0;
    let ent = 0, sal = 0;
    for (const m of movsDeFecha(fISO, usuario)) {
      const monto = Number(m.monto) || 0;
      const tipo = tipoDeMov(m) || "Otro";
      if (m.metodo === "transferencia") { transferencias += m.entrada ? monto : -monto; continue; }
      if (m.metodo === "cheque") { cheques += m.entrada ? monto : -monto; continue; }
      if (m.metodo !== "efectivo") continue;
      if (m.entrada) { ent += monto; entradasPorTipo[tipo] = (entradasPorTipo[tipo] || 0) + monto; }
      else {
        sal += monto;
        const et = m.tipoGasto ? (tipo + " · " + m.tipoGasto) : tipo;
        salidasPorTipo[et] = (salidasPorTipo[et] || 0) + monto;
      }
    }
    entroCobranza += cob; entroMovs += ent; salio += sal;
    cobTransfer += (a.transferencia || 0) - (a.deposito || 0);
    cobDeposito += a.deposito || 0;
    transferencias += (a.transferencia || 0) - (a.deposito || 0);
    depositos += a.deposito || 0;
    garantias += a.garantias || 0;
    dias.push({ fecha: fISO, cobranza: r2(cob), entradas: r2(ent), salidas: r2(sal), neto: r2(cob + ent - sal) });
  }
  const entro = r2(entroCobranza + entroMovs);
  return {
    lunes, hasta: dias.length ? dias[dias.length - 1].fecha : lunes,
    entroCobranza: r2(entroCobranza), entroMovs: r2(entroMovs), entro,
    salio: r2(salio), quedaEnCaja: r2(entro - salio),
    // De la cobranza en efectivo, cuánto fue garantía (ya va dentro, se informa).
    garantiasDentro: r2(garantias),
    // LA COBRANZA COMPLETA DE LA SEMANA, partida por forma. Sirve para cuadrar
    // este cierre contra la tarjeta de Cartera, que suma todas las formas.
    cobranza: { efectivo: r2(entroCobranza), transferencia: r2(cobTransfer),
      deposito: r2(cobDeposito), total: r2(entroCobranza + cobTransfer + cobDeposito) },
    // Esto NO es efectivo: va al banco. Se reporta aparte para que nadie lo sume.
    transferencias: r2(transferencias), depositos: r2(depositos), cheques: r2(cheques),
    entradasPorTipo, salidasPorTipo, dias,
  };
}
app.get("/api/semana/caja", requiere("direccion", "admin"), (req, res) => {
  res.json(cierreDeCaja(req.usuario, req.query.lunes));
});
// El mismo cierre en Excel, para mandárselo a Dirección o guardarlo del sábado.
app.get("/api/semana/caja/excel", requiere("direccion", "admin"), async (req, res) => {
  const c = cierreDeCaja(req.usuario, req.query.lunes);
  const wb = new ExcelJS.Workbook(); wb.creator = "FOOAX";
  const s = wb.addWorksheet("Cierre de caja", { properties: { defaultColWidth: 20 } });
  const AURORA = "FFF1228E", RIO = "FF324AB6", VERDE = "FF0B7247";
  const dinero = '"$"#,##0.00';
  const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const nomDia = (f) => { const [y, m, d] = f.split("-").map(Number);
    return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + d; };
  s.columns = [{ width: 44 }, { width: 16 }, { width: 16 }, { width: 16 }];
  let fila = 1;
  const tit = s.getRow(fila++); s.mergeCells(1, 1, 1, 4);
  tit.getCell(1).value = "FOOAX · CIERRE DE CAJA DE LA SEMANA · " + c.lunes + " al " + c.hasta;
  tit.getCell(1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  tit.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
  tit.getCell(1).alignment = { horizontal: "center" }; tit.height = 22;
  const nota = s.getRow(fila++); s.mergeCells(2, 1, 2, 4);
  nota.getCell(1).value = "La caja arranca en CERO cada lunes, así que lo que debe quedar es lo que entró menos lo que salió.";
  nota.getCell(1).font = { italic: true, size: 9 };
  nota.getCell(1).alignment = { horizontal: "center" };
  fila++;
  const enc = (txt, color) => { const r = s.getRow(fila++); s.mergeCells(fila - 1, 1, fila - 1, 3);
    r.getCell(1).value = txt; r.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; return r; };
  const linea = (txt, val, negrita) => { const r = s.getRow(fila++);
    r.getCell(1).value = txt; if (negrita) r.getCell(1).font = { bold: true };
    const cc = r.getCell(4); cc.value = val; cc.numFmt = dinero; if (negrita) cc.font = { bold: true }; };
  // De dónde sale el número: el desglose por forma, para poder cuadrarlo contra
  // la tarjeta de Cartera sin adivinar (Karina, 6-ago).
  if (c.cobranza) {
    enc("COBRANZA DE LA SEMANA, POR FORMA", "FF8A5A00");
    linea("En efectivo — es lo único que entra a esta caja", c.cobranza.efectivo);
    linea("En transferencias — van al banco", c.cobranza.transferencia);
    linea("En depósitos Oxxo / tienda — van al banco", c.cobranza.deposito);
    linea("TOTAL COBRADO EN LA SEMANA", c.cobranza.total, true);
    const rn = s.getRow(fila++); s.mergeCells(fila - 1, 1, fila - 1, 4);
    rn.getCell(1).value = "Este total incluye garantías y solidario, y lo cobrado a créditos en recuperación. "
      + "La tarjeta de Cartera los reporta aparte, por eso los dos números no son el mismo.";
    rn.getCell(1).font = { italic: true, size: 9 };
    rn.getCell(1).alignment = { wrapText: true };
    fila++;
  }
  enc("ENTRÓ EN EFECTIVO", RIO).getCell(4).value = null;
  linea("Cobranza en efectivo (fichas, garantías y solidario)", c.entroCobranza);
  for (const k of Object.keys(c.entradasPorTipo).sort((a, b) => c.entradasPorTipo[b] - c.entradasPorTipo[a]))
    linea("   " + k, c.entradasPorTipo[k]);
  linea("TOTAL QUE ENTRÓ", c.entro, true);
  fila++;
  enc("SALIÓ EN EFECTIVO", RIO);
  const sal = Object.keys(c.salidasPorTipo).sort((a, b) => c.salidasPorTipo[b] - c.salidasPorTipo[a]);
  if (!sal.length) linea("Nada salió de la caja esta semana", 0);
  for (const k of sal) linea("   " + k, c.salidasPorTipo[k]);
  linea("TOTAL QUE SALIÓ", c.salio, true);
  fila++;
  const rq = s.getRow(fila++); s.mergeCells(fila - 1, 1, fila - 1, 3);
  rq.getCell(1).value = "EFECTIVO QUE DEBE QUEDAR EL SÁBADO";
  rq.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  rq.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  const cq = rq.getCell(4); cq.value = c.quedaEnCaja; cq.numFmt = dinero;
  cq.font = { bold: true, size: 12, color: { argb: VERDE } };
  fila++;
  enc("APARTE — NO ES EFECTIVO, VA AL BANCO", "FF8A5A00");
  linea("Transferencias", c.transferencias);
  linea("Depósitos Oxxo / tienda", c.depositos);
  if (c.cheques) linea("Cheques (son papel, no billetes)", c.cheques);
  fila++;
  const rh = s.getRow(fila++);
  ["Día", "Entró", "Salió", "Neto"].forEach((h, i) => { const cc = rh.getCell(i + 1);
    cc.value = h; cc.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    cc.alignment = { horizontal: i ? "center" : "left" }; });
  for (const d of (c.dias || [])) {
    const r = s.getRow(fila++);
    r.getCell(1).value = nomDia(d.fecha) + " · " + d.fecha;
    r.getCell(2).value = d.cobranza + d.entradas; r.getCell(2).numFmt = dinero;
    r.getCell(3).value = d.salidas; r.getCell(3).numFmt = dinero;
    const cn = r.getCell(4); cn.value = d.neto; cn.numFmt = dinero;
    cn.font = { bold: true, color: { argb: d.neto < 0 ? "FFB00020" : "FF000000" } };
  }
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Cierre de caja FOOAX ${c.lunes} al ${c.hasta}.xlsx"`);
  res.end(Buffer.from(buf));
});

// ---------- ARQUEO DE CAJA en Excel (formato de la ficha física) ----------
// Botón para Monse: cuenta el efectivo por denominación (billetes/monedas),
// subtotal y total, del día elegido. Solo dirección/admin.
// ===================================================================
// MORA DEL DÍA, POR CENTRO — la idea de Karina (12-ago), tomada de su boceto:
//
//     MORA DE CENTROS :
//       El Milagro · Ma de los Ángeles      $780.00
//       Cofre de dinero · Lizbeth           $180.00
//       Total de Mora del día               $960.00
//       TOTAL DE MORA                     $9,754.00
//
// Usa EXACTAMENTE la misma regla que la mora de la semana (faltante = cuota −
// lo que abonó), para que los dos reportes nunca se contradigan: mismos
// excluidos (vencidos, cuota variable, sin cuota, sin desembolsar) y mismo
// criterio de día de cobro.
//
// Lo que había antes en el arqueo era un solo número, y encima solo contaba a
// las que pagaron DE MENOS: la que no pagaba nada no sumaba a la mora del día.
// ===================================================================
function moraDelDia(usuario, fecha) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || "")) ? fecha : hoyMX();
  const dia = NOMBRE_DIA[new Date(f + "T12:00:00").getDay()];
  const lunes = lunesDeLaSemana(f);
  const cv = carteraViva(usuario);
  const mios = new Set(idsEjecutivos(usuario).map((id) => norm(USUARIOS[id].nombre)));
  // Lo abonado ESE DÍA, crédito por crédito.
  const { porFecha } = pagosDeLaSemana(usuario, f, f);
  const pagoDelDia = {};
  for (const clave in porFecha)
    if (porFecha[clave][f]) pagoDelDia[clave] = (porFecha[clave][f].p || 0);

  const sumaMovsCorte = (destino, desdeF, hastaF) => {
    const d0 = new Date(desdeF + "T12:00:00");
    for (let k = 0; k < 400; k++) {
      const dd = new Date(d0); dd.setDate(d0.getDate() + k);
      const fISO = dd.toISOString().slice(0, 10);
      if (fISO > hastaF) break;
      for (const m of movsDeFecha(fISO, usuario)) {
        if (!/^(liquidaci|recuperaci)/i.test(tipoDeMov(m) || "")) continue;
        const soc = socioDeMov(m); if (!soc) continue;
        let prod = productoDeMov(m);
        if (!prod) {
          // Sin crédito escrito solo se puede aplicar si tiene UNO solo vivo.
          const suyos = PADRON.filter((c) => c.activa !== false && c.estatus !== "BAJA" && String(c.id) === String(soc));
          if (suyos.length === 1) prod = suyos[0].producto;
        }
        if (!prod) continue;
        const cl = claveCredito(soc, prod);
        destino[cl] = (destino[cl] || 0) + (Number(m.monto) || 0);
      }
    }
  };

  // TODO lo abonado DESDE EL CORTE, en dos cortes de tiempo: hasta este día
  // (decide la mora del día) y hasta hoy (decide qué ya se recuperó). Es la
  // misma ventana que usa la mora semanal — método de Monse, 14-ago.
  const corteHoy = corteSaldos();
  const hoyReal2 = hoyMX();
  const { porFecha: pfCorte } = pagosDeLaSemana(usuario, corteHoy, hoyReal2 > f ? hoyReal2 : f);
  const abonadoDesdeCorteHasta = {}, abonadoTotal = {};
  for (const clave in pfCorte)
    for (const d2 in pfCorte[clave]) {
      const v = pfCorte[clave][d2].p || 0;
      abonadoTotal[clave] = (abonadoTotal[clave] || 0) + v;
      if (d2 <= f) abonadoDesdeCorteHasta[clave] = (abonadoDesdeCorteHasta[clave] || 0) + v;
    }
  sumaMovsCorte(abonadoDesdeCorteHasta, corteHoy, f);
  sumaMovsCorte(abonadoTotal, corteHoy, hoyReal2 > f ? hoyReal2 : f);
  // Abonos de caja por clave y por FECHA, para poder cortarlos en cualquier día
  // del acumulado sin volver a recorrer los movimientos.
  const movsPorClaveFecha = {};
  {
    const d0 = new Date(corteHoy + "T12:00:00");
    for (let k = 0; k < 400; k++) {
      const dd = new Date(d0); dd.setDate(d0.getDate() + k);
      const fISO2 = dd.toISOString().slice(0, 10);
      // Hasta HOY, no hasta el día del reporte: el "sigue debiendo" tiene que
      // ver el dinero que entró DESPUÉS de ese día (es justo lo que reconcilia
      // el arqueo con la mora de la semana). Cortando en `f`, una liquidación
      // posterior no se veía y los dos números se separaban.
      if (fISO2 > (hoyReal2 > f ? hoyReal2 : f)) break;
      const dest = {};
      sumaMovsCorte(dest, fISO2, fISO2);
      for (const cl in dest) (movsPorClaveFecha[cl] = movsPorClaveFecha[cl] || {})[fISO2] = dest[cl];
    }
  }
  // Abonos de un crédito ENTRE dos fechas (fichas + oficina). Es el equivalente
  // de la mora semanal: se suma desde el arranque propio del crédito.
  const abonoEntre = (clave, desdeISO, hastaISO) => {
    let t = 0;
    for (const d2 in (pfCorte[clave] || {}))
      if (d2 >= desdeISO && d2 <= hastaISO) t += pfCorte[clave][d2].p || 0;
    for (const d2 in (movsPorClaveFecha[clave] || {}))
      if (d2 >= desdeISO && d2 <= hastaISO) t += movsPorClaveFecha[clave][d2];
    return Math.round(t * 100) / 100;
  };
  const movsCorteHasta = (clave, hastaISO) => {
    let t = 0;
    for (const dd2 in (movsPorClaveFecha[clave] || {})) if (dd2 <= hastaISO) t += movsPorClaveFecha[clave][dd2];
    return t;
  };

  // LOS PAGOS DE OFICINA TAMBIÉN CUENTAN. Una liquidación o recuperación que
  // registra Dirección es dinero que la clienta entregó: si no se cuenta aquí,
  // sale debiendo alguien que ya pagó. La mora de la semana sí los contaba y
  // este bloque no — por eso el arqueo mostraba MÁS que la mora semanal, que
  // fue exactamente lo que Karina notó el 12-ago.


  // Y lo abonado de ese día EN ADELANTE, hasta el DOMINGO: sirve para saber
  // quién se puso al corriente después.
  //
  // El tope es el domingo, no hoy, A PROPÓSITO: es la misma ventana que usa la
  // mora de la semana, y solo así el «sigue debiendo» de este bloque coincide
  // al centavo con lo que ella reporta. Cortando en hoy los dos números se
  // separaban y parecían contradictorios. (En la práctica no hay abonos con
  // fecha futura, así que el número es el mismo; lo que cambia es que ahora
  // está garantizado.)
  const finSem = new Date(lunes + "T12:00:00"); finSem.setDate(finSem.getDate() + 6);
  const domingoSem = finSem.toISOString().slice(0, 10);
  const { porFecha: pfHasta } = pagosDeLaSemana(usuario, f, domingoSem);
  const pagoHastaHoy = {};
  for (const clave in pfHasta)
    for (const d2 in pfHasta[clave])
      if (d2 >= f && d2 <= domingoSem)
        pagoHastaHoy[clave] = (pagoHastaHoy[clave] || 0) + (pfHasta[clave][d2].p || 0);
  sumaMovsCorte(pagoHastaHoy, f, domingoSem);

  const centros = {};
  const fuera = { vencidos: 0, cuotaVariable: 0, sinCuota: 0, sinDesembolsar: 0, liquidados: 0 };
  for (const c of PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    if (!mios.has(norm(c.ejecutivo))) continue;
    if (String(c.diaPago || "").trim().toUpperCase() !== dia) continue;   // solo los que cobran HOY
    if (infoCredito(cv, c).saldoActual <= 0.009) { fuera.liquidados++; continue; }
    if (/vencid/i.test(String(c.estatus || ""))) { fuera.vencidos++; continue; }
    if (esCuotaVariable(c.producto)) { fuera.cuotaVariable++; continue; }
    const cuota = Number(c.cuota) || 0;
    if (cuota <= 0) { fuera.sinCuota++; continue; }
    const des = String(c.desembolso || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(des) && des > f) { fuera.sinDesembolsar++; continue; }
    const clave = claveCredito(c.id, c.producto);
    const pagado = Math.round((pagoDelDia[clave] || 0) * 100) / 100;
    // LA MISMA FÓRMULA DE MONSE que la mora semanal (14-ago): cuotas exigidas
    // desde el corte hasta ESTE día, menos TODO lo abonado desde el corte hasta
    // este día — así el adelanto de la semana pasada (ARIELA) y el pago
    // adelantado dentro de la semana (LA CONSENTIDA, pagó el miércoles su
    // jueves) cuentan a favor. Acotado a una cuota y al saldo restante (LUCIA).
    const infoD = infoCredito(cv, c);
    // MISMA VARA que la mora semanal: la cuenta arranca en el primer día de
    // cobro después del corte, y desde ahí se cuentan cuotas Y abonos.
    let desdeV = diaSiguiente(corteSaldos());
    const iniObD = inicioObligaciones(c);
    if (iniObD && iniObD > desdeV) desdeV = iniObD;
    const venc = vencimientosEntre(idxDia(dia), desdeV, f);
    const abonadoHastaHoyDia = Math.round((abonoEntre(clave, desdeV, f) || 0) * 100) / 100;
    let faltante0 = Math.max(0, Math.min(cuota, cuota * venc - abonadoHastaHoyDia));
    const plazoD = Number(c.plazo) || 0;
    let termino = false;
    if (plazoD > 0 && iniObD && infoD.saldoActual < cuota * 2) {
      termino = vencimientosEntre(idxDia(dia), iniObD, f) >= plazoD;
      if (termino) faltante0 = infoD.saldoActual + Math.max(0, (abonadoTotal[clave] || 0) - abonadoHastaHoyDia);
    }
    const faltante = Math.round(Math.min(faltante0, infoD.saldoActual + Math.max(0, (abonadoTotal[clave] || 0) - abonadoHastaHoyDia)) * 100) / 100;
    if (faltante <= 0) continue;
    // LO QUE PAGÓ DESPUÉS, hasta hoy. Es lo que reconcilia este bloque con la
    // mora de la semana: ahí la que se pone al corriente el miércoles YA NO
    // aparece debiendo el lunes, y aquí SÍ (porque ese lunes no pagó). Sin
    // decirlo, los dos reportes se ven contradictorios — que fue justo lo que
    // Karina notó el 12-ago: «el arqueo muestra más que esta parte del sistema».
    // Lo que sigue debiendo HOY con la misma fórmula, pero contando también lo
    // abonado después de este día. La resta contra `faltante` es lo recuperado.
    let sd0 = Math.max(0, Math.min(cuota, cuota * venc - abonoEntre(clave, desdeV, hoyReal2 > f ? hoyReal2 : f)));
    if (termino) sd0 = infoD.saldoActual;
    const sigueDebiendo = Math.round(Math.min(sd0, infoD.saldoActual) * 100) / 100;
    const pagadoDespues = Math.round(Math.max(0, faltante - sigueDebiendo) * 100) / 100;
    const nom = String(c.centro || "").trim() || "Individual";
    const g = centros[nom] || (centros[nom] = { centro: nom, ejecutivo: c.ejecutivo || "—",
      filas: [], total: 0, recuperado: 0, pendiente: 0 });
    g.filas.push({ socio: String(c.id), clienta: c.nombre, producto: c.producto,
      cuota, pagado, faltante, pagadoDespues, sigueDebiendo });
    g.total = Math.round((g.total + faltante) * 100) / 100;
    g.recuperado = Math.round((g.recuperado + Math.min(pagadoDespues, faltante)) * 100) / 100;
    g.pendiente = Math.round((g.pendiente + sigueDebiendo) * 100) / 100;
  }
  const lista = Object.values(centros).sort((a, b) => b.total - a.total);
  for (const g of lista) g.filas.sort((a, b) => b.faltante - a.faltante);
  const totalDia = Math.round(lista.reduce((t, g) => t + g.total, 0) * 100) / 100;
  const recuperado = Math.round(lista.reduce((t, g) => t + g.recuperado, 0) * 100) / 100;
  const pendiente = Math.round(lista.reduce((t, g) => t + g.pendiente, 0) * 100) / 100;

  // TOTAL DE MORA: el acumulado de la semana hasta ese día — el número grande
  // del boceto. Se suman los faltantes DÍA POR DÍA con esta misma regla.
  //
  // No se saca de la mora semanal a propósito: aquella mide "cuota − lo que
  // abonó en TODA la semana", así que perdona a la que pagó tarde. Mezclarlas
  // daba un acumulado MENOR que el día, que no se puede leer. Cada día se mide
  // igual y se suma: eso sí se sostiene.
  //
  // Misma fórmula de Monse, día por día: cuotas vencidas desde el corte hasta
  // ese día, menos lo abonado desde el corte hasta ese día. Los abonos por
  // fecha ya están en pfCorte; solo se corta la suma en cada día.
  let acumulado = 0;
  for (let k = 0; k < 7; k++) {
    const dd = new Date(lunes + "T12:00:00"); dd.setDate(dd.getDate() + k);
    const fISO = dd.toISOString().slice(0, 10);
    if (fISO > f) break;
    const diaK = NOMBRE_DIA[dd.getDay()];
    for (const c of PADRON) {
      if (c.activa === false || c.estatus === "BAJA") continue;
      if (!mios.has(norm(c.ejecutivo))) continue;
      if (String(c.diaPago || "").trim().toUpperCase() !== diaK) continue;
      const infoK = infoCredito(cv, c);
      if (infoK.saldoActual <= 0.009) continue;
      if (/vencid/i.test(String(c.estatus || ""))) continue;
      if (esCuotaVariable(c.producto)) continue;
      const cuotaK = Number(c.cuota) || 0;
      if (cuotaK <= 0) continue;
      const desK = String(c.desembolso || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(desK) && desK > fISO) continue;
      const claveK = claveCredito(c.id, c.producto);
      let abonadoK = 0;
      for (const dd2 in (pfCorte[claveK] || {}))
        if (dd2 <= fISO) abonadoK += pfCorte[claveK][dd2].p || 0;
      abonadoK += movsCorteHasta(claveK, fISO);
      let desdeK = diaSiguiente(corteHoy);
      const iniObK = inicioObligaciones(c);
      if (iniObK && iniObK > desdeK) desdeK = iniObK;
      const vencK = vencimientosEntre(idxDia(diaK), desdeK, fISO);
      abonadoK = abonoEntre(claveK, desdeK, fISO);
      let faltK = Math.max(0, Math.min(cuotaK, cuotaK * vencK - abonadoK));
      const plazoK = Number(c.plazo) || 0;
      if (plazoK > 0 && iniObK && infoK.saldoActual < cuotaK * 2 &&
          vencimientosEntre(idxDia(diaK), iniObK, fISO) >= plazoK)
        faltK = infoK.saldoActual;
      acumulado += Math.min(faltK, infoK.saldoActual);
    }
  }
  acumulado = Math.round(acumulado * 100) / 100;

  return { fecha: f, dia, lunes, centros: lista, totalDia, recuperado, pendiente,
    totalSemanaAlDia: acumulado, fuera,
    clientas: lista.reduce((n, g) => n + g.filas.length, 0),
    seRegularizaron: lista.reduce((n, g) => n + g.filas.filter((x) => x.sigueDebiendo <= 0).length, 0) };
}
app.get("/api/mora/dia", requiere("direccion", "admin"), (req, res) => {
  res.json(moraDelDia(req.usuario, req.query.fecha));
});

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
  // ── BLOQUE 1: EL ARQUEO TAL COMO LO MANDARON ─────────────────────────────
  // Regla de Karina (30-jul): el arqueo se deja INTACTO —lo que la ejecutiva
  // contó, sin restarle nada— y las deducciones van aparte. Antes se mezclaba:
  // debajo de unas denominaciones que sumaban $72,043 aparecía un "TOTAL
  // EFECTIVO $65,357" (que era la COBRANZA, otra cosa), y luego la advertencia
  // ANTES de los números que la explican. Se leía al revés y confundía.
  s.mergeCells(fila, 1, fila, 3);
  const ct = s.getCell(fila, 1);
  ct.value = totalEfe > 0 ? "TOTAL CONTADO EN CAJA" : "ESTE DÍA NO SE CAPTURÓ EL CONTEO";
  ct.font = { bold: true, color: { argb: "FFFFFFFF" } };
  ct.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NARANJA } };
  const cv = s.getCell(fila, 4); cv.value = totalEfe; cv.numFmt = dinero;
  cv.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
  fila += 2;

  // ── BLOQUE 2: DE DÓNDE SALE ESE NÚMERO ───────────────────────────────────
  const aEntregar = a.efectivo - egresosEfectivo;
  const sinDesglosar = Math.round((aEntregar - totalEfe) * 100) / 100;
  s.mergeCells(fila, 1, fila, 4);
  const ch = s.getCell(fila, 1);
  ch.value = "CUENTAS DEL DÍA · así se llega a lo que debe entregar";
  ch.font = { bold: true, color: { argb: "FFFFFFFF" } };
  ch.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
  fila++;
  const linea = (lbl, val, negrita) => { const r = s.getRow(fila++); r.getCell(1).value = lbl;
    if (negrita) r.getCell(1).font = { bold: true };
    const c = r.getCell(4); c.value = val; c.numFmt = dinero; c.font = { bold: true }; };
  // La cobranza va aquí, con su nombre: NO es lo contado. Se imprime siempre,
  // aunque no hayan capturado el conteo — si no, un día con $31,389 de cobranza
  // salía en cero y parecía un arqueo vacío.
  linea("Cobranza en efectivo del día", a.efectivo);
  // egresosEfectivo es el NETO: si es negativo, entró más de lo que salió.
  if (egresosEfectivo >= 0) linea("− Gastos y retiros en efectivo", -egresosEfectivo);
  else linea("+ Entradas de caja (recuperaciones, etc.)", -egresosEfectivo);
  linea("= Efectivo a entregar", aEntregar, true);
  // La diferencia va AL FINAL, cuando el lector ya vio las cuentas de arriba.
  if (Math.abs(sinDesglosar) >= 0.01) {
    const r = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c = r.getCell(1);
    const falta = sinDesglosar > 0;
    if (totalEfe > 0) {
      // Cuando hay gastos registrados se dice la causa más probable con todas
      // sus letras: casi siempre es un gasto anotado cuyo dinero no salió de la
      // caja, no un faltante de la ejecutiva.
      // Si lo que sobra COINCIDE con un gasto anotado, se dice con nombre: es
      // casi siempre eso, y así la ejecutiva no tiene que deducirlo. Pedido por
      // Karina el 5-ago, viendo su arqueo con $100 de gasolina.
      const sobra = Math.abs(sinDesglosar);
      const culpables = (movs || []).filter((m) => !m.entrada && !m.anulado && m.metodo === "efectivo"
        && Math.abs(Number(m.monto) - sobra) < 0.01);
      const nombreGasto = culpables.length === 1
        ? (culpables[0].tipoGasto || String(culpables[0].concepto || "").split(" · ")[0] || "gasto")
        : null;
      c.value = "⚠ " + (falta ? "FALTAN" : "SOBRAN") + " contra lo contado" +
        (!falta && nombreGasto
          ? " — es justo el gasto de " + nombreGasto + " que se anotó. Revisa si ese dinero YA salió de la caja: "
            + "si todavía está adentro, cuenten los billetes DESPUÉS de sacarlo; si alguien lo pagó de su bolsa, "
            + "no va como salida de caja sino como reembolso."
          : (!falta && egresosEfectivo > 0
            ? " — revisa si algún gasto se anotó pero el dinero no salió de la caja"
            : (falta ? " — revisa la cobranza y el conteo" : "")));
    } else {
      c.value = "⚠ Sin conteo de billetes: el efectivo de arriba viene de los pagos registrados";
    }
    const color = totalEfe > 0 ? (falta ? "FFB00020" : "FF8A5A00") : "FF8A5A00";
    c.font = { bold: true, color: { argb: color } };
    c.alignment = { wrapText: true };
    const cd2 = r.getCell(4); cd2.value = Math.abs(sinDesglosar); cd2.numFmt = dinero;
    cd2.font = { bold: true, color: { argb: color } };
  } else if (totalEfe > 0) {
    const r = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c = r.getCell(1); c.value = "✓ El día CUADRA: lo contado es exactamente lo que debe entregar";
    c.font = { bold: true, color: { argb: "FF0B7247" } };
  }
  fila++;
  // Igual que en el tablero: la transferencia de los "otros movimientos" es
  // dinero que entró o salió del banco y va en este renglón, no solo en el
  // "otros +" de la ejecutiva (Karina, 5-ago).
  const movsMetX = netoMovsPorMetodo(movs);
  if (a.deposito > 0) {
    linea("Transferencias", a.transferencia - a.deposito + movsMetX.transferencia);
    linea("Depósitos Oxxo / tienda", a.deposito);
  } else {
    linea("Depósitos / transferencias", a.transferencia + movsMetX.transferencia);
  }
  if (movsMetX.transferencia) linea("   de eso, otros movimientos", movsMetX.transferencia);
  if (movsMetX.cheque) linea("Cheques (no son billetes)", movsMetX.cheque);
  // EN QUÉ SE FUE EL DINERO, por tipo. Antes el Excel decía "− Gastos $X" y para
  // saber en qué había que leer el detalle renglón por renglón.
  const gx = gastosDelDia(movs, a.porEjec);
  // Formateador propio: más abajo esta misma función declara su `pesos`, y
  // usarlo aquí arriba truena por la zona muerta del const.
  const mxn = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tiposX = Object.keys(gx.porTipo || {}).filter((k) => gx.porTipo[k] > 0).sort((p, q) => gx.porTipo[q] - gx.porTipo[p]);
  if (tiposX.length) {
    fila++;
    const rg = s.getRow(fila++); rg.getCell(1).value = "EN QUÉ SE FUE EL DINERO";
    rg.getCell(1).font = { bold: true, color: { argb: RIO } };
    for (const t of tiposX) linea("   " + t, gx.porTipo[t]);
    linea("   Total de gastos", gx.total);
    for (const sg of (gx.sobregiro || [])) {
      const r = s.getRow(fila++);
      r.getCell(1).value = "⚠ " + sg.ejecutivo + " gastó " + mxn(sg.gastos) + " y solo cobró " + mxn(sg.cobro);
      r.getCell(1).font = { bold: true, color: { argb: "FFB00020" } };
      s.mergeCells(fila - 1, 1, fila - 1, 3);
      const c = r.getCell(4); c.value = sg.aEntregar; c.numFmt = dinero;
      c.font = { bold: true, color: { argb: "FFB00020" } };
    }
    for (const db of (gx.posiblesDobles || [])) {
      const r = s.getRow(fila++);
      s.mergeCells(fila - 1, 1, fila - 1, 4);
      const c = r.getCell(1);
      c.value = "⚠ " + mxn(db.monto) + " está capturado DOS VECES (campo y dirección): " + db.concepto;
      c.font = { bold: true, color: { argb: "FFB00020" } };
    }
    fila++;
  }
  linea("Garantías", a.garantias);
  fila++;

  // ---- MORA DE CENTROS · el bloque que pidió Karina (12-ago) ----
  // Antes aquí había un solo número, y encima solo contaba a las que pagaron
  // DE MENOS: la que no pagaba nada no sumaba. Ahora es centro por centro, con
  // nombre y monto, y usa la misma regla que la mora de la semana.
  const md = moraDelDia(req.usuario, fecha);
  s.mergeCells(fila, 1, fila, 4);
  const rmc = s.getCell(fila, 1);
  rmc.value = "MORA DE CENTROS · " + md.dia + " " + md.fecha
    + "   (quién NO cubrió su cuota ESE DÍA)";
  rmc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  rmc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
  rmc.alignment = { horizontal: "center" };
  s.getRow(fila).height = 20;
  fila++;
  if (!md.centros.length) {
    s.mergeCells(fila, 1, fila, 4);
    const c = s.getCell(fila, 1);
    c.value = md.clientas === 0
      ? "Ningún centro cobra el " + md.dia.toLowerCase() + ", o todas cubrieron su cuota."
      : "Sin faltantes este día.";
    c.font = { italic: true, color: { argb: "FF6B6480" } };
    fila++;
  }
  for (const g of md.centros) {
    // Renglón del centro, con su ejecutiva
    const rc = s.getRow(fila++);
    rc.getCell(1).value = g.centro;
    rc.getCell(1).font = { bold: true };
    rc.getCell(2).value = g.ejecutivo;
    rc.getCell(2).font = { color: { argb: "FF6B6480" } };
    const ct2 = rc.getCell(4); ct2.value = g.total; ct2.numFmt = dinero;
    ct2.font = { bold: true, color: { argb: "FFB00020" } };
    // Y sus clientas, una por una: sin nombres no se puede ir a cobrar.
    for (const x of g.filas) {
      const r = s.getRow(fila++);
      r.getCell(1).value = "    " + x.clienta;
      r.getCell(1).font = { color: { argb: "FF6B6480" } };
      r.getCell(2).value = x.producto;
      r.getCell(2).font = { size: 10, color: { argb: "FF6B6480" } };
      const cp = r.getCell(3);
      cp.value = x.sigueDebiendo <= 0
        ? "se puso al corriente después"
        : (x.pagado > 0 ? "pagó " + mxn(x.pagado) + " de " + mxn(x.cuota) : "no pagó");
      cp.font = { size: 10, color: { argb: x.sigueDebiendo <= 0 ? "FF0B7247" : "FF6B6480" } };
      cp.alignment = { horizontal: "right" };
      const cf2 = r.getCell(4); cf2.value = x.faltante; cf2.numFmt = dinero;
      // Verde si ya la cubrió entre semana: ese día faltó, pero ya no debe.
      cf2.font = { color: { argb: x.sigueDebiendo <= 0 ? "FF0B7247" : "FFB00020" } };
    }
  }
  {
    const rt2 = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c = rt2.getCell(1);
    c.value = "Total de Mora del día" + (md.clientas ? "  ·  " + md.clientas + " clientas" : "");
    c.font = { bold: true };
    c.alignment = { horizontal: "right" };
    const cv2 = rt2.getCell(4); cv2.value = md.totalDia; cv2.numFmt = dinero;
    cv2.font = { bold: true, color: { argb: "FFB00020" } };
    cv2.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  }
  // EL PUENTE con la mora de la semana. Sin esto los dos reportes se ven
  // contradictorios: aquí la que se puso al corriente el miércoles SÍ aparece
  // debiendo el lunes (ese lunes no pagó), y en la mora semanal ya no.
  if (md.recuperado > 0) {
    const rr = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c = rr.getCell(1);
    c.value = "De esa mora, ya se recuperó entre semana" + (md.seRegularizaron ? "  ·  " + md.seRegularizaron + " clientas se pusieron al corriente" : "");
    c.font = { color: { argb: "FF0B7247" } };
    c.alignment = { horizontal: "right" };
    const cv3 = rr.getCell(4); cv3.value = -md.recuperado; cv3.numFmt = dinero;
    cv3.font = { color: { argb: "FF0B7247" } };
    const rp = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c2 = rp.getCell(1);
    c2.value = "SIGUE DEBIENDO de este día  (es el número que sale en «Mora de la semana»)";
    c2.font = { bold: true };
    c2.alignment = { horizontal: "right" };
    const cv4 = rp.getCell(4); cv4.value = md.pendiente; cv4.numFmt = dinero;
    cv4.font = { bold: true, color: { argb: "FFB00020" } };
    cv4.border = { top: { style: "thin" }, bottom: { style: "double" } };
  }
  {
    const rg2 = s.getRow(fila++);
    s.mergeCells(fila - 1, 1, fila - 1, 3);
    const c = rg2.getCell(1);
    c.value = "TOTAL DE MORA · acumulado de la semana al " + md.fecha;
    c.font = { bold: true, size: 12 };
    c.alignment = { horizontal: "right" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEDF5" } };
    const cv2 = rg2.getCell(4); cv2.value = md.totalSemanaAlDia; cv2.numFmt = dinero;
    cv2.font = { bold: true, size: 12, color: { argb: "FFB00020" } };
    cv2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEDF5" } };
  }
  // Lo que quedó fuera de esta mora, dicho — no se calla nada.
  {
    const f2 = md.fuera;
    const suma = f2.vencidos + f2.cuotaVariable + f2.sinCuota + f2.sinDesembolsar;
    if (suma > 0) {
      const r = s.getRow(fila++);
      s.mergeCells(fila - 1, 1, fila - 1, 4);
      r.getCell(1).value = "Fuera de esta cuenta: " + f2.vencidos + " vencidos (van en recuperación), "
        + f2.cuotaVariable + " de cuota variable, " + f2.sinCuota + " sin cuota capturada, "
        + f2.sinDesembolsar + " que aún no desembolsan.";
      r.getCell(1).font = { italic: true, size: 10, color: { argb: "FF6B6480" } };
    }
  }
  fila += 2;
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
      // DE QUIÉN es el gasto primero, y quién lo capturó después: Monse necesita
      // saber a qué ejecutiva cargarlo, no quién tecleó.
      const dueño = ejecutivoDeMov(m);
      r.getCell(2).value = [dueño ? "de " + USUARIOS[dueño].nombre : "",
        m.registradoPor || m.usuario || "",
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
    const rec = store.snapshotsDeFecha(fecha, true)[ejec];   // crudo: es la foto original
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

// Las ejecutivas del sistema, para que el tablero pueda preguntar «¿de quién es
// este gasto?» al registrar un movimiento de caja.
// El catálogo de conceptos, para que el tablero arme su menú de una sola fuente.
app.get("/api/conceptos", requiere("direccion", "admin"), (req, res) => {
  res.json({ conceptos: Object.keys(CONCEPTOS_DIR).map((k) => ({
    nombre: k, entrada: !!CONCEPTOS_DIR[k].entrada, clienta: CONCEPTOS_DIR[k].clienta || null })) });
});
app.get("/api/ejecutivos", requiere("direccion", "admin"), (req, res) => {
  res.json({ ejecutivos: idsEjecutivos(req.usuario)
    .map((id) => ({ id, nombre: USUARIOS[id].nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")) });
});

app.get("/api/movimientos", requiere("direccion", "admin"), (req, res) => {
  const fecha = req.query.fecha || hoyMX();
  // La lista trae también los anulados (marcados) para que quede el rastro a la
  // vista; los totales solo suman los vivos.
  // `ejecutivoNombre` va resuelto para que la lista diga DE QUIÉN es el gasto,
  // no solo quién lo capturó (que casi siempre es Dirección).
  const lista = movsDeFecha(fecha, req.usuario, true).sort((a, b) => b.ts - a.ts)
    .map((m) => {
      const e = ejecutivoDeMov(m), s = socioDeMov(m);
      const cl = s && PADRON.find((c) => String(c.id) === String(s));
      return { ...m,
        ejecutivoNombre: e ? USUARIOS[e].nombre : undefined,
        clientaNombre: cl ? cl.nombre : undefined };
    });
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
function altasParaApp(usuario) {
  const nombreEjec = usuario.nombre;
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
  //
  // Y TAMBIÉN los que LLEGARON A CERO. Reportado el 5-ago: «cuando liquidan, los
  // ejecutivos lo siguen teniendo en su sistema». Una clienta que termina de
  // pagar NO queda dada de baja —sigue activa con saldo cero—, así que no
  // entraba aquí y se le seguía apareciendo en la lista de cobro.
  //
  // El saldo se lee de carteraViva(), que es la ÚNICA fuente de saldo del
  // sistema: ya resuelve el corte, reparte las liquidaciones entre los créditos
  // de una misma socia y descuenta lo del ciclo anterior en las renovaciones.
  // El primer intento (5-ago) calculaba esto aparte, mirando solo desde el
  // corte, y por eso una clienta que liquidó AYER le seguía apareciendo: ayer
  // queda fuera de esa ventana. Lo cachó Karina preguntando «¿seguro?».
  //
  // ÚNICA EXCEPCIÓN, el día de hoy: a la que acaba de dar su última cuota esta
  // mañana NO se le quita todavía. Si se le borrara el renglón del teléfono
  // —y el sync REEMPLAZA el día completo— ese pago se perdería al sincronizar.
  // Desaparece mañana.
  const hoy = hoyMX();
  const corte = corteSaldos();
  const cv = carteraViva(usuario);
  const { porFecha } = pagosDeLaSemana(usuario, corte);
  const fechasLiq = {};
  liquidacionesDeLaSemana(usuario, corte, fechasLiq);
  const cobroHoy = (c) => {
    const pf = porFecha[claveCredito(c.id, c.producto)] || {};
    if ((pf[hoy] && pf[hoy].p) > 0) return true;
    return ((fechasLiq[String(c.id)] || {})[hoy] || 0) > 0;   // liquidó hoy por caja
  };
  const yaNoDebe = (c) => infoCredito(cv, c).saldoActual <= 0.009 && !cobroHoy(c);
  // NO SE QUITA LO QUE SIGUE VIVO CON ESA MISMA LLAVE. Al renovar quedan dos
  // registros con el mismo socio y producto: el viejo de baja y el nuevo. Como
  // la app borra por socio+producto, el "quitar" del viejo alcanzaba también al
  // nuevo, y en cada sondeo la app lo borraba y lo volvía a agregar. Efecto:
  // decía "algo cambió" CADA MINUTO y le repintaba la pantalla a la ejecutiva
  // mientras capturaba. El orden (quitar antes que altas) salvaba el dato, pero
  // el parpadeo era real.
  const vivasAhora = new Set(PADRON.filter((c) => mia(c) && viva(c) && !yaNoDebe(c))
    .map((c) => claveCredito(c.id, c.producto)));
  const quitar = PADRON
    .filter((c) => mia(c) && (!viva(c) || yaNoDebe(c)))
    .filter((c) => !vivasAhora.has(claveCredito(c.id, c.producto)))
    .map((c) => ({ id: String(c.id), producto: c.producto }));
  return { altas, centros, quitar };
}

// DATOS VIVOS PARA LA APP. Los montos de cada clienta viven EMBEBIDOS en el HTML
// de cada app: se escribieron el día que se generó el archivo y ahí se quedaron.
// Cuando Monse manda una plantilla nueva, el padrón del servidor se actualiza y
// el teléfono NO — la ejecutiva sigue viendo la cuota del mes pasado. Reportado
// por Julio el 7-ago: sus tres MAGNUS traían la mensualidad de un mes anterior
// (es decreciente) y Martha seguía con el crédito viejo de $50,000.
//
// Y EL PLAZO NUNCA VIAJÓ. El padrón lo tiene desde la plantilla, pero ningún
// HTML lo incluye, así que la app se lo pedía a mano a la ejecutiva —y encima
// preguntaba «¿de cuántas SEMANAS?» a los créditos MENSUALES de MAGNUS.
//
// Esto manda los datos frescos en cada carga: se acabó el archivo que envejece.
function datosVivosParaApp(usuario) {
  const mia = (c) => norm(c.ejecutivo) === norm(usuario.nombre);
  const hoy = hoyMX();
  const corte = corteSaldos();
  const cv = carteraViva(usuario);
  const { porFecha } = pagosDeLaSemana(usuario, corte);

  // EL SALDO SE MANDA SIN LO QUE ELLA CAPTURÓ HOY. La app resta en pantalla su
  // propia captura del día (`saldoNeto = saldo − lo cobrado − sus abonos`), así
  // que si el saldo ya viniera descontado se restaría DOS VECES y la clienta
  // aparecería debiendo de menos. Se le devuelve solo lo suyo de hoy.
  //
  // Lo de DIRECCIÓN (folio DIR-…) NO se devuelve: una liquidación que capturó
  // Monse tiene que verse ya descontada en el teléfono de la ejecutiva. Eso era
  // exactamente lo que no bajaba.
  const suyoHoy = {};   // socio → liquidado/recuperado por ELLA hoy
  for (const m of movsDeFecha(hoy, usuario)) {
    if (String(m.folio || "").startsWith("DIR-")) continue;
    if (!/^(liquidaci|recuperaci)/i.test(tipoDeMov(m) || "")) continue;
    const soc = socioDeMov(m);
    if (soc) suyoHoy[soc] = (suyoHoy[soc] || 0) + (Number(m.monto) || 0);
  }

  const bolsa = Object.assign({}, suyoHoy);   // se consume: una liquidación por socia
  return PADRON
    .filter((c) => mia(c) && c.activa !== false && c.estatus !== "BAJA")
    .map((c) => {
      const info = infoCredito(cv, c);
      const pagoHoy = ((porFecha[claveCredito(c.id, c.producto)] || {})[hoy] || {}).p || 0;
      // Nunca se devuelve más de lo que de verdad se le descontó a ESTE crédito.
      const soc = String(c.id);
      const devuelve = Math.min(bolsa[soc] || 0, info.liquidado || 0);
      if (devuelve > 0) bolsa[soc] -= devuelve;
      return {
        id: soc, producto: c.producto,
        saldo: Math.max(0, info.saldoActual + pagoHoy + devuelve),
        cuota: Number(c.cuota) || 0,
        plazo: Number(c.plazo) || 0,
        unidad: c.unidad || "",
        dia: c.diaPago || "",
        importe: Number(c.importe) || 0,
        mora: Number(c.mora) || 0,
        etiqueta: c.etiqueta || "",
        desembolso: String(c.desembolso || "").slice(0, 10),
      };
    });
}

// El paquete completo que baja al teléfono: altas, bajas y montos al día.
// Lo pide `vivos.js` al abrir, cada minuto, al recuperar señal y al volver a la
// pestaña — para que un cambio de Dirección aparezca solo, sin recargar y sin
// que nadie tenga que regenerar el archivo de nadie.
function paqueteVivo(usuario) {
  const { altas, centros, quitar } = altasParaApp(usuario);
  // `hoy`: la fecha OFICIAL del servidor viaja en cada paquete. El vigilante de
  // medianoche la usa como única referencia — comparar contra el reloj del
  // teléfono recargaba la app CADA MINUTO cuando ese reloj andaba mal (le pasó
  // a Christopher el 12-ago, capturando pagos).
  return { altas, centros, quitar, vivos: datosVivosParaApp(usuario),
    correcciones: correccionesParaApp(usuario), ts: Date.now(), hoy: hoyMX() };
}

// LAS CORRECCIONES DE DIRECCIÓN, para que la ejecutiva las vea en su teléfono.
// Si Monse le anula un pago, no basta con que el tablero cuadre: la ejecutiva
// tiene que ver el renglón corregido, o al día siguiente vuelve a capturarlo.
// Se mandan solo las de HOY: los días pasados ya están cerrados y su app
// arranca limpia cada mañana.
function correccionesParaApp(usuario) {
  const fecha = hoyMX();
  const rec = store.snapshotsDeFecha(fecha)[usuario.id];       // ya vienen corregidos
  if (!rec) return [];
  const hayAjuste = store.ajustesCobranza().some((a) => a.fecha === fecha && a.ejecutivo === usuario.id);
  if (!hayAjuste) return [];
  let data = rec.snapshot;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return []; } }
  const out = [];
  const meter = (nodo, centro) => {
    for (const clave in (nodo || {})) {
      const r = nodo[clave];
      if (!r || typeof r !== "object") continue;
      if (!r._ajustadoPor && !r._anuladoPorDireccion) continue;
      out.push({ clave, centro: centro || null, pago: r.pago || 0, garantia: r.garantia || 0,
        solidario: r.solidario || 0, anulado: !!r._anuladoPorDireccion, por: r._ajustadoPor || "Dirección" });
    }
  };
  meter(data.regI, null);
  for (const c in (data.reg || {})) meter(data.reg[c], c);
  return out;
}
app.get("/api/vivos", requiere("ejecutivo"), (req, res) => {
  res.json(paqueteVivo(req.usuario));
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
  // TODO EL PAQUETE VIVO EN UNO. Antes esto eran dos scripts escritos a mano
  // aquí dentro; la lógica se mudó a `public/vivos.js`, que además lo vuelve a
  // pedir cada minuto. El primer paquete viaja incrustado para que al abrir ya
  // esté al día aunque el teléfono no tenga señal para el primer sondeo.
  const inyecciones =
    '<script src="/sync.js"></script><script src="/captura-agil.js"></script>' +
    "<script>window.__VIVOS0=" + JSON.stringify(paqueteVivo(req.usuario)) + ";</script>" +
    '<script src="/vivos.js"></script>';
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
// MARTHA PATRICIA VASQUEZ HERNANDEZ (11113236921, Foxi Plus - 2) pasa de
// Christopher a JULIO: la clienta es de su ruta. Lo pidió Karina el 30-jul.
// Va como corrección única (centinela) para que el SERVIDOR quede igual que las
// apps, donde ya se movió. El saldo NO se toca: solo cambia el ejecutivo, y
// queda `ejecutivo_anterior` como rastro. De aquí en adelante esto ya no
// necesita programación: el tablero tiene el botón "Reasignar".
function reasignarMarthaPatricia30jul() {
  const CENTINELA = "MIGR-MARTHA-JULIO-2026-07-30";
  const ID = "11113236921", PROD = "Foxi Plus - 2";
  if (store.cambiosPadron().some((c) => c.centinela === CENTINELA)) return;   // ya aplicada
  const c = PADRON.find((x) => String(x.id) === ID && x.activa !== false && x.estatus !== "BAJA");
  if (!c) return;                                   // no está: nada que hacer
  if (norm(c.ejecutivo) === norm("Julio")) return;   // ya es de Julio
  store.agregarCambioPadron({
    tipo: "ajuste", id: ID, producto: c.producto || PROD,
    campos: { ejecutivo: "Julio" },
    motivo: "La clienta es de la ruta de Julio (la tenía registrada Christopher)",
    saldoAnterior: c.saldo || 0, fecha: hoyMX(), por: "Karina (desarrollo)",
    centinela: CENTINELA, ts: Date.now(),
  });
  refrescarPadron();
  console.log("[reasignación] MARTHA PATRICIA 11113236921 → Julio (saldo intacto)");
}

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

// Reparación ÚNICA del sábado 8-ago-2026. Ese día entraron liquidaciones que no
// dijeron a qué crédito iban (el movimiento sólo guardaba el socio), así que el
// sistema las repartió entre los créditos de la socia en orden fijo y se las
// comió el primero. Resultado: un crédito ya pagado seguía debiendo, y otro
// aparecía rebajado de más.
//
// El crédito correcto NO se adivina: se dedujo con la cuenta que empata al peso
//   saldo del crédito − cuota que pagó esa semana = monto de la liquidación
// y en las dos de aquí abajo el resultado es único (ningún otro crédito suyo da
// ese número). Las que NO empatan solas se dejan fuera a propósito: las contesta
// la ejecutiva que cobró, no una corazonada.
//
// No se mueve un peso: el monto es el mismo. Sólo se dice a qué crédito
// pertenece, que era el dato que faltaba. Corre una sola vez (centinela).
function repararLiquidacionesDel8ago() {
  const CENTINELA = "MIGR-LIQ-CREDITO-2026-08-08";
  if (store.todosMovimientos().some((m) => m.folio === CENTINELA)) return;   // ya aplicada
  const FIX = [
    // folio,                          socio,          crédito al que iba,   comprobación
    ["EJE-CHRISTOPHER-CHR-0808-01", "11112847319", "Micro-Especial",  "12,968 − 1,621 = 11,347"],
    ["EJE-CHRISTOPHER-CHR-0808-02", "11113102023", "Grupal-Micro",    "3,520 − 320 = 3,200"],
  ];
  let n = 0;
  for (const [folio, socio, producto, cuenta] of FIX) {
    const m = store.todosMovimientos().find((x) => x.folio === folio);
    if (!m) { console.error("[reparación 8-ago] no encuentro el movimiento " + folio); continue; }
    if (String(m.socio || "") !== socio) { console.error("[reparación 8-ago] " + folio + " no es de la socia " + socio); continue; }
    if (m.producto) continue;                        // ya tiene crédito: no se pisa
    // El crédito tiene que existir y ser de ella: si el padrón cambió, mejor no tocar nada.
    const cred = PADRON.find((c) => String(c.id).split("|")[0] === socio
      && norm(c.producto) === norm(producto) && c.activa !== false && c.estatus !== "BAJA");
    if (!cred) { console.error("[reparación 8-ago] " + socio + " ya no tiene activo un \"" + producto + "\""); continue; }
    store.corregirMovimiento(folio, { producto: cred.producto,
      productoPor: "Karina (desarrollo) · autorizado por Karina el 8-ago",
      productoMotivo: "La liquidación era de este crédito y el sistema se la aplicó a otro. " + cuenta });
    n++;
  }
  store.agregarMovimiento({ folio: CENTINELA, fecha: "2000-01-01", monto: 0,
    concepto: "migración", anulado: true, usuario: "karina", ts: Date.now() });
  console.log(`[reparación] liquidaciones del 8-ago: ${n} movimientos ligados a su crédito`);
}

// ALMA ROSARIO CAMACHO GONZALEZ (11112919388), 10-ago-2026. Su liquidación del
// sábado quedó sin crédito y por eso los $5,440 seguían SUELTOS: se le comían el
// saldo a cualquier crédito que le abrieran. Ese lunes le intentaron re-dar
// crédito tres veces y las tres nacieron en cero — no era el recrédito, era este
// dato faltante.
//
// Karina confirmó que fue el GRUPAL-MICRO, y cuadra por los tres lados:
//   · $5,440 = 10 cuotas exactas de $544, la cuota del Micro (la del Basico es $720)
//   · el Micro debía $5,984; el Basico sólo $2,160 — nadie paga $5,440 por $2,160
//   · el 8-ago ella misma lo puso en cero con motivo "LIQUIDO", y el 10-ago Anel
//     le hizo recrédito a ese mismo crédito
//
// No se mueve un peso: sólo se dice a qué crédito pertenece. Con esto el
// Grupal-Basico deja de aparecer liquidado y recupera su saldo real.
function repararAlmaRosario10ago() {
  const CENTINELA = "MIGR-LIQ-ALMAROSARIO-2026-08-10";
  if (store.todosMovimientos().some((m) => m.folio === CENTINELA)) return;   // ya aplicada
  const FOLIO = "EJE-NERI-NER-0808-03", SOCIO = "11112919388", PROD = "Grupal-Micro";
  const m = store.todosMovimientos().find((x) => x.folio === FOLIO);
  if (!m) console.error("[reparación Alma Rosario] no encuentro " + FOLIO);
  else if (String(m.socio || "") !== SOCIO) console.error("[reparación Alma Rosario] " + FOLIO + " no es de esa socia");
  else if (m.producto) console.error("[reparación Alma Rosario] ya tenía crédito: " + m.producto);
  else {
    store.corregirMovimiento(FOLIO, { producto: PROD,
      productoPor: "Karina (desarrollo) · confirmado por Karina el 10-ago",
      productoMotivo: "La liquidación de $5,440 era del Grupal-Micro (10 cuotas de $544; debía $5,984). "
        + "Sin crédito se la comía el Grupal-Basico y hacía nacer en cero cada recrédito." });
    console.log("[reparación] Alma Rosario: la liquidación de $5,440 ligada al Grupal-Micro");
  }
  store.agregarMovimiento({ folio: CENTINELA, fecha: "2000-01-01", monto: 0,
    concepto: "migración", anulado: true, usuario: "neri", ts: Date.now() });
}

store.init().then(() => {
  refrescarPadron();
  console.log(`Padrón cargado: ${PADRON.length} clientas`);
  // MOTOR DE REGLAS: se comprueba contra los ejemplos que validó la contadora.
  // Si un cambio en las tasas o en el redondeo deja de reproducirlos, se grita
  // aquí — vale más un servidor que avisa que uno que cobra mal en silencio.
  try {
    const ap = motor.autoprueba();
    if (ap.ok) console.log("[motor de reglas] OK · reproduce los " + ap.casos.length + " ejemplos validados");
    else {
      console.error("[motor de reglas] ⚠️  NO reproduce los ejemplos validados:");
      for (const c of ap.casos) if (!c.ok) console.error("   ✗ " + c.caso + " · espera " + c.espera + " · obtuvo " + c.obtuvo);
    }
  } catch (e) { console.error("[motor de reglas] no se pudo leer:", e.message); }
  recuperarMovimientosHistoricos();
  repararAnuladosFalsos();
  repararCapturaKarina24jul();
  reasignarMarthaPatricia30jul();
  repararLiquidacionesDel8ago();
  repararAlmaRosario10ago();
  repararCarteraJulio();
  aplicarCorteDeLaPlantilla();
  app.listen(PORT, () => console.log(`FOOAX cobranza · puerto ${PORT}`));
}).catch((e) => { console.error("Error al iniciar el store:", e); process.exit(1); });
