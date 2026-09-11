// PANTALLA MÍNIMA DE GARANTÍAS — MVP (10-sep-2026, CU-006). Los dos endpoints
// de solo lectura /api/garantias y /api/garantias/ficha, construidos para que
// Dirección vea en la aplicación lo que el motor de Garantía Líquida ya
// calcula (resumen + estado de cuenta por clienta), sin inventar nada de lo
// que sigue sin definirse (esos huecos se listan como "pendientes" en la
// misma respuesta). Mismo patrón que garantia_liquida.js: corre contra el
// servidor local (3899) con DATA_DIR desechable.
//
//   D=/tmp/fooax-prueba-ga; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantias_pantalla.js
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
  const desembolso = "2026-09-01"; // con margen sobre el corte real de la plantilla
  const fechaMov = "2026-09-02";

  console.log("\n— 1. Sin ninguna clienta de prueba con garantía, /api/garantias igual responde (no truena) —");
  const r0 = await j(await fetch(U + "/api/garantias", { headers: H(ca) }));
  ok("trae pasivoTotal numérico", typeof r0.pasivoTotal === "number", JSON.stringify(r0).slice(0, 150));
  ok("trae la lista de pendientes (no se inventa lo que falta)", Array.isArray(r0.pendientes) && r0.pendientes.length > 0);

  console.log("\n— 2. Un alta nueva con garantía aparece en el resumen —");
  const socio1 = "7" + RUN.padStart(10, "0");
  const producto1 = "Prueba GA Resumen " + RUN;
  const r1 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio1, nombre: "Prueba GA " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: producto1, saldo: 5800, cuota: 725, plazo: 8, importe: 5000,
      desembolso, diaPago: "MARTES",
    }),
  }));
  ok("el alta responde ok", r1.ok === true, JSON.stringify(r1).slice(0, 200));

  const r2 = await j(await fetch(U + "/api/garantias", { headers: H(ca) }));
  const encontrada = (r2.socias || []).find((s) => String(s.id) === socio1);
  ok("la nueva clienta aparece en el resumen con su garantía (10% de 5000 = 500)",
    encontrada && encontrada.garantia === 500, JSON.stringify(encontrada));
  ok("el pasivo total del resumen 2 es mayor o igual al del resumen 1 (sumó los $500 nuevos)",
    r2.pasivoTotal >= r0.pasivoTotal + 500 - 0.01, JSON.stringify({ antes: r0.pasivoTotal, despues: r2.pasivoTotal }));
  ok("el centro C-0 aparece desglosado en porCentro",
    (r2.porCentro || []).some((x) => x.centro === "C-0"));

  console.log("\n— 3. La ficha de esa clienta trae su historial con saldo corrido —");
  const rf1 = await j(await fetch(U + "/api/garantias/ficha?id=" + socio1, { headers: H(ca) }));
  ok("saldoActual coincide con el resumen ($500)", rf1.saldoActual === 500, JSON.stringify(rf1.saldoActual));
  ok("el historial trae exactamente 1 movimiento (la recepción automática)",
    Array.isArray(rf1.historial) && rf1.historial.length === 1, JSON.stringify(rf1.historial));
  ok("ese movimiento es una entrada con saldoDespues = 500",
    rf1.historial[0] && rf1.historial[0].entrada === true && rf1.historial[0].saldoDespues === 500,
    JSON.stringify(rf1.historial[0]));
  ok("la ficha también trae su lista de pendientes (exportar PDF/Excel, ajuste manual)",
    Array.isArray(rf1.pendientes) && rf1.pendientes.length > 0);

  console.log("\n— 4. Después de una devolución parcial, el historial trae 2 movimientos con saldo corrido correcto —");
  const rDev = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 200, metodo: "efectivo",
      fecha: fechaMov, socio: socio1, producto: producto1,
    }),
  }));
  ok("la devolución parcial de $200 entra", rDev.ok === true, JSON.stringify(rDev).slice(0, 200));

  const rf2 = await j(await fetch(U + "/api/garantias/ficha?id=" + socio1, { headers: H(ca) }));
  ok("el historial ya trae 2 movimientos, en orden cronológico",
    Array.isArray(rf2.historial) && rf2.historial.length === 2, JSON.stringify(rf2.historial));
  ok("el segundo movimiento es salida y deja el saldo corrido en 300",
    rf2.historial[1] && rf2.historial[1].entrada === false && rf2.historial[1].saldoDespues === 300,
    JSON.stringify(rf2.historial[1]));
  ok("saldoActual de la ficha coincide con el saldo corrido del último movimiento (300)",
    rf2.saldoActual === 300, JSON.stringify(rf2.saldoActual));

  console.log("\n— 5. Ficha de un socio inexistente da error claro, no 500 ni lista vacía silenciosa —");
  const rf3 = await fetch(U + "/api/garantias/ficha?id=999999999999999", { headers: H(ca) });
  const rf3j = await j(rf3);
  ok("responde 400 con mensaje explicando que no la encuentra", rf3.status === 400 && !!rf3j.error, JSON.stringify(rf3j));

  console.log("\n— 6. Un rol sin permiso (ejecutivo) no puede ver estos endpoints —");
  const ck = await login("karina", "karina2026");
  const rEj = await fetch(U + "/api/garantias", { headers: H(ck) });
  ok("un ejecutivo recibe 403/401, no ve el pasivo total de todas las socias", rEj.status === 403 || rEj.status === 401, String(rEj.status));

  console.log(`\n${PASS} pasaron, ${FAIL} fallaron`);
  process.exit(FAIL ? 1 : 0);
})();
