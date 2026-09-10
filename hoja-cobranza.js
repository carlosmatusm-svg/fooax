// FOOAX · HOJA DE COBRANZA AUTOMÁTICA (v4 del Excel de Dirección, generada
// por el sistema). Reproduce el libro de 25 pestañas que la Ing. Monse armaba
// a mano cada semana — pero lleno desde los datos vivos: capturas de las
// apps, cartera, mora, motor de intereses y renovaciones. Lo que antes eran
// "celdas amarillas para llenar" aquí ya viene puesto.
//
// Diseño: este módulo NO importa nada del servidor — recibe un contexto (ctx)
// con las funciones y datos que necesita. Así se prueba solo y no engorda
// server.js. Los totales van como FÓRMULA con resultado cacheado: Excel los
// recalcula si alguien edita, y la vista previa no sale en blanco.

"use strict";

const LEMA = "Creciendo juntas, avanzando siempre";
const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const MONEDA = '"$"#,##0.00';
const PCT = "0.0%";
const AURORA = "FFF1228E", RIO = "FF324AB6", VERDE = "FF0B7247", GRIS = "FFEDEFF7", ROJO = "FFB00020", AMBAR = "FFF2BB06";

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ---------- helpers de armado ----------
function tit(ws, fila, texto, cols, color) {
  ws.mergeCells(fila, 1, fila, cols);
  const c = ws.getRow(fila).getCell(1);
  c.value = texto;
  c.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color || AURORA } };
  c.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(fila).height = 24;
}
function sub(ws, fila, texto, cols) {
  ws.mergeCells(fila, 1, fila, cols);
  const c = ws.getRow(fila).getCell(1);
  c.value = texto;
  c.font = { italic: true, size: 9, color: { argb: "FF6B6480" } };
}
function enc(ws, fila, textos) {
  textos.forEach((t, i) => {
    const c = ws.getRow(fila).getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
  });
}
function dinero(ws, fila, col, v, negrita) {
  const c = ws.getRow(fila).getCell(col);
  c.value = r2(v); c.numFmt = MONEDA;
  if (negrita) c.font = { bold: true };
  return c;
}
// Fórmula con resultado: Excel recalcula, la vista previa no queda en blanco.
function formula(ws, fila, col, f, resultado, fmt) {
  const c = ws.getRow(fila).getCell(col);
  c.value = { formula: f, result: r2(resultado) };
  c.numFmt = fmt || MONEDA;
  c.font = { bold: true };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
  return c;
}
function colLetra(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---------- datos base ----------
function fechasDeLaSemana(lunes) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(lunes + "T12:00:00");
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
function etiquetaSemana(fechas) {
  const M = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const a = fechas[0].split("-").map(Number), b = fechas[5].split("-").map(Number);
  if (a[1] === b[1]) return a[2] + " al " + b[2] + " de " + M[b[1] - 1] + " " + b[0];
  return a[2] + " de " + M[a[1] - 1] + " al " + b[2] + " de " + M[b[1] - 1] + " " + b[0];
}
function grupoDe(producto) {
  const p = String(producto || "").toLowerCase();
  if (p.includes("basico") || p.includes("básico")) return "BASICO";
  if (p.includes("micro")) return "MICROEMPRESAS";
  if (p.includes("adicional")) return "ADICIONALES";
  return "INDIVIDUALES";   // individuales, foxi, comadre, magnus, pago único, reestructuras
}
// La escalera del SUGERIDO — copiada TAL CUAL de la fórmula M de la CARTERA
// MAESTRA v4: con mora no hay sugerido; individual/foxi sube por peldaños
// fijos; grupal sube 20% redondeado a $500.
function sugeridoDe(producto, importe, conMora) {
  if (conMora || !(importe > 0)) return null;
  const p = String(producto || "").toLowerCase();
  if (p.includes("individual") || p.includes("foxi")) {
    if (importe <= 5000) return 7000;
    if (importe <= 7000) return 10000;
    if (importe <= 10000) return 12000;
    if (importe <= 12000) return 15000;
    return importe;
  }
  return Math.round((importe * 1.2) / 500) * 500;
}

// Las capturas de la semana, día por día y ejecutiva por ejecutiva, con las
// correcciones de Dirección ya aplicadas (snapshotsDeFecha las trae puestas).
function capturasDeLaSemana(ctx, usuario, fechas) {
  const rows = [];
  for (const fecha of fechas) {
    const snaps = ctx.store.snapshotsDeFecha(fecha);
    for (const id of ctx.idsEjecutivos(usuario, fecha)) {
      const rec = snaps[id];
      if (!rec) continue;
      let data = rec.snapshot;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch { continue; } }
      const meter = (nodo, centro) => {
        for (const clave in (nodo || {})) {
          const r = nodo[clave];
          if (!r || typeof r !== "object") continue;
          const pago = Number(r.pago) || 0, gar = Number(r.garantia) || 0, sol = Number(r.solidario) || 0;
          if (pago <= 0 && gar <= 0 && sol <= 0) continue;
          const partes = String(clave).split("|");
          rows.push({ fecha, dia: DIAS[fechas.indexOf(fecha)], ejecId: id,
            ejec: ctx.USUARIOS[id] ? ctx.USUARIOS[id].nombre : id,
            centro: centro || "INDIVIDUAL", clienta: partes[2] || partes[0],
            socio: partes[0], producto: partes[1] || "",
            destino: centro ? centro : "INDIVIDUAL",
            pago, gar, sol, forma: String(r.forma || "E").toUpperCase() });
        }
      };
      meter(data && data.regI, null);
      for (const cn in ((data && data.reg) || {})) meter(data.reg[cn], cn);
    }
  }
  return rows;
}

// La cartera maestra viva: un renglón por crédito activo, con el motor y la
// mora de la semana ya puestos, y la escalera de renovación calculada.
function carteraMaestra(ctx, usuario, lunes) {
  const cv = ctx.carteraViva(usuario);
  const mora = ctx.moraDeLaSemana(usuario, lunes);
  const faltaPor = {};   // socio|producto → faltante de la semana
  for (const g of (mora.dias || []))
    for (const x of (g.filas || []))
      faltaPor[String(x.socio) + "|" + ctx.norm(x.producto || "")] =
        (faltaPor[String(x.socio) + "|" + ctx.norm(x.producto || "")] || 0) + (x.faltante || 0);
  const mios = new Set(ctx.idsEjecutivos(usuario, lunes).map((id) => ctx.norm(ctx.USUARIOS[id].nombre)));
  const filas = [];
  for (const c of ctx.PADRON) {
    if (c.activa === false || c.estatus === "BAJA") continue;
    if (!mios.has(ctx.norm(c.ejecutivo))) continue;
    const info = ctx.infoCredito(cv, c);
    if (info.saldoActual <= 0.009) continue;                  // liquidadas fuera
    const vencida = ctx.esVencido(c) || ctx.vencidaPorPlazo(c, info);
    const moraSem = r2(faltaPor[String(c.id) + "|" + ctx.norm(c.producto)] || 0);
    // IMPORTE = el PRÉSTAMO (como en el v4). Las altas del tablero lo traen;
    // a los créditos de plantilla se les despeja de la cuota con la tasa real
    // del motor: cuota = D/plazo + D·t/4·(1+IVA)  →  D = cuota / (1/plazo +
    // t/4·(1+IVA)). Comprobado: cuota 588 a 24 sem con 6.32% da $9,800 exacto.
    let importe = Number(c.importe) || 0;
    if (!importe) {
      const rr = ctx.motor.resolverCredito(c);
      const pl = Number(c.plazo) || 0, cu = Number(c.cuota) || 0;
      if (rr && rr.ok && rr.producto && !ctx.esCuotaVariable(c.producto) && pl > 0 && cu > 0) {
        const t = Number(rr.producto.tasaMensual) || 0;
        const iva = ctx.motor.reglas().iva != null ? ctx.motor.reglas().iva : 0.16;
        const factor = 1 / pl + (t / 4) * (1 + iva);
        if (factor > 0) importe = Math.round((cu / factor) / 50) * 50;
      }
      if (!importe) importe = Number(c.saldo) || 0;
    }
    const totalPagar = r2((info.pagado || 0) + (info.liquidado || 0) + info.saldoActual);
    const avance = totalPagar > 0 ? r2(((info.pagado || 0) + (info.liquidado || 0)) / totalPagar) : 0;
    const conMora = moraSem > 0 || vencida;
    const sugerido = sugeridoDe(c.producto, importe, conMora);
    const reqAnalisis = sugerido != null && ((sugerido - importe) >= 3000 || importe >= 10000);
    const proxima = !conMora && avance >= 0.7 && sugerido != null && sugerido > importe;
    const np = ctx.numeroDePago(c, info.saldoActual);
    filas.push({ noCentro: c.noCentro || "", centro: c.centro || "INDIVIDUAL",
      ejecutivo: c.ejecutivo || "", clienta: c.nombre, socio: String(c.id),
      producto: c.producto || "", importe, saldo: r2(info.saldoActual),
      mora: moraSem, estatus: vencida ? "VENCIDO" : (c.estatus || "VIGENTE"),
      avance, sugerido, reqAnalisis, proxima,
      crecimiento: proxima ? r2(sugerido - importe) : 0,
      plazo: Number(c.plazo) || null, semanaActual: np && np.pago != null ? np.pago : null,
      otorgamiento: String(c.desembolso || "").slice(0, 10) || "",
      cuota: Number(c.cuota) || 0, diaPago: String(c.diaPago || "").toUpperCase(),
      grupo: grupoDe(c.producto) });
  }
  filas.sort((a, b) => String(a.ejecutivo).localeCompare(String(b.ejecutivo), "es")
    || String(a.centro).localeCompare(String(b.centro), "es")
    || String(a.clienta).localeCompare(String(b.clienta), "es"));
  return filas;
}

// Teoría del motor por crédito: abono a capital, interés semanal e IVA — la
// misma aritmética de las hojas BASICO/MICRO/etc. del v4, pero con la tasa
// REAL del catálogo de cada producto (no una tasa fija por hoja).
function teoriaDe(ctx, fila) {
  const r = ctx.motor.resolverCredito({ producto: fila.producto, plazo: fila.plazo,
    cuota: fila.cuota, id: fila.socio, nombre: fila.clienta });
  if (!r || !r.ok || !r.producto || ctx.esCuotaVariable(fila.producto)) {
    // Sin catálogo o cuota variable (MAGNUS): la teoría no aplica, va la real.
    return { abono: 0, interes: 0, iva: 0, teorico: 0, cuotaReal: fila.cuota || 0, sinTeoria: true };
  }
  const p = r.producto;
  const plazo = fila.plazo || (p.plazos && p.plazos[0]) || 0;
  const tasa = Number(p.tasaMensual) || 0;             // mensual, en fracción (0.0567)
  const iva = p.iva != null ? Number(p.iva) : (ctx.motor.reglas().iva != null ? ctx.motor.reglas().iva : 0.16);
  const abono = plazo > 0 ? fila.importe / plazo : 0;
  const interes = (fila.importe * tasa) / 4;
  const ivaM = p.metodo === "B" ? 0 : interes * iva;   // MAGNUS (método B) va sin IVA
  return { abono: r2(abono), interes: r2(interes), iva: r2(ivaM),
    teorico: r2(abono + interes + ivaM), cuotaReal: fila.cuota || 0, sinTeoria: false };
}

// ---------- el libro ----------
async function generar(ctx, ExcelJS, usuario, lunesOpt) {
  const lunes = /^\d{4}-\d{2}-\d{2}$/.test(String(lunesOpt || "")) ? lunesOpt : ctx.lunesDeLaSemana(ctx.hoyMX());
  const fechas = fechasDeLaSemana(lunes);
  const semanaTxt = etiquetaSemana(fechas);
  const hoy = ctx.hoyMX();

  const captura = capturasDeLaSemana(ctx, usuario, fechas);
  const cartera = carteraMaestra(ctx, usuario, lunes);
  const ejecutivas = ctx.idsEjecutivos(usuario, lunes).map((id) => ({ id, nombre: ctx.USUARIOS[id].nombre }));
  const mora = ctx.moraDeLaSemana(usuario, lunes);

  // Índices que varias pestañas comparten.
  const capPorEjecDia = {}, capPorEjec = {}, capPorCentroDia = {}, capPorCentro = {};
  for (const r of captura) {
    const tot = r.pago + r.gar + r.sol;
    capPorEjecDia[r.ejec + "|" + r.dia] = r2((capPorEjecDia[r.ejec + "|" + r.dia] || 0) + tot);
    capPorEjec[r.ejec] = r2((capPorEjec[r.ejec] || 0) + tot);
    capPorCentroDia[r.centro + "|" + r.dia] = r2((capPorCentroDia[r.centro + "|" + r.dia] || 0) + tot);
    capPorCentro[r.centro] = r2((capPorCentro[r.centro] || 0) + tot);
  }
  const moraPorEjecDia = {}, moraPorEjec = {};
  for (const g of (mora.dias || []))
    for (const x of (g.filas || [])) {
      moraPorEjecDia[x.ejecutivo + "|" + g.dia] = r2((moraPorEjecDia[x.ejecutivo + "|" + g.dia] || 0) + (x.faltante || 0));
      moraPorEjec[x.ejecutivo] = r2((moraPorEjec[x.ejecutivo] || 0) + (x.faltante || 0));
    }

  const wb = new ExcelJS.Workbook();
  wb.creator = "FOOAX · Hoja de Cobranza automática";

  // ===== PORTADA =====
  {
    const ws = wb.addWorksheet("PORTADA");
    ws.columns = [{ width: 4 }, { width: 26 }, { width: 26 }, { width: 26 }, { width: 26 }];
    tit(ws, 2, "FOOAX", 5);
    tit(ws, 3, "HOJA DE COBRANZA AUTOMÁTICA", 5, RIO);
    sub(ws, 4, LEMA + " · generada por el sistema el " + hoy, 5);
    ws.getRow(6).getCell(2).value = "SEMANA OPERATIVA"; ws.getRow(6).getCell(2).font = { bold: true };
    ws.getRow(7).getCell(2).value = semanaTxt;
    const prestamoTotal = cartera.reduce((t, x) => t + x.importe, 0);
    const cobranzaSemanal = captura.reduce((t, x) => t + x.pago + x.gar + x.sol, 0);
    let ivaSemanal = 0;
    for (const f of cartera) { const t = teoriaDe(ctx, f); ivaSemanal += t.iva; }
    enc(ws, 9, ["", "PRÉSTAMO TOTAL (cartera viva)", "COBRANZA DE LA SEMANA (real)", "IVA SEMANAL (teórico)"]);
    dinero(ws, 10, 2, prestamoTotal, true); dinero(ws, 10, 3, cobranzaSemanal, true); dinero(ws, 10, 4, ivaSemanal, true);
    sub(ws, 12, "Todo este libro se llena solo desde el sistema: capturas de las apps, cartera, mora, motor de intereses y renovaciones. Nada que pegar.", 5);
  }

  // ===== INSTRUCCIONES =====
  {
    const ws = wb.addWorksheet("INSTRUCCIONES MONSE");
    ws.columns = [{ width: 4 }, { width: 120 }];
    tit(ws, 1, "FOOAX · CÓMO USAR ESTA HOJA (versión automática)", 2);
    const lineas = [
      "",
      "Esta hoja la genera el SISTEMA: ya viene llena. Lo que antes se pegaba o se llenaba a mano, aquí ya está puesto.",
      "",
      "• Ya NO se pega la cobranza: la pestaña CAPTURA DE LA SEMANA trae lo capturado por las ejecutivas, con las correcciones de Dirección aplicadas.",
      "• Ya NO se llenan plazos, cuotas ni fechas: la CARTERA MAESTRA trae PLAZO, No.SEMANA, FECHA DE OTORGAMIENTO y CUOTA del sistema.",
      "• Ya NO se captura la mora del día: el TABLERO SEMANAL la trae calculada por día y por ejecutiva.",
      "• Los textos para el grupo de WhatsApp (cierre del día, mora, otorgamiento) están listos para copiar en sus pestañas.",
      "• El PANEL DE CONTROL comprueba solo que todo cuadre: si algo dice ✗, avisa a Karina.",
      "",
      "Para bajar la versión de otra semana: en el tablero, botón de la Hoja de Cobranza eligiendo el lunes de esa semana.",
      "",
      LEMA + ".",
    ];
    lineas.forEach((t, i) => { ws.getRow(3 + i).getCell(2).value = t; });
  }

  // ===== CAPTURA DE LA SEMANA (antes «PEGAR CAPTURA») =====
  {
    const ws = wb.addWorksheet("PEGAR CAPTURA");
    ws.columns = [{ width: 4 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 22 }, { width: 30 }, { width: 13 }, { width: 13 }, { width: 20 }, { width: 16 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 12 }];
    tit(ws, 1, "FOOAX · CAPTURA DE LA SEMANA (ya no se pega nada: es lo capturado en las apps)", 14);
    sub(ws, 2, LEMA + " · con las correcciones de Dirección aplicadas · semana " + semanaTxt, 14);
    enc(ws, 4, ["", "FECHA", "DÍA", "No.CENTRO", "CENTRO", "CLIENTA", "No.SOCIO", "EJECUTIVO", "PRODUCTO", "DESTINO", "PAGO", "GARANTÍA", "SOLIDARIO", "FORMA"]);
    let f = 5; let tP = 0, tG = 0, tS = 0;
    const numCentro = {};
    for (const c of cartera) if (c.noCentro) numCentro[ctx.norm(c.centro)] = c.noCentro;
    for (const r of captura) {
      const row = ws.getRow(f);
      row.getCell(2).value = r.fecha; row.getCell(3).value = r.dia;
      row.getCell(4).value = numCentro[ctx.norm(r.centro)] || "";
      row.getCell(5).value = r.centro; row.getCell(6).value = r.clienta;
      row.getCell(7).value = r.socio; row.getCell(8).value = r.ejec;
      row.getCell(9).value = r.producto; row.getCell(10).value = r.destino;
      dinero(ws, f, 11, r.pago); dinero(ws, f, 12, r.gar); dinero(ws, f, 13, r.sol);
      row.getCell(14).value = { E: "EFECTIVO", T: "TRANSFERENCIA", D: "DEPÓSITO", M: "MIXTO", CH: "CHEQUE" }[r.forma] || r.forma;
      tP += r.pago; tG += r.gar; tS += r.sol; f++;
    }
    ws.getRow(f).getCell(6).value = "TOTAL"; ws.getRow(f).getCell(6).font = { bold: true };
    formula(ws, f, 11, "SUM(K5:K" + (f - 1) + ")", tP);
    formula(ws, f, 12, "SUM(L5:L" + (f - 1) + ")", tG);
    formula(ws, f, 13, "SUM(M5:M" + (f - 1) + ")", tS);
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ===== CARTERA MAESTRA =====
  {
    const ws = wb.addWorksheet("CARTERA MAESTRA");
    ws.columns = [{ width: 4 }, { width: 9 }, { width: 20 }, { width: 13 }, { width: 30 }, { width: 14 }, { width: 19 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 12 }, { width: 9 }, { width: 11 }, { width: 12 }, { width: 8 }, { width: 11 }, { width: 13 }, { width: 12 }];
    tit(ws, 1, "FOOAX · CARTERA MAESTRA (viva, del sistema — nada que actualizar a mano)", 18);
    sub(ws, 2, "Créditos activos con saldo: " + cartera.length + " · saldo = lo que la clienta debe HOY · mora = lo que faltó esta semana · semana " + semanaTxt, 18);
    enc(ws, 4, ["", "No.CENTRO", "CENTRO", "EJECUTIVO", "CLIENTA", "No.SOCIO", "PRODUCTO", "IMPORTE", "SALDO", "MORA", "ESTATUS", "AVANCE", "SUGERIDO", "REQ.ANÁLISIS", "PLAZO", "No.SEMANA", "OTORGAMIENTO", "CUOTA"]);
    let f = 5;
    for (const c of cartera) {
      const row = ws.getRow(f);
      row.getCell(2).value = c.noCentro; row.getCell(3).value = c.centro;
      row.getCell(4).value = c.ejecutivo; row.getCell(5).value = c.clienta;
      row.getCell(6).value = c.socio; row.getCell(7).value = c.producto;
      dinero(ws, f, 8, c.importe); dinero(ws, f, 9, c.saldo);
      const cm = dinero(ws, f, 10, c.mora);
      if (c.mora > 0) cm.font = { bold: true, color: { argb: ROJO } };
      row.getCell(11).value = c.estatus;
      if (c.estatus === "VENCIDO") row.getCell(11).font = { bold: true, color: { argb: ROJO } };
      const av = row.getCell(12); av.value = c.avance; av.numFmt = PCT;
      if (c.sugerido != null) dinero(ws, f, 13, c.sugerido);
      row.getCell(14).value = c.sugerido == null ? "" : (c.reqAnalisis ? "SÍ" : "No");
      row.getCell(15).value = c.plazo; row.getCell(16).value = c.semanaActual;
      row.getCell(17).value = c.otorgamiento; dinero(ws, f, 18, c.cuota);
      f++;
    }
    ws.getRow(f).getCell(5).value = "TOTAL"; ws.getRow(f).getCell(5).font = { bold: true };
    formula(ws, f, 8, "SUM(H5:H" + (f - 1) + ")", cartera.reduce((t, x) => t + x.importe, 0));
    formula(ws, f, 9, "SUM(I5:I" + (f - 1) + ")", cartera.reduce((t, x) => t + x.saldo, 0));
    formula(ws, f, 10, "SUM(J5:J" + (f - 1) + ")", cartera.reduce((t, x) => t + x.mora, 0));
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ===== hojas por producto (BASICO / MICROEMPRESAS / ADICIONALES / INDIVIDUALES) =====
  const totalesGrupo = {};
  for (const grupo of ["INDIVIDUALES", "BASICO", "MICROEMPRESAS", "ADICIONALES"]) {
    const ws = wb.addWorksheet(grupo);
    ws.columns = [{ width: 4 }, { width: 11 }, { width: 9 }, { width: 24 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }];
    tit(ws, 1, "FOOAX · HOJA DE COBRANZA · " + grupo, 12);
    sub(ws, 2, "Semana " + semanaTxt + " · teoría del MOTOR real de cada producto (abono a capital, interés semanal, IVA) vs la cuota y lo cobrado", 12);
    enc(ws, 4, ["", "DÍA", "No.CENTRO", "CENTRO", "PRESTAMO", "ABONO", "INTERES", "IVA", "TOTAL TEÓRICO", "CUOTA REAL", "COBRADO (app)", "DIF. COBRADO−CUOTA"]);
    let f = 5;
    const tot = { prestamo: 0, abono: 0, interes: 0, iva: 0, teorico: 0, cuota: 0, cobrado: 0 };
    for (let di = 0; di < 6; di++) {
      const dia = DIAS[di];
      // centros con créditos de este grupo que cobran ese día
      const delDia = cartera.filter((c) => c.grupo === grupo && c.diaPago === dia);
      const capDia = captura.filter((r) => r.dia === dia && grupoDe(r.producto) === grupo);
      if (!delDia.length && !capDia.length) continue;
      const porCentro = {};
      for (const c of delDia) (porCentro[c.centro] = porCentro[c.centro] || []).push(c);
      // Cobros FUERA de calendario (pagó en un día que no era el suyo, o el
      // crédito no trae día): entran con teoría en cero, para que el panel de
      // control cuadre contra las capturas y ningún peso se caiga del libro.
      const programados = new Set(Object.keys(porCentro).map((k) => ctx.norm(k)));
      const fueraDeDia = [...new Set(capDia.filter((r) => !programados.has(ctx.norm(r.centro))).map((r) => r.centro))];
      const f0 = f;
      for (const centro of Object.keys(porCentro).sort((a, b) => a.localeCompare(b, "es"))) {
        const creditos = porCentro[centro];
        let prestamo = 0, abono = 0, interes = 0, iva = 0, teorico = 0, cuota = 0;
        for (const c of creditos) {
          const t = teoriaDe(ctx, c);
          prestamo += c.importe; abono += t.abono; interes += t.interes;
          iva += t.iva; teorico += t.teorico; cuota += t.cuotaReal;
        }
        const cobrado = captura.filter((r) => r.dia === dia && ctx.norm(r.centro) === ctx.norm(centro)
          && grupoDe(r.producto) === grupo).reduce((t2, r) => t2 + r.pago, 0);
        const row = ws.getRow(f);
        row.getCell(2).value = dia; row.getCell(3).value = creditos[0].noCentro || "";
        row.getCell(4).value = centro;
        dinero(ws, f, 5, prestamo); dinero(ws, f, 6, abono); dinero(ws, f, 7, interes);
        dinero(ws, f, 8, iva); dinero(ws, f, 9, teorico); dinero(ws, f, 10, cuota);
        dinero(ws, f, 11, cobrado);
        const dif = dinero(ws, f, 12, cobrado - cuota);
        if (cobrado - cuota < -0.009) dif.font = { color: { argb: ROJO } };
        tot.prestamo += prestamo; tot.abono += abono; tot.interes += interes;
        tot.iva += iva; tot.teorico += teorico; tot.cuota += cuota; tot.cobrado += cobrado;
        f++;
      }
      for (const centro of fueraDeDia) {
        const cobrado = capDia.filter((r) => ctx.norm(r.centro) === ctx.norm(centro))
          .reduce((t2, r) => t2 + r.pago, 0);
        if (cobrado <= 0.009) continue;
        const row = ws.getRow(f);
        row.getCell(2).value = dia;
        row.getCell(4).value = centro + " · fuera de su día";
        row.getCell(4).font = { italic: true, color: { argb: "FF6B6480" } };
        dinero(ws, f, 5, 0); dinero(ws, f, 6, 0); dinero(ws, f, 7, 0); dinero(ws, f, 8, 0);
        dinero(ws, f, 9, 0); dinero(ws, f, 10, 0); dinero(ws, f, 11, cobrado); dinero(ws, f, 12, cobrado);
        tot.cobrado += cobrado;
        f++;
      }
      // subtotal del día
      const row = ws.getRow(f);
      row.getCell(4).value = "SUBTOTAL " + dia; row.getCell(4).font = { bold: true };
      for (const [col, key] of [[5, "prestamo"], [6, "abono"], [7, "interes"], [8, "iva"], [9, "teorico"], [10, "cuota"], [11, "cobrado"]]) {
        const L = colLetra(col);
        const suma = [];
        for (let rr = f0; rr < f; rr++) suma.push(L + rr);
        const val = Array.from({ length: f - f0 }, (_, k) => Number(ws.getRow(f0 + k).getCell(col).value) || 0).reduce((a, b) => a + b, 0);
        formula(ws, f, col, "SUM(" + L + f0 + ":" + L + (f - 1) + ")", val);
      }
      f++;
    }
    const row = ws.getRow(f);
    row.getCell(4).value = "TOTAL " + grupo; row.getCell(4).font = { bold: true };
    formula(ws, f, 5, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",E5:E" + (f - 1) + ")", tot.prestamo);
    formula(ws, f, 6, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",F5:F" + (f - 1) + ")", tot.abono);
    formula(ws, f, 7, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",G5:G" + (f - 1) + ")", tot.interes);
    formula(ws, f, 8, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",H5:H" + (f - 1) + ")", tot.iva);
    formula(ws, f, 9, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",I5:I" + (f - 1) + ")", tot.teorico);
    formula(ws, f, 10, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",J5:J" + (f - 1) + ")", tot.cuota);
    formula(ws, f, 11, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",K5:K" + (f - 1) + ")", tot.cobrado);
    totalesGrupo[grupo] = { ...tot, filaTotal: f };
  }

  // ===== COBRANZA (matriz día × centro por producto, con lo COBRADO real) =====
  {
    const ws = wb.addWorksheet("COBRANZA");
    ws.columns = [{ width: 4 }, { width: 11 }, { width: 9 }, { width: 24 }, { width: 13 }, { width: 15 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }];
    tit(ws, 1, "FOOAX · HOJA DE COBRANZA · COBRADO POR CENTRO Y DÍA", 10);
    sub(ws, 2, "Semana " + semanaTxt + " · lo realmente capturado (pagos), por producto", 10);
    enc(ws, 4, ["", "DÍA", "No.CENTRO", "CENTRO", "BASICO", "MICROEMPRESAS", "ADICIONAL", "INDIVIDUAL", "GARANTÍAS", "TOTAL"]);
    let f = 5;
    const totG = { B: 0, M: 0, A: 0, I: 0, G: 0, T: 0 };
    const numCentro = {};
    for (const c of cartera) if (c.noCentro) numCentro[ctx.norm(c.centro)] = c.noCentro;
    for (let di = 0; di < 6; di++) {
      const dia = DIAS[di];
      const delDia = captura.filter((r) => r.dia === dia);
      if (!delDia.length) continue;
      const centros = [...new Set(delDia.map((r) => r.centro))].sort((a, b) => a.localeCompare(b, "es"));
      const f0 = f;
      for (const centro of centros) {
        const del = delDia.filter((r) => r.centro === centro);
        const b = del.filter((r) => grupoDe(r.producto) === "BASICO").reduce((t, r) => t + r.pago + r.sol, 0);
        const m = del.filter((r) => grupoDe(r.producto) === "MICROEMPRESAS").reduce((t, r) => t + r.pago + r.sol, 0);
        const a = del.filter((r) => grupoDe(r.producto) === "ADICIONALES").reduce((t, r) => t + r.pago + r.sol, 0);
        const i = del.filter((r) => grupoDe(r.producto) === "INDIVIDUALES").reduce((t, r) => t + r.pago + r.sol, 0);
        const g = del.reduce((t, r) => t + r.gar, 0);
        const row = ws.getRow(f);
        row.getCell(2).value = dia; row.getCell(3).value = numCentro[ctx.norm(centro)] || "";
        row.getCell(4).value = centro;
        dinero(ws, f, 5, b); dinero(ws, f, 6, m); dinero(ws, f, 7, a); dinero(ws, f, 8, i); dinero(ws, f, 9, g);
        formula(ws, f, 10, "SUM(E" + f + ":I" + f + ")", b + m + a + i + g);
        totG.B += b; totG.M += m; totG.A += a; totG.I += i; totG.G += g; totG.T += b + m + a + i + g;
        f++;
      }
      const row = ws.getRow(f);
      row.getCell(4).value = "SUBTOTAL " + dia; row.getCell(4).font = { bold: true };
      for (const col of [5, 6, 7, 8, 9, 10]) {
        const L = colLetra(col);
        const val = Array.from({ length: f - f0 }, (_, k) => Number(ws.getRow(f0 + k).getCell(col).value && ws.getRow(f0 + k).getCell(col).value.result != null ? ws.getRow(f0 + k).getCell(col).value.result : ws.getRow(f0 + k).getCell(col).value) || 0).reduce((x, y) => x + y, 0);
        formula(ws, f, col, "SUM(" + L + f0 + ":" + L + (f - 1) + ")", val);
      }
      f++;
    }
    const row = ws.getRow(f);
    row.getCell(4).value = "TOTAL SEMANA"; row.getCell(4).font = { bold: true };
    formula(ws, f, 5, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",E5:E" + (f - 1) + ")", totG.B);
    formula(ws, f, 6, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",F5:F" + (f - 1) + ")", totG.M);
    formula(ws, f, 7, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",G5:G" + (f - 1) + ")", totG.A);
    formula(ws, f, 8, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",H5:H" + (f - 1) + ")", totG.I);
    formula(ws, f, 9, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",I5:I" + (f - 1) + ")", totG.G);
    formula(ws, f, 10, "SUMIF(D5:D" + (f - 1) + ",\"SUBTOTAL*\",J5:J" + (f - 1) + ")", totG.T);
    ctx._cobranzaTotales = totG;
  }

  // ===== POR EJECUTIVO =====
  {
    const ws = wb.addWorksheet("POR EJECUTIVO");
    ws.columns = [{ width: 4 }, { width: 24 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }];
    tit(ws, 1, "FOOAX · COBRANZA POR DÍA Y EJECUTIVO (real, de las apps)", 9);
    sub(ws, 2, "Semana " + semanaTxt, 9);
    enc(ws, 4, ["", "EJECUTIVO", ...DIAS, "TOTAL SEMANA"]);
    let f = 5;
    for (const e of ejecutivas) {
      const row = ws.getRow(f);
      row.getCell(2).value = e.nombre;
      let suma = 0;
      DIAS.forEach((dia, i) => { const v = capPorEjecDia[e.nombre + "|" + dia] || 0; dinero(ws, f, 3 + i, v); suma += v; });
      formula(ws, f, 9, "SUM(C" + f + ":H" + f + ")", suma);
      f++;
    }
    const row = ws.getRow(f);
    row.getCell(2).value = "TOTAL DÍA"; row.getCell(2).font = { bold: true };
    DIAS.forEach((dia, i) => {
      const L = colLetra(3 + i);
      const val = ejecutivas.reduce((t, e) => t + (capPorEjecDia[e.nombre + "|" + dia] || 0), 0);
      formula(ws, f, 3 + i, "SUM(" + L + "5:" + L + (f - 1) + ")", val);
    });
    formula(ws, f, 9, "SUM(I5:I" + (f - 1) + ")", ejecutivas.reduce((t, e) => t + (capPorEjec[e.nombre] || 0), 0));
    f += 2;
    ws.getRow(f).getCell(2).value = "% DE PARTICIPACIÓN"; ws.getRow(f).getCell(2).font = { bold: true };
    f++;
    const totalSemana = ejecutivas.reduce((t, e) => t + (capPorEjec[e.nombre] || 0), 0) || 1;
    for (const e of ejecutivas) {
      ws.getRow(f).getCell(2).value = e.nombre;
      const c = ws.getRow(f).getCell(3);
      c.value = r2((capPorEjec[e.nombre] || 0) / totalSemana); c.numFmt = PCT;
      f++;
    }
  }

  // ===== COBRANZA EJEC-CENTRO (bloques por ejecutiva) =====
  {
    const ws = wb.addWorksheet("COBRANZA EJEC-CENTRO");
    ws.columns = [{ width: 4 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 14 }];
    tit(ws, 1, "FOOAX · COBRANZA POR EJECUTIVA Y CENTRO", 6);
    sub(ws, 2, "Semana " + semanaTxt + " · lo cobrado real por centro, en el orden de la semana", 6);
    let f = 4;
    for (const e of ejecutivas) {
      const suyos = captura.filter((r) => r.ejec === e.nombre);
      if (!suyos.length) continue;
      const row = ws.getRow(f);
      ws.mergeCells(f, 2, f, 5);
      row.getCell(2).value = e.nombre;
      row.getCell(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } };
      formula(ws, f, 6, "0", suyos.reduce((t, r) => t + r.pago + r.gar + r.sol, 0));
      const filaEjec = f;
      f++;
      enc(ws, f, ["", "CENTRO", "DÍA", "PAGOS", "GAR+SOL", "COBRADO"]);
      f++;
      const f0 = f;
      const porCD = {};
      for (const r of suyos) {
        const k = r.centro + "|" + r.dia;
        const b = porCD[k] || (porCD[k] = { centro: r.centro, dia: r.dia, pagos: 0, extra: 0 });
        b.pagos += r.pago; b.extra += r.gar + r.sol;
      }
      for (const k of Object.keys(porCD).sort()) {
        const b = porCD[k];
        const row2 = ws.getRow(f);
        row2.getCell(2).value = b.centro; row2.getCell(3).value = b.dia;
        dinero(ws, f, 4, b.pagos); dinero(ws, f, 5, b.extra);
        formula(ws, f, 6, "D" + f + "+E" + f, b.pagos + b.extra);
        f++;
      }
      // el total del bloque, ahora sí con su fórmula real
      ws.getRow(filaEjec).getCell(6).value = { formula: "SUM(F" + f0 + ":F" + (f - 1) + ")",
        result: r2(suyos.reduce((t, r) => t + r.pago + r.gar + r.sol, 0)) };
      f++;
    }
  }

  // ===== COBRANZA DETALLE (día × centro × producto: teórico vs cobrado) =====
  {
    const ws = wb.addWorksheet("COBRANZA DETALLE");
    ws.columns = [{ width: 4 }, { width: 11 }, { width: 24 }, { width: 16 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }];
    tit(ws, 1, "FOOAX · COBRANZA DETALLE · teoría del motor vs cobrado real", 9);
    sub(ws, 2, "Semana " + semanaTxt, 9);
    enc(ws, 4, ["", "DÍA", "CENTRO", "PRODUCTO (grupo)", "CUOTAS ESPERADAS", "COBRADO (app)", "GARANTÍAS", "SOLIDARIOS", "DIFERENCIA"]);
    let f = 5;
    const esperadoPor = {};   // centro|dia|grupo → suma de cuotas reales
    for (const c of cartera) {
      const k = ctx.norm(c.centro) + "|" + c.diaPago + "|" + c.grupo;
      esperadoPor[k] = r2((esperadoPor[k] || 0) + c.cuota);
    }
    let tE = 0, tC = 0, tG2 = 0, tS2 = 0;
    for (let di = 0; di < 6; di++) {
      const dia = DIAS[di];
      const delDia = captura.filter((r) => r.dia === dia);
      const claves = new Set();
      for (const r of delDia) claves.add(ctx.norm(r.centro) + "|" + dia + "|" + grupoDe(r.producto) + "§" + r.centro);
      for (const c of cartera) if (c.diaPago === dia) claves.add(ctx.norm(c.centro) + "|" + dia + "|" + c.grupo + "§" + c.centro);
      for (const kc of [...claves].sort()) {
        const [k, centroNombre] = kc.split("§");
        const grupo = k.split("|")[2];
        const esperado = esperadoPor[k] || 0;
        const del = delDia.filter((r) => ctx.norm(r.centro) === k.split("|")[0] && grupoDe(r.producto) === grupo);
        const cobrado = del.reduce((t, r) => t + r.pago + r.sol, 0);
        const gar = del.reduce((t, r) => t + r.gar, 0);
        const sol = del.reduce((t, r) => t + r.sol, 0);
        if (esperado <= 0 && cobrado <= 0 && gar <= 0) continue;
        const row = ws.getRow(f);
        row.getCell(2).value = dia; row.getCell(3).value = centroNombre;
        row.getCell(4).value = grupo;
        dinero(ws, f, 5, esperado); dinero(ws, f, 6, cobrado);
        dinero(ws, f, 7, gar); dinero(ws, f, 8, sol);
        const d = dinero(ws, f, 9, cobrado - esperado);
        if (cobrado - esperado < -0.009) d.font = { color: { argb: ROJO } };
        tE += esperado; tC += cobrado; tG2 += gar; tS2 += sol;
        f++;
      }
    }
    ws.getRow(f).getCell(3).value = "TOTAL"; ws.getRow(f).getCell(3).font = { bold: true };
    formula(ws, f, 5, "SUM(E5:E" + (f - 1) + ")", tE);
    formula(ws, f, 6, "SUM(F5:F" + (f - 1) + ")", tC);
    formula(ws, f, 7, "SUM(G5:G" + (f - 1) + ")", tG2);
    formula(ws, f, 8, "SUM(H5:H" + (f - 1) + ")", tS2);
    formula(ws, f, 9, "F" + f + "-E" + f, tC - tE);
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ===== REPORTE DÍA (texto de WhatsApp por día) =====
  {
    const ws = wb.addWorksheet("REPORTE DÍA");
    ws.columns = [{ width: 4 }, { width: 70 }];
    tit(ws, 1, "FOOAX · REPORTE CONSOLIDADO DEL DÍA — textos listos para el grupo", 2);
    sub(ws, 2, "Copia el bloque del día y pégalo en WhatsApp. Sale de la cobranza real de las apps.", 2);
    let f = 4;
    const dinerito = (v) => "$" + Math.round(v).toLocaleString("es-MX");
    for (let di = 0; di < 6; di++) {
      const dia = DIAS[di];
      const total = ejecutivas.reduce((t, e) => t + (capPorEjecDia[e.nombre + "|" + dia] || 0), 0);
      if (total <= 0 && fechas[di] > hoy) continue;
      const bloque = ["🌸 *FOOAX · CIERRE DEL DÍA*", "📅 " + dia + " " + fechas[di] + " · Semana " + semanaTxt,
        "━━━━━━━━━━━━━━━", "👥 *COBRANZA POR EJECUTIVO*",
        ...ejecutivas.map((e) => "🔹 " + e.nombre + ": " + dinerito(capPorEjecDia[e.nombre + "|" + dia] || 0)),
        "━━━━━━━━━━━━━━━", "💰 *TOTAL FOOAX DEL DÍA:* " + dinerito(total),
        "━━━━━━━━━━━━━━━", "_" + LEMA + "_"];
      ws.getRow(f).getCell(2).value = "— " + dia + " —"; ws.getRow(f).getCell(2).font = { bold: true, color: { argb: RIO.replace("FF", "FF") } };
      f++;
      for (const linea of bloque) { ws.getRow(f).getCell(2).value = linea; f++; }
      f++;
    }
  }

  // ===== TABLERO SEMANAL =====
  {
    const ws = wb.addWorksheet("TABLERO SEMANAL");
    ws.columns = [{ width: 4 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
    tit(ws, 1, "FOOAX · TABLERO SEMANAL PARA EL GRUPO (la mora ya viene calculada)", 9);
    sub(ws, 2, "Semana " + semanaTxt, 9);
    ws.getRow(4).getCell(2).value = "1 · FALTAS DE PAGO (MORA) POR DÍA"; ws.getRow(4).getCell(2).font = { bold: true };
    enc(ws, 5, ["", "EJECUTIVO", ...DIAS, "TOTAL"]);
    let f = 6;
    for (const e of ejecutivas) {
      ws.getRow(f).getCell(2).value = e.nombre;
      let suma = 0;
      DIAS.forEach((dia, i) => { const v = moraPorEjecDia[e.nombre + "|" + dia] || 0; dinero(ws, f, 3 + i, v); suma += v; });
      formula(ws, f, 9, "SUM(C" + f + ":H" + f + ")", suma);
      f++;
    }
    ws.getRow(f).getCell(2).value = "TOTAL DÍA"; ws.getRow(f).getCell(2).font = { bold: true };
    DIAS.forEach((dia, i) => {
      const L = colLetra(3 + i);
      formula(ws, f, 3 + i, "SUM(" + L + "6:" + L + (f - 1) + ")", ejecutivas.reduce((t, e) => t + (moraPorEjecDia[e.nombre + "|" + dia] || 0), 0));
    });
    formula(ws, f, 9, "SUM(I6:I" + (f - 1) + ")", ejecutivas.reduce((t, e) => t + (moraPorEjec[e.nombre] || 0), 0));
    const filaTotMora = f;
    f += 2;
    ws.getRow(f).getCell(2).value = "2 · OTORGAMIENTO (renovaciones próximas: avance ≥70% y sin mora)"; ws.getRow(f).getCell(2).font = { bold: true };
    f++;
    enc(ws, f, ["", "EJECUTIVO", "CLIENTAS A OTORGAR", "MONTO A OTORGAR (sugerido)"]);
    f++;
    const f0o = f;
    for (const e of ejecutivas) {
      const prox = cartera.filter((c) => c.proxima && ctx.norm(c.ejecutivo) === ctx.norm(e.nombre));
      ws.getRow(f).getCell(2).value = e.nombre;
      ws.getRow(f).getCell(3).value = prox.length;
      dinero(ws, f, 4, prox.reduce((t, c) => t + (c.sugerido || 0), 0));
      f++;
    }
    ws.getRow(f).getCell(2).value = "TOTAL"; ws.getRow(f).getCell(2).font = { bold: true };
    formula(ws, f, 3, "SUM(C" + f0o + ":C" + (f - 1) + ")", cartera.filter((c) => c.proxima).length, "#,##0");
    formula(ws, f, 4, "SUM(D" + f0o + ":D" + (f - 1) + ")", cartera.filter((c) => c.proxima).reduce((t, c) => t + (c.sugerido || 0), 0));
    f += 2;
    const dinerito = (v) => "$" + Math.round(v).toLocaleString("es-MX");
    const texto1 = ["📋 TEXTO · MORA DE LA SEMANA (copia y pega):", "🌸 *FOOAX · MORA DE LA SEMANA*", "📅 " + semanaTxt,
      "━━━━━━━━━━━━━━━", "⚠️ *FALTAS POR EJECUTIVO*",
      ...ejecutivas.map((e) => "🔴 " + e.nombre + ": " + dinerito(moraPorEjec[e.nombre] || 0)),
      "━━━━━━━━━━━━━━━", "💢 *TOTAL MORA:* " + dinerito(ejecutivas.reduce((t, e) => t + (moraPorEjec[e.nombre] || 0), 0)),
      "━━━━━━━━━━━━━━━", "Equipo, manden sus horarios de recuperación. ¡Vamos!", "_" + LEMA + "_", ""];
    const prox = cartera.filter((c) => c.proxima);
    const texto2 = ["📋 TEXTO · OTORGAMIENTO DE LA SEMANA (copia y pega):", "🌸 *FOOAX · OTORGAMIENTO DE LA SEMANA*", "📅 " + semanaTxt,
      "━━━━━━━━━━━━━━━", "📤 *CRÉDITOS A OTORGAR (renovaciones)*",
      ...ejecutivas.map((e) => {
        const p = prox.filter((c) => ctx.norm(c.ejecutivo) === ctx.norm(e.nombre));
        return "🔹 " + e.nombre + ": " + dinerito(p.reduce((t, c) => t + (c.sugerido || 0), 0)) + " (" + p.length + " clientas)";
      }),
      "━━━━━━━━━━━━━━━", "💰 *TOTAL A OTORGAR:* " + dinerito(prox.reduce((t, c) => t + (c.sugerido || 0), 0)),
      "━━━━━━━━━━━━━━━", "Confirmen sus horarios de otorgamiento. ¡Vamos!", "_" + LEMA + "_"];
    for (const linea of [...texto1, ...texto2]) { ws.getRow(f).getCell(2).value = linea; f++; }
    void filaTotMora;
  }

  // ===== RENOVACIONES =====
  {
    const ws = wb.addWorksheet("RENOVACIONES");
    ws.columns = [{ width: 4 }, { width: 13 }, { width: 20 }, { width: 30 }, { width: 14 }, { width: 19 }, { width: 12 }, { width: 12 }, { width: 9 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 9 }];
    tit(ws, 1, "FOOAX · RENOVACIONES (se calcula sola de la cartera)", 13);
    const prox = cartera.filter((c) => c.proxima);
    sub(ws, 2, "Próximas (avance ≥70%, sin mora): " + prox.length + " · el SUGERIDO sigue la escalera oficial · semana " + semanaTxt, 13);
    enc(ws, 4, ["", "EJECUTIVO", "CENTRO", "CLIENTA", "No.SOCIO", "PRODUCTO", "IMPORTE", "SALDO", "AVANCE", "MORA", "SUGERIDO", "REQ.ANÁLISIS", "PRÓXIMA"]);
    let f = 5;
    const orden = [...cartera].sort((a, b) => (b.proxima - a.proxima) || (b.avance - a.avance));
    for (const c of orden) {
      const row = ws.getRow(f);
      row.getCell(2).value = c.ejecutivo; row.getCell(3).value = c.centro;
      row.getCell(4).value = c.clienta; row.getCell(5).value = c.socio;
      row.getCell(6).value = c.producto;
      dinero(ws, f, 7, c.importe); dinero(ws, f, 8, c.saldo);
      const av = row.getCell(9); av.value = c.avance; av.numFmt = PCT;
      dinero(ws, f, 10, c.mora);
      if (c.sugerido != null) dinero(ws, f, 11, c.sugerido);
      row.getCell(12).value = c.sugerido == null ? "" : (c.reqAnalisis ? "SÍ" : "No");
      row.getCell(13).value = c.proxima ? "SÍ" : "";
      if (c.proxima) row.getCell(13).font = { bold: true, color: { argb: VERDE } };
      f++;
    }
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ===== CRECIMIENTO y PROYECCIÓN =====
  {
    const carteraHoy = cartera.filter((c) => c.estatus !== "VENCIDO").reduce((t, c) => t + c.importe, 0);
    const crecimiento = cartera.reduce((t, c) => t + c.crecimiento, 0);
    const renuevan = cartera.filter((c) => c.proxima).length;
    const analisis = cartera.filter((c) => c.sugerido != null && c.reqAnalisis).length;
    const ws = wb.addWorksheet("CRECIMIENTO");
    ws.columns = [{ width: 4 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }];
    tit(ws, 1, "FOOAX · CRECIMIENTO (vive de la cartera)", 5);
    enc(ws, 3, ["", "CARTERA HOY (vigente)", "CRECIMIENTO POTENCIAL", "CARTERA PROYECTADA", "CLIENTAS QUE RENUEVAN"]);
    dinero(ws, 4, 2, carteraHoy, true); dinero(ws, 4, 3, crecimiento, true);
    formula(ws, 4, 4, "B4+C4", carteraHoy + crecimiento);
    ws.getRow(4).getCell(5).value = renuevan;
    sub(ws, 6, "Requieren análisis de capacidad de pago: " + analisis + ". El potencial supone que las próximas (avance 70%+, sin mora) renuevan al sugerido.", 5);

    const ws2 = wb.addWorksheet("PROYECCIÓN");
    ws2.columns = [{ width: 4 }, { width: 20 }, { width: 20 }, { width: 18 }, { width: 22 }, { width: 12 }];
    tit(ws2, 1, "FOOAX · PROYECCIÓN A DICIEMBRE", 6);
    sub(ws2, 2, "Escenarios sobre el crecimiento potencial. No incluye clientas con mora.", 6);
    ws2.getRow(4).getCell(2).value = "Cartera hoy:"; dinero(ws2, 4, 4, carteraHoy, true);
    ws2.getRow(5).getCell(2).value = "Crecimiento potencial (100%):"; dinero(ws2, 5, 4, crecimiento, true);
    enc(ws2, 7, ["", "ESCENARIO", "% RENUEVA AL ALZA", "CRECIMIENTO", "CARTERA A DICIEMBRE", "% CRECE"]);
    const esc = [["Conservador", 0.6], ["Realista", 0.75], ["Optimista", 0.9]];
    esc.forEach(([nom, pc], i) => {
      const f = 8 + i;
      ws2.getRow(f).getCell(2).value = nom;
      const c = ws2.getRow(f).getCell(3); c.value = pc; c.numFmt = "0%";
      dinero(ws2, f, 4, crecimiento * pc);
      formula(ws2, f, 5, "$D$4+D" + f, carteraHoy + crecimiento * pc);
      const p = ws2.getRow(f).getCell(6); p.value = carteraHoy > 0 ? r2(crecimiento * pc / carteraHoy) : 0; p.numFmt = PCT;
    });
    sub(ws2, 12, "Planea con el realista (75%). Requieren análisis de capacidad de pago: " + analisis + ".", 6);
    // CU-031 · M3: la SEMANA ENTRANTE — cobranza programada del calendario,
    // ajustada por la recuperación real de las últimas semanas. Los
    // desembolsos comprometidos y las garantías por devolver se encienden
    // cuando lleguen las entregas 3B/3C; aquí ya tienen su renglón.
    let f2 = 14;
    ws2.getRow(f2).getCell(2).value = "SEMANA ENTRANTE (M3)";
    ws2.getRow(f2).getCell(2).font = { bold: true };
    f2++;
    enc(ws2, f2, ["", "CONCEPTO", "", "", "MONTO", ""]);
    f2++;
    const programada = cartera.filter((c) => c.estatus !== "VENCIDO").reduce((t, c) => t + c.cuota, 0);
    // % de recuperación global de las últimas 4 semanas (cobrado / esperado).
    let recupPct = null;
    {
      let cob4 = 0, sem4 = 0;
      let L = lunes;
      for (let k = 0; k < 4; k++) {
        const dl = new Date(L + "T12:00:00"); dl.setDate(dl.getDate() - 7);
        L = dl.toISOString().slice(0, 10);
        if (L < ctx.lunesDeLaSemana(ctx.corteSaldos())) break;
        cob4 += capturasDeLaSemana(ctx, usuario, fechasDeLaSemana(L)).reduce((t, r) => t + r.pago + r.sol, 0);
        sem4++;
      }
      if (sem4 > 0 && programada > 0) recupPct = Math.min(1.2, (cob4 / sem4) / programada);
    }
    const filasM3 = [
      ["Cobranza programada (cuotas del calendario)", programada],
      ["Cobranza esperada ajustada (× " + (recupPct != null ? Math.round(recupPct * 100) + "% recuperación reciente" : "sin historial") + ")",
        recupPct != null ? programada * recupPct : programada],
      ["− Desembolsos comprometidos (se enciende con la entrega 3B)", null],
      ["− Garantías por devolver (se enciende con la entrega 3C)", null],
      ["= FLUJO NETO ESTIMADO (con lo que el sistema ya ve)", recupPct != null ? programada * recupPct : programada],
    ];
    for (const [txt, v] of filasM3) {
      ws2.getRow(f2).getCell(2).value = txt;
      if (v != null) dinero(ws2, f2, 5, v, txt.startsWith("=")); else ws2.getRow(f2).getCell(5).value = "—";
      f2++;
    }
  }

  // ===== SEMÁFORO =====
  {
    const ws = wb.addWorksheet("SEMÁFORO");
    ws.columns = [{ width: 4 }, { width: 26 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 14 }];
    tit(ws, 1, "FOOAX · SEMÁFORO DE DESEMPEÑO POR EJECUTIVO", 9);
    sub(ws, 2, "Cobranza (60%) + control de mora (40%) · Verde ≥90% · Amarillo 70-89% · Rojo <70% · meta = cobranza de la semana anterior · semana " + semanaTxt, 9);
    enc(ws, 4, ["", "EJECUTIVO", "COBRANZA ESTA SEM", "META (SEM ANT)", "% CUMPL.", "MORA ESTA SEM", "PUNTAJE MORA", "PUNTAJE FINAL", "SEMÁFORO"]);
    // La meta: lo cobrado la semana ANTERIOR, del propio sistema.
    const lunesAnt = (() => { const d = new Date(lunes + "T12:00:00"); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
    const capAnt = capturasDeLaSemana(ctx, usuario, fechasDeLaSemana(lunesAnt));
    const metaPor = {};
    for (const r of capAnt) metaPor[r.ejec] = r2((metaPor[r.ejec] || 0) + r.pago + r.gar + r.sol);
    let f = 5;
    for (const e of ejecutivas) {
      const cob = capPorEjec[e.nombre] || 0;
      const meta = metaPor[e.nombre] || 0;
      const cumpl = meta > 0 ? cob / meta : null;
      const m = moraPorEjec[e.nombre] || 0;
      const pMora = cob === 0 ? 0 : Math.max(0, Math.min(1, (0.2 - m / cob) / 0.15));
      const final = cumpl == null ? null : 0.6 * Math.min(cumpl, 1.5) + 0.4 * pMora;
      const row = ws.getRow(f);
      row.getCell(2).value = e.nombre;
      dinero(ws, f, 3, cob); dinero(ws, f, 4, meta);
      if (cumpl != null) { const c = row.getCell(5); c.value = r2(cumpl); c.numFmt = PCT; }
      dinero(ws, f, 6, m);
      row.getCell(7).value = r2(pMora);
      if (final != null) row.getCell(8).value = r2(final);
      row.getCell(9).value = final == null ? "—" : (final >= 0.9 ? "🟢 VERDE" : final >= 0.7 ? "🟡 AMARILLO" : "🔴 ROJO");
      f++;
    }
  }

  // ===== HISTÓRICO EJECUTIVO =====
  {
    const ws = wb.addWorksheet("HISTÓRICO EJECUTIVO");
    ws.columns = [{ width: 4 }, { width: 22 }, ...Array(ejecutivas.length * 2 + 1).fill({ width: 14 })];
    tit(ws, 1, "FOOAX · HISTÓRICO POR EJECUTIVO (una fila por semana, del sistema)", 2 + ejecutivas.length * 2 + 1);
    enc(ws, 3, ["", "SEMANA", ...ejecutivas.map((e) => e.nombre.split(" ")[0].toUpperCase()),
      ...ejecutivas.map((e) => "MORA " + e.nombre.split(" ")[0].toUpperCase()), "TOTAL COBRANZA"]);
    // Desde el corte hasta esta semana.
    let f = 4;
    let L = ctx.lunesDeLaSemana(ctx.corteSaldos());
    const semanas = [];
    while (L <= lunes) {
      semanas.push(L);
      const d = new Date(L + "T12:00:00"); d.setDate(d.getDate() + 7);
      L = d.toISOString().slice(0, 10);
    }
    for (const lw of semanas.slice(-8)) {
      const fw = fechasDeLaSemana(lw);
      const capW = capturasDeLaSemana(ctx, usuario, fw);
      const porE = {};
      for (const r of capW) porE[r.ejec] = r2((porE[r.ejec] || 0) + r.pago + r.gar + r.sol);
      const moraW = ctx.moraDeLaSemana(usuario, lw);
      const moraE = {};
      for (const g of (moraW.dias || [])) for (const x of (g.filas || []))
        moraE[x.ejecutivo] = r2((moraE[x.ejecutivo] || 0) + (x.faltante || 0));
      const row = ws.getRow(f);
      row.getCell(2).value = etiquetaSemana(fw);
      ejecutivas.forEach((e, i) => dinero(ws, f, 3 + i, porE[e.nombre] || 0));
      ejecutivas.forEach((e, i) => dinero(ws, f, 3 + ejecutivas.length + i, moraE[e.nombre] || 0));
      formula(ws, f, 3 + ejecutivas.length * 2, "SUM(" + colLetra(3) + f + ":" + colLetra(2 + ejecutivas.length) + f + ")",
        ejecutivas.reduce((t, e) => t + (porE[e.nombre] || 0), 0));
      f++;
    }
  }

  // ===== CARTERA POR PRODUCTO (CU-032 · M4) =====
  {
    const ws = wb.addWorksheet("CARTERA POR PRODUCTO");
    ws.columns = [{ width: 4 }, { width: 30 }, { width: 10 }, { width: 15 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 15 }, { width: 13 }];
    tit(ws, 1, "FOOAX · CARTERA POR PRODUCTO DEL CATÁLOGO (M4)", 10);
    sub(ws, 2, "Dónde vive la mora y qué producto crece · la suma de productos ES la cartera total · semana " + semanaTxt, 10);
    enc(ws, 4, ["", "PRODUCTO (catálogo)", "CRÉDITOS", "SALDO INSOLUTO", "% CARTERA", "ESPERADO SEMANA", "COBRADO SEMANA", "% RECUPER.", "MORA SEMANA", "RECUPERACIÓN (vencidos)"]);
    const porProd = {};
    for (const c of cartera) {
      const r = ctx.motor.resolverCredito({ producto: c.producto, plazo: c.plazo, cuota: c.cuota, id: c.socio, nombre: c.clienta });
      const nombre = (r && r.ok && r.producto && r.producto.nombre) ? r.producto.nombre : "Sin clasificar (" + c.producto + ")";
      const b = porProd[nombre] || (porProd[nombre] = { n: 0, saldo: 0, esperado: 0, cobrado: 0, mora: 0, recup: 0, padron: new Set() });
      b.n++; b.saldo += c.saldo; b.mora += c.mora;
      if (c.estatus === "VENCIDO") b.recup += c.saldo; else b.esperado += c.cuota;
      b.padron.add(ctx.norm(c.producto));
    }
    for (const r of captura) {
      let nombre = null;
      for (const k in porProd) if (porProd[k].padron.has(ctx.norm(r.producto))) { nombre = k; break; }
      if (nombre) porProd[nombre].cobrado += r.pago + r.sol;
    }
    const carteraTotal = cartera.reduce((t, c) => t + c.saldo, 0);
    let f = 5;
    for (const nombre of Object.keys(porProd).sort((a, b) => porProd[b].saldo - porProd[a].saldo)) {
      const b = porProd[nombre];
      const row = ws.getRow(f);
      row.getCell(2).value = nombre;
      row.getCell(3).value = b.n;
      dinero(ws, f, 4, b.saldo);
      const p = row.getCell(5); p.value = carteraTotal > 0 ? r2(b.saldo / carteraTotal) : 0; p.numFmt = PCT;
      dinero(ws, f, 6, b.esperado); dinero(ws, f, 7, b.cobrado);
      const pr = row.getCell(8); pr.value = b.esperado > 0 ? r2(b.cobrado / b.esperado) : 0; pr.numFmt = PCT;
      const cm = dinero(ws, f, 9, b.mora);
      if (b.mora > 0) cm.font = { color: { argb: ROJO } };
      dinero(ws, f, 10, b.recup);
      f++;
    }
    ws.getRow(f).getCell(2).value = "TOTAL"; ws.getRow(f).getCell(2).font = { bold: true };
    formula(ws, f, 3, "SUM(C5:C" + (f - 1) + ")", cartera.length, "#,##0");
    formula(ws, f, 4, "SUM(D5:D" + (f - 1) + ")", carteraTotal);
    formula(ws, f, 6, "SUM(F5:F" + (f - 1) + ")", Object.values(porProd).reduce((t, b) => t + b.esperado, 0));
    formula(ws, f, 7, "SUM(G5:G" + (f - 1) + ")", Object.values(porProd).reduce((t, b) => t + b.cobrado, 0));
    formula(ws, f, 9, "SUM(I5:I" + (f - 1) + ")", Object.values(porProd).reduce((t, b) => t + b.mora, 0));
    formula(ws, f, 10, "SUM(J5:J" + (f - 1) + ")", Object.values(porProd).reduce((t, b) => t + b.recup, 0));
    ctx._carteraPorProductoTotal = r2(Object.values(porProd).reduce((t, b) => t + b.saldo, 0));
    ctx._carteraTotal = r2(carteraTotal);
  }

  // ===== SEMÁFORO POR CENTRO (CU-030 · M2, con histórico reconstruido) =====
  {
    const ws = wb.addWorksheet("SEMÁFORO POR CENTRO");
    ws.columns = [{ width: 4 }, { width: 24 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 11 }, { width: 13 },
      ...Array(8).fill({ width: 10 })];
    tit(ws, 1, "FOOAX · SEMÁFORO POR CENTRO (M2) · verde ≥97% · ámbar 85–96% · rojo <85%", 15);
    sub(ws, 2, "El color no lo pone nadie: esperado (cuotas de la semana) vs cobrado (apps) · umbrales sugeridos, Dirección los fija · los rojos arriba · semana " + semanaTxt, 15);
    const semanasHist = [];
    {
      let L = lunes;
      for (let k = 0; k < 8; k++) {
        semanasHist.unshift(L);
        const d = new Date(L + "T12:00:00"); d.setDate(d.getDate() - 7);
        if (d.toISOString().slice(0, 10) < ctx.lunesDeLaSemana(ctx.corteSaldos())) break;
        L = d.toISOString().slice(0, 10);
      }
    }
    const capPorSemana = {};
    for (const lw of semanasHist)
      capPorSemana[lw] = lw === lunes ? captura : capturasDeLaSemana(ctx, usuario, fechasDeLaSemana(lw));
    enc(ws, 4, ["", "CENTRO", "EJECUTIVO", "ESPERADO", "COBRADO", "% RECUP.", "SEMÁFORO",
      ...semanasHist.map((lw) => "S. " + lw.slice(5))]);
    const esperadoCentro = {};
    for (const c of cartera) {
      if (c.estatus === "VENCIDO") continue;
      const k = ctx.norm(c.centro);
      const b = esperadoCentro[k] || (esperadoCentro[k] = { centro: c.centro, ejec: c.ejecutivo, esperado: 0 });
      b.esperado += c.cuota;
    }
    const colorDe = (pct, esperado) => esperado <= 0 ? ["GRIS", "FFB9B9C4"]
      : pct >= 0.97 ? ["🟢 VERDE", "FF9FD8B4"] : pct >= 0.85 ? ["🟡 ÁMBAR", "FFF5DC8C"] : ["🔴 ROJO", "FFF2A9B2"];
    const filasC = Object.values(esperadoCentro)
      .map((b) => {
        const cobrado = captura.filter((r) => ctx.norm(r.centro) === ctx.norm(b.centro)).reduce((t, r) => t + r.pago + r.sol, 0);
        const pct = b.esperado > 0 ? cobrado / b.esperado : 0;
        return { ...b, cobrado, pct };
      })
      .sort((a, b) => a.pct - b.pct);
    let f = 5;
    for (const b of filasC) {
      const row = ws.getRow(f);
      row.getCell(2).value = b.centro; row.getCell(3).value = b.ejec;
      dinero(ws, f, 4, b.esperado); dinero(ws, f, 5, b.cobrado);
      const p = row.getCell(6); p.value = r2(b.pct); p.numFmt = PCT;
      const [texto, color] = colorDe(b.pct, b.esperado);
      const cSem = row.getCell(7); cSem.value = texto;
      cSem.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      semanasHist.forEach((lw, i) => {
        const capW = capPorSemana[lw].filter((r) => ctx.norm(r.centro) === ctx.norm(b.centro))
          .reduce((t, r) => t + r.pago + r.sol, 0);
        const pctW = b.esperado > 0 ? capW / b.esperado : 0;
        const c2 = row.getCell(8 + i);
        c2.value = r2(pctW); c2.numFmt = "0%";
        c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorDe(pctW, b.esperado)[1] } };
      });
      f++;
    }
    ws.getRow(f).getCell(2).value = "TOTAL"; ws.getRow(f).getCell(2).font = { bold: true };
    formula(ws, f, 4, "SUM(D5:D" + (f - 1) + ")", filasC.reduce((t, b) => t + b.esperado, 0));
    formula(ws, f, 5, "SUM(E5:E" + (f - 1) + ")", filasC.reduce((t, b) => t + b.cobrado, 0));
    sub(ws, f + 1, "El histórico se reconstruye de las capturas guardadas (con el esperado actual como referencia). Cuando el módulo M2 encienda su corte semanal guardado, cada semana conservará su esperado exacto de entonces.", 15);
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ===== COBRANZA CRUZADA (CU-033 · M5, la parte visible) =====
  {
    const ws = wb.addWorksheet("COBRANZA CRUZADA");
    ws.columns = [{ width: 4 }, { width: 14 }, { width: 30 }, { width: 22 }, { width: 40 }, { width: 13 }, { width: 14 }, { width: 24 }];
    tit(ws, 1, "FOOAX · COBRANZA CRUZADA (M5) · socias con más de un crédito vivo", 8);
    sub(ws, 2, "La regla completa (un solo importe en la app y reparto vencido-primero) es del módulo M5; esta hoja ya enseña a quiénes aplica y cómo pagaron · semana " + semanaTxt, 8);
    enc(ws, 4, ["", "No.SOCIO", "CLIENTA", "CENTRO", "CRÉDITOS VIVOS (cuota c/u)", "CUOTA TOTAL", "PAGADO SEMANA", "OBSERVACIÓN"]);
    const porSocia = {};
    for (const c of cartera) (porSocia[c.socio] = porSocia[c.socio] || []).push(c);
    let f = 5;
    for (const socio of Object.keys(porSocia)) {
      const creds = porSocia[socio];
      if (creds.length < 2) continue;
      const pagado = captura.filter((r) => r.socio === socio).reduce((t, r) => t + r.pago + r.sol, 0);
      const cuotaTotal = creds.reduce((t, c) => t + c.cuota, 0);
      const pagoPorCred = creds.map((c) => captura.filter((r) => r.socio === socio && ctx.norm(r.producto) === ctx.norm(c.producto))
        .reduce((t, r) => t + r.pago + r.sol, 0));
      const desbalance = pagoPorCred.some((p) => p > 0.009) && pagoPorCred.some((p, i) => p <= 0.009 && creds[i].cuota > 0);
      const row = ws.getRow(f);
      row.getCell(2).value = socio; row.getCell(3).value = creds[0].clienta;
      row.getCell(4).value = creds[0].centro;
      row.getCell(5).value = creds.map((c) => c.producto + " ($" + Math.round(c.cuota) + ")").join(" · ");
      dinero(ws, f, 6, cuotaTotal); dinero(ws, f, 7, pagado);
      const obs = row.getCell(8);
      if (desbalance && pagado > 0) { obs.value = "pagó a un crédito y al otro no"; obs.font = { color: { argb: ROJO } }; }
      else if (pagado <= 0.009) obs.value = "sin pago esta semana";
      else obs.value = "";
      f++;
    }
    if (f === 5) sub(ws, 5, "Ninguna socia con más de un crédito vivo.", 8);
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ===== RESUMEN CENTRO =====
  {
    const ws = wb.addWorksheet("RESUMEN CENTRO");
    ws.columns = [{ width: 4 }, { width: 10 }, { width: 24 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
    tit(ws, 1, "FOOAX · RESUMEN POR CENTRO (de la captura de la semana)", 14);
    sub(ws, 2, "Semana " + semanaTxt, 14);
    enc(ws, 4, ["", "No.CENTRO", "CENTRO", "EJECUTIVO", "BASICO", "MICRO", "ADICIONAL", "INDIVIDUAL", "GARANTÍAS", "SOLIDARIOS", "EFECTIVO", "TRANSFER.", "OXXO", "CHEQUE"]);
    const centros = {};
    for (const r of captura) {
      const k = r.centro;
      const c = centros[k] || (centros[k] = { ejec: r.ejec, B: 0, M: 0, A: 0, I: 0, G: 0, S: 0, E: 0, T: 0, D: 0, CH: 0 });
      const g = grupoDe(r.producto)[0];
      c[g === "B" ? "B" : g === "M" ? "M" : g === "A" ? "A" : "I"] += r.pago;
      c.G += r.gar; c.S += r.sol;
      const total = r.pago + r.gar + r.sol;
      if (r.forma === "T") c.T += total;
      else if (r.forma === "D") c.D += total;
      else if (r.forma === "CH") c.CH += total;
      else c.E += total;
    }
    const numCentro = {};
    for (const c of cartera) if (c.noCentro) numCentro[ctx.norm(c.centro)] = c.noCentro;
    let f = 5;
    const tot = { B: 0, M: 0, A: 0, I: 0, G: 0, S: 0, E: 0, T: 0, D: 0, CH: 0 };
    for (const k of Object.keys(centros).sort((a, b) => a.localeCompare(b, "es"))) {
      const c = centros[k];
      const row = ws.getRow(f);
      row.getCell(2).value = numCentro[ctx.norm(k)] || ""; row.getCell(3).value = k; row.getCell(4).value = c.ejec;
      [["B", 5], ["M", 6], ["A", 7], ["I", 8], ["G", 9], ["S", 10], ["E", 11], ["T", 12], ["D", 13], ["CH", 14]]
        .forEach(([key, col]) => { dinero(ws, f, col, c[key]); tot[key] += c[key]; });
      f++;
    }
    ws.getRow(f).getCell(3).value = "TOTAL"; ws.getRow(f).getCell(3).font = { bold: true };
    [["B", 5], ["M", 6], ["A", 7], ["I", 8], ["G", 9], ["S", 10], ["E", 11], ["T", 12], ["D", 13], ["CH", 14]]
      .forEach(([key, col]) => {
        const L = colLetra(col);
        formula(ws, f, col, "SUM(" + L + "5:" + L + (f - 1) + ")", tot[key]);
      });
  }

  // ===== CONCENTRADO DEL DÍA =====
  {
    const ws = wb.addWorksheet("CONCENTRADO DEL DÍA");
    ws.columns = [{ width: 4 }, { width: 22 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }];
    // El último día con captura (o hoy si aún no hay nada).
    const conDatos = fechas.filter((fe) => captura.some((r) => r.fecha === fe));
    const fechaDia = conDatos.length ? conDatos[conDatos.length - 1] : hoy;
    const diaTxt = DIAS[fechas.indexOf(fechaDia)] || "";
    tit(ws, 1, "FOOAX · CONCENTRADO DEL DÍA · " + diaTxt + " " + fechaDia, 8);
    sub(ws, 2, "Se calcula solo de la captura de las apps y de los movimientos del día.", 8);
    ws.getRow(4).getCell(2).value = "1 · COBRANZA POR EJECUTIVO"; ws.getRow(4).getCell(2).font = { bold: true };
    enc(ws, 5, ["", "EJECUTIVO", "PAGOS", "GARANTÍAS", "SOLIDARIO", "TOTAL", "EFECTIVO", "TRANSFER."]);
    let f = 6;
    const delDia = captura.filter((r) => r.fecha === fechaDia);
    for (const e of ejecutivas) {
      const de = delDia.filter((r) => r.ejec === e.nombre);
      const p = de.reduce((t, r) => t + r.pago, 0), g = de.reduce((t, r) => t + r.gar, 0), s = de.reduce((t, r) => t + r.sol, 0);
      const efe = de.filter((r) => r.forma !== "T" && r.forma !== "D" && r.forma !== "CH").reduce((t, r) => t + r.pago + r.gar + r.sol, 0);
      const tr = de.filter((r) => r.forma === "T").reduce((t, r) => t + r.pago + r.gar + r.sol, 0);
      const row = ws.getRow(f);
      row.getCell(2).value = e.nombre;
      dinero(ws, f, 3, p); dinero(ws, f, 4, g); dinero(ws, f, 5, s);
      formula(ws, f, 6, "C" + f + "+D" + f + "+E" + f, p + g + s);
      dinero(ws, f, 7, efe); dinero(ws, f, 8, tr);
      f++;
    }
    ws.getRow(f).getCell(2).value = "TOTAL FOOAX"; ws.getRow(f).getCell(2).font = { bold: true };
    for (const col of [3, 4, 5, 6, 7, 8]) {
      const L = colLetra(col);
      const val = Array.from({ length: f - 6 }, (_, k) => {
        const v = ws.getRow(6 + k).getCell(col).value;
        return Number(v && v.result != null ? v.result : v) || 0;
      }).reduce((a, b) => a + b, 0);
      formula(ws, f, col, "SUM(" + L + "6:" + L + (f - 1) + ")", val);
    }
    const filaTotal = f;
    f += 2;
    ws.getRow(f).getCell(2).value = "2 · OTROS MOVIMIENTOS DEL DÍA"; ws.getRow(f).getCell(2).font = { bold: true };
    f++;
    enc(ws, f, ["", "FOLIO", "CONCEPTO", "CENTRO", "CLIENTA", "VÍA", "MONTO"]);
    f++;
    let totMovs = 0;
    const f0m = f;
    for (const m of ctx.movsDeFecha(fechaDia, usuario)) {
      if (m.anulado) continue;
      const row = ws.getRow(f);
      row.getCell(2).value = m.folio || "";
      row.getCell(3).value = ctx.tipoDeMov(m) || m.concepto || "";
      row.getCell(4).value = m.centro || "";
      row.getCell(5).value = m.clienta || m.aNombre || "";
      row.getCell(6).value = (m.metodo || "efectivo").toUpperCase();
      dinero(ws, f, 7, m.monto);
      totMovs += Number(m.monto) || 0;
      f++;
    }
    ws.getRow(f).getCell(2).value = "TOTAL MOVIMIENTOS"; ws.getRow(f).getCell(2).font = { bold: true };
    formula(ws, f, 7, f > f0m ? "SUM(G" + f0m + ":G" + (f - 1) + ")" : "0", totMovs);
    f += 2;
    const dinerito = (v) => "$" + Math.round(v).toLocaleString("es-MX");
    const totalDia = ejecutivas.reduce((t, e) => t + delDia.filter((r) => r.ejec === e.nombre).reduce((x, r) => x + r.pago + r.gar + r.sol, 0), 0);
    const texto = ["📋 TEXTO · CIERRE DEL DÍA (copia y pega al grupo):", "🌸 *FOOAX · CIERRE DEL DÍA*", "📅 " + fechaDia,
      "━━━━━━━━━━━━━━━", "👥 *COBRANZA POR EJECUTIVO*",
      ...ejecutivas.map((e) => "🔹 " + e.nombre + ": " + dinerito(delDia.filter((r) => r.ejec === e.nombre).reduce((t, r) => t + r.pago + r.gar + r.sol, 0))),
      "━━━━━━━━━━━━━━━", "💰 *TOTAL FOOAX:* " + dinerito(totalDia), "━━━━━━━━━━━━━━━", "_" + LEMA + "_"];
    for (const linea of texto) { ws.getRow(f).getCell(2).value = linea; f++; }
    void filaTotal;
  }

  // ===== MORA POR EJECUTIVO =====
  {
    const ws = wb.addWorksheet("MORA POR EJECUTIVO");
    ws.columns = [{ width: 4 }, { width: 22 }, { width: 22 }, { width: 24 }, { width: 18 }];
    tit(ws, 1, "FOOAX · MORA Y RECUPERACIÓN POR EJECUTIVO", 5);
    sub(ws, 2, "MORA DE LA SEMANA = lo que faltó de cuota en créditos vigentes · RECUPERACIÓN = saldo vivo de créditos VENCIDOS · semana " + semanaTxt, 5);
    enc(ws, 4, ["", "EJECUTIVO", "MORA SEMANA (vigentes)", "RECUPERACIÓN (vencidos)", "TOTAL POR COBRAR"]);
    let f = 5;
    for (const e of ejecutivas) {
      const rec = cartera.filter((c) => c.estatus === "VENCIDO" && ctx.norm(c.ejecutivo) === ctx.norm(e.nombre))
        .reduce((t, c) => t + c.saldo, 0);
      const m = moraPorEjec[e.nombre] || 0;
      const row = ws.getRow(f);
      row.getCell(2).value = e.nombre;
      dinero(ws, f, 3, m); dinero(ws, f, 4, rec);
      formula(ws, f, 5, "C" + f + "+D" + f, m + rec);
      f++;
    }
    ws.getRow(f).getCell(2).value = "TOTAL FOOAX"; ws.getRow(f).getCell(2).font = { bold: true };
    for (const col of [3, 4, 5]) {
      const L = colLetra(col);
      const val = Array.from({ length: f - 5 }, (_, k) => {
        const v = ws.getRow(5 + k).getCell(col).value;
        return Number(v && v.result != null ? v.result : v) || 0;
      }).reduce((a, b) => a + b, 0);
      formula(ws, f, col, "SUM(" + L + "5:" + L + (f - 1) + ")", val);
    }
  }

  // ===== ALTAS DE CLIENTAS =====
  {
    const ws = wb.addWorksheet("ALTAS DE CLIENTAS");
    ws.columns = [{ width: 4 }, { width: 11 }, { width: 10 }, { width: 22 }, { width: 30 }, { width: 14 }, { width: 20 }, { width: 12 }, { width: 12 }];
    tit(ws, 1, "FOOAX · ALTAS DE CLIENTAS DE LA SEMANA (del tablero, con rastro)", 9);
    sub(ws, 2, "Semana " + semanaTxt, 9);
    enc(ws, 4, ["", "FECHA", "No.CENTRO", "CENTRO", "CLIENTA", "No.SOCIO", "PRODUCTO", "SALDO", "CUOTA"]);
    let f = 5;
    for (const cb of ctx.store.cambiosPadron()) {
      if (cb.tipo !== "alta" || !cb.clienta) continue;
      const fcha = String(cb.fecha || "").slice(0, 10);
      if (fcha < fechas[0] || fcha > fechas[5]) continue;
      const cl = cb.clienta;
      const row = ws.getRow(f);
      row.getCell(2).value = fcha; row.getCell(3).value = cl.noCentro || "";
      row.getCell(4).value = cl.centro || ""; row.getCell(5).value = cl.nombre || "";
      row.getCell(6).value = String(cl.id || ""); row.getCell(7).value = cl.producto || "";
      dinero(ws, f, 8, cl.saldo || 0); dinero(ws, f, 9, cl.cuota || 0);
      f++;
    }
    if (f === 5) sub(ws, 5, "Sin altas esta semana.", 9);
  }

  // ===== CONTROL DESEMBOLSOS =====
  {
    const ws = wb.addWorksheet("CONTROL DESEMBOLSOS");
    ws.columns = [{ width: 4 }, { width: 14 }, { width: 11 }, { width: 22 }, { width: 30 }, { width: 14 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 12 }];
    tit(ws, 1, "FOOAX · CONTROL DE DESEMBOLSOS DE LA SEMANA (créditos entregados)", 10);
    sub(ws, 2, "De los movimientos de tesorería (Autorización de préstamo / Desembolso) · semana " + semanaTxt, 10);
    enc(ws, 4, ["", "FOLIO", "FECHA", "CENTRO", "CLIENTA", "No.SOCIO", "EJECUTIVO", "MONTO ENTREGADO", "MÉTODO SALIDA", "No.CHEQUE"]);
    let f = 5; let tot = 0;
    for (const fe of fechas) {
      for (const m of ctx.movsDeFecha(fe, usuario)) {
        if (m.anulado || m.entrada) continue;
        const t = ctx.tipoDeMov(m) || "";
        if (!/autorizaci|desembols/i.test(t)) continue;
        const row = ws.getRow(f);
        row.getCell(2).value = m.folio || ""; row.getCell(3).value = fe;
        row.getCell(4).value = m.centro || ""; row.getCell(5).value = m.clienta || m.aNombre || "";
        row.getCell(6).value = m.socio || ""; row.getCell(7).value = m.ejecutivo || "";
        dinero(ws, f, 8, m.monto); tot += Number(m.monto) || 0;
        row.getCell(9).value = (m.metodo || "efectivo").toUpperCase();
        row.getCell(10).value = m.cheque || "";
        f++;
      }
    }
    ws.getRow(f).getCell(5).value = "TOTAL"; ws.getRow(f).getCell(5).font = { bold: true };
    formula(ws, f, 8, f > 5 ? "SUM(H5:H" + (f - 1) + ")" : "0", tot);
    // CU-034 · M6: autorizado vs entregado, por centro, con sus alertas. El
    // sistema ya captura los DOS conceptos (Autorización de préstamo y
    // Desembolso), así que el cruce sale solo; los sobres y la custodia del
    // pagaré llegan con la entrega 3B y aquí se les hace lugar.
    f += 2;
    ws.getRow(f).getCell(2).value = "AUTORIZADO vs ENTREGADO POR CENTRO (M6)";
    ws.getRow(f).getCell(2).font = { bold: true };
    f++;
    enc(ws, f, ["", "CENTRO", "AUTORIZADO", "ENTREGADO", "DIFERENCIA", "ALERTA"]);
    f++;
    const porCentroM6 = {};
    for (const fe of fechas) {
      for (const m of ctx.movsDeFecha(fe, usuario)) {
        if (m.anulado || m.entrada) continue;
        const t2 = ctx.tipoDeMov(m) || "";
        const esAut = /autorizaci/i.test(t2), esDes = /desembols/i.test(t2);
        if (!esAut && !esDes) continue;
        const k = m.centro || "(sin centro)";
        const b = porCentroM6[k] || (porCentroM6[k] = { aut: 0, ent: 0 });
        if (esAut) b.aut += Number(m.monto) || 0; else b.ent += Number(m.monto) || 0;
      }
    }
    const f0m6 = f;
    let tA = 0, tE = 0;
    for (const k of Object.keys(porCentroM6).sort((a, b) => a.localeCompare(b, "es"))) {
      const b = porCentroM6[k];
      const row = ws.getRow(f);
      row.getCell(2).value = k;
      dinero(ws, f, 3, b.aut); dinero(ws, f, 4, b.ent);
      formula(ws, f, 5, "C" + f + "-D" + f, b.aut - b.ent);
      const al = row.getCell(6);
      if (b.ent > b.aut + 0.009) { al.value = "⚠ entregado SIN autorización"; al.font = { bold: true, color: { argb: ROJO } }; }
      else if (b.aut > b.ent + 0.009) { al.value = "autorizado sin entregar"; al.font = { color: { argb: AMBAR } }; }
      tA += b.aut; tE += b.ent;
      f++;
    }
    if (f === f0m6) { sub(ws, f, "Sin autorizaciones ni desembolsos esta semana.", 6); f++; }
    else {
      ws.getRow(f).getCell(2).value = "TOTAL"; ws.getRow(f).getCell(2).font = { bold: true };
      formula(ws, f, 3, "SUM(C" + f0m6 + ":C" + (f - 1) + ")", tA);
      formula(ws, f, 4, "SUM(D" + f0m6 + ":D" + (f - 1) + ")", tE);
      formula(ws, f, 5, "C" + f + "-D" + f, tA - tE);
    }
  }

  // ===== CONTROL (cuadres) =====
  {
    const ws = wb.addWorksheet("CONTROL");
    ws.columns = [{ width: 4 }, { width: 5 }, { width: 52 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 15 }];
    tit(ws, 1, "PANEL DE CONTROL · VERIFICACIÓN AUTOMÁTICA", 7);
    sub(ws, 2, LEMA + " · semana " + semanaTxt, 7);
    let f = 4; let n = 1; let malos = 0;
    const check = (nombre, a, b) => {
      const row = ws.getRow(f);
      row.getCell(2).value = n++;
      row.getCell(3).value = nombre;
      dinero(ws, f, 4, a); dinero(ws, f, 5, b);
      formula(ws, f, 6, "D" + f + "-E" + f, a - b);
      const ok = Math.abs(a - b) < 0.01;
      if (!ok) malos++;
      const c = row.getCell(7);
      c.value = { formula: 'IF(ABS(F' + f + ')<0.01,"✓ CUADRA","✗ NO CUADRA")', result: ok ? "✓ CUADRA" : "✗ NO CUADRA" };
      c.font = { bold: true, color: { argb: ok ? VERDE : ROJO } };
      f++;
    };
    const capTotal = captura.reduce((t, r) => t + r.pago + r.gar + r.sol, 0);
    const capPagos = captura.reduce((t, r) => t + r.pago + r.sol, 0);
    const capGar = captura.reduce((t, r) => t + r.gar, 0);
    const totG = ctx._cobranzaTotales || { B: 0, M: 0, A: 0, I: 0, G: 0, T: 0 };
    check("COBRANZA total de la semana: matriz por centro vs captura de las apps", totG.T, capTotal);
    check("PAGOS por producto (B+M+A+I) vs pagos+solidarios capturados", totG.B + totG.M + totG.A + totG.I, capPagos);
    check("GARANTÍAS de la matriz vs garantías capturadas", totG.G, capGar);
    const porEjecSuma = Object.values(capPorEjec).reduce((a, b) => a + b, 0);
    check("POR EJECUTIVO total vs captura de las apps", porEjecSuma, capTotal);
    check("CARTERA POR PRODUCTO: suma de productos vs cartera total (CU-032)",
      ctx._carteraPorProductoTotal || 0, ctx._carteraTotal || 0);
    for (const g of ["BASICO", "MICROEMPRESAS", "ADICIONALES", "INDIVIDUALES"]) {
      const t = totalesGrupo[g];
      if (t) check("COBRADO hoja " + g + " vs capturas de ese producto", t.cobrado,
        captura.filter((r) => grupoDe(r.producto) === g).reduce((x, r) => x + r.pago, 0));
    }
    f++;
    const row = ws.getRow(f);
    ws.mergeCells(f, 2, f, 5);
    row.getCell(2).value = "ESTATUS GENERAL DE LA HOJA";
    row.getCell(2).font = { bold: true };
    const c = row.getCell(6);
    ws.mergeCells(f, 6, f, 7);
    c.value = malos === 0 ? "✓ LISTA PARA ENTREGAR" : "✗ REVISAR ANTES DE ENTREGAR";
    c.font = { bold: true, size: 12, color: { argb: malos === 0 ? VERDE : ROJO } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: malos === 0 ? "FFE7F4EC" : "FFFDECEC" } };
  }

  return { wb, semanaTxt, lunes };
}

module.exports = { generar, DIAS, grupoDe, sugeridoDe, fechasDeLaSemana, etiquetaSemana };
