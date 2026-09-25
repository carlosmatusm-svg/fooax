// FOOAX · REPORTE SEMANAL DE GARANTÍAS EN EXCEL (25-sep-2026, CU-008).
//
// Anel/Karina: "falta el reporte semanal". El reporte ya existía en pantalla
// (/api/garantias/reporte-semanal y /api/garantias/reporte-salidas), pero
// Karina lo sigue armando a mano en Excel (hojas "REPORTES SEMANALES" y
// "REPORTE DE SALIDA A" de PLANILLA-GARANTIAS LUNES PRIMERA PARTE). Este
// módulo arma ESE mismo libro con los datos del sistema.
//
// Es un módulo de RENDERIZADO (mismo criterio que hoja-cobranza.js): recibe lo
// que ya calcularon reporteSemanalGarantias() y reporteSalidaGarantiasSemanal()
// en dominios/garantia_liquida.js y solo lo acomoda en celdas — no suma, no
// filtra, no decide nada. No conoce req/res.
"use strict";

const AURORA = "FFF1228E";
const RIO = "FF324AB6";
const VERDE = "FF0B7247";
const ROJO = "FF8E0019";
const MONEDA = '"$"#,##0.00';
const DIAS = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];

function nombreDelDia(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return DIAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
}

function fechaDDMMAAAA(fechaISO) {
  const [anio, mes, dia] = String(fechaISO || "").split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : String(fechaISO || "");
}

// Hoja con título en banda rosa, subtítulo y encabezados en azul (misma
// identidad que el resto de descargas del tablero).
function hojaConEncabezado(wb, nombre, titulo, subtitulo, columnas) {
  const hoja = wb.addWorksheet(nombre);
  // El título abarca al menos 6 columnas para que no se corte en hojas angostas.
  const ultima = String.fromCharCode(64 + Math.max(columnas.length, 6));
  hoja.mergeCells(`A1:${ultima}1`);
  Object.assign(hoja.getCell("A1"), {
    value: titulo,
    font: { bold: true, size: 13, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: AURORA } },
    alignment: { horizontal: "center", vertical: "middle" },
  });
  hoja.getRow(1).height = 24;
  hoja.mergeCells(`A2:${ultima}2`);
  Object.assign(hoja.getCell("A2"), {
    value: subtitulo, font: { italic: true, size: 9 }, alignment: { horizontal: "center" },
  });
  const fila = hoja.getRow(4);
  columnas.forEach(([encabezado, ancho], i) => {
    const celda = fila.getCell(i + 1);
    celda.value = encabezado;
    hoja.getColumn(i + 1).width = ancho;
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    celda.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  fila.height = 30;
  // Para imprimir: horizontal y a lo ancho de una sola hoja.
  hoja.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return hoja;
}

function monedaEn(celda, valor, extra = {}) {
  celda.value = valor;
  celda.numFmt = MONEDA;
  Object.assign(celda, extra);
}

// ---- Hoja 1: REPORTE SEMANAL (entrada por día + desglose por ejecutivo +
// resumen de movimiento).
function hojaSemanal(wb, semanal, responsables) {
  const formas = [...new Set(semanal.entradasPorQuienYForma.flatMap((f) => Object.keys(f.porForma)))].sort();
  const hoja = hojaConEncabezado(wb, "Reporte semanal",
    `FOOAX · REPORTE SEMANAL DE GARANTÍAS · ${fechaDDMMAAAA(semanal.semana.desde)} AL ${fechaDDMMAAAA(semanal.semana.hasta)}`,
    `Custodia: ${responsables.custodia} · Autoriza: ${responsables.autoriza}`,
    [["Día", 14], ["Fecha", 13], ["Entrada de garantías", 18], ["Salida de garantías", 18]]);

  // Los 7 días de la semana SIEMPRE, aunque alguno no tenga movimiento
  // (igual que la hoja de Karina, que lista LUNES a SÁBADO con celdas vacías).
  const porFecha = Object.fromEntries(semanal.porDia.map((d) => [d.fecha, d]));
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(semanal.semana.desde + "T12:00:00");
    d.setDate(d.getDate() + i);
    const fecha = d.toISOString().slice(0, 10);
    return porFecha[fecha] ?? { fecha, entradas: 0, salidas: 0 };
  });
  let r = 5;
  for (const { fecha, entradas, salidas } of dias) {
    const fila = hoja.getRow(r++);
    fila.getCell(1).value = nombreDelDia(fecha);
    fila.getCell(2).value = fechaDDMMAAAA(fecha);
    monedaEn(fila.getCell(3), entradas);
    monedaEn(fila.getCell(4), salidas, { font: { color: { argb: ROJO } } });
  }
  const total = hoja.getRow(r++);
  total.getCell(2).value = "TOTAL";
  total.getCell(2).font = { bold: true };
  monedaEn(total.getCell(3), semanal.totalEntradas, { font: { bold: true } });
  monedaEn(total.getCell(4), semanal.totalSalidas, { font: { bold: true, color: { argb: ROJO } } });

  r += 1;
  hoja.getCell(`A${r}`).value = "DESGLOSE DE ENTRADAS POR EJECUTIVO";
  hoja.getCell(`A${r}`).font = { bold: true };
  r += 1;
  const encabezados = ["Ejecutivo", ...formas.map((f) => f.toUpperCase())];
  encabezados.forEach((texto, i) => {
    const celda = hoja.getRow(r).getCell(i + 1);
    celda.value = texto;
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
    if (i >= 4) hoja.getColumn(i + 1).width = 16;
  });
  r += 1;
  for (const { quien, porForma } of semanal.entradasPorQuienYForma) {
    const fila = hoja.getRow(r++);
    fila.getCell(1).value = quien;
    formas.forEach((forma, i) => { if (porForma[forma] != null) monedaEn(fila.getCell(i + 2), porForma[forma]); });
  }

  r += 1;
  hoja.getCell(`A${r}`).value = "FOOAX · RESUMEN DE MOVIMIENTO DE GARANTÍAS";
  hoja.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  const resumen = [
    ["(+) Entrada · garantías recibidas en la semana", semanal.totalEntradas, VERDE],
    ["(−) Salida · garantías devueltas a clientas", semanal.totalSalidas, ROJO],
    ["MOVIMIENTO NETO (entrada − salida)", semanal.movimientoNeto, semanal.movimientoNeto < 0 ? ROJO : VERDE],
  ];
  for (const [concepto, monto, color] of resumen) {
    const fila = hoja.getRow(r++);
    hoja.mergeCells(`A${fila.number}:C${fila.number}`);
    fila.getCell(1).value = concepto;
    monedaEn(fila.getCell(4), monto, { font: { bold: true, color: { argb: color } } });
  }
  r += 1;
  hoja.mergeCells(`A${r}:D${r}`);
  hoja.getCell(`A${r}`).value = `Nota: las garantías son resguardo de la clienta. El término correcto es GARANTÍAS. Custodia: ${responsables.custodia}.`;
  hoja.getCell(`A${r}`).font = { italic: true, size: 9 };
  hoja.getCell(`A${r}`).alignment = { wrapText: true };
  hoja.getRow(r).height = 28;
}

// ---- Hoja 2: REPORTE DE SALIDA DE GARANTÍAS POR CLIENTE (formato de la
// captura que mandó Karina: ID, NOMBRE, CENTRO, EJECUTIVO, MONTO,
// OBSERVACIONES) + rollup por centro.
function hojaSalidas(wb, salidas, responsables, fechaReporte) {
  const hoja = hojaConEncabezado(wb, "Salida por cliente",
    "FOOAX · REPORTE DE SALIDA DE GARANTÍAS POR CLIENTE",
    `Custodia: ${responsables.custodia} · Autoriza: ${responsables.autoriza} · Fecha de reporte: ${fechaDDMMAAAA(fechaReporte)} · Semana ${fechaDDMMAAAA(salidas.semana.desde)} al ${fechaDDMMAAAA(salidas.semana.hasta)}`,
    [["ID", 15], ["Nombre de la clienta", 36], ["Centro", 22], ["Ejecutivo", 16], ["Tipo", 16], ["Monto", 13],
      ["Observaciones (periodo de garantías y pago de cierre)", 52]]);

  let r = 5;
  for (const s of salidas.salidas) {
    const fila = hoja.getRow(r++);
    [s.socio, s.nombre ?? "—", [s.noCentro, s.centro].filter(Boolean).join(" "), s.ejecutivo ?? s.quien, s.tipoGarantia]
      .forEach((valor, i) => { fila.getCell(i + 1).value = valor; });
    monedaEn(fila.getCell(6), s.monto);
    fila.getCell(7).value = s.observaciones;
    fila.getCell(7).alignment = { wrapText: true };
  }
  const total = hoja.getRow(r++);
  total.getCell(2).value = "TOTAL SALIDA DE GARANTÍAS";
  total.getCell(2).font = { bold: true };
  monedaEn(total.getCell(6), salidas.total, { font: { bold: true } });

  r += 2;
  hoja.getCell(`A${r}`).value = "GARANTÍAS POR CENTRO";
  hoja.getCell(`A${r}`).font = { bold: true };
  r += 1;
  ["Centro", "Ejecutivo", "Monto"].forEach((texto, i) => {
    const celda = hoja.getRow(r).getCell(i + 1);
    celda.value = texto;
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RIO } };
  });
  r += 1;
  for (const { centro, ejecutivo, total: monto } of salidas.rollupPorCentroYEjecutivo) {
    const fila = hoja.getRow(r++);
    fila.getCell(1).value = centro;
    fila.getCell(2).value = ejecutivo;
    monedaEn(fila.getCell(3), monto);
  }
  const totalCentros = hoja.getRow(r);
  totalCentros.getCell(2).value = "TOTAL";
  totalCentros.getCell(2).font = { bold: true };
  monedaEn(totalCentros.getCell(3), salidas.total, { font: { bold: true } });
}

// Único punto de entrada.
function generarReporteSemanal(ExcelJS, { semanal, salidas, responsables, fechaReporte }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FOOAX";
  hojaSemanal(wb, semanal, responsables);
  hojaSalidas(wb, salidas, responsables, fechaReporte);
  return wb;
}

module.exports = { generarReporteSemanal };
