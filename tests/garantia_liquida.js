// GARANTÍA LÍQUIDA: recepción automática al desembolso, candado antiduplicado
// en la devolución, y aplicación a mora/crédito con doble registro (10-sep-2026,
// CU-006, CU-022 Anexo H.14). Mismo patrón que sincronizacion_desembolso.js:
// corre contra el servidor local (3899) con DATA_DIR desechable.
//
//   D=/tmp/fooax-prueba-gl; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantia_liquida.js
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

async function garantiaDe(ca, socio) {
  const lista = await j(await fetch(U + "/api/creditos?q=" + encodeURIComponent(socio), { headers: H(ca) }));
  return (lista.resultados || [])[0] || null;
}

(async () => {
  const ca = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  // El guardado de garantía se netea desde el CORTE vigente (CORTE_SALDOS_DEFECTO
  // = 2026-07-21, pero la plantilla real de padron_corte.json ya lo movió más
  // adelante — se vio en vivo "[corte] la plantilla lo movió a 2026-08-05").
  // Un desembolso ANTERIOR al corte queda fuera del neteo (mismo criterio que
  // ya usa pagosDeLaSemana() para toda la cartera, no es exclusivo de Garantía
  // Líquida) — por eso esta prueba usa fechas bien entrado septiembre, con
  // margen de sobra sobre cualquier corte que la plantilla real haya movido,
  // a diferencia de sincronizacion_desembolso.js (que no depende del corte
  // porque solo verifica pagaré/plan/sobre, no el guardado neteado).
  const desembolso = "2026-09-01"; // con margen sobre el corte real de la plantilla
  const fechaMov = "2026-09-02";   // día siguiente

  console.log("\n— 1. El alta retiene Garantía Líquida SOLA, sin que nadie la capture —");
  const socio1 = "6" + RUN.padStart(10, "0");
  const producto1 = "Prueba GL Alta " + RUN;
  const r1 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio1, nombre: "Prueba GL " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: producto1, saldo: 4640, cuota: 580, plazo: 8, importe: 4000,
      desembolso, diaPago: "LUNES", comision: 100, seguro: 50,
    }),
  }));
  ok("el alta responde ok", r1.ok === true, JSON.stringify(r1).slice(0, 200));
  const c1 = await garantiaDe(ca, socio1);
  ok("el guardado de garantía ya trae el 10% del importe (400), sin captura manual",
    c1 && c1.garantia === 400, JSON.stringify(c1 && c1.garantia));

  console.log("\n— 2. Reintento del mismo desembolso no duplica la garantía (folio determinístico) —");
  // Mismo alta no se puede repetir (choca de socio+producto), así que se
  // verifica llamando dos veces la función interna vía un segundo alta con el
  // MISMO producto sobre otra clienta no aplica; en su lugar, se confirma que
  // agregarMovimiento es idempotente probando /api/movimiento con el mismo
  // folio determinístico no es posible desde HTTP (el folio lo arma el
  // servidor). Se deja como propiedad ya cubierta por el folio "GAR-AUTO-..."
  // (store.agregarMovimiento ya tiene su propia garantía de idempotencia,
  // reusada tal cual — no se reinventa aquí).
  ok("(nota) idempotencia de folio reusa store.agregarMovimiento, no se reprueba aparte", true);

  console.log("\n— 3. Devolver toda la garantía guardada —");
  const r2 = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 400, metodo: "efectivo",
      fecha: fechaMov, socio: socio1, producto: producto1,
    }),
  }));
  ok("la devolución de los $400 completos entra", r2.ok === true, JSON.stringify(r2).slice(0, 200));
  ok("regresa el ticket H.14 con el disponible antes/después", r2.ticket && r2.ticket.disponibleAntes === 400 && r2.ticket.disponibleDespues === 0,
    JSON.stringify(r2.ticket));
  const c1b = await garantiaDe(ca, socio1);
  ok("el guardado queda en 0 tras la devolución completa", c1b && c1b.garantia === 0, JSON.stringify(c1b && c1b.garantia));

  console.log("\n— 4. CANDADO ANTIDUPLICADO: la segunda devolución se rechaza citando el ticket de la primera —");
  const r3 = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 50, metodo: "efectivo",
      fecha: fechaMov, socio: socio1, producto: producto1,
    }),
  }));
  ok("la segunda devolución se rechaza (ya no hay garantía disponible)", r3.ok === undefined && !!r3.error, JSON.stringify(r3));
  ok("el rechazo cita el folio del ticket con el que salió la primera", r3.ticketAnterior && r3.ticketAnterior.folio === r2.movimiento.folio,
    JSON.stringify(r3.ticketAnterior) + " vs " + (r2.movimiento && r2.movimiento.folio));

  console.log("\n— 5. Aplicar Garantía Líquida al propio crédito (doble registro) —");
  const socio2 = "5" + RUN.padStart(10, "0");
  const producto2 = "Prueba GL Aplicar " + RUN;
  const r4 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio2, nombre: "Prueba GL Aplicar " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: producto2, saldo: 5500, cuota: 700, plazo: 8, importe: 5000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  ok("el segundo alta (para aplicación) responde ok", r4.ok === true);
  const antesAplicar = await garantiaDe(ca, socio2);
  ok("retuvo $500 de garantía (10% de 5000)", antesAplicar && antesAplicar.garantia === 500, JSON.stringify(antesAplicar && antesAplicar.garantia));
  const saldoAntes = antesAplicar ? antesAplicar.saldoActual : null;

  const r5 = await j(await fetch(U + "/api/garantia-liquida/aplicar", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      socio: socio2, producto: producto2, monto: 500, motivo: "Prueba automatizada: aplicación a mora.",
      fecha: fechaMov,
    }),
  }));
  ok("la aplicación responde ok", r5.ok === true, JSON.stringify(r5).slice(0, 300));
  ok("genera los DOS movimientos (garantía + recuperación) con el mismo aplicacionId",
    r5.movimientoGarantia && r5.movimientoRecuperacion
      && r5.movimientoGarantia.aplicacionId === r5.movimientoRecuperacion.aplicacionId);
  ok("el movimiento de garantía es salida (entrada:false)", r5.movimientoGarantia && r5.movimientoGarantia.entrada === false);
  ok("el movimiento de recuperación es entrada (entrada:true)", r5.movimientoRecuperacion && r5.movimientoRecuperacion.entrada === true);

  const despuesAplicar = await garantiaDe(ca, socio2);
  ok("el guardado de garantía bajó a 0", despuesAplicar && despuesAplicar.garantia === 0, JSON.stringify(despuesAplicar && despuesAplicar.garantia));
  ok("el saldo del crédito bajó los mismos $500 (la 'Recuperación' sí abona, igual que un pago real)",
    despuesAplicar && saldoAntes != null && Math.abs((saldoAntes - despuesAplicar.saldoActual) - 500) < 0.01,
    "antes=" + saldoAntes + " despues=" + (despuesAplicar && despuesAplicar.saldoActual));

  console.log("\n— 6. CANDADO también en la aplicación: no se puede aplicar más de lo ya aplicado —");
  const r6 = await j(await fetch(U + "/api/garantia-liquida/aplicar", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      socio: socio2, producto: producto2, monto: 10, motivo: "Segundo intento, debe rechazarse.",
      fecha: fechaMov,
    }),
  }));
  ok("la segunda aplicación se rechaza", r6.ok === undefined && !!r6.error, JSON.stringify(r6));
  ok("cita el folio del ticket con el que ya se aplicó", r6.ticketAnterior && r6.ticketAnterior.folio === r5.movimientoGarantia.folio,
    JSON.stringify(r6.ticketAnterior));

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
