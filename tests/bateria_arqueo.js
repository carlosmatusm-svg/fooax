// BATERÍA DE PRUEBAS DEL ARQUEO — problemas comunes de campo, de punta a punta.
// Corre contra el servidor local (3899) con la burbuja de prueba.
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
  const ce = await login("prueba", "PruebaFOOAX2026");
  const cd = await login("pruebadir", "PruebaFOOAX2026");
  const HOY = (await j(await fetch(U + "/api/me", { headers: H(ce) }))).hoy;
  const sync = (snap, ts) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: HOY, snapshot: snap, ts: ts || Date.now() }) });
  const arqueo = async () => j(await fetch(U + "/api/arqueo", { headers: H(cd) }));
  const consolidado = async () => j(await fetch(U + "/api/consolidado", { headers: H(cd) }));

  console.log("\n— 1. FORMAS DE PAGO (E, T, D, mixtos en todas sus variantes) —");
  // NOEMI (2 créditos reales), GABRIELA (Foxi Plus 2), y socios reales sueltos
  const reg = { "C-99": {
    "s1|Prod A": { pago: 1000, forma: "E" },                                  // efectivo
    "s2|Prod B": { pago: 2000, forma: "T" },                                  // transferencia
    "s3|Prod C": { pago: 1500, forma: "D" },                                  // depósito → banco
    "s4|Prod D": { pago: 900, forma: "M", mixTr: 400 },                       // mixto: solo transf llenada
    "s5|Prod E": { pago: 800, forma: "M", mixEfe: 300 },                      // mixto: solo efe llenada
    "s6|Prod F": { pago: 700, forma: "M", mixEfe: 200, mixTr: 500 },          // mixto completo
    "s7|Prod G": { pago: 600, forma: "M" },                                   // mixto sin llenar
    "s8|Prod H": { pago: 0, garantia: 250, forma: "E" },                      // solo garantía
  } };
  await sync({ reg, regI: {}, movs: [] });
  let a = await arqueo();
  const totalCobrado = 1000 + 2000 + 1500 + 900 + 800 + 700 + 600 + 250;
  ok("efectivo + transferencia = total cobrado (nada se pierde)",
     Math.abs(a.efectivo + a.transferencia - totalCobrado) < 0.01,
     "efe " + a.efectivo + " + tr " + a.transferencia + " ≠ " + totalCobrado);
  // esperado: efe = 1000 + (900-400) + 300(el resto de s5 es 500 tr? no: mixEfe=300, resto a transf NO — regla: transf es lo capturado, efe el resto)
  // regla del RESTO: me = (mixEfe!=null && mixEfe+mixTr==tot) ? mixEfe : tot-mixTr
  // s4: mt=400 → me=500 · s5: mt=0, mixEfe=300, 300+0≠800 → me=800 · s6: 200+500≠700→ me=700-500=200 · s7: me=600
  const efeEsp = 1000 + 500 + 800 + 200 + 600 + 250;
  const trEsp = 2000 + 1500 + 400 + 0 + 500 + 0;
  ok("mixto solo-transf: el efectivo es el RESTO", Math.abs(a.efectivo - efeEsp) < 0.01, "efe " + a.efectivo + " esperado " + efeEsp);
  ok("depósito va a transferencias, no a efectivo", Math.abs(a.transferencia - trEsp) < 0.01, "tr " + a.transferencia + " esperado " + trEsp);
  ok("garantía sola sí entra al total", a.garantias === 250, "gar " + a.garantias);

  console.log("\n— 2. MORA: clienta con DOS créditos (caso NOEMI real) —");
  // NOEMI 11113163277: Grupal-Basico 2 cuota $1,008 · Grupal-Micro cuota $512 (padrón real)
  await sync({ reg: { "C-99": {
    "11113163277|Grupal-Basico 2": { pago: 1008, forma: "E" },   // básico completo
    "11113163277|Grupal-Micro": { pago: 512, forma: "E" },       // micro completo
  } }, regI: {}, movs: [] });
  a = await arqueo();
  ok("pagó sus DOS cuotas completas → mora $0 (antes daba mora falsa)", a.faltantes === 0, "faltantes " + a.faltantes);
  await sync({ reg: { "C-99": {
    "11113163277|Grupal-Basico 2": { pago: 500, forma: "E" },    // básico parcial (falta 508)
    "11113163277|Grupal-Micro": { pago: 512, forma: "E" },
  } }, regI: {}, movs: [] });
  a = await arqueo();
  ok("pago parcial del básico → mora exacta $508 del crédito correcto", a.faltantes === 508, "faltantes " + a.faltantes);

  console.log("\n— 3. PRODUCTO ESCRITO DISTINTO (guiones/espacios) —");
  await sync({ reg: { "C-99": {
    "11113163277|Grupal - Basico 2": { pago: 500, forma: "E" },  // con guion y espacios
  } }, regI: {}, movs: [] });
  a = await arqueo();
  ok("'Grupal - Basico 2' encuentra la cuota de 'Grupal-Basico 2' → mora $508", a.faltantes === 508, "faltantes " + a.faltantes);

  console.log("\n— 4. OTROS MOVIMIENTOS (entradas, salidas, transferencia) —");
  await sync({ reg: { "C-99": { "s1|P": { pago: 1000, forma: "E" } } }, regI: {}, movs: [
    { folio: "B1", concepto: "COMISION", monto: 100, via: "E" },
    { folio: "B2", concepto: "LIQUIDACION", monto: 200, via: "E" },
    { folio: "B3", concepto: "GASTO", monto: 50, via: "E" },
    { folio: "B4", concepto: "RECUPERACION", monto: 300, via: "T" },   // por transferencia
    { folio: "B5", concepto: "DESEMBOLSO", monto: 400, via: "E" },
  ] });
  a = await arqueo();
  // a entregar = 1000 + 100 + 200 − 50 − 400 = 850 (la recuperación por T no toca el efectivo)
  ok("a entregar = cobranza + entradas − salidas (solo EFECTIVO)", a.efectivoAEntregar === 850, "aEntregar " + a.efectivoAEntregar);

  console.log("\n— 5. CONTEO DE BILLETES vs A ENTREGAR —");
  await sync({ reg: { "C-99": { "s1|P": { pago: 1000, forma: "E" } } }, regI: {}, movs: [
    { folio: "C1", concepto: "COMISION", monto: 500, via: "E" },
  ], arqueo: { "1000": 1, "500": 1, "20": 5 } });   // contado $1,600 (billete+moneda de $20 suman por valor)
  a = await arqueo();
  const contado = Object.entries(a.denomTotal).reduce((s, [d, q]) => s + d * q, 0);
  ok("el conteo llega al servidor (incluye $20 sumados por valor)", contado === 1600, "contado " + contado);
  ok("a entregar $1,500 (la diferencia real de caja sería $100)", a.efectivoAEntregar === 1500, "aEntregar " + a.efectivoAEntregar);

  console.log("\n— 5b. MOVIMIENTO BORRADO EN LA APP (fantasma) —");
  // el envío anterior ya NO trae B1..B5: deben quedar ANULADOS y salir de las sumas
  a = await arqueo();
  ok("los movimientos borrados dejan de contar (adiós fantasmas)", a.efectivoAEntregar === 1500, "aEntregar " + a.efectivoAEntregar);
  let lm = await j(await fetch(U + "/api/movimientos", { headers: H(cd) }));
  ok("el rastro queda: aparecen ANULADOS en la lista de Anel",
     lm.lista.some((m) => m.anulado) && lm.entradas === 500,
     "anulados " + lm.lista.filter((m) => m.anulado).length + " · entradas " + lm.entradas);
  // la ejecutiva lo vuelve a mandar → revive
  await sync({ reg: { "C-99": { "s1|P": { pago: 1000, forma: "E" } } }, regI: {}, movs: [
    { folio: "C1", concepto: "COMISION", monto: 500, via: "E" },
    { folio: "B2", concepto: "LIQUIDACION", monto: 200, via: "E" },
  ], arqueo: { "1000": 1, "500": 1, "20": 5 } });
  a = await arqueo();
  ok("si lo reenvía, revive y vuelve a contar", a.efectivoAEntregar === 1700, "aEntregar " + a.efectivoAEntregar);

  console.log("\n— 6. BLINDAJES —");
  let r = await j(await sync({ reg: {}, regI: {}, movs: [] }));
  ok("captura vacía NO pisa cobranza (rechazada)", r.rechazado === "vacio_sobre_lleno", JSON.stringify(r).slice(0, 80));
  r = await j(await sync({ reg: { "C-99": { "s9|P": { pago: 77, forma: "E" } } }, regI: {}, movs: [] }, 1000));
  a = await arqueo();
  ok("captura con reloj VIEJO no pisa la actual", a.efectivo === 1500 || a.efectivo !== 77, "efectivo " + a.efectivo);

  console.log("\n— 7. CUADRES CRUZADOS (arqueo vs consolidado) —");
  const c = await consolidado();
  a = await arqueo();
  const tc = c.total.pago + c.total.garantias;
  ok("consolidado: efe+tr = pago+garantías", Math.abs(c.total.efectivo + c.total.transferencia - tc) < 0.01,
     c.total.efectivo + "+" + c.total.transferencia + " vs " + tc);
  ok("arqueo y consolidado ven el MISMO efectivo", Math.abs(a.efectivo - c.total.efectivo) < 0.01,
     a.efectivo + " vs " + c.total.efectivo);

  console.log("\n══════════════════════════════════");
  console.log(FAIL === 0 ? "✅✅ TODO PASÓ: " + PASS + " pruebas" : "❌ FALLARON " + FAIL + " de " + (PASS + FAIL));
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR de la batería:", e.message); process.exit(2); });
