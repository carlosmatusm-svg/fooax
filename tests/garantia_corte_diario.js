// CORTE DIARIO DE GARANTÍAS, por grupo (centro) y tipo de crédito (producto)
// — 21-sep-2026, audio de Karina/Dirección: "el corte diario de garantías
// tiene que ser por grupo por tipo de crédito", reforzando que "es muy
// importante que haya un corte diario". Ella misma no sabía si esto se
// complementa con el arqueo diario que ya existe — SE VALIDÓ TÉCNICAMENTE
// que no conviene mezclarlo (ver el comentario largo en
// dominios/garantia_liquida.js::corteDiarioGarantias): el arqueo agrupa por
// EJECUTIVA desde snapshots, este corte agrupa por CENTRO y PRODUCTO desde
// el padrón — unidades distintas. Por eso esta prueba también confirma que
// /api/arqueo sigue intacto (ver punto 4).
//
// Mismo patrón que el resto de pruebas del módulo: servidor local con
// DATA_DIR desechable.
//
//   D=/tmp/fooax-prueba-corte; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantia_corte_diario.js
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
  const fechaCorte = "2026-09-03";
  const centroA = "C-0";
  const centroB = "ADNACHIEL"; // centro real ya existente en el padrón de prueba (C-1 no es un centro válido)
  const productoBasico = "Básico Corte " + RUN;
  const productoAdicional = "Adicionales Corte " + RUN;

  console.log("\n— 0. Dos clientas de prueba en centros y productos distintos —");
  const socioA = "8" + RUN.padStart(10, "0");
  const socioB = "9" + RUN.padStart(10, "0");
  const raA = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioA, nombre: "Prueba Corte A " + RUN, centro: centroA, ejecutivo: "Karina",
      producto: productoBasico, saldo: 5800, cuota: 725, plazo: 8, importe: 5000,
      desembolso, diaPago: "MARTES",
    }),
  }));
  ok("el alta de la clienta A responde ok", raA.ok === true, JSON.stringify(raA).slice(0, 200));
  const raB = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioB, nombre: "Prueba Corte B " + RUN, centro: centroB, ejecutivo: "Karina",
      producto: productoAdicional, saldo: 5800, cuota: 725, plazo: 8, importe: 5000,
      desembolso, diaPago: "MARTES",
    }),
  }));
  ok("el alta de la clienta B responde ok", raB.ok === true, JSON.stringify(raB).slice(0, 200));

  console.log("\n— 1. Movimientos de Garantía Líquida y Garantía A el mismo día, en cada centro/producto —");
  const movA = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A", concepto: "Garantía A", monto: 150, metodo: "efectivo",
      socio: socioA, producto: productoBasico, fecha: fechaCorte,
    }),
  }));
  ok("la aportación de la clienta A se registra", movA.ok === true, JSON.stringify(movA).slice(0, 200));
  const movB = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A", concepto: "Garantía A", monto: 90, metodo: "efectivo",
      socio: socioB, producto: productoAdicional, fecha: fechaCorte,
    }),
  }));
  ok("la aportación de la clienta B se registra", movB.ok === true, JSON.stringify(movB).slice(0, 200));
  const salidaA = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A entregada", concepto: "Garantía A entregada", monto: 50, metodo: "efectivo",
      socio: socioA, producto: productoBasico, fecha: fechaCorte,
    }),
  }));
  ok("la entrega de la clienta A se registra", salidaA.ok === true, JSON.stringify(salidaA).slice(0, 200));

  console.log("\n— 2. El corte diario (GET /api/garantias/corte-diario) desglosa por centro y por producto —");
  const corte = await j(await fetch(U + "/api/garantias/corte-diario?fecha=" + fechaCorte, { headers: H(ca) }));
  ok("trae la fecha pedida", corte.fecha === fechaCorte, JSON.stringify(corte.fecha));
  ok("totalEntradas incluye los $150 + $90 de las dos aportaciones", corte.totalEntradas >= 240, JSON.stringify(corte.totalEntradas));
  ok("totalSalidas incluye los $50 de la entrega", corte.totalSalidas >= 50, JSON.stringify(corte.totalSalidas));

  const filaA = (corte.porGrupoYTipoCredito || []).find((f) => f.centro === centroA && f.producto === productoBasico);
  ok("la fila de centro A + producto Básico trae $150 de entradas y $50 de salidas",
    filaA && filaA.entradas === 150 && filaA.salidas === 50, JSON.stringify(filaA));
  const filaB = (corte.porGrupoYTipoCredito || []).find((f) => f.centro === centroB && f.producto === productoAdicional);
  ok("la fila de centro B + producto Adicionales trae $90 de entradas",
    filaB && filaB.entradas === 90, JSON.stringify(filaB));

  const porCentroA = (corte.porCentro || []).find((c) => c.centro === centroA);
  ok("el rollup por centro (sin distinguir producto) también existe para el centro A",
    porCentroA && porCentroA.entradas === 150 && porCentroA.salidas === 50, JSON.stringify(porCentroA));
  const porProductoBasico = (corte.porTipoCredito || []).find((p) => p.producto === productoBasico);
  ok("el rollup por tipo de crédito también existe para el producto Básico",
    porProductoBasico && porProductoBasico.entradas === 150, JSON.stringify(porProductoBasico));

  ok("trae el detalle de movimientos", Array.isArray(corte.movimientos) && corte.movimientos.length >= 3, JSON.stringify(corte.movimientos && corte.movimientos.length));
  ok("explica por qué es un reporte aparte del arqueo (nota de validación técnica)",
    typeof corte.notaArqueo === "string" && /arqueo/i.test(corte.notaArqueo), corte.notaArqueo);

  console.log("\n— 3. Un día sin movimientos regresa el corte en cero, no error —");
  const corteVacio = await j(await fetch(U + "/api/garantias/corte-diario?fecha=2026-01-01", { headers: H(ca) }));
  ok("totalEntradas es 0", corteVacio.totalEntradas === 0, JSON.stringify(corteVacio.totalEntradas));
  ok("totalSalidas es 0", corteVacio.totalSalidas === 0, JSON.stringify(corteVacio.totalSalidas));
  ok("porGrupoYTipoCredito es un arreglo vacío", Array.isArray(corteVacio.porGrupoYTipoCredito) && corteVacio.porGrupoYTipoCredito.length === 0);

  console.log("\n— 4. El arqueo diario de caja (/api/arqueo) sigue intacto — el corte es APARTE, no lo tocó —");
  const arqueo = await j(await fetch(U + "/api/arqueo?fecha=" + fechaCorte, { headers: H(ca) }));
  ok("el arqueo responde normal, con su campo porEjec de siempre (agrupado por ejecutiva)",
    "porEjec" in arqueo && arqueo.fecha === fechaCorte, JSON.stringify(Object.keys(arqueo)).slice(0, 200));

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
