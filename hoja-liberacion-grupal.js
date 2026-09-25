// FOOAX · HOJA DE LIBERACIÓN DE GARANTÍAS POR CENTRO (formato "GARANTIA
// GRUPAL") — vista imprimible (25-sep-2026).
//
// Renderiza como HTML, con estilos @media print, lo que ya arma
// dominios/hoja_liberacion_grupal.js::hojaLiberacionGrupal(). Es un módulo de
// RENDERIZADO, no de negocio (mismo criterio que ticket-liberacion-garantia.js
// y hoja-cobranza.js): no repite ningún cálculo, solo formatea, y no conoce
// req/res.
//
// Formato tomado de la hoja "HOJA DE LIBERACION DE GARANTIAS" del Excel de
// Karina, bloque "GARANTIA GRUPAL": un renglón por clienta con su FIRMA DE
// RECIBIDO y COMENTARIOS (periodo + cierre al pago), SUBTOTAL/TOTAL, y al pie
// FIRMA DEL GERENTE DE SUCURSAL y JEFA DE CENTRO. El sistema no captura firma
// digital: deja el espacio físico para firmar en papel; después la hoja se
// escanea y regresa a oficina, y Alejandra la valida.
"use strict";

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatoMoneda(monto) {
  return "$" + Number(monto || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatoFecha(fechaISO) {
  const [anio, mes, dia] = String(fechaISO || "").split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : String(fechaISO || "");
}

function filaPartida({ numero, nombre, tipoGarantia, folio, monto, observaciones }) {
  return "<tr>"
    + `<td class="num">${escaparHtml(numero)}</td>`
    + `<td>${escaparHtml(nombre)}</td>`
    + `<td>${escaparHtml(tipoGarantia)}<div class="folio">${escaparHtml(folio)}</div></td>`
    + `<td class="monto">${formatoMoneda(monto)}</td>`
    + '<td class="firma-celda"></td>'
    + `<td class="coment">${escaparHtml(observaciones)}</td>`
    + "</tr>";
}

function bloqueFirma(nombre, rol) {
  const nombreVisible = nombre
    ? `<strong>${escaparHtml(nombre)}</strong>`
    : '<strong class="vacio">Nombre: ______________________________</strong>';
  return `<div class="firma"><div class="linea">${nombreVisible}<br>${escaparHtml(rol)}</div></div>`;
}

// Único punto de entrada: recibe la hoja que regresa hojaLiberacionGrupal() y
// devuelve el documento HTML completo, listo para imprimir/guardar como PDF.
function renderHtml(hoja) {
  const filas = (hoja.partidas || []).map(filaPartida).join("");
  const subtotales = (hoja.subtotales || []).map(({ tipoGarantia, monto }) =>
    `<tr><td colspan="3" class="der">Subtotal ${escaparHtml(tipoGarantia)}</td><td class="monto">${formatoMoneda(monto)}</td><td colspan="2"></td></tr>`).join("");
  const centroVisible = [hoja.noCentro, hoja.centro].filter(Boolean).join(" ");
  const avisos = (hoja.avisos || []).map((a) => `<div class="aviso">${escaparHtml(a)}</div>`).join("");
  const firmasPie = hoja.individual
    ? bloqueFirma(hoja.firmas?.gerente, "Firma del ejecutivo de crédito y cobranza (entregó)")
    : bloqueFirma(hoja.firmas?.gerente, "Firma del gerente de sucursal")
      + bloqueFirma(hoja.firmas?.jefaDeCentro, "Firma de la jefa de centro");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hoja de liberación de garantías — ${escaparHtml(centroVisible)} — ${escaparHtml(formatoFecha(hoja.fechaEntrega))}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 24px; }
  h1 { font-size: 17px; margin: 0; }
  h2 { font-size: 13px; text-align: center; margin: 2px 0 16px; color: #555; font-weight: normal; }
  .encabezado { display: flex; align-items: center; justify-content: center; gap: 12px; }
  .encabezado img { height: 46px; width: auto; }
  .datos { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; font-size: 14px; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { border: 1px solid #999; padding: 6px 7px; font-size: 12.5px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  .num { width: 28px; text-align: center; }
  .monto { text-align: right; white-space: nowrap; }
  .der { text-align: right; }
  .folio { font-size: 10.5px; color: #666; }
  .firma-celda { width: 22%; height: 38px; }
  .coment { font-size: 11.5px; width: 26%; }
  .nota { border: 1px solid #b8860b; background: #fff8e1; padding: 9px; margin: 14px 0; font-size: 12px; }
  .firmas { display: flex; justify-content: space-around; gap: 24px; margin-top: 60px; }
  .firma { flex: 1; max-width: 45%; text-align: center; }
  .firma .linea { border-top: 1px solid #222; margin-top: 50px; padding-top: 6px; font-size: 12px; }
  .vacio { font-weight: normal; color: #444; }
  .responsables { margin-top: 26px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 12px; }
  .oficina { margin-top: 18px; border: 1px dashed #777; padding: 10px; font-size: 12px; }
  .oficina div { margin: 7px 0; }
  .aviso { border: 1px solid #c62828; background: #ffebee; padding: 8px; margin: 8px 0; font-size: 12.5px; }
  .btn-imprimir { margin: 0 0 16px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  @media print { .no-imprimir { display: none; } body { margin: 8mm; } }
</style>
</head>
<body>
  <div class="no-imprimir">
    <button class="btn-imprimir" onclick="window.print()">Imprimir / Guardar como PDF</button>
    ${avisos}
  </div>

  <div class="encabezado">
    <img src="/img/logo-fooax-hoja.png" alt="FOOAX">
    <h1>HOJA DE LIBERACIÓN DE GARANTÍAS — ${hoja.individual ? "GARANTÍA INDIVIDUAL" : "GARANTÍA GRUPAL"}</h1>
  </div>
  <h2>FOOAX · Creciendo juntas, avanzando siempre</h2>

  <div class="datos">
    <div><strong>Centro:</strong> ${escaparHtml(centroVisible)}</div>
    <div><strong>Fecha de entrega:</strong> ${escaparHtml(formatoFecha(hoja.fechaEntrega))}</div>
    <div><strong>Folio de hoja:</strong> ${escaparHtml(hoja.folioHoja)}</div>
  </div>

  <table>
    <thead>
      <tr><th class="num">No.</th><th>Nombre</th><th>Garantía / folio</th><th>Entrega de garantía</th><th>Firma de recibido</th><th>Comentarios</th></tr>
    </thead>
    <tbody>${filas}</tbody>
    <tfoot>
      ${subtotales}
      <tr><td colspan="3" class="der"><strong>TOTAL</strong></td><td class="monto"><strong>${formatoMoneda(hoja.total)}</strong></td><td colspan="2"></td></tr>
    </tfoot>
  </table>

  <div class="nota">${escaparHtml(hoja.notaSobreSellado)}</div>

  <div class="firmas">${firmasPie}</div>

  <div class="responsables">
    <div><strong>Custodia:</strong> ${escaparHtml(hoja.custodia)} &nbsp;·&nbsp; <strong>Autoriza:</strong> ${escaparHtml(hoja.autoriza)}</div>
  </div>

  <div class="oficina">
    <strong>Uso de oficina</strong>
    <div>Regresó escaneada el: ____________________ &nbsp; Recibió: ______________________________</div>
    <div>Validó (${escaparHtml(hoja.custodia)}): ______________________________ &nbsp; Fecha: ______________</div>
  </div>
</body>
</html>`;
}

module.exports = { renderHtml };
