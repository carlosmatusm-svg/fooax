// FOOAX · TICKET DE LIBERACIÓN DE GARANTÍAS — vista imprimible (21-sep-2026).
//
// Renderiza como HTML, con estilos @media print, los datos que ya arma
// dominios/garantia_liquida.js::ticketLiberacionGarantia(). Cierra el hallazgo
// de validación del CU-006 sobre un audio de Karina (Dirección): "cuando
// entregas la garantía tienes que imprimir un ticket que se los deje firmar y
// que el ejecutivo lo deje escanear para que quede de evidencia" — hasta hoy
// el endpoint solo regresaba JSON, sin nada que se pudiera imprimir.
//
// Mismo criterio que hoja-cobranza.js: es un módulo de RENDERIZADO, no de
// negocio — no repite ningún cálculo, solo formatea lo que el dominio ya
// entregó, y no conoce req/res (recibe el objeto ticket y regresa un string
// HTML; server.js decide cómo servirlo).
//
// A diferencia de hoja-cobranza.js (ExcelJS, para descargar) esto es HTML
// imprimible que se abre directo en el navegador: el sistema no tiene ni
// necesita una librería de generación de PDF — el diálogo de impresión del
// propio teléfono/tablet del ejecutivo ya resuelve "guardar como PDF" o
// imprimir en papel para que la clienta firme a mano (el sistema no captura
// firma digital, solo deja el espacio físico).
//
// LOS DOS NOMBRES EN LAS FIRMAS (21-sep-2026, pedido de Carlos): antes las
// dos líneas de firma solo decían el ROL ("Firma de la clienta", "Firma del
// ejecutivo") sin el nombre real de la persona, aunque el sistema ya lo
// tiene (nombreClienta y ejecutivo.nombre ya venían arriba en el ticket).
// Ahora el nombre completo se imprime arriba de cada línea de firma, para
// que quien firme y quien reciba el papel/escaneo sepan exactamente de
// quién es cada firma sin tener que buscarlo en otra parte del documento.
//
// LOGO (21-sep-2026, pedido de Karina/Dirección): usa /img/logo-fooax-hoja.png,
// el mismo PNG chico ya usado para insertarlo en la Hoja de Cobranza (Excel,
// ver hoja-cobranza.js). Se referencia por ruta (<img src="/img/...">), no
// como base64 embebido: express.static ya sirve /public en la raíz (mismo
// criterio que login.html/tablero.html, que ya cargan /img/logo-fooax.jpg),
// así que no hace falta duplicar el archivo dentro de este módulo.
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

function filaPartida({ tipoGarantia, folio, fechaEntrega, monto }) {
  return "<tr>"
    + `<td>${escaparHtml(tipoGarantia)}</td>`
    + `<td>${escaparHtml(folio)}</td>`
    + `<td>${escaparHtml(fechaEntrega)}</td>`
    + `<td class="monto">${formatoMoneda(monto)}</td>`
    + "</tr>";
}

// Único punto de entrada: recibe el ticket que regresa ticketLiberacionGarantia()
// y devuelve el documento HTML completo, listo para imprimir/guardar como PDF.
function renderHtml(ticket) {
  const filasPartidas = (ticket.partidas || []).map(filaPartida).join("");
  const folios = (ticket.folios || []).filter(Boolean).join(", ");
  const tituloFolio = folios ? ` — Folio ${escaparHtml(folios)}` : "";
  const nombreEjecutivo = ticket.ejecutivo?.nombre ?? "—";
  const centroEjecutivo = ticket.ejecutivo?.centro ?? "—";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket de liberación de garantía${tituloFolio}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 24px; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; }
  h2 { font-size: 13px; text-align: center; margin: 0 0 20px; color: #555; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { border: 1px solid #999; padding: 6px 8px; font-size: 13px; text-align: left; }
  th { background: #f0f0f0; }
  .monto { text-align: right; }
  .dato { margin: 6px 0; font-size: 14px; }
  .dato strong { display: inline-block; min-width: 150px; }
  .nota { border: 1px solid #b8860b; background: #fff8e1; padding: 10px; margin: 18px 0; font-size: 12.5px; }
  .firmas { display: flex; justify-content: space-between; margin-top: 70px; }
  .firma { width: 45%; text-align: center; }
  .firma .linea { border-top: 1px solid #222; margin-top: 55px; padding-top: 6px; font-size: 12px; }
  .responsables { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 12.5px; }
  .responsables .dato strong { min-width: 100px; }
  .btn-imprimir { margin: 0 0 20px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  .encabezado { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 4px; }
  .encabezado img { height: 48px; width: auto; }
  .encabezado h1 { margin: 0; }
  @media print { .btn-imprimir { display: none; } body { margin: 8mm; } }
</style>
</head>
<body>
  <button class="btn-imprimir" onclick="window.print()">Imprimir / Guardar como PDF</button>

  <div class="encabezado">
    <img src="/img/logo-fooax-hoja.png" alt="FOOAX">
    <h1>TICKET DE LIBERACIÓN DE GARANTÍA${tituloFolio}</h1>
  </div>
  <h2>FOOAX</h2>

  <div class="dato"><strong>Fecha de entrega:</strong> ${escaparHtml(ticket.fechaEntrega)}</div>
  <div class="dato"><strong>Clienta:</strong> ${escaparHtml(ticket.nombreClienta)}</div>
  <div class="dato"><strong>Socio:</strong> ${escaparHtml(ticket.socio)} &nbsp;·&nbsp; <strong>Producto:</strong> ${escaparHtml(ticket.producto)}</div>
  <div class="dato"><strong>Comentarios:</strong> ${escaparHtml(ticket.comentarios)}</div>

  <table>
    <thead>
      <tr><th>Tipo de garantía</th><th>Folio</th><th>Fecha de entrega</th><th>Monto</th></tr>
    </thead>
    <tbody>${filasPartidas}</tbody>
    <tfoot>
      <tr>
        <td colspan="3"><strong>Total entregado</strong></td>
        <td class="monto"><strong>${formatoMoneda(ticket.total)}</strong></td>
      </tr>
    </tfoot>
  </table>

  <div class="nota">${escaparHtml(ticket.notaSobreSellado)}</div>

  <div class="dato"><strong>Ejecutivo:</strong> ${escaparHtml(nombreEjecutivo)} &nbsp;·&nbsp; <strong>Centro:</strong> ${escaparHtml(centroEjecutivo)}</div>

  <div class="firmas">
    <div class="firma"><div class="linea"><strong>${escaparHtml(ticket.nombreClienta)}</strong><br>Firma de la clienta (recibido de conformidad)</div></div>
    <div class="firma"><div class="linea"><strong>${escaparHtml(nombreEjecutivo)}</strong><br>Firma del ejecutivo (entregó)</div></div>
  </div>

  <div class="responsables">
    <div class="dato"><strong>Custodia:</strong> ${escaparHtml(ticket.custodia)}</div>
    <div class="dato"><strong>Autoriza:</strong> ${escaparHtml(ticket.autoriza)}</div>
  </div>
</body>
</html>`;
}

module.exports = { renderHtml };
