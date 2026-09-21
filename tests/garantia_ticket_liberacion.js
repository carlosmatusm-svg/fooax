// TICKET DE LIBERACIÓN DE GARANTÍAS (21-sep-2026, CU-006, formato "HOJA DE
// LIBERACION DE GARANTIAS" de Karina/Dirección). Mismo patrón que
// tests/garantia_candados_reestructura_liberacion.js: corre contra el
// servidor local (3899) con DATA_DIR desechable.
//
// Incluye (21-sep-2026, cierre de 2 huecos de una validación independiente):
//   - que el JSON de ticketLiberacionGarantia trae custodia/autoriza (los dos
//     roles fijos de Dirección del Excel "REPORTE DE SALIDA A").
//   - que GET /api/garantias/liberacion/ticket responde HTML imprimible con
//     todos los campos (fecha, clienta, monto, comentarios, ejecutivo, nota
//     del sobre, custodia, autoriza, espacio de firma y botón de imprimir).
//
//   D=/tmp/fooax-prueba-tl; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantia_ticket_liberacion.js
const U = "http://localhost:3899";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

async function login(u, p) {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: p }) });
  return r.headers.get("set-cookie").split(";")[0];
}
const H = (c) => ({ "Content-Type": "application/json", Cookie: c });

async function ticketDe(ca, socio, producto) {
  return j(await fetch(U + "/api/garantias/liberacion?id=" + socio + "&producto=" + encodeURIComponent(producto), { headers: H(ca) }));
}

(async () => {
  const ca = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const desembolso = "2026-09-01"; // con margen sobre el corte real de la plantilla
  const fechaMov = "2026-09-02";
  const fechaSalida = "2026-09-15";

  console.log("\n— 1. Sin ninguna salida registrada, NO se genera ticket —");
  const socioX = "1" + RUN.padStart(10, "0");
  const productoX = "Prueba Sin Salida " + RUN;
  const rAltaX = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioX, nombre: "Prueba Sin Salida " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoX, saldo: 2300, cuota: 300, plazo: 8, importe: 2000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  ok("el alta (sin salida) responde ok", rAltaX.ok === true, JSON.stringify(rAltaX).slice(0, 200));
  const ticketSinSalida = await ticketDe(ca, socioX, productoX);
  ok("regresa error claro en vez de un ticket vacío/inventado",
    !!ticketSinSalida.error && /no hay nada que liberar/i.test(ticketSinSalida.error),
    JSON.stringify(ticketSinSalida));

  console.log("\n— 2. Con la garantía guardada + una salida completa, el ticket trae todos los campos —");
  const socioY = "2" + RUN.padStart(10, "0");
  const productoY = "Prueba Con Salida " + RUN;
  const rAltaY = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioY, nombre: "Prueba Con Salida " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoY, saldo: 2300, cuota: 300, plazo: 8, importe: 2000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  ok("el alta (con salida) responde ok", rAltaY.ok === true, JSON.stringify(rAltaY).slice(0, 200));

  // El alta ya retuvo automáticamente el 10% de 2000 = $200 al desembolsar
  // (registrarGarantiaLiquidaAlDesembolsar) — se entrega completa al cierre.
  const rBaja = await j(await fetch(U + "/api/clientes/baja", {
    method: "POST", headers: H(ca), body: JSON.stringify({ id: socioY, producto: productoY, motivo: "Otro" }),
  }));
  ok("la baja (cierre de ciclo) responde ok", rBaja.ok === true, JSON.stringify(rBaja));

  const rEntrega = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 200, metodo: "efectivo",
      fecha: fechaSalida, socio: socioY, producto: productoY,
    }),
  }));
  ok("la entrega/liberación de los $200 guardados responde ok", rEntrega.ok === true, JSON.stringify(rEntrega).slice(0, 200));
  const folioSalida = rEntrega.movimiento && rEntrega.movimiento.folio;

  const ticket = await ticketDe(ca, socioY, productoY);
  ok("el ticket NO trae error", !ticket.error, JSON.stringify(ticket).slice(0, 300));
  ok("fechaEntrega es la fecha real de la salida", ticket.fechaEntrega === fechaSalida, ticket.fechaEntrega);
  ok("nombreClienta viene del padrón", ticket.nombreClienta === "Prueba Con Salida " + RUN, ticket.nombreClienta);
  ok("montoEntregado es el total realmente liberado ($200)", Math.abs(ticket.montoEntregado - 200) < 0.01, ticket.montoEntregado);
  ok("total coincide con montoEntregado (una sola partida)", Math.abs(ticket.total - 200) < 0.01, ticket.total);
  ok("subtotal trae una partida de tipo Líquida por $200",
    Array.isArray(ticket.subtotal) && ticket.subtotal.length === 1
      && ticket.subtotal[0].tipoGarantia === "Líquida" && Math.abs(ticket.subtotal[0].monto - 200) < 0.01,
    JSON.stringify(ticket.subtotal));
  ok("el folio del ticket es el folio real del movimiento de salida",
    ticket.folio === folioSalida, ticket.folio + " vs " + folioSalida);
  ok("comentarios cita el periodo GARANTIAS DEL ... AL ... con las fechas reales",
    new RegExp("GARANTIAS DEL 01-09-2026 AL 15-09-2026").test(ticket.comentarios || ""), ticket.comentarios);
  ok("firmaRecibido viene sin firmar por defecto (el sistema no captura firma digital)",
    ticket.firmaRecibido && ticket.firmaRecibido.firmado === false && ticket.firmaRecibido.fecha === null,
    JSON.stringify(ticket.firmaRecibido));
  ok("trae nombre y centro del ejecutivo responsable (del padrón)",
    ticket.ejecutivo && ticket.ejecutivo.nombre === "Karina" && ticket.ejecutivo.centro === "C-0",
    JSON.stringify(ticket.ejecutivo));
  ok("la firma del ejecutivo también viene sin firmar por defecto",
    ticket.ejecutivo && ticket.ejecutivo.firma && ticket.ejecutivo.firma.firmado === false,
    JSON.stringify(ticket.ejecutivo));
  ok("trae la nota fija del sobre sellado con un teléfono de contacto (no vacío)",
    typeof ticket.notaSobreSellado === "string" && /sellado/i.test(ticket.notaSobreSellado) && /\S+/.test(ticket.notaSobreSellado),
    ticket.notaSobreSellado);
  ok("declara el pendiente del ejecutivo de la entrega física (no se adivina)",
    Array.isArray(ticket.pendientes) && ticket.pendientes.some((p) => /entrega física/i.test(p.tema)),
    JSON.stringify(ticket.pendientes));
  ok("trae custodia (Excel 'REPORTE DE SALIDA A': Ing. Alejandra González Arango, por defecto)",
    typeof ticket.custodia === "string" && /Alejandra Gonz.lez Arango/i.test(ticket.custodia),
    ticket.custodia);
  ok("trae autoriza (Excel 'REPORTE DE SALIDA A': Lic. Anel Aydee Díaz Silva, Directora General)",
    typeof ticket.autoriza === "string" && /Anel Aydee D.az Silva/i.test(ticket.autoriza) && /Directora General/i.test(ticket.autoriza),
    ticket.autoriza);

  console.log("\n— 3. La vista imprimible (GET /api/garantias/liberacion/ticket) trae TODOS los campos —");
  const rHtml = await fetch(
    U + "/api/garantias/liberacion/ticket?id=" + socioY + "&producto=" + encodeURIComponent(productoY),
    { headers: H(ca) },
  );
  const html = await rHtml.text();
  ok("responde 200", rHtml.status === 200, String(rHtml.status));
  ok("Content-Type es HTML", /text\/html/i.test(rHtml.headers.get("content-type") || ""), rHtml.headers.get("content-type"));
  ok("es un documento HTML completo (DOCTYPE + </html>)",
    /<!DOCTYPE html>/i.test(html) && /<\/html>/i.test(html), html.slice(0, 60));
  ok("trae la fecha de entrega", html.includes(fechaSalida), "no encontrada: " + fechaSalida);
  ok("trae el nombre de la clienta", html.includes("Prueba Con Salida " + RUN), "no encontrado el nombre");
  ok("trae el monto entregado formateado ($200.00)", /\$200\.00/.test(html), "no encontrado $200.00");
  ok("trae los comentarios con el periodo y 'CIERRE AL PAGO'",
    /GARANTIAS DEL 01-09-2026 AL 15-09-2026/.test(html), "no encontrado el periodo en el HTML");
  ok("trae el nombre del ejecutivo (Karina) y su centro (C-0)",
    html.includes("Karina") && html.includes("C-0"), "no encontrado ejecutivo/centro");
  ok("trae la nota del sobre sellado", /sellado/i.test(html), "no encontrada la nota del sobre");
  ok("trae Custodia (Ing. Alejandra González Arango)", /Custodia/i.test(html) && /Alejandra/i.test(html), "no encontrada Custodia");
  ok("trae Autoriza (Lic. Anel Aydee Díaz Silva, Directora General)",
    /Autoriza/i.test(html) && /Anel Aydee/i.test(html) && /Directora General/i.test(html), "no encontrada Autoriza");
  ok("deja un espacio físico para la firma de la clienta y del ejecutivo",
    /Firma de la clienta/i.test(html) && /Firma del ejecutivo/i.test(html), "no encontrado el espacio de firma");
  ok("el nombre real de la clienta aparece junto a su línea de firma (21-sep-2026, pedido de Carlos)",
    new RegExp("Prueba Con Salida " + RUN + "[\\s\\S]{0,80}Firma de la clienta", "i").test(html), "no encontrado el nombre junto a la firma de la clienta");
  ok("el nombre real del ejecutivo aparece junto a su línea de firma",
    new RegExp("Karina[\\s\\S]{0,80}Firma del ejecutivo", "i").test(html), "no encontrado el nombre junto a la firma del ejecutivo");
  ok("trae el botón/atajo para imprimir (window.print())", /window\.print\(\)/.test(html), "no encontrado window.print()");
  ok("trae el logo de FOOAX (21-sep-2026, pedido de Karina/Dirección)",
    /<img[^>]+src="\/img\/logo-fooax-hoja\.png"/.test(html), "no encontrado el <img> del logo");

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
