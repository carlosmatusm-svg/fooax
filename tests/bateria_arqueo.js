// BATERÍA DE PRUEBAS DEL ARQUEO — problemas comunes de campo, de punta a punta.
// Corre contra el servidor local (3899) con la burbuja de prueba.
// OJO: requiere DATOS LIMPIOS (no es re-ejecutable sobre un día ya cerrado —
// la fusión post-cierre sumaría las corridas). Antes de correr:
//   printf '{}' > data/snapshots.json; printf '[]' > data/movimientos.json
//   printf '[]' > data/padron_cambios.json
//   rm -f data/snapshots_hist.jsonl && reiniciar el servidor
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
  ok("el DEPÓSITO Oxxo se ve por separado (subconjunto de transferencias)",
     a.deposito === 1500, "deposito " + a.deposito);

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

  console.log("\n— 5c. EL BUG DEL MARTES: un sync VACÍO no anula los movimientos —");
  // La app abrió limpia (o el blindaje la rechaza) y manda movs:[]. NADIE borró
  // nada: los movimientos del día deben SEGUIR contando. Antes esto anulaba todo.
  await j(await sync({ reg: {}, regI: {}, movs: [] }));   // rechazado por blindaje
  a = await arqueo();
  ok("sync vacío rechazado NO anula: 'a entregar' se mantiene en 1700", a.efectivoAEntregar === 1700, "aEntregar " + a.efectivoAEntregar);
  let lm5c = await j(await fetch(U + "/api/movimientos", { headers: H(cd) }));
  const vivos5c = lm5c.lista.filter((m) => !m.anulado).length;
  ok("los movimientos siguen VIVOS tras el sync vacío (nadie los borró): 2 vivos",
     vivos5c === 2, "vivos " + vivos5c);
  // captura con cobranza pero SIN movimientos (movs:[]) tampoco anula
  await sync({ reg: { "C-99": { "s1|P": { pago: 1000, forma: "E" } } }, regI: {}, movs: [], arqueo: { "1000": 1, "500": 1, "20": 5 } });
  a = await arqueo();
  ok("captura con cobranza y movs:[] tampoco anula (a entregar 1700)", a.efectivoAEntregar === 1700, "aEntregar " + a.efectivoAEntregar);

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

  console.log("\n— 8. FECHA CORREGIDA: el día equivocado NO se cuenta doble —");
  const semana = async () => j(await fetch(U + "/api/semana", { headers: H(cd) }));
  const AYER = (() => { const d = new Date(HOY + "T12:00"); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10); })();
  const syncF = (fecha, snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha, snapshot: snap, ts: Date.now() }) });
  const s0 = (await semana()).totalSemana;
  // el teléfono capturó $5,000 con la fecha de AYER (pegado en el día viejo)
  await syncF(AYER, { reg: { "C-99": { "sx|P": { pago: 5000, forma: "E" } } }, regI: {}, movs: [] });
  // corrige la fecha: lo mismo se re-sincroniza HOY (ya está en la captura de hoy previa)…
  let sm = (await semana()).totalSemana;
  ok("mientras no se corrige, la semana trae el día duplicado (+5000)", Math.abs(sm - (s0 + 5000)) < 0.01, sm + " vs " + (s0 + 5000));
  // …y la app avisa al servidor que AYER estaba mal etiquetado
  let rr = await j(await fetch(U + "/api/reetiquetado", { method: "POST", headers: H(ce), body: JSON.stringify({ de: AYER }) }));
  sm = (await semana()).totalSemana;
  ok("tras corregir la fecha, el día equivocado se retira (semana vuelve a cuadrar)", rr.retirado === true && Math.abs(sm - s0) < 0.01, "retirado " + rr.retirado + " · semana " + sm + " vs " + s0);
  rr = await j(await fetch(U + "/api/reetiquetado", { method: "POST", headers: H(ce), body: JSON.stringify({ de: HOY }) }));
  ok("blindaje: no se puede retirar la captura de HOY", !!rr.error, JSON.stringify(rr).slice(0, 60));

  console.log("\n— 9. CIERRE DEL DÍA: queda registrado quién usó el botón —");
  let cc = await j(await fetch(U + "/api/cierre", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: HOY, confirmado: true }) }));
  const cons = await consolidado();
  ok("el cierre se marca (con palomita de confirmación) y el tablero lo ve",
     cc.marcado === true && cc.confirmado === true && !!cons.ejecutivos.prueba.cierre,
     "marcado " + cc.marcado + " · confirmado " + cc.confirmado + " · cierre " + cons.ejecutivos.prueba.cierre);

  console.log("\n— 10. CAPTURA DESPUÉS DEL CIERRE: se SUMA, no reemplaza —");
  // CONTRATO de sesión: tras el cierre la app arranca limpia y cada sync manda
  // el estado COMPLETO de la sesión (acumulado). La batería imita eso.
  const antes10 = (await consolidado()).ejecutivos.prueba;
  const ses1 = { "tardio|P": { pago: 111, forma: "E" } };
  await sync({ reg: { "C-99": Object.assign({}, ses1) }, regI: {}, movs: [] });
  const desp10 = (await consolidado()).ejecutivos.prueba;
  ok("el pago tardío se SUMA al día cerrado (antes borraba lo anterior)",
     Math.abs(desp10.efectivo - (antes10.efectivo + 111)) < 0.01,
     antes10.efectivo + " → " + desp10.efectivo);
  const lm10 = await j(await fetch(U + "/api/movimientos", { headers: H(cd) }));
  ok("los movimientos del día NO se anulan por la captura tardía",
     lm10.lista.some((m) => !m.anulado && /Comisión|Liquidación/.test(m.concepto)),
     "vivos: " + lm10.lista.filter((m) => !m.anulado).length);
  // 2º y 3º pago tardío (sesión acumulada): el cierre sobrevive a los reemplazos
  ses1["tardio2|P"] = { pago: 40, forma: "E" };
  await sync({ reg: { "C-99": Object.assign({}, ses1) }, regI: {}, movs: [] });
  ses1["tardio3|P"] = { pago: 60, forma: "E" };
  await sync({ reg: { "C-99": Object.assign({}, ses1) }, regI: {}, movs: [] });
  const desp10b = (await consolidado()).ejecutivos.prueba;
  ok("2º y 3º tardío también SUMAN (el cierre sobrevive a los reemplazos)",
     Math.abs(desp10b.efectivo - (desp10.efectivo + 100)) < 0.01,
     desp10.efectivo + " → " + desp10b.efectivo);
  ok("el 'cerró ✓' sigue visible después de los tardíos", !!desp10b.cierre, "cierre " + desp10b.cierre);
  // re-sincronizar la MISMA sesión no duplica nada (fusión idempotente)
  await sync({ reg: { "C-99": Object.assign({}, ses1) }, regI: {}, movs: [] });
  const desp10c = (await consolidado()).ejecutivos.prueba;
  ok("re-sincronizar la misma sesión NO duplica (fusión idempotente)",
     Math.abs(desp10c.efectivo - desp10b.efectivo) < 0.01,
     desp10b.efectivo + " → " + desp10c.efectivo);

  console.log("\n— 10b. CONTEO DE BILLETES tras cerrar: NO se duplica —");
  ses1["bills|P"] = { pago: 1000, forma: "E" };
  await sync({ reg: { "C-99": Object.assign({}, ses1) }, regI: {}, movs: [], arqueo: { "500": 2 } });
  let ar1 = await arqueo();
  await fetch(U + "/api/cierre", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: HOY, confirmado: true }) });
  const cnt1 = ar1.denomTotal["500"];
  // SEGUNDA sesión del día (la app vuelve a arrancar limpia)
  const ses2 = { "bills2|P": { pago: 100, forma: "E" } };
  await sync({ reg: { "C-99": Object.assign({}, ses2) }, regI: {}, movs: [], arqueo: { "500": 2 } });
  let ar2 = await arqueo();
  ok("el conteo de billetes NO se duplica al re-sincronizar tras cerrar (bug $848)",
     ar2.denomTotal["500"] === cnt1, "antes " + cnt1 + " → después " + ar2.denomTotal["500"]);
  ses2["bills3|P"] = { pago: 100, forma: "E" };
  await sync({ reg: { "C-99": Object.assign({}, ses2) }, regI: {}, movs: [], arqueo: { "500": 3 } });
  let ar3 = await arqueo();
  ok("un re-conteo más alto SÍ actualiza (gana el último)", ar3.denomTotal["500"] === cnt1 + 1, "billetes de $500: " + ar3.denomTotal["500"]);
  const resu = await j(await fetch(U + "/api/resumen", { headers: H(cd) }));
  const falsa = (resu.items || []).some((it) => /bajó de/.test(it.txt || ""));
  ok("sin falsa alarma de reducción tras capturas post-cierre", !falsa,
     JSON.stringify((resu.items || []).map((i) => i.txt).filter((t) => /bajó/.test(t))).slice(0, 120));

  console.log("\n— 10c. LOS HERMANOS DEL BUG $848: doble pago y folios reiniciados —");
  // La MISMA clienta (bills|P, pagó E $1,000 antes del cierre) vuelve a pagar
  // T $200 en la sesión nueva: debe SUMAR (antes el pago de la mañana se perdía)
  const c0 = (await consolidado()).ejecutivos.prueba;
  ses2["bills|P"] = { pago: 200, forma: "T" };
  await sync({ reg: { "C-99": Object.assign({}, ses2) }, regI: {}, movs: [], arqueo: { "500": 3 } });
  let cA = (await consolidado()).ejecutivos.prueba;
  ok("doble pago cruzando el cierre: se SUMA, no reemplaza (mañana E$1,000 + tarde T$200)",
     Math.abs(cA.pago - (c0.pago + 200)) < 0.01 && Math.abs(cA.transferencia - (c0.transferencia + 200)) < 0.01 && Math.abs(cA.efectivo - c0.efectivo) < 0.01,
     "pago " + c0.pago + "→" + cA.pago + " · tr " + c0.transferencia + "→" + cA.transferencia + " · efe " + c0.efectivo + "→" + cA.efectivo);
  await sync({ reg: { "C-99": Object.assign({}, ses2) }, regI: {}, movs: [], arqueo: { "500": 3 } });
  let cB = (await consolidado()).ejecutivos.prueba;
  ok("y re-sincronizar ese doble pago NO lo duplica", Math.abs(cB.pago - cA.pago) < 0.01, cA.pago + " → " + cB.pago);
  // FOLIO REINICIADO: la sesión nueva vuelve a empezar en -01; un folio repetido
  // con contenido DISTINTO es un movimiento NUEVO (antes se descartaba en silencio)
  const lmA = await j(await fetch(U + "/api/movimientos", { headers: H(cd) }));
  const movsSes = [{ folio: "C1", concepto: "COMISION", monto: 300, via: "E" }];   // C1 ya existió en la mañana con $500
  await sync({ reg: { "C-99": Object.assign({}, ses2) }, regI: {}, movs: movsSes, arqueo: { "500": 3 } });
  const lmB = await j(await fetch(U + "/api/movimientos", { headers: H(cd) }));
  ok("folio reiniciado con contenido distinto = movimiento NUEVO (ya no se pierde)",
     Math.abs(lmB.entradas - (lmA.entradas + 300)) < 0.01, "entradas " + lmA.entradas + " → " + lmB.entradas);
  await sync({ reg: { "C-99": Object.assign({}, ses2) }, regI: {}, movs: movsSes, arqueo: { "500": 3 } });
  const lmC = await j(await fetch(U + "/api/movimientos", { headers: H(cd) }));
  ok("y re-sincronizarlo NO lo duplica (idempotente por contenido)",
     Math.abs(lmC.entradas - lmB.entradas) < 0.01, "entradas " + lmB.entradas + " → " + lmC.entradas);

  console.log("\n— 11. ALTAS: centros reales, sin fantasmas, y el padrón protegido —");
  const ca = await login("anel", "anel2026");   // dirección REAL (solo local)
  let dc = await j(await fetch(U + "/api/centros", { headers: H(ca) }));
  ok("la lista de centros reales carga", (dc.centros || []).length > 10, "centros " + (dc.centros || []).length);
  let rc = await j(await fetch(U + "/api/centros", { method: "POST", headers: H(ca), body: JSON.stringify({ numero: "99", nombre: "CENTRO BATERIA", ejecutivo: "Neri", dia: "Lunes" }) }));
  ok("se registra un centro NUEVO", rc.ok === true && rc.centro === "CENTRO BATERIA", JSON.stringify(rc).slice(0, 80));
  rc = await j(await fetch(U + "/api/centros", { method: "POST", headers: H(ca), body: JSON.stringify({ numero: "98", nombre: "centro bateria", ejecutivo: "Neri" }) }));
  ok("centro duplicado (aunque cambie mayúsculas) se rechaza", !!rc.error, JSON.stringify(rc).slice(0, 60));
  rc = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000001", nombre: "CLIENTA BATERIA", producto: "Grupal-Basico", centro: "CENTRO QUE NO EXISTE", ejecutivo: "Neri", saldo: 100, cuota: 50 }) }));
  ok("alta con centro inexistente se rechaza (adiós centros fantasma)", !!rc.error, JSON.stringify(rc).slice(0, 70));
  rc = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000001", nombre: "CLIENTA BATERIA", producto: "Grupal-Basico", centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: 100, cuota: 50 }) }));
  ok("alta con el centro nuevo funciona", rc.ok === true, JSON.stringify(rc).slice(0, 60));
  rc = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000001", nombre: "CLIENTA BATERIA", producto: "Grupal - Basico", centro: "CENTRO BATERIA", ejecutivo: "Neri" }) }));
  ok("alta DUPLICADA (mismo socio+producto, aunque cambie el guion) se rechaza", !!rc.error, JSON.stringify(rc).slice(0, 60));
  rc = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cd), body: JSON.stringify({ id: "70000000002", nombre: "X", producto: "P", centro: "CENTRO BATERIA", ejecutivo: "Prueba" }) }));
  ok("la cuenta de PRUEBA no puede tocar el padrón real (alta)", !!rc.error && /PRUEBA/.test(rc.error), JSON.stringify(rc).slice(0, 70));
  rc = await j(await fetch(U + "/api/centros", { method: "POST", headers: H(cd), body: JSON.stringify({ numero: "97", nombre: "CENTRO PIRATA", ejecutivo: "Prueba" }) }));
  ok("ni registrar centros", !!rc.error, JSON.stringify(rc).slice(0, 60));
  rc = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "ABC 123", nombre: "X", producto: "P", centro: "CENTRO BATERIA", ejecutivo: "Neri" }) }));
  ok("socio con letras se rechaza (basura que nunca haría match)", !!rc.error && /dígitos/.test(rc.error), JSON.stringify(rc).slice(0, 70));

  console.log("\n— 11b. REESTRUCTURA: centro nuevo + clienta de reestructura —");
  let rr2 = await j(await fetch(U + "/api/centros", { method: "POST", headers: H(ca), body: JSON.stringify({ numero: "95", nombre: "REESTRUCTURA TEST", ejecutivo: "Neri", dia: "Lunes" }) }));
  ok("se crea el centro de reestructura", rr2.ok === true, JSON.stringify(rr2).slice(0, 60));
  rr2 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "11113001966", nombre: "ODEETTE", producto: "Reestructura", centro: "REESTRUCTURA TEST", ejecutivo: "Neri", saldo: 5000, cuota: 300 }) }));
  ok("reestructura de clienta que YA existe: mensaje dice DÓNDE está y cómo seguir",
     !!rr2.error && /YA tiene un crédito/.test(rr2.error) && /otro nombre de producto/.test(rr2.error), (rr2.error || "").slice(0, 90));
  rr2 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "11113001966", nombre: "ODEETTE", producto: "Reestructura 2", centro: "REESTRUCTURA TEST", ejecutivo: "Neri", saldo: 5000, cuota: 300 }) }));
  ok("con otro nombre de producto SÍ entra (reestructura aparte)", rr2.ok === true, JSON.stringify(rr2).slice(0, 60));
  rr2 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "1111-3077-000", nombre: "COPIA CON GUIONES", producto: "Reestructura", centro: "REESTRUCTURA TEST", ejecutivo: "Neri" }) }));
  ok("socio copiado con guiones/espacios se limpia y SÍ entra", rr2.ok === true && rr2.clienta.id === "11113077000", JSON.stringify(rr2).slice(0, 80));

  console.log("\n— 12. CRÉDITOS Y SALDOS · solo Anel y Monse —");
  const cm = await login("monse", "monse2026");           // admin real (local)
  const cal = await login("alejandra", "alejandra2026");  // admin, pero NO es Anel/Monse
  let cr = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000050", nombre: "CARTERA TEST", producto: "Credito Prueba", centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: 1000, cuota: 100 }) }));
  ok("alta de clienta con saldo para la cartera", cr.ok === true, JSON.stringify(cr).slice(0, 60));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cal), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 300 }) }));
  ok("otro admin (Alejandra) NO puede tocar créditos", !!cr.error && /Anel y Monse/.test(cr.error), (cr.error || "").slice(0, 70));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cd), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 300 }) }));
  ok("la cuenta de prueba tampoco", !!cr.error, (cr.error || "").slice(0, 60));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cm), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 300 }) }));
  ok("Monse marca VENCIDA + mora", cr.ok === true && cr.clienta.estatus === "VENCIDA" && cr.clienta.mora === 300, JSON.stringify(cr.clienta || {}).slice(0, 90));
  let lv = await j(await fetch(U + "/api/creditos?estado=vencidas", { headers: H(ca) }));
  ok("la vencida aparece en la lista de vencidas", (lv.resultados || []).some(c => String(c.id) === "70000000050"), "vencidas " + (lv.resultados || []).length);
  cr = await j(await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", saldo: 400, motivo: "corrección de captura" }) }));
  ok("Anel ajusta el saldo (con motivo)", cr.ok === true && cr.clienta.saldo === 400, JSON.stringify(cr.clienta || {}).slice(0, 80));
  cr = await j(await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", saldo: 400 }) }));
  ok("ajuste SIN motivo se rechaza (queda bitácora)", !!cr.error && /motivo/.test(cr.error), (cr.error || "").slice(0, 60));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cm), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 0 }) }));
  ok("mora 0 le quita lo VENCIDA (vuelve a VIGENTE)", cr.ok === true && cr.clienta.estatus === "VIGENTE" && (cr.clienta.mora || 0) === 0, JSON.stringify(cr.clienta || {}).slice(0, 80));
  cr = await j(await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba 2", saldo: 1500, cuota: 150 }) }));
  ok("re-dar crédito crea uno NUEVO, mismo grupo, guardando el anterior", cr.ok === true && cr.clienta.producto === "Credito Prueba 2" && cr.clienta.recredito === true, JSON.stringify(cr.clienta || {}).slice(0, 90));
  cr = await j(await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba 2", saldo: 1500, cuota: 150 }) }));
  ok("re-crédito con producto que choca se rechaza (pide otro nombre)", !!cr.error && /otro nombre/.test(cr.error), (cr.error || "").slice(0, 70));
  let sb = await j(await fetch(U + "/api/clientes?q=" + encodeURIComponent("CARTERA TEST"), { headers: H(ca) }));
  ok("conviven el crédito viejo y el nuevo (historial intacto)", (sb.resultados || []).filter(c => String(c.id) === "70000000050").length >= 2, "créditos " + (sb.resultados || []).filter(c => String(c.id) === "70000000050").length);

  console.log("\n— 13. LIQUIDACIÓN baja el saldo en el TABLERO (no solo en el Excel) —");
  await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000060", nombre: "LIQ TEST", producto: "Grupal-Basico", centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: 1000, cuota: 200 }) }));
  const cn = await login("neri", "neri2026");   // ejecutiva REAL (local)
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: HOY, snapshot: { reg: {}, regI: {}, movs: [{ folio: "L1", concepto: "LIQUIDACION", monto: 600, via: "E", socio: "70000000060", clienta: "LIQ TEST" }], arqueo: {} }, ts: Date.now() }) });
  let sl = await j(await fetch(U + "/api/clientes?q=" + encodeURIComponent("LIQ TEST"), { headers: H(ca) }));
  const liqCl = (sl.resultados || []).find(c => String(c.id) === "70000000060") || {};
  ok("la liquidación ($600) baja el saldo en la BÚSQUEDA del tablero (1000→400)", liqCl.saldoActual === 400 && liqCl.liquidado === 600, "saldoActual " + liqCl.saldoActual + " · liquidado " + liqCl.liquidado);
  let cl2 = await j(await fetch(U + "/api/creditos?q=" + encodeURIComponent("LIQ TEST"), { headers: H(cm) }));
  const liqCl2 = (cl2.resultados || []).find(c => String(c.id) === "70000000060") || {};
  ok("y también en el PANEL de créditos (mismo saldo)", liqCl2.saldoActual === 400, "saldoActual " + liqCl2.saldoActual);

  console.log("\n— 14. RE-ENTRAR con la MISMA captura NO duplica (bug 'solo registré una vez') —");
  const D = "2026-06-10";
  const syncD = (snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D, snapshot: snap, ts: Date.now() }) });
  const consD = async () => { const c = await j(await fetch(U + "/api/consolidado?fecha=" + D, { headers: H(cd) })); return (c.ejecutivos && c.ejecutivos.prueba) || {}; };
  const capD = { reg: { "C-77": { "z1|P": { pago: 500, forma: "E" }, "z2|P": { pago: 300, forma: "T" } } }, regI: {}, movs: [], arqueo: { "500": 1, "200": 1, "100": 1 } };
  await syncD(capD);
  const antesD = await consD();
  await fetch(U + "/api/cierre", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D, confirmado: true }) });
  await syncD(JSON.parse(JSON.stringify(capD)));   // re-entra: misma captura
  await syncD(JSON.parse(JSON.stringify(capD)));   // y otra vez
  const despD = await consD();
  ok("re-entrar y re-mandar la MISMA captura NO duplica el día",
     Math.abs(despD.efectivo - antesD.efectivo) < 0.01 && Math.abs(despD.transferencia - antesD.transferencia) < 0.01,
     "efe " + antesD.efectivo + "→" + despD.efectivo + " · tr " + antesD.transferencia + "→" + despD.transferencia);
  const capMas = JSON.parse(JSON.stringify(capD)); capMas.reg["C-77"]["z3|P"] = { pago: 200, forma: "E" };
  await syncD(capMas);
  const masD = await consD();
  ok("un pago NUEVO distinto sí se suma tras cerrar", Math.abs(masD.efectivo - (antesD.efectivo + 200)) < 0.01, antesD.efectivo + "→" + masD.efectivo);

  console.log("\n— 15. RESTAURAR la versión DEL CIERRE (arregla el descuadre por re-captura) —");
  const capDist = JSON.parse(JSON.stringify(capD)); capDist.reg["C-77"]["z1|P"] = { pago: 900, forma: "E" };
  await syncD(capDist);   // monto distinto → se suma → descuadre a propósito
  const sucio = await consD();
  ok("un monto DISTINTO tras cerrar se suma (descuadre a propósito)", sucio.efectivo > masD.efectivo, "efe " + sucio.efectivo);
  const rv = await j(await fetch(U + "/api/recuperar?fecha=" + D, { headers: H(cd) }));
  const alc = rv.ejecutivos && rv.ejecutivos.prueba && rv.ejecutivos.prueba.alCerrar;
  ok("el restaurador OFRECE la versión al cerrar con la cifra correcta",
     !!alc && alc.efectivo === antesD.efectivo && alc.transferencia === antesD.transferencia,
     alc ? ("efe " + alc.efectivo + " · tr " + alc.transferencia) : "sin alCerrar");
  const rr3 = await j(await fetch(U + "/api/recuperar", { method: "POST", headers: H(cd), body: JSON.stringify({ fecha: D, ejec: "prueba", archivado: "alCerrar" }) }));
  const rest = await consD();
  ok("restaurar la del cierre deja el día correcto otra vez",
     rr3.ok === true && Math.abs(rest.efectivo - antesD.efectivo) < 0.01 && Math.abs(rest.transferencia - antesD.transferencia) < 0.01,
     "efe " + rest.efectivo + " · tr " + rest.transferencia);

  console.log("\n══════════════════════════════════");
  console.log(FAIL === 0 ? "✅✅ TODO PASÓ: " + PASS + " pruebas" : "❌ FALLARON " + FAIL + " de " + (PASS + FAIL));
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR de la batería:", e.message); process.exit(2); });
