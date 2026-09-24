// CANDADO ANTIDUPLICADO EN GARANTÍA A (24-sep-2026, hallazgo de Karina: probó
// sacar $550 de Garantía A a una socia con solo $467 guardados y el sistema
// lo dejó pasar — "Garantía A entregada" nunca tuvo el mismo candado que ya
// protege "Garantía líquida entregada" desde el 10-sep-2026, ver
// tests/garantia_liquida.js sección 4). Esta prueba cubre el candado que se
// agrega hoy en server.js (mismo criterio, mismo mensaje, otra fuente de
// disponible) — no repite nada de lo ya cubierto en garantia_a_visible_y_
// reportes.js (entrada/salida normales, ticket, reportes).
//
//   D=/tmp/fooax-prueba-ga; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantia_a_candado_antiduplicado.js
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

(async () => {
  const ca = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const desembolso = "2026-09-01";
  const fechaMov = "2026-09-02";

  const socio1 = "7" + RUN.padStart(10, "0");
  const producto1 = "Prueba GA Candado " + RUN;
  const r0 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio1, nombre: "Prueba GA Candado " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: producto1, saldo: 4640, cuota: 580, plazo: 8, importe: 4000,
      desembolso, diaPago: "LUNES", comision: 100, seguro: 50,
    }),
  }));
  ok("el alta responde ok", r0.ok === true, JSON.stringify(r0).slice(0, 200));

  console.log("\n— 1. Se capturan $467 de Garantía A (mismo caso real que encontró Karina) —");
  const entrada = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A", concepto: "Garantía A", monto: 467, metodo: "efectivo",
      socio: socio1, producto: producto1, fecha: fechaMov,
    }),
  }));
  ok("la aportación de $467 entra", entrada.ok === true, JSON.stringify(entrada).slice(0, 200));

  console.log("\n— 2. CANDADO: pedir $550 de salida (más de lo guardado) se rechaza —");
  const r1 = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A entregada", concepto: "Garantía A entregada", monto: 550, metodo: "efectivo",
      socio: socio1, producto: producto1, fecha: fechaMov,
    }),
  }));
  ok("la salida de $550 se rechaza (solo hay $467 guardados)", r1.ok === undefined && !!r1.error, JSON.stringify(r1));
  ok("el mensaje cita el disponible real ($467)", r1.disponible === 467, JSON.stringify(r1));

  const ficha1 = await j(await fetch(U + "/api/garantias/ficha?id=" + socio1, { headers: H(ca) }));
  ok("el saldo de Garantía A NO se movió (sigue en $467)", ficha1.saldoActualGarantiaA === 467, JSON.stringify(ficha1).slice(0, 200));
  ok("no quedó ningún movimiento de salida en el historial", (ficha1.historialGarantiaA || []).filter((h) => !h.entrada).length === 0,
    JSON.stringify(ficha1.historialGarantiaA));

  console.log("\n— 3. Una salida dentro de lo disponible SÍ procede (no se sobre-bloqueó) —");
  const r2 = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A entregada", concepto: "Garantía A entregada", monto: 467, metodo: "efectivo",
      socio: socio1, producto: producto1, fecha: fechaMov,
    }),
  }));
  ok("la salida de los $467 completos entra", r2.ok === true, JSON.stringify(r2).slice(0, 200));
  ok("el ticket muestra disponibleAntes=467 y disponibleDespues=0",
    r2.ticket && r2.ticket.disponibleAntes === 467 && r2.ticket.disponibleDespues === 0, JSON.stringify(r2.ticket));

  console.log("\n— 4. Con el guardado en $0, una segunda salida cita el ticket con el que ya salió —");
  const r3 = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A entregada", concepto: "Garantía A entregada", monto: 10, metodo: "efectivo",
      socio: socio1, producto: producto1, fecha: fechaMov,
    }),
  }));
  ok("la segunda salida se rechaza (ya no hay nada guardado)", r3.ok === undefined && !!r3.error, JSON.stringify(r3));
  ok("cita el folio del ticket con el que salió la primera vez",
    r3.ticketAnterior && r3.ticketAnterior.folio === r2.movimiento.folio,
    JSON.stringify(r3.ticketAnterior) + " vs " + (r2.movimiento && r2.movimiento.folio));

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
