// GARANTÍA A VISIBLE + TICKET + REPORTES DE GARANTÍAS (20-sep-2026, hallazgo
// de validación del módulo de Garantías contra CU-006/CU-008): antes de esta
// entrega, Garantía A se calculaba en el backend (carteraVivaCalcular) pero
// no se veía en ningún lado — /api/garantias y /api/garantias/ficha solo
// mostraban Garantía Líquida — y ninguna aportación/entrega de Garantía A
// generaba ticket (CU-006 item 12, RESUELTO 10-sep-2026: "sin excepción, sin
// distinguir por volumen ni por tipo de garantía"). Tampoco existía ningún
// reporte del catálogo de CU-008. Esta prueba cubre las tres construcciones,
// SIN tocar nada de Garantía Líquida (se corre junto con garantia_liquida.js
// y garantias_pantalla.js, que deben seguir en verde).
//
// Mismo patrón que el resto de pruebas del módulo: servidor local con
// DATA_DIR desechable.
//
//   D=/tmp/fooax-prueba-ga2; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantia_a_visible_y_reportes.js
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
  const mesDelMov = fechaMov.slice(0, 7);
  const centro1 = "C-0"; // mismo centro de prueba que ya usa garantias_pantalla.js

  console.log("\n— 0. Alta de una clienta de prueba —");
  const socio1 = "7" + RUN.padStart(10, "0");
  const producto1 = "Prueba GA-VIS " + RUN;
  const r0 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio1, nombre: "Prueba GA-VIS " + RUN, centro: centro1, ejecutivo: "Karina",
      producto: producto1, saldo: 5800, cuota: 725, plazo: 8, importe: 5000,
      desembolso, diaPago: "MARTES",
    }),
  }));
  ok("el alta responde ok", r0.ok === true, JSON.stringify(r0).slice(0, 200));

  console.log("\n— 1. Una aportación de Garantía A genera ticket (CU-006 item 12) —");
  const entrada = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A", concepto: "Garantía A", monto: 100, metodo: "efectivo",
      socio: socio1, producto: producto1, fecha: fechaMov,
    }),
  }));
  ok("el movimiento se registra", entrada.ok === true, JSON.stringify(entrada).slice(0, 200));
  ok("trae ticket (antes esto regresaba null)", !!entrada.ticket, JSON.stringify(entrada.ticket));
  ok("el ticket muestra disponibleAntes=0 y disponibleDespues=100",
    entrada.ticket && entrada.ticket.disponibleAntes === 0 && entrada.ticket.disponibleDespues === 100,
    JSON.stringify(entrada.ticket));

  console.log("\n— 2. Garantía A aparece en el resumen (/api/garantias), separada de Líquida —");
  const resumen = await j(await fetch(U + "/api/garantias", { headers: H(ca) }));
  ok("trae pasivoTotalGarantiaA numérico", typeof resumen.pasivoTotalGarantiaA === "number", JSON.stringify(resumen).slice(0, 200));
  const encontrada = (resumen.sociasGarantiaA || []).find((s) => String(s.id) === socio1);
  ok("la clienta aparece en sociasGarantiaA con $100", encontrada && encontrada.garantiaA === 100, JSON.stringify(encontrada));
  ok("el centro de la clienta aparece en porCentroGarantiaA",
    (resumen.porCentroGarantiaA || []).some((x) => x.centro === centro1));
  ok("NO se mezcló con el pasivo de Garantía Líquida (esa clienta no tiene líquida capturada aparte de la retención automática)",
    !(resumen.socias || []).some((s) => String(s.id) === socio1 && s.garantia === 100));

  console.log("\n— 3. Garantía A aparece en la ficha (/api/garantias/ficha), separada de Líquida —");
  const ficha = await j(await fetch(U + "/api/garantias/ficha?id=" + socio1, { headers: H(ca) }));
  ok("trae saldoActualGarantiaA = 100", ficha.saldoActualGarantiaA === 100, JSON.stringify(ficha).slice(0, 300));
  ok("trae historialGarantiaA con 1 movimiento", Array.isArray(ficha.historialGarantiaA) && ficha.historialGarantiaA.length === 1,
    JSON.stringify(ficha.historialGarantiaA));

  console.log("\n— 4. Entrega de Garantía A también genera ticket —");
  const salida = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A entregada", concepto: "Garantía A entregada", monto: 40, metodo: "efectivo",
      socio: socio1, producto: producto1, fecha: fechaMov,
    }),
  }));
  ok("el movimiento se registra", salida.ok === true, JSON.stringify(salida).slice(0, 200));
  ok("trae ticket de salida con disponibleAntes=100, disponibleDespues=60",
    salida.ticket && salida.ticket.disponibleAntes === 100 && salida.ticket.disponibleDespues === 60,
    JSON.stringify(salida.ticket));

  const fichaDespues = await j(await fetch(U + "/api/garantias/ficha?id=" + socio1, { headers: H(ca) }));
  ok("el saldo de Garantía A bajó a $60 después de la entrega", fichaDespues.saldoActualGarantiaA === 60, JSON.stringify(fichaDespues).slice(0, 200));
  ok("el historial de Garantía A ya trae 2 movimientos", (fichaDespues.historialGarantiaA || []).length === 2);

  console.log("\n— 5. Reporte semanal de entrada/salida incluye los dos movimientos —");
  const repSemanal = await j(await fetch(U + "/api/garantias/reporte-semanal?fecha=" + fechaMov, { headers: H(ca) }));
  ok("la semana resuelta cubre 7 días (lunes a domingo) e incluye la fecha del movimiento",
    repSemanal.semana && repSemanal.semana.desde <= fechaMov && fechaMov <= repSemanal.semana.hasta,
    JSON.stringify(repSemanal.semana));
  ok("totalEntradas incluye al menos los $100 de la aportación", repSemanal.totalEntradas >= 100, JSON.stringify(repSemanal.totalEntradas));
  ok("totalSalidas incluye al menos los $40 de la entrega", repSemanal.totalSalidas >= 40, JSON.stringify(repSemanal.totalSalidas));
  const filaDelDia = (repSemanal.porDia || []).find((x) => x.fecha === fechaMov);
  ok("el día del movimiento aparece en porDia con ambos montos", filaDelDia && filaDelDia.entradas >= 100 && filaDelDia.salidas >= 40, JSON.stringify(filaDelDia));

  console.log("\n— 6. Reporte de salidas por clienta (mensual) incluye la entrega —");
  const repSalidas = await j(await fetch(U + "/api/garantias/reporte-salidas?mes=" + mesDelMov, { headers: H(ca) }));
  const filaSalida = (repSalidas.salidas || []).find((s) => s.socio === socio1 && s.tipo === "Garantía A entregada");
  ok("la salida aparece con folio, centro y monto correctos",
    filaSalida && filaSalida.monto === 40 && filaSalida.centro === centro1, JSON.stringify(filaSalida));
  const rollup = (repSalidas.rollupPorCentro || []).find((x) => x.centro === centro1);
  ok("el rollup por centro incluye ese centro con al menos $40", rollup && rollup.total >= 40, JSON.stringify(rollup));

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
