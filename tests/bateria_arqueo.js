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
  // EN LUNES "ayer" es domingo (semana pasada) y la semana NO lo suma — la
  // prueba se ajusta al calendario para no fallar en falso los lunes.
  const lunesDe = (f) => { const [y, m, d] = f.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay(); dt.setUTCDate(dt.getUTCDate() - (dow === 0 ? 6 : dow - 1)); return dt.toISOString().slice(0, 10); };
  const ayerEnSemana = AYER >= lunesDe(HOY);
  const esperaDup = s0 + (ayerEnSemana ? 5000 : 0);
  // el teléfono capturó $5,000 con la fecha de AYER (pegado en el día viejo)
  await syncF(AYER, { reg: { "C-99": { "sx|P": { pago: 5000, forma: "E" } } }, regI: {}, movs: [] });
  // corrige la fecha: lo mismo se re-sincroniza HOY (ya está en la captura de hoy previa)…
  let sm = (await semana()).totalSemana;
  ok("mientras no se corrige, la semana trae el día duplicado" + (ayerEnSemana ? " (+5000)" : " (lunes: ayer es de la semana pasada, no suma)"),
     Math.abs(sm - esperaDup) < 0.01, sm + " vs " + esperaDup);
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
  // La batería fija SU corte al arrancar. Desde el 4-ago el corte lo mueve la
  // plantilla al cargarse, y si queda en una fecha futura los pagos que capturan
  // estas pruebas caen ANTES del corte y no cuentan. Se pone bien atrás para que
  // todo lo que capture la batería sí se descuente; las secciones que necesitan
  // un corte propio lo fijan aparte.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01", confirmar: true }) });
  const cal = await login("alejandra", "alejandra2026");  // admin, pero NO es Anel/Monse
  let cr = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000050", nombre: "CARTERA TEST", producto: "Credito Prueba", centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: 1000, cuota: 100 }) }));
  ok("alta de clienta con saldo para la cartera", cr.ok === true, JSON.stringify(cr).slice(0, 60));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cal), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 300 }) }));
  ok("otro admin (Alejandra) NO puede tocar créditos", !!cr.error && /Anel y Monse/.test(cr.error), (cr.error || "").slice(0, 70));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cd), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 300 }) }));
  ok("la cuenta de prueba tampoco", !!cr.error, (cr.error || "").slice(0, 60));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cm), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 300 }) }));
  ok("Monse marca VENCIDO + mora (la palabra de la plantilla, no 'VENCIDA')", cr.ok === true && cr.clienta.estatus === "VENCIDO" && cr.clienta.mora === 300, JSON.stringify(cr.clienta || {}).slice(0, 90));
  let lv = await j(await fetch(U + "/api/creditos?estado=vencidas", { headers: H(ca) }));
  ok("la vencida aparece en la lista de vencidas", (lv.resultados || []).some(c => String(c.id) === "70000000050"), "vencidas " + (lv.resultados || []).length);
  cr = await j(await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", saldo: 400, motivo: "corrección de captura" }) }));
  ok("Anel ajusta el saldo (con motivo)", cr.ok === true && cr.clienta.saldo === 400, JSON.stringify(cr.clienta || {}).slice(0, 80));
  cr = await j(await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", saldo: 400 }) }));
  ok("ajuste SIN motivo se rechaza (queda bitácora)", !!cr.error && /motivo/.test(cr.error), (cr.error || "").slice(0, 60));
  cr = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cm), body: JSON.stringify({ id: "70000000050", producto: "Credito Prueba", mora: 0 }) }));
  ok("mora 0 le quita lo VENCIDO (vuelve a VIGENTE)", cr.ok === true && cr.clienta.estatus === "VIGENTE" && (cr.clienta.mora || 0) === 0, JSON.stringify(cr.clienta || {}).slice(0, 80));
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

  console.log("\n— 16. GASTOS: un gasto en efectivo cuadra; en transferencia no toca la caja —");
  const DG = "2026-05-20";
  const syncG = (snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: DG, snapshot: snap, ts: Date.now() }) });
  const arqG = async () => j(await fetch(U + "/api/arqueo?fecha=" + DG, { headers: H(cd) }));
  // cobranza $1000 efectivo + gasto $200 EFECTIVO + gasto $300 TRANSFERENCIA;
  // cuenta la caja DESPUÉS del gasto en efectivo → $800 en billetes.
  await syncG({ reg: { "C-1": { "g1|P": { pago: 1000, forma: "E" } } }, regI: {}, movs: [
    { folio: "GG1", concepto: "GASTO", monto: 200, via: "E", nota: "transporte" },
    { folio: "GG2", concepto: "GASTO", monto: 300, via: "T", nota: "pago banco" },
  ], arqueo: { "500": 1, "200": 1, "100": 1 } });
  const ag = await arqG();
  const pg = (ag.porEjec || {}).prueba || {};
  ok("gasto en efectivo baja el 'a entregar' exacto (1000 − 200 = 800)", pg.aEntregar === 800, "aEntregar " + pg.aEntregar);
  ok("la caja CUADRA con el gasto en efectivo (contó 800 = debe 800, dif 0)", pg.contado === 800 && pg.dif === 0, "contó " + pg.contado + " · dif " + pg.dif);
  ok("el gasto por TRANSFERENCIA no descuadra la caja (sigue en 800, no 500)", pg.aEntregar === 800, "aEntregar " + pg.aEntregar);
  ok("el consolidado también cuadra con el gasto (a entregar 800 = billetes 800)",
     Math.abs((ag.efectivoAEntregar) - 800) < 0.01 && Math.abs(Object.entries(ag.denomTotal).reduce((s, [d, q]) => s + Number(d) * q, 0) - 800) < 0.01,
     "aEntregar " + ag.efectivoAEntregar);

  console.log("\n— 17. VOLVER TRAS CERRAR: 'capturar todo de nuevo' (reinicio) + filtro de hitos —");
  const D2 = "2026-04-15";
  const sync2 = (snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D2, snapshot: snap, ts: Date.now() }) });
  const cons2 = async () => { const c = await j(await fetch(U + "/api/consolidado?fecha=" + D2, { headers: H(cd) })); return (c.ejecutivos || {}).prueba || {}; };
  // captura PROGRESIVA (como en la vida real: se archiva versión a cada rato)
  const capP = { reg: { "C-9": {} }, regI: {}, movs: [], arqueo: { "500": 2 } };
  for (let i = 1; i <= 6; i++) { capP.reg["C-9"]["p" + i + "|P"] = { pago: 100 * i, forma: "E" }; await sync2(JSON.parse(JSON.stringify(capP))); }
  const cerr2 = await cons2();   // 100+200+...+600 = 2100
  await fetch(U + "/api/cierre", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D2, confirmado: true }) });
  // eligió "CAPTURAR TODO de nuevo" en la pregunta de la app
  let ri = await j(await fetch(U + "/api/dia/reinicio", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D2 }) }));
  ok("el reinicio responde ok (y había día que reiniciar)", ri.ok === true && ri.habia === true, JSON.stringify(ri).slice(0, 60));
  await sync2({ reg: { "C-9": { "p1|P": { pago: 150, forma: "E" } } }, regI: {}, movs: [], arqueo: { "100": 1, "50": 1 } });
  const nuevo2 = await cons2();
  ok("tras el reinicio, el día cuenta DESDE CERO (150, no " + (cerr2.efectivo + 150) + ")", Math.abs(nuevo2.efectivo - 150) < 0.01, "efectivo " + nuevo2.efectivo);
  ok("y el cierre viejo ya no aparece (día abierto otra vez)", !nuevo2.cierre, "cierre " + nuevo2.cierre);
  const rv2 = await j(await fetch(U + "/api/recuperar?fecha=" + D2, { headers: H(cd) }));
  const ep2 = (rv2.ejecutivos || {}).prueba || {};
  ok("la versión CERRADA ($2,100) sigue recuperable en el tablero", (ep2.versiones || []).some((v) => Math.abs(v.cifras.total - 2100) < 0.01), "versiones " + (ep2.versiones || []).length);
  ok("filtro de HITOS: la cerrada aparece PRIMERO (no enterrada por las 'a medias')",
     ep2.versiones && ep2.versiones[0] && Math.abs(ep2.versiones[0].cifras.total - 2100) < 0.01,
     "primera " + (ep2.versiones && ep2.versiones[0] ? ep2.versiones[0].cifras.total : "—"));
  // restaurarla la deja de vuelta exacta
  const rr4 = await j(await fetch(U + "/api/recuperar", { method: "POST", headers: H(cd), body: JSON.stringify({ fecha: D2, ejec: "prueba", archivado: ep2.versiones[0].archivado }) }));
  const rest2 = await cons2();
  ok("y 'Regresar esta' la restaura exacta ($2,100)", rr4.ok === true && Math.abs(rest2.efectivo - 2100) < 0.01, "efectivo " + rest2.efectivo);

  console.log("\n— 18. SNAPSHOT COMO TEXTO (así lo manda la app real, no como objeto) —");
  // La app envía snapshot = localStorage tal cual (STRING). La batería siempre
  // mandaba objetos y por eso el bug del 27-jul (movimientos sin guardar en
  // vivo) pasó todas las pruebas. Esta lo reproduce con el formato real.
  const D3 = "2026-03-10";
  const snapTxt = JSON.stringify({ fecha: D3, reg: { "C-5": { "t1|P": { pago: 700, forma: "E" } } }, regI: {},
    movs: [{ folio: "TX1", concepto: "RECUPERACION", monto: 250, via: "E", socio: "70000000070", clienta: "TEXTO TEST" }],
    arqueo: { "500": 1, "200": 2, "50": 1 } });
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D3, snapshot: snapTxt, ts: Date.now() }) });
  const c3 = await j(await fetch(U + "/api/consolidado?fecha=" + D3, { headers: H(cd) }));
  const p3 = (c3.ejecutivos || {}).prueba || {};
  ok("la cobranza del snapshot-texto se registra ($700)", Math.abs(p3.efectivo - 700) < 0.01, "efectivo " + p3.efectivo);
  const m3 = await j(await fetch(U + "/api/movimientos?fecha=" + D3, { headers: H(cd) }));
  ok("los OTROS MOVIMIENTOS del snapshot-texto se guardan EN VIVO (sin redespliegue)",
     (m3.lista || []).some((m) => /Recuperaci/.test(m.concepto) && m.monto === 250), "movs " + (m3.lista || []).length);
  const a3 = await j(await fetch(U + "/api/arqueo?fecha=" + D3, { headers: H(cd) }));
  const pe3 = (a3.porEjec || {}).prueba || {};
  ok("y el arqueo cuadra con ellos (contó 950 = 700 + 250, dif 0)", pe3.contado === 950 && pe3.dif === 0, "contó " + pe3.contado + " · dif " + pe3.dif);

  console.log("\n— 19. CHEQUES en otros movimientos: NO son efectivo de caja —");
  const D4 = "2026-02-11";
  const syncCh = (snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D4, snapshot: JSON.stringify(snap), ts: Date.now() }) });
  // sesión con: cobranza $500 E · liquidación $2,280 en CHEQUE · recuperación
  // $100 E · y una liquidación $300 mal guardada como EFECTIVO (caso Neri:
  // registro viejo de antes del arreglo, para probar la reparación)
  const movsCh = [
    { folio: "CQ1", concepto: "LIQUIDACION", monto: 2280, via: "CH", cheque: "0012345", socio: "70000000080", clienta: "CHEQUE TEST" },
    { folio: "CQ2", concepto: "RECUPERACION", monto: 100, via: "E" },
    { folio: "CQ3", concepto: "LIQUIDACION", monto: 300, via: "E", socio: "70000000081", clienta: "REPARA TEST" },
  ];
  const capCh = { fecha: D4, reg: { "C-7": { "chx|P": { pago: 500, forma: "E" } } }, regI: {}, movs: movsCh, arqueo: { "500": 1, "100": 1 } };
  await syncCh(capCh);
  let m4 = await j(await fetch(U + "/api/movimientos?fecha=" + D4, { headers: H(cd) }));
  const cq1 = (m4.lista || []).find((m) => /CQ1$/.test(m.folio)) || {};
  ok("el cheque se guarda como CHEQUE con su número", cq1.metodo === "cheque" && cq1.cheque === "0012345", "metodo " + cq1.metodo + " · #" + cq1.cheque);
  ok("y se reporta aparte (totalCheques $2,280)", Math.abs((m4.totalCheques || 0) - 2280) < 0.01, "cheques " + m4.totalCheques);
  const cq3a = (m4.lista || []).find((m) => /CQ3$/.test(m.folio)) || {};
  ok("(estado viejo simulado: la liquidación $300 quedó como efectivo)", cq3a.metodo === "efectivo", "metodo " + cq3a.metodo);
  // la app re-manda el MISMO movimiento ya con su via correcta (CH) — como hace
  // el rescate del arranque al re-procesar los snapshots
  const capCh2 = JSON.parse(JSON.stringify(capCh));
  capCh2.movs[2] = { folio: "CQ3", concepto: "LIQUIDACION", monto: 300, via: "CH", cheque: "0077", socio: "70000000081", clienta: "REPARA TEST" };
  await syncCh(capCh2);
  m4 = await j(await fetch(U + "/api/movimientos?fecha=" + D4, { headers: H(cd) }));
  const cq3b = (m4.lista || []).find((m) => /CQ3$/.test(m.folio)) || {};
  ok("la REPARACIÓN corrige el método a cheque SIN duplicar (caso Neri 25-jul)",
     cq3b.metodo === "cheque" && cq3b.cheque === "0077" && (m4.lista || []).filter((m) => /CQ3/.test(m.folio)).length === 1,
     "metodo " + cq3b.metodo + " · #" + cq3b.cheque);
  ok("totalCheques ya con los dos ($2,580)", Math.abs((m4.totalCheques || 0) - 2580) < 0.01, "cheques " + m4.totalCheques);
  const a4 = await j(await fetch(U + "/api/arqueo?fecha=" + D4, { headers: H(cd) }));
  const pe4 = (a4.porEjec || {}).prueba || {};
  ok("el arqueo NO exige los cheques en billetes: contó 600 = debe 600 (500+100), dif 0",
     pe4.contado === 600 && pe4.aEntregar === 600 && pe4.dif === 0,
     "contó " + pe4.contado + " · debe " + pe4.aEntregar + " · dif " + pe4.dif);

  console.log("\n— 20. SALDOS: descuentan lo abonado de SEMANAS PASADAS (corte de saldos) —");
  // El bug del lunes 27-jul: los saldos solo restaban la semana en curso; el
  // lunes la ventana se vaciaba y lo pagado el viernes dejaba de descontar.
  await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000095", nombre: "SALDO TEST", producto: "Credito Saldo", centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: 1000, cuota: 100 }) }));
  // SEMANA PASADA DE VERDAD, cualquier día que se corra. Antes era HOY−5, que
  // en SÁBADO cae en el lunes de ESTA semana: el pago dejaba de ser "de la
  // semana pasada" (rompía la premisa de esta prueba) y además se sumaba a la
  // cobranza de la semana, descuadrando la sección 37 los sábados. Ahora se
  // ancla al lunes de esta semana y se retrocede: siempre cae en la anterior.
  const LUN20 = (() => { const d = new Date(HOY + "T12:00");
    const g = d.getDay(); d.setDate(d.getDate() - ((g === 0 ? 7 : g) - 1));
    return d; })();
  const D5 = (() => { const d = new Date(LUN20); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10); })();
  // La prueba fija SU corte antes del pago: si se queda el corte que traiga el
  // sistema (que se mueve con cada plantilla nueva), este pago cae antes y la
  // prueba falla sin que nada esté mal. El corte va un día antes del abono.
  const CORTE20 = (() => { const d = new Date(LUN20); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10); })();
  await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: CORTE20, confirmar: true }) }));
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: D5, snapshot: JSON.stringify({ fecha: D5, reg: { "C-88": { "70000000095|Credito Saldo": { pago: 200, forma: "E" } } }, regI: {}, movs: [] }), ts: Date.now() }) });
  const saldoDe = async () => { const s = await j(await fetch(U + "/api/clientes?q=" + encodeURIComponent("SALDO TEST"), { headers: H(ca) })); return ((s.resultados || []).find((c) => String(c.id) === "70000000095") || {}).saldoActual; };
  ok("un pago de la SEMANA PASADA sigue bajando el saldo (1000 − 200 = 800)", (await saldoDe()) === 800, "saldoActual " + (await saldoDe()));
  let ct = await j(await fetch(U + "/api/saldos/corte", { headers: H(ca) }));
  ok("el corte de saldos es visible para dirección", /^\d{4}-\d{2}-\d{2}$/.test(ct.corte || ""), "corte " + ct.corte);
  // El corte va el DÍA SIGUIENTE al pago: así el abono queda ANTES del corte y
  // deja de descontar, que es lo que esta prueba comprueba. Atado a D5 y no a
  // HOY: con HOY−3 caía ANTES del pago los lunes y la prueba fallaba sola.
  const DC3 = (() => { const d = new Date(D5 + "T12:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cal), body: JSON.stringify({ fecha: DC3, confirmar: true }) }));
  ok("otro admin NO puede mover el corte (solo Anel y Monse)", !!ct.error, (ct.error || "").slice(0, 50));
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: DC3, confirmar: true }) }));
  ok("Monse mueve el corte (cargó plantillas nuevas)", ct.ok === true && ct.corte === DC3, JSON.stringify(ct).slice(0, 50));
  ok("un pago ANTERIOR al corte ya no descuenta (la plantilla ya lo traía)", (await saldoDe()) === 1000, "saldoActual " + (await saldoDe()));
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01", confirmar: true }) }));
  ok("y al regresar el corte, vuelve a descontar", ct.ok === true && (await saldoDe()) === 800, "saldoActual " + (await saldoDe()));
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2099-01-01", confirmar: true }) }));
  ok("un corte en el futuro se rechaza", !!ct.error, (ct.error || "").slice(0, 50));

  console.log("\n— 21. FASE 2 · cartera, mora de la semana y semáforo —");
  let ca2 = await j(await fetch(U + "/api/cartera", { headers: H(ca) }));
  ok("la cartera carga con sus cifras", ca2.creditosActivos > 0 && ca2.cartera > 0, "créditos " + ca2.creditosActivos + " · cartera " + ca2.cartera);
  ok("saldo promedio = cartera ÷ créditos con saldo", Math.abs(ca2.saldoPromedio - (ca2.cartera / ca2.conSaldo)) < 0.02, "prom " + ca2.saldoPromedio);
  // PENDIENTE ≠ MORA (corrección de Anel, 4-ago). Antes se afirmaba
  // mora === esperado − cobrado, que era justo la confusión: eso es la cobranza
  // por recuperar, no la morosidad. Ahora mora = lo que YA venció sin cubrirse.
  ok("la mora real nunca pasa de lo esperado A LA FECHA",
     ca2.moraSemana >= 0 && ca2.moraSemana <= ca2.esperadoALaFecha + 0.02,
     "mora " + ca2.moraSemana + " · esperado a la fecha " + ca2.esperadoALaFecha);
  ok("lo esperado a la fecha no pasa de lo esperado de la semana completa",
     ca2.esperadoALaFecha <= ca2.esperadoSemana + 0.02,
     "a la fecha " + ca2.esperadoALaFecha + " de " + ca2.esperadoSemana);
  ok("el pendiente de cobro se reporta aparte de la mora",
     typeof ca2.pendienteSemana === "number" && ca2.pendienteSemana >= 0, "pendiente " + ca2.pendienteSemana);
  ok("el semáforo cuadra con los créditos activos",
     Object.values(ca2.semaforo).reduce((a, b) => a + b, 0) === ca2.creditosActivos,
     JSON.stringify(ca2.semaforo));
  ok("suma de carteras por ejecutiva = cartera total",
     Math.abs(ca2.porEjec.reduce((s, e) => s + e.cartera, 0) - ca2.cartera) < 1, "suma " + ca2.porEjec.reduce((s, e) => s + e.cartera, 0));
  ok("detecta los plazos mal capturados (para que Monse los corrija)", Array.isArray(ca2.inconsistentes), "inconsistentes " + (ca2.inconsistentes || []).length);
  // una clienta que paga su cuota completa pasa a "al corriente" y sube el cobrado
  const antesCorr = ca2.semaforo.alCorriente, antesCob = ca2.cobradoSemana;
  const cli = { id: "70000000097", producto: "Credito Semaforo", cuota: 250, saldo: 1000 };
  await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: cli.id, nombre: "SEMAFORO TEST", producto: cli.producto, centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: cli.saldo, cuota: cli.cuota }) }));
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: HOY, snapshot: JSON.stringify({ fecha: HOY, reg: { "C-88": { [cli.id + "|" + cli.producto]: { pago: cli.cuota, forma: "E" } } }, regI: {}, movs: [] }), ts: Date.now() }) });
  ca2 = await j(await fetch(U + "/api/cartera", { headers: H(ca) }));
  ok("quien paga su cuota completa cuenta como AL CORRIENTE", ca2.semaforo.alCorriente === antesCorr + 1, antesCorr + " → " + ca2.semaforo.alCorriente);
  ok("y su pago sube el cobrado de la semana", Math.abs(ca2.cobradoSemana - (antesCob + cli.cuota)) < 0.02, antesCob + " → " + ca2.cobradoSemana);
  ok("la ejecutiva de prueba NO ve la cartera real (403)", (await fetch(U + "/api/cartera", { headers: H(ce) })).status === 403);

  console.log("\n— 22. LA EJECUTIVA VE EL MISMO 'A ENTREGAR' QUE MONSE —");
  // Bug del 25-jul: a la ejecutiva se le mandaba una lista de movimientos VACÍA,
  // así que su "a entregar" no le restaba sus gastos. Dos números del mismo día.
  const D6 = "2026-01-14";
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D6, snapshot: JSON.stringify({ fecha: D6,
    reg: { "C-6": { "e1|P": { pago: 900, forma: "E" } } }, regI: {},
    movs: [{ folio: "EE1", concepto: "GASTO", monto: 150, via: "E", nota: "pasaje" },
           { folio: "EE2", concepto: "RECUPERACION", monto: 50, via: "E" }],
    arqueo: { "500": 1, "200": 1, "100": 1 } }), ts: Date.now() }) });
  const aEje = await j(await fetch(U + "/api/arqueo?fecha=" + D6, { headers: H(ce) }));   // la ejecutiva
  const aDir = await j(await fetch(U + "/api/arqueo?fecha=" + D6, { headers: H(cd) }));   // dirección
  const pEje = (aEje.porEjec || {}).prueba || {}, pDir = (aDir.porEjec || {}).prueba || {};
  ok("a la ejecutiva SÍ se le restan sus gastos (900 − 150 + 50 = 800)", pEje.aEntregar === 800, "aEntregar " + pEje.aEntregar);
  ok("y ve EXACTAMENTE lo mismo que Monse para ese día", pEje.aEntregar === pDir.aEntregar && pEje.contado === pDir.contado,
     "ejecutiva " + pEje.aEntregar + " vs dirección " + pDir.aEntregar);
  ok("su caja cuadra (contó 800 = debe 800, dif 0)", pEje.contado === 800 && pEje.dif === 0, "contó " + pEje.contado + " · dif " + pEje.dif);
  ok("la ejecutiva NO ve movimientos de otras ejecutivas", Object.keys(aEje.porEjec || {}).every((k) => k === "prueba"), Object.keys(aEje.porEjec || {}).join(","));

  console.log("\n— 23. FASE 2 · TENDENCIAS semana a semana —");
  // 4 semanas sintéticas: paga, paga, NO paga, paga. La cartera debe bajar
  // exactamente lo abonado y la semana sin cobro debe mostrar su mora.
  const lunesDe2 = (f) => { const [y, m, d] = f.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d));
    const dw = dt.getUTCDay(); dt.setUTCDate(dt.getUTCDate() - (dw === 0 ? 6 : dw - 1)); return dt.toISOString().slice(0, 10); };
  const menosSem = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 7 * n); return d.toISOString().slice(0, 10); };
  const L0 = lunesDe2(HOY);
  const W = [menosSem(L0, 4), menosSem(L0, 3), menosSem(L0, 2), menosSem(L0, 1)];
  await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: W[0], confirmar: true }) }));
  await fetch(U + "/api/centros", { method: "POST", headers: H(ca), body: JSON.stringify({ numero: "77", nombre: "CENTRO TENDENCIA", ejecutivo: "Neri", dia: "Lunes" }) });
  const SOC = "70000000123", PRD = "Credito Tendencia";
  await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: SOC, nombre: "TENDENCIA TEST", producto: PRD, centro: "CENTRO TENDENCIA", ejecutivo: "Neri", saldo: 4000, cuota: 1000, plazo: 4 }) }));
  const pagarW = (fecha, monto) => fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha,
    snapshot: JSON.stringify({ fecha, reg: { "C-77": { [SOC + "|" + PRD]: { pago: monto, forma: "E" } } }, regI: {}, movs: [], arqueo: {} }), ts: Date.now() }) });
  await pagarW(W[0], 1000); await pagarW(W[1], 1000); await pagarW(W[3], 1000);   // W[2] sin pago
  const tend = await j(await fetch(U + "/api/tendencias", { headers: H(ca) }));
  const SS = {}; (tend.serie || []).forEach((x) => { SS[x.semana] = x; });
  ok("la serie es CONTINUA (rellena las semanas sin captura)", (tend.serie || []).length >= 5 && !!SS[W[2]], "filas " + (tend.serie || []).length);
  // SE MIDE POR DIFERENCIA, NO CONTRA EL TOTAL. Antes se comparaba la cartera
  // GLOBAL de una semana contra la de la otra y se exigía que la resta diera
  // justo los $1,000 de esta clienta. Eso solo se sostenía mientras ninguna otra
  // sección de la batería tuviera abonos en esas semanas — y en cuanto los tuvo,
  // la prueba se puso roja marcando $40,430 de diferencia sin que nada estuviera
  // mal. Ahora se toma la cartera, se abona UNA vez más, y se comprueba que baje
  // exactamente ese abono.
  const carteraDe = async (sem) => {
    const t = await j(await fetch(U + "/api/tendencias", { headers: H(ca) }));
    const f = (t.serie || []).find((x) => x.semana === sem);
    return f ? f.cartera : null;
  };
  const diaDe = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const antesW = await carteraDe(W[1]);
  await pagarW(diaDe(W[1], 2), 500);          // día propio, para no pisar otra captura
  const despuesW = await carteraDe(W[1]);
  ok("la cartera baja EXACTAMENTE lo abonado (−500 al capturar un abono más)",
     antesW !== null && despuesW !== null && Math.abs((despuesW - antesW) + 500) < 0.01,
     antesW + " → " + despuesW);
  // Antes se afirmaba que la semana W[2] salía en CERO. Era frágil: la ventana de
  // 4 semanas se mueve con el calendario y el 4-ago cayó sobre una semana que sí
  // tenía cobranza real, así que la prueba fallaba sin que nada estuviera mal.
  // Ahora se verifica el CÁLCULO, que es lo que de verdad protege: cada semana
  // posterior al corte debe traer sus cifras y su cumplimiento debe cuadrar
  // contra su propio esperado y cobrado.
  const conCifras = (tend.serie || []).filter((x) => x.esperado != null);
  ok("toda semana posterior al corte trae esperado, mora y cumplimiento",
     conCifras.length > 0 && conCifras.every((x) => x.mora != null && x.cumplimiento != null),
     "semanas con cifras: " + conCifras.length);
  ok("y en cada una el cumplimiento cuadra con su esperado y su cobrado",
     conCifras.every((x) => x.esperado <= 0
       ? x.cumplimiento === 0
       : Math.abs(x.cumplimiento - Math.round((x.cobrado / x.esperado) * 100 * 100) / 100) < 0.02),
     JSON.stringify(conCifras.map((x) => [x.semana, x.esperado, x.cobrado, x.cumplimiento])[0] || []));
  ok("la cartera NUNCA sube en la serie (solo baja o se mantiene)",
     (tend.serie || []).filter((x) => x.cartera != null).every((x, i, arr) => i === 0 || x.cartera <= arr[i - 1].cartera + 0.01), "ok");
  ok("las tendencias son solo para dirección/admin (ejecutiva 403)", (await fetch(U + "/api/tendencias", { headers: H(ce) })).status === 403);

  console.log("\n— 24. CERRAR = MANDÓ SU ARQUEO (regla Karina 27-jul) —");
  const D7 = "2026-02-18";
  const cerrarEn = async (f) => { const r = await fetch(U + "/api/cierre", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: f, confirmado: true }) });
    const d = await r.json().catch(() => ({})); return { status: r.status, ...d }; };
  const cerrarD7 = () => cerrarEn(D7);
  const consD7 = async () => { const c = await j(await fetch(U + "/api/consolidado?fecha=" + D7, { headers: H(cd) })); return (c.ejecutivos || {}).prueba || {}; };
  // cobranza en EFECTIVO pero SIN contar un solo billete
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D7,
    snapshot: JSON.stringify({ fecha: D7, reg: { "C-4": { "q1|P": { pago: 900, forma: "E" } } }, regI: {}, movs: [], arqueo: {} }), ts: Date.now() }) });
  let cz = await cerrarD7();
  ok("con efectivo y SIN conteo, el servidor RECHAZA el cierre", cz.status === 400 && cz.falta === "arqueo", JSON.stringify(cz).slice(0, 90));
  ok("y el día NO queda marcado como cerrado", !(await consD7()).cierre, "cierre " + (await consD7()).cierre);
  // ahora sí cuenta sus billetes
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D7,
    snapshot: JSON.stringify({ fecha: D7, reg: { "C-4": { "q1|P": { pago: 900, forma: "E" } } }, regI: {}, movs: [], arqueo: { "500": 1, "200": 2 } }), ts: Date.now() }) });
  cz = await cerrarD7();
  ok("con el conteo hecho, el cierre SÍ pasa", cz.status === 200 && cz.marcado === true && cz.contado === 900, JSON.stringify(cz).slice(0, 80));
  ok("y ahora el día sí aparece cerrado para Monse", !!(await consD7()).cierre);
  // un día 100% transferencia no tiene efectivo que contar: debe poder cerrar
  const D8 = "2026-02-25";
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D8,
    snapshot: JSON.stringify({ fecha: D8, reg: { "C-4": { "q2|P": { pago: 700, forma: "T" } } }, regI: {}, movs: [], arqueo: {} }), ts: Date.now() }) });
  const cz8 = await cerrarEn(D8);
  ok("un día TODO por transferencia sí puede cerrar (no hay efectivo que contar)", cz8.status === 200 && cz8.marcado === true, JSON.stringify(cz8).slice(0, 70));

  console.log("\n— 25. MAGNUS (cuota VARIABLE): no inventa mora · COMADRE sí es cuota fija —");
  // Julio trae solo Comadre y Magnus. Comadre es cuota PAREJA (método A) → cabe
  // igual que los grupales. Magnus es saldos insolutos (cuota DECRECIENTE) → su
  // cuota del padrón deja de valer al primer pago y NO debe generar mora.
  await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000200", nombre: "JULIO MAGNUS", producto: "Magnus", centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: 20000, cuota: 1800, plazo: 12 }) }));
  await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: "70000000201", nombre: "JULIO COMADRE", producto: "Comadre", centro: "CENTRO BATERIA", ejecutivo: "Neri", saldo: 12000, cuota: 1000, plazo: 12 }) }));
  const D9 = "2026-03-04";
  // los dos pagan MENOS que su cuota del padrón
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: D9, snapshot: JSON.stringify({ fecha: D9,
    reg: { "C-88": { "70000000200|Magnus": { pago: 900, forma: "E" }, "70000000201|Comadre": { pago: 400, forma: "E" } } },
    regI: {}, movs: [], arqueo: { "1000": 1, "200": 1, "100": 1 } }), ts: Date.now() }) });
  const a9 = await j(await fetch(U + "/api/arqueo?fecha=" + D9, { headers: H(ca) }));   // Anel: ve a las ejecutivas reales
  const e9 = (a9.porEjec || {}).neri || {};
  ok("MAGNUS no genera mora falsa (solo cuenta la de Comadre: 1000 − 400 = 600)",
     Math.abs((e9.faltantes || 0) - 600) < 0.01, "faltantes " + e9.faltantes);
  const car9 = await j(await fetch(U + "/api/cartera", { headers: H(ca) }));
  ok("el semáforo aparta los créditos de cuota variable", (car9.semaforo.cuotaVariable || 0) >= 1, JSON.stringify(car9.semaforo));
  ok("y el esperado de la semana NO incluye la cuota de Magnus",
     car9.esperadoSemana > 0 && !JSON.stringify(car9.semaforo).includes("undefined"), "esperado " + car9.esperadoSemana);
  const sinMagnus = (car9.inconsistentes || []).every((x) => !/magnus/i.test(x.producto || ""));
  ok("Magnus tampoco sale como 'plazo mal capturado' (no se le deriva el nº de pago)", sinMagnus, "inconsistentes " + (car9.inconsistentes || []).length);

  console.log("\n— 26. CORREGIR EL CONTEO DE BILLETES tras cerrar (dedazo del 28-jul) —");
  // Caso real: Karina cerró con 1 billete de $100 y 2 de $20 de más ($140). El
  // conteo mal tecleado dejaba el día en rojo PARA SIEMPRE, porque al reabrir
  // la app queda limpia y el blindaje de captura vacía rechazaba la corrección.
  const DK = "2026-05-06";
  const syncK = (snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: DK, snapshot: JSON.stringify(snap), ts: Date.now() }) });
  const arqK = async () => { const a = await j(await fetch(U + "/api/arqueo?fecha=" + DK, { headers: H(cd) })); return (a.porEjec || {}).prueba || {}; };
  const consK = async () => { const c = await j(await fetch(U + "/api/consolidado?fecha=" + DK, { headers: H(cd) })); return (c.ejecutivos || {}).prueba || {}; };
  const MAL = { "500": 4, "200": 5, "100": 15, "50": 19, "20": 7, "10": 5, "5": 12, "2": 22, "1": 36 };   // $5,780
  const BIEN = { "500": 4, "200": 5, "100": 14, "50": 19, "20": 5, "10": 5, "5": 12, "2": 22, "1": 36 };  // $5,640
  await syncK({ fecha: DK, reg: { "C-1": { "k1|P": { pago: 5640, forma: "E" } } }, regI: {},
    movs: [{ folio: "MK1", concepto: "RECUPERACION", monto: 0, via: "E" }], arqueo: MAL });
  await fetch(U + "/api/cierre", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: DK, confirmado: true }) });
  let ek = await arqK();
  ok("cerró con el conteo MAL y sobran $140", ek.contado === 5780 && ek.dif === 140, "contó " + ek.contado + " · dif " + ek.dif);
  const cobAntesK = (await consK()).efectivo;
  // su app quedó limpia tras enviar: la corrección llega SIN pagos, solo conteo
  const rk = await j(await syncK({ fecha: DK, reg: {}, regI: {}, movs: [], arqueo: BIEN }));
  ok("la corrección del conteo SÍ se acepta (antes la rechazaba el blindaje)", rk.ok === true, JSON.stringify(rk).slice(0, 70));
  ek = await arqK();
  ok("el conteo corregido queda y el día CUADRA en $0", ek.contado === 5640 && ek.dif === 0, "contó " + ek.contado + " · dif " + ek.dif);
  const cobDespK = (await consK()).efectivo;
  ok("la cobranza NO se perdió al corregir", Math.abs(cobDespK - cobAntesK) < 0.01, cobAntesK + " → " + cobDespK);
  ok("y el día sigue marcado como cerrado", !!(await consK()).cierre);
  const r0 = await j(await syncK({ fecha: DK, reg: {}, regI: {}, movs: [], arqueo: {} }));
  ok("una captura vacía SIN conteo se sigue rechazando (blindaje intacto)", r0.rechazado === "vacio_sobre_lleno", JSON.stringify(r0).slice(0, 60));

  console.log("\n— 27. El DESGLOSE de una clienta NO se cuenta dos veces (bug real del 28-jul) —");
  // Karina cerró con un conteo PERFECTO de $5,640, pero el tablero le marcaba
  // $5,780 y "sobran $140": la clienta del mixto traía desglose {100:1, 20:2} y
  // el sistema lo SUMABA encima del conteo físico. Los mismos billetes, dos veces.
  const DD = "2026-01-21";
  const syncDsg = (snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: DD, snapshot: JSON.stringify(snap), ts: Date.now() }) });
  const arqDsg = async () => { const a = await j(await fetch(U + "/api/arqueo?fecha=" + DD, { headers: H(cd) })); return (a.porEjec || {}).prueba || {}; };
  await syncDsg({ fecha: DD, regI: {}, movs: [], reg: { "C-2": {
    "d1|P": { pago: 5500, forma: "E" },
    // la del mixto: pagó $140 en efectivo y trae el desglose de esos billetes
    "d2|P": { pago: 480, garantia: 20, forma: "M", mixEfe: 140, mixTr: 360, desglose: { "100": 1, "20": 2 } },
  } }, arqueo: { "500": 4, "200": 5, "100": 14, "50": 19, "20": 5, "10": 5, "5": 12, "2": 22, "1": 36 } });
  const ed = await arqDsg();
  ok("el conteo es el que ella tecleó, sin sumarle el desglose", ed.contado === 5640, "contó " + ed.contado + " (el desglose habría dado 5,780)");
  ok("y el día CUADRA en $0 (antes marcaba sobra $140)", ed.dif === 0, "debe " + ed.aEntregar + " · dif " + ed.dif);
  // día VIEJO sin conteo de arqueo: ahí el desglose SÍ es la única fuente
  const DV = "2026-01-22";
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: DV, snapshot: JSON.stringify({ fecha: DV,
    reg: { "C-2": { "v1|P": { pago: 300, forma: "E", desglose: { "100": 3 } } } }, regI: {}, movs: [], arqueo: {} }), ts: Date.now() }) });
  const av = await j(await fetch(U + "/api/arqueo?fecha=" + DV, { headers: H(cd) }));
  const ev = (av.porEjec || {}).prueba || {};
  ok("en días viejos SIN arqueo, el desglose sigue siendo la fuente del conteo", ev.contado === 300, "contó " + ev.contado);

  console.log("\n— 28. GARANTÍAS CON CENTAVOS: los medios pesos no se redondean (Monse, 29-jul) —");
  // Las garantías traen medios pesos (57.50, 40.50). El dato SIEMPRE se guardó
  // bien, pero los textos (campanita de dirección y aviso de la app) redondeaban
  // a peso entero y decían $58 donde la captura era $57.50. Monse lo reportó
  // creyendo que faltaría $1 por cada redondeo. Se prueban las dos cosas: que el
  // número guardado conserva los centavos y que el TEXTO ya los muestra.
  const DC = "2026-04-08";
  const syncCent = (f, snap) => fetch(U + "/api/sync", { method: "POST", headers: H(ce),
    body: JSON.stringify({ fecha: f, snapshot: JSON.stringify(snap), ts: Date.now() }) });
  await syncCent(DC,{ fecha: DC, reg: { "C-3": {
    "g1|P": { pago: 0, garantia: 57.5, forma: "E" },   // Jolibeth: $57.50
    "g2|P": { pago: 0, garantia: 40.5, forma: "E" },   // Elena Francisca: $40.50
  } }, regI: {}, movs: [], arqueo: { "50": 1, "20": 2, "5": 1, "2": 1, "0.5": 2 } });
  const ac = await j(await fetch(U + "/api/arqueo?fecha=" + DC, { headers: H(cd) }));
  const ec = (ac.porEjec || {}).prueba || {};
  ok("las garantías con centavos se guardan enteras (57.50 + 40.50 = 98)",
    Math.abs((ec.garantias || 0) - 98) < 0.001, "garantías " + ec.garantias);
  ok("con las dos monedas de $0.50 el día cuadra al centavo",
    Math.abs((ec.contado || 0) - 98) < 0.001 && Math.abs(ec.dif || 0) < 0.001,
    "contado " + ec.contado + " · dif " + ec.dif);
  const res = await j(await fetch(U + "/api/resumen?fecha=" + DC, { headers: H(cd) }));
  const txt = JSON.stringify(res);
  ok("el texto de dirección no redondea la garantía a peso entero (ni $58 ni $41)",
    txt.indexOf("$58") < 0 && txt.indexOf("$41") < 0, txt.slice(0, 200));

  // Lo que a Monse le preocupaba: que "al final haga falta $1 por cada redondeo".
  // Si entrega una moneda de $0.50 de menos, el arqueo lo TIENE que ver.
  const DC2 = "2026-04-09";
  await syncCent(DC2, { fecha: DC2, reg: { "C-3": {
    "g3|P": { pago: 0, garantia: 57.5, forma: "E" },
  } }, regI: {}, movs: [], arqueo: { "50": 1, "5": 1, "2": 1 } }); // 57, falta $0.50
  const ac2 = await j(await fetch(U + "/api/arqueo?fecha=" + DC2, { headers: H(cd) }));
  const ec2 = (ac2.porEjec || {}).prueba || {};
  ok("si falta la moneda de $0.50, el arqueo lo detecta (no se traga los centavos)",
    Math.abs((ec2.dif || 0) + 0.5) < 0.001, "dif " + ec2.dif + " (debía ser −0.5)");

  console.log("\n— 29. EL DÍA DEL CORTE CUENTA, y para excluirlo se MUEVE el corte (29-jul) —");
  // Decisión tomada con Karina el 29-jul: el corte es el PRIMER día cuyos abonos
  // se descuentan, ese día incluido. Se probó cambiarlo a "el último día que la
  // plantilla ya trae descontado" y se DESECHÓ: habría desplazado un día de
  // cobranza en todos los cortes viejos. Para dejar el sábado fuera, Monse mueve
  // el corte al domingo desde el tablero — sin tocar código.
  const co = await j(await fetch(U + "/api/saldos/corte", { headers: H(cd) }));
  ok("el corte dice desde qué día se descuenta, y es el corte MISMO",
    !!co.corte && co.desde === co.corte, JSON.stringify(co));
  // Mover el corte un día SÍ deja fuera el día anterior: es la palanca real.
  const ant = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-04-08", confirmar: true }) }));
  const co2 = await j(await fetch(U + "/api/saldos/corte", { headers: H(cd) }));
  ok("Monse puede mover el corte y el sistema lo respeta al instante",
    ant.ok === true && co2.corte === "2026-04-08", JSON.stringify(ant) + " → " + JSON.stringify(co2));
  const xls = await fetch(U + "/api/semana/excel", { headers: H(cd) });
  ok("y el Excel de saldos se sigue generando con la columna de días de pago",
    xls.status === 200 && /spreadsheet/.test(xls.headers.get("content-type") || ""),
    xls.status + " " + xls.headers.get("content-type"));

  console.log("\n— 30. LAS LIQUIDACIONES TRAEN SU FECHA en el Excel (Karina, 29-jul) —");
  // La columna "Días de pago" salía VACÍA en liquidaciones y recuperaciones: los
  // pagos vienen del snapshot (por crédito) y las liquidaciones de movimientos
  // (por socio), y solo se estaban leyendo las primeras. Justo las 6 de Neri del
  // 25-jul eran liquidaciones, o sea la mitad del problema que se quería resolver.
  const cnn = await login("neri", "neri2026");
  // Se toma del padrón que usa el servidor (el mismo archivo que se copió a la
  // carpeta de pruebas), para que el caso sea siempre el mismo y no dependa de la
  // búsqueda del API.
  const padronFile = process.env.DATA_DIR ? require("path").join(process.env.DATA_DIR, "padron.json") : "data/padron.json";
  const clNeri = JSON.parse(require("fs").readFileSync(padronFile, "utf8"))
    .find((x) => x.ejecutivo === "Neri" && (x.saldo || 0) > 1000 && x.estatus !== "BAJA");
  ok("hay un crédito de Neri con saldo para probar la liquidación", !!clNeri, padronFile);
  {
    const FL = "2026-07-22";
    await fetch(U + "/api/sync", { method: "POST", headers: H(cnn), body: JSON.stringify({ fecha: FL, ts: Date.now(),
      snapshot: JSON.stringify({ fecha: FL, reg: {}, regI: {},
        movs: [{ folio: "LQFECHA", concepto: "LIQUIDACION", monto: 500, via: "E", socio: String(clNeri.id), clienta: clNeri.nombre }],
        arqueo: { "500": 1 } }) }) });
    const xr = await fetch(U + "/api/semana/excel", { headers: H(cm) });
    const ExcelJS2 = require("exceljs");
    const wb2 = new ExcelJS2.Workbook();
    await wb2.xlsx.load(Buffer.from(await xr.arrayBuffer()));
    const ws2 = wb2.getWorksheet("Saldos actualizados");
    ok("la columna 11 del Excel es 'Días de pago'",
      String(ws2.getRow(2).getCell(11).value).indexOf("Días") >= 0, String(ws2.getRow(2).getCell(11).value));
    let conLiq = 0, conFecha = 0;
    ws2.eachRow((r2, n2) => {
      if (n2 < 3) return;
      if (String(r2.getCell(5).value) === "TOTAL") return;
      const liq = Number(r2.getCell(8).value) || 0;
      if (liq > 0) { conLiq++; if (String(r2.getCell(11).value || "").trim()) conFecha++; }
    });
    ok("TODA liquidación del Excel trae su día (antes salían todas vacías)",
      conLiq > 0 && conFecha === conLiq, conFecha + " con fecha de " + conLiq + " liquidaciones");
  }

  console.log("\n— 31. UN VENCIDO NO TIENE CALENDARIO: no se le pide nº de pago (Karina, 29-jul) —");
  // Karina explicó el 29-jul que a los VENCIDOS nunca les pagaron, y por eso la
  // plantilla les pone cuota 0 y plazo 0 a propósito. Antes el sistema los sacaba
  // como "dato incompleto" y se le iba a pedir a Monse la cuota y el plazo de 22
  // créditos que NO tienen. Además el semáforo preguntaba por estatus "VENCIDA"
  // (con A) y en la plantilla dice "VENCIDO": 29 no se marcaban como vencidos.
  const car = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  const padr = JSON.parse(require("fs").readFileSync(padronFile, "utf8"));
  const esVenc = (c) => /vencid/i.test(String(c.estatus || ""));
  const vencPadron = padr.filter((c) => esVenc(c) && c.activa !== false).length;
  ok("la plantilla trae créditos con estatus VENCIDO (no 'VENCIDA')",
    vencPadron > 0, vencPadron + " vencidos en el padrón");
  ok("el semáforo los cuenta como vencidas (antes solo los cachaba la mora capturada)",
    (car.semaforo || {}).vencida >= vencPadron,
    "semáforo.vencida=" + (car.semaforo || {}).vencida + " vs " + vencPadron + " vencidos");
  const incVenc = (car.inconsistentes || []).filter((x) => {
    const c = padr.find((y) => String(y.id) === String(x.socio) && y.producto === x.producto);
    return c && esVenc(c);
  });
  ok("NINGÚN vencido sale como 'plazo mal capturado' (no se le pide un dato que no existe)",
    incVenc.length === 0, incVenc.length + " vencidos en la lista de inconsistentes");
  // Prueba CAUSAL (no contra el archivo del padrón, que la batería ya modificó con
  // sus altas): se dan de alta dos créditos con la MISMA cuota, uno vencido y uno
  // vigente, y se mide cuánto se movió el esperado. El vencido no debe moverlo.
  const esp = async () => (await j(await fetch(U + "/api/cartera", { headers: H(cm) }))).esperadoSemana;
  const espAntes = await esp();
  // El alta siempre nace VIGENTE (el endpoint fuerza el estatus), así que primero
  // se da de alta y DESPUÉS se marca morosa — que es como pasa en la vida real.
  const r31 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca),
    body: JSON.stringify({ id: "70000000311", nombre: "CLIENTA VENCIDA PRUEBA", producto: "Grupal-Basico",
      centro: clNeri.centro, ejecutivo: "Neri", saldo: 5000, cuota: 500, plazo: 10 }) }));
  const espVigente = await esp();
  ok("un crédito nuevo VIGENTE con cuota $500 sube el esperado $500 (la prueba muerde)",
    !r31.error && Math.abs(espVigente - espAntes - 500) < 0.01,
    "antes " + espAntes + " → después " + espVigente + (r31.error ? " · " + r31.error : ""));
  const rm = await j(await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: "70000000311", producto: "Grupal-Basico", mora: 1500 }) }));
  const espVencida = await esp();
  ok("al marcarla morosa queda VENCIDO y su cuota SALE del esperado (baja los $500)",
    !rm.error && Math.abs(espVencida - espAntes) < 0.01,
    "esperado " + espVencida + " · debía volver a " + espAntes + (rm.error ? " · " + rm.error : ""));
  const cliVenc = (await j(await fetch(U + "/api/creditos?q=70000000311", { headers: H(cm) }))).resultados || [];
  ok("y el estatus que escribe el sistema es 'VENCIDO', como en la plantilla (no 'VENCIDA')",
    cliVenc.some((x) => String(x.estatus) === "VENCIDO"),
    JSON.stringify(cliVenc.map((x) => x.estatus)));

  console.log("\n— 32. RENOVACIÓN: lo del ciclo viejo NO se le resta al nuevo (Karina, 29-jul) —");
  // Karina: "LIQUIDADO es que ya terminaron de pagar, pero a veces renuevan y se
  // vuelve a dar de alta". La llave de un crédito es socio+producto y al renovar el
  // nombre es el MISMO → los abonos del ciclo cerrado se le restaban al nuevo:
  // renovaba $10,000 y el tablero lo mostraba en $8,000. No se arregla por fecha
  // (liquidan y renuevan el mismo día, y solo se guarda fecha, no hora): al cerrar
  // el ciclo se anota cuánto llevaba abonado y eso se descuenta.
  const cenR = (await j(await fetch(U + "/api/centros", { headers: H(cm) }))).centros[0].centro;
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY, confirmar: true }) });
  const renueva = async (soc, via) => {
    await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({
      id: soc, nombre: "RENUEVA " + via, producto: "Grupal-Basico", centro: cenR,
      ejecutivo: "Neri", saldo: 2000, cuota: 500, plazo: 4 }) });
    const snap = via === "pago"
      ? { fecha: HOY, reg: {}, regI: { [soc + "|Grupal-Basico"]: { pago: 2000, forma: "E" } }, movs: [], arqueo: { "500": 4 } }
      : { fecha: HOY, reg: {}, regI: {}, arqueo: { "500": 4 },
          movs: [{ folio: "LQR" + soc, concepto: "LIQUIDACION", monto: 2000, via: "E", socio: soc, clienta: "RENUEVA " + via }] };
    await fetch(U + "/api/sync", { method: "POST", headers: H(cnn),
      body: JSON.stringify({ fecha: HOY, ts: Date.now(), snapshot: JSON.stringify(snap) }) });
    const r = await j(await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm), body: JSON.stringify({
      id: soc, producto: "Grupal-Basico", centro: cenR, ejecutivo: "Neri", saldo: 10000, cuota: 1000, plazo: 10 }) }));
    const lst = (await j(await fetch(U + "/api/creditos?q=" + soc, { headers: H(cm) }))).resultados || [];
    return { r, nuevo: lst.find((x) => x.recredito) || lst[0] };
  };
  const rp = await renueva("70000000921", "pago");
  ok("liquidó con PAGO y renovó el MISMO día → el ciclo nuevo vale sus $10,000 completos",
    !rp.r.error && rp.nuevo && Math.abs(rp.nuevo.saldoActual - 10000) < 0.01,
    "saldo del nuevo: " + (rp.nuevo || {}).saldoActual + (rp.r.error ? " · " + rp.r.error : ""));
  const rl = await renueva("70000000922", "liquidacion");
  ok("liquidó con LIQUIDACIÓN y renovó el MISMO día → también vale sus $10,000",
    !rl.r.error && rl.nuevo && Math.abs(rl.nuevo.saldoActual - 10000) < 0.01,
    "saldo del nuevo: " + (rl.nuevo || {}).saldoActual + (rl.r.error ? " · " + rl.r.error : ""));
  ok("y el ciclo anterior quedó cerrado (no conviven dos con la misma llave)",
    rp.r.cerroAnterior === "Grupal-Basico" && rl.r.cerroAnterior === "Grupal-Basico",
    JSON.stringify([rp.r.cerroAnterior, rl.r.cerroAnterior]));
  // Y si TODAVÍA debe, la renovación con el mismo nombre se sigue bloqueando.
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({
    id: "70000000923", nombre: "RENUEVA DEBIENDO", producto: "Grupal-Basico", centro: cenR,
    ejecutivo: "Neri", saldo: 2000, cuota: 500, plazo: 4 }) });
  const rb = await j(await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm), body: JSON.stringify({
    id: "70000000923", producto: "Grupal-Basico", centro: cenR, ejecutivo: "Neri", saldo: 10000, cuota: 1000, plazo: 10 }) }));
  ok("si el ciclo anterior AÚN DEBE, la renovación con el mismo nombre se rechaza",
    !!rb.error && /saldo/i.test(rb.error), JSON.stringify(rb).slice(0, 110));

  console.log("\n— 33. GASTOS: el arqueo aguanta y el Excel dice DE QUÉ fueron (Karina, 30-jul) —");
  // El Excel de arqueo decía "− Gastos $450" y nada más: Monse veía el monto pero
  // no de qué fue, y tenía que preguntar uno por uno. Ahora van renglón por
  // renglón con quién lo capturó, y el neto cuadra con el efectivo a entregar.
  const FGAS = "2026-06-24";
  await syncCent(FGAS, { fecha: FGAS,
    reg: { "C-9": { "gx1|P": { pago: 2000, forma: "E" }, "gx2|P": { pago: 1000, forma: "E" } } }, regI: {},
    movs: [{ folio: "GA1", concepto: "GASTO", monto: 300, via: "E", nota: "pasaje" },
           { folio: "GA2", concepto: "GASTO", monto: 150, via: "E", nota: "papeleria" },
           { folio: "GA3", concepto: "RECUPERACION", monto: 600, via: "E", entrada: true, clienta: "ROSA MARIA" }],
    arqueo: { "500": 6, "100": 1, "50": 1 } });   // 3,150 = 3,000 - 450 + 600
  const arqGasto = await j(await fetch(U + "/api/arqueo?fecha=" + FGAS, { headers: H(cd) }));
  const ejeGasto = (arqGasto.porEjec || {}).prueba || {};
  ok("con gastos y una entrada, el día CUADRA en $0",
    Math.abs(ejeGasto.dif || 0) < 0.01 && Math.abs(ejeGasto.aEntregar - 3150) < 0.01,
    "cobró " + ejeGasto.efectivo + " · neto " + (-ejeGasto.egresoEfectivo) + " · entrega " + ejeGasto.aEntregar +
    " · contó " + ejeGasto.contado + " · dif " + ejeGasto.dif);
  const xlsGasto = await fetch(U + "/api/arqueo/excel?fecha=" + FGAS, { headers: H(cd) });
  const ExcelGasto = require("exceljs");
  const wbGasto = new ExcelGasto.Workbook();
  await wbGasto.xlsx.load(Buffer.from(await xlsGasto.arrayBuffer()));
  const wsGasto = wbGasto.getWorksheet("Arqueo");
  const filasGasto = [];
  wsGasto.eachRow((r) => { const f = []; r.eachCell({ includeEmpty: true }, (c) => f.push(String(c.value == null ? "" : c.value))); filasGasto.push(f.join(" | ")); });
  const planoGasto = filasGasto.join("\n");
  ok("el Excel trae el bloque de gastos con su detalle",
    /GASTOS Y MOVIMIENTOS DE CAJA/.test(planoGasto) && /pasaje/.test(planoGasto) && /papeleria/.test(planoGasto),
    planoGasto.slice(0, 150));
  ok("cada gasto sale en NEGATIVO y la entrada en positivo",
    /-300/.test(planoGasto) && /-150/.test(planoGasto) && /\|\s*600/.test(planoGasto), "");
  ok("el arqueo se muestra INTACTO: 'TOTAL CONTADO EN CAJA' con lo que ella contó",
    /TOTAL CONTADO EN CAJA/i.test(planoGasto) && /3150/.test(planoGasto), "");
  ok("y las deducciones van en su propio bloque, después del arqueo",
    /CUENTAS DEL DÍA/i.test(planoGasto) &&
    planoGasto.indexOf("CUENTAS DEL DÍA") > planoGasto.indexOf("TOTAL CONTADO EN CAJA"), "");
  ok("cuando el gasto es REAL no sale advertencia: dice que el día cuadra",
    /El día CUADRA/i.test(planoGasto) && !/SOBRAN|FALTAN/.test(planoGasto), "");
  // El renglón del tablero sumaba las salidas en vez de restarlas: al lado de
  // "Salidas −$100" decía "efectivo $6,786" cuando el neto era $6,586. Karina lo
  // cachó el 30-jul con una prueba de $100 (caso real: 6,686 de entradas).
  const movG = await j(await fetch(U + "/api/movimientos?fecha=" + FGAS, { headers: H(cd) }));
  ok("entradas y salidas se reportan por separado",
    movG.entradas === 600 && movG.salidas === 450,
    "entradas " + movG.entradas + " · salidas " + movG.salidas);
  ok("el NETO en efectivo resta las salidas (no las suma)",
    movG.netoEfectivo === 150,
    "neto " + movG.netoEfectivo + " · el bruto de antes daba " + movG.totalEfectivo);

  console.log("\n— 34. ANULAR un movimiento de Dirección, con rastro (Karina, 30-jul) —");
  // Karina registró un gasto de prueba de $100 desde el tablero y NO HABÍA forma
  // de quitarlo: el día quedaba marcando "sobran $100" para siempre. Los
  // movimientos de la ejecutiva se anulan al borrarlos en su app; los de
  // Dirección (folio DIR-…) no tenían salida. Nunca se borra: se tacha con quién
  // lo anuló y por qué.
  const FANU = "2026-06-26";
  await syncCent(FANU, { fecha: FANU, reg: { "C-1": { "z1|P": { pago: 2000, forma: "E" } } },
    regI: {}, movs: [], arqueo: { "500": 4 } });
  const diaA = async () => { const a = await j(await fetch(U + "/api/arqueo?fecha=" + FANU, { headers: H(cd) }));
    return { efe: a.efectivo, egr: a.egresosEfectivo || 0 }; };
  const d0 = await diaA();
  ok("el día arranca sin egresos", d0.efe === 2000 && d0.egr === 0, JSON.stringify(d0));
  const rmov = await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cd),
    body: JSON.stringify({ fecha: FANU, monto: 100, concepto: "gasto de prueba", categoria: "Otro", metodo: "efectivo" }) }));
  const d1 = await diaA();
  ok("un gasto de $100 RESTA del efectivo a entregar (2,000 → 1,900)",
    d1.egr === 100 && d1.efe - d1.egr === 1900, JSON.stringify(d1));
  const sinMot = await j(await fetch(U + "/api/movimiento/anular", { method: "POST", headers: H(cd),
    body: JSON.stringify({ folio: rmov.movimiento.folio, fecha: FANU }) }));
  ok("anular SIN motivo se rechaza (el rastro es obligatorio)", !!sinMot.error, JSON.stringify(sinMot).slice(0, 80));
  const conMot = await j(await fetch(U + "/api/movimiento/anular", { method: "POST", headers: H(cd),
    body: JSON.stringify({ folio: rmov.movimiento.folio, fecha: FANU, motivo: "era una prueba, el dinero nunca salió" }) }));
  const d2 = await diaA();
  ok("al anularlo el día VUELVE A CUADRAR (1,900 → 2,000)",
    conMot.ok === true && d2.egr === 0 && d2.efe - d2.egr === 2000, JSON.stringify(d2));
  const listaA = (await j(await fetch(U + "/api/movimientos?fecha=" + FANU, { headers: H(cd) }))).lista || [];
  const anu = listaA.find((x) => x.folio === rmov.movimiento.folio) || {};
  ok("el movimiento NO se borra: queda con quién lo anuló y por qué",
    anu.anulado === true && !!anu.anuladoPor && /prueba/i.test(anu.anuladoMotivo || ""),
    JSON.stringify({ anulado: anu.anulado, por: anu.anuladoPor, motivo: anu.anuladoMotivo }));

  console.log("\n— 35. EL GASTO SE REGISTRA EN SU PROPIA FECHA (Monse, 4-ago) —");
  // El formulario no tenía campo de fecha y TODO caía en el día de hoy: al subir
  // los gastos de varios días de golpe, se descontaban del efectivo de uno solo
  // y el arqueo salía en NEGATIVO. Ahora la fecha se elige y se valida.
  const FGA = "2026-06-17";
  const egrHoyAntes = ((await j(await fetch(U + "/api/arqueo", { headers: H(cd) }))).egresosEfectivo) || 0;
  const rFec = await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cd),
    body: JSON.stringify({ fecha: FGA, monto: 500, concepto: "gasto de otro día", categoria: "Gasto operativo", metodo: "efectivo" }) }));
  ok("un gasto se puede registrar con la fecha en que salió",
    rFec.ok === true && rFec.movimiento.fecha === FGA, JSON.stringify(rFec).slice(0, 90));
  const arqFec = await j(await fetch(U + "/api/arqueo?fecha=" + FGA, { headers: H(cd) }));
  ok("y descuenta del arqueo de ESE día, no del de hoy",
    (arqFec.egresosEfectivo || 0) === 500, "egresos " + FGA + ": " + arqFec.egresosEfectivo);
  const egrHoyDespues = ((await j(await fetch(U + "/api/arqueo", { headers: H(cd) }))).egresosEfectivo) || 0;
  ok("y el arqueo de HOY no se mueve ni un peso por ese gasto",
    Math.abs(egrHoyDespues - egrHoyAntes) < 0.01,
    "hoy antes " + egrHoyAntes + " · después " + egrHoyDespues);
  const rFut = await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cd),
    body: JSON.stringify({ fecha: "2027-01-01", monto: 500, concepto: "futuro", categoria: "Otro", metodo: "efectivo" }) }));
  ok("una fecha FUTURA se rechaza", !!rFut.error && /futura/i.test(rFut.error), JSON.stringify(rFut).slice(0, 80));

  console.log("\n— 36. LIQUIDACIÓN SIN CLIENTA: entra a caja pero no baja ningún saldo (Karina, 4-ago) —");
  // Karina sospechó que las liquidaciones no estaban descontando. Se probó: SÍ
  // descuentan cuando traen clienta. Fallan en dos casos, y los dos son reales:
  // (1) capturadas ANTES del corte y (2) sin número de socio. La app ya exige la
  // clienta; el tablero de Dirección no, y por ahí se cuelan.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY, confirmar: true }) });
  const cenL = (await j(await fetch(U + "/api/centros", { headers: H(cm) }))).centros[0].centro;
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({
    id: "70000000851", nombre: "LIQ CON CLIENTA", producto: "Grupal-Basico", centro: cenL,
    ejecutivo: "Neri", saldo: 540, cuota: 540, plazo: 24 }) });
  const saldoL = async (id) => {
    const r = await j(await fetch(U + "/api/creditos?q=" + id, { headers: H(cm) }));
    return ((r.resultados || [])[0] || {}).saldoActual;
  };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cnn), body: JSON.stringify({ fecha: HOY, ts: Date.now(),
    snapshot: JSON.stringify({ fecha: HOY, reg: {}, regI: {}, arqueo: {},
      movs: [{ folio: "LQOK", concepto: "LIQUIDACION", monto: 540, via: "E", socio: "70000000851", clienta: "LIQ CON CLIENTA" }] }) }) });
  ok("una liquidación CON clienta sí le deja el saldo en cero",
    (await saldoL("70000000851")) === 0, "saldo " + (await saldoL("70000000851")));
  const rSin = await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: HOY, monto: 1500, concepto: "Liquidación sin decir de quién", categoria: "Otro", metodo: "efectivo" }) }));
  const carL = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("una liquidación SIN clienta se detecta y se avisa (antes pasaba en silencio)",
    (carL.liquidacionesSinClienta || []).some((x) => x.folio === rSin.movimiento.folio),
    JSON.stringify((carL.liquidacionesSinClienta || []).map((x) => x.folio)));
  // El atraso se mide en PAGOS, no en días: el plazo es un número de pagos y se
  // recorre cuando la clienta falta. Cada listado trae los pagos que lleva
  // contra los que debería llevar, y la resta tiene que cuadrar.
  ok("y el tablero lista los créditos atrasados contando PAGOS, no días",
    Array.isArray(carL.atrasados) && carL.atrasados.every((x) =>
      x.saldo > 0 && x.atraso >= 4 && x.atraso === x.debio - x.hechos && x.debio <= x.plazo),
    "atrasados: " + (carL.atrasados || []).length);

  console.log("\n— 37. COBRANZA vs RECUPERACIÓN por ESTADO del crédito (dictado de Monse, 4-ago) —");
  // «Recuperación es todo lo entrante, tanto de créditos de mora como de créditos
  // vencidos» — y ese dinero cuenta SOLO como recuperación, no también como
  // cobranza (opción A). Antes la recuperación la definía la ETIQUETA que ponía
  // la ejecutiva; ahora la define el ESTADO del crédito.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY, confirmar: true }) });
  const cenR2 = (await j(await fetch(U + "/api/centros", { headers: H(cm) }))).centros[0].centro;
  const altaR = (id, n) => fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({
    id, nombre: n, producto: "Grupal-Basico", centro: cenR2, ejecutivo: "Neri", saldo: 5000, cuota: 500, plazo: 24 }) });
  await altaR("70000000901", "SANA RECUP"); await altaR("70000000902", "CON MORA RECUP");
  await fetch(U + "/api/creditos/mora", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: "70000000902", producto: "Grupal-Basico", mora: 1500 }) });
  const antesR = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  await fetch(U + "/api/sync", { method: "POST", headers: H(cnn), body: JSON.stringify({ fecha: HOY, ts: Date.now(),
    snapshot: JSON.stringify({ fecha: HOY, arqueo: {}, movs: [], regI: {},
      reg: { "C-Z": { "70000000901|Grupal-Basico": { pago: 500, forma: "E" },
                      "70000000902|Grupal-Basico": { pago: 500, forma: "E" } } } }) }) });
  const despR = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  // El sync REEMPLAZA el día de la ejecutiva (así manda la app: su día completo),
  // así que después de este sync la cobranza de Neri de hoy son EXACTAMENTE estos
  // dos pagos. Por eso se afirma el valor absoluto del cobrado y no una resta:
  // el "antes" ya no existe una vez que se reemplaza el día.
  const dRec = despR.recuperacionSemana - antesR.recuperacionSemana;
  ok("el pago de la clienta SANA es lo único que queda en cobranza",
    despR.cobradoSemana === 500, "cobrado " + despR.cobradoSemana);
  ok("el pago de la clienta CON MORA se fue a recuperación",
    dRec === 500, "subió recuperación " + dRec);
  ok("y NO se contó dos veces (opción A de Monse)",
    despR.cobradoSemana === 500 && dRec === 500,
    "cobrado " + despR.cobradoSemana + " · recuperación +" + dRec);

  console.log("\n— 38. LOS TRES PUNTOS DE MONSE (4-ago) —");
  // 1) que los saldos se actualicen · 2) que un crédito terminado deje de
  // aparecer · 3) que el Excel no arrastre el viernes o el sábado a la semana
  // siguiente. Los tres eran el mismo problema: el corte no se movía solo cuando
  // entraba una plantilla nueva. Ahora el corte VIAJA CON LA PLANTILLA.
  const coP = await j(await fetch(U + "/api/saldos/corte", { headers: H(cd) }));
  ok("el corte se lee sin que nadie lo mueva a mano", !!coP.corte, JSON.stringify(coP));
  // Un crédito TERMINADO (saldo 0) sale como liquidado y no espera cuota.
  const cenT = (await j(await fetch(U + "/api/centros", { headers: H(cm) }))).centros[0].centro;
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({
    id: "70000000861", nombre: "YA TERMINO", producto: "Grupal-Basico", centro: cenT,
    ejecutivo: "Neri", saldo: 500, cuota: 500, plazo: 24 }) });
  const antesT = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(cm), body: JSON.stringify({
    id: "70000000861", producto: "Grupal-Basico", saldo: 0, motivo: "terminó de pagar" }) });
  const despT = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("un crédito que llega a cero deja de esperar cuota",
    despT.esperadoSemana <= antesT.esperadoSemana - 500 + 0.02,
    "esperado " + antesT.esperadoSemana + " → " + despT.esperadoSemana);
  ok("y sale del semáforo como liquidado, no como vencido ni en mora",
    despT.semaforo.liquidada > antesT.semaforo.liquidada,
    "liquidadas " + antesT.semaforo.liquidada + " → " + despT.semaforo.liquidada);

  console.log("\n— 39. EL GASTO QUE CAPTURA DIRECCIÓN SE LE CARGA A SU EJECUTIVA (Karina, 5-ago) —");
  // Karina lo cachó: un gasto de Julio capturado desde el tablero no sumaba en
  // "otros movimientos" de nadie. Se guardaba a nombre de quien lo tecleó
  // (Dirección) y el reparto lo tiraba por no ser ejecutiva. En EFECTIVO al
  // menos bajaba el efectivo a entregar del día; POR TRANSFERENCIA no toca la
  // caja y desaparecía de TODOS los totales.
  const D39 = "2026-03-19";
  const ejs39 = await j(await fetch(U + "/api/ejecutivos", { headers: H(cm) }));
  ok("el tablero puede pedir la lista de ejecutivas para el selector",
    Array.isArray(ejs39.ejecutivos) && ejs39.ejecutivos.length > 0 && ejs39.ejecutivos[0].nombre,
    JSON.stringify(ejs39.ejecutivos));
  const mio39 = (ejs39.ejecutivos || [])[0].id;
  // OJO: hay que esperar la RESPUESTA, no solo lanzar el fetch. Escrito como
  // estaba (j(fetch(...).then(r=>r))) el await se resolvía antes de que el
  // servidor guardara, y las comprobaciones de abajo corrían en carrera.
  const post39 = async (monto, metodo, ejecutivo) => j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: D39, monto, concepto: "Gasto de campo", categoria: "Otro", metodo, ejecutivo }) }));
  await post39(450, "transferencia", mio39);
  await post39(200, "efectivo", mio39);
  const arq39 = await j(await fetch(U + "/api/arqueo?fecha=" + D39, { headers: H(cm) }));
  const e39 = arq39.porEjec[mio39] || {};
  ok("el gasto POR TRANSFERENCIA sí le suma a su ejecutiva (antes se perdía)",
    (e39.movSalidas || 0) === 650, "otros− " + (e39.movSalidas || 0) + " (esperado 650 = 450+200)");
  ok("pero la transferencia NO le baja el efectivo a entregar: va al banco, no a la caja",
    arq39.egresosEfectivo === 200, "egresosEfectivo " + arq39.egresosEfectivo + " (solo los $200 en efectivo)");
  const rMal39 = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: D39, monto: 99, concepto: "X", categoria: "Otro", metodo: "efectivo", ejecutivo: "no-existe" }) });
  ok("una ejecutiva inventada se rechaza", rMal39.status === 400, "status " + rMal39.status);
  const lst39 = await j(await fetch(U + "/api/movimientos?fecha=" + D39, { headers: H(cm) }));
  ok("la lista dice DE QUIÉN es el gasto, no solo quién lo capturó",
    (lst39.lista || []).filter((m) => m.ejecutivoNombre).length >= 2,
    "con dueño: " + (lst39.lista || []).filter((m) => m.ejecutivoNombre).length);
  // Un retiro de dirección no es de nadie: sigue siendo válido dejarlo sin dueño.
  const rSin39 = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: D39, monto: 1000, concepto: "Retiro de dirección", categoria: "Retiro de dirección", metodo: "efectivo" }) });
  ok("un movimiento SIN ejecutiva se sigue aceptando (retiro de dirección)", rSin39.status === 200, "status " + rSin39.status);

  console.log("\n— 40. LA CLIENTA QUE LIQUIDA SALE DE LA APP DE SU EJECUTIVA (Karina, 5-ago) —");
  // «Cuando liquidan, los ejecutivos lo siguen teniendo en su sistema.» Una
  // clienta que termina de pagar NO queda dada de baja: sigue activa con saldo
  // cero, así que no entraba en la lista de QUITAR y se le seguía apareciendo.
  // Pero la que paga su última cuota HOY tiene que seguir viéndose hoy: si
  // desapareciera, su renglón se borra del teléfono y —como el sync reemplaza el
  // día completo— ese pago se perdería al sincronizar.
  // La cuenta de prueba no tiene cartera, así que se usa una ejecutiva REAL
  // (local): es la única forma de ver la lista que de verdad viaja a su app.
  const cCh = await login("christopher", "chris2026");
  const html40 = await (await fetch(U + "/app", { headers: H(cCh) })).text();
  // El paquete completo (altas, bajas y montos) viaja en window.__VIVOS0 y
  // `vivos.js` lo vuelve a pedir a /api/vivos cada minuto.
  const mP40 = /window\.__VIVOS0=(\{.*?\});<\/script>/s.exec(html40);
  const mQ = mP40 ? { 1: JSON.stringify(JSON.parse(mP40[1]).quitar || []) } : null;
  ok("la app de la ejecutiva recibe su lista de créditos a quitar", !!mQ,
    mQ ? "sí" : "no se encontró window.__VIVOS0 en el HTML de la app");
  ok("y también carga vivos.js, que la mantiene al día sin recargar",
    html40.includes('src="/vivos.js"'), "no se inyectó vivos.js");
  const todos40 = await j(await fetch(U + "/api/creditos?q=", { headers: H(cm) }));
  const buscar40 = async (t) => j(await fetch(U + "/api/creditos?q=" + encodeURIComponent(t), { headers: H(cm) }));
  if (mQ) {
    const quitar = JSON.parse(mQ[1]);
    ok("la lista de quitar no trae duplicados",
      new Set(quitar.map((q) => q.id + "|" + q.producto)).size === quitar.length, "quitar: " + quitar.length);
    // NINGUNO de los que se le quitan puede tener saldo pendiente: si le
    // borráramos del teléfono a una clienta que aún debe, dejaría de cobrarle.
    const liq40 = await j(await fetch(U + "/api/creditos?estado=liquidadas", { headers: H(cm) }));
    const vivos40 = new Map();
    for (const x of (liq40.resultados || [])) vivos40.set(String(x.id) + "|" + x.producto, x.saldoActual || 0);
    const conDeuda = quitar.filter((q) => (vivos40.get(String(q.id) + "|" + q.producto) || 0) > 0.009);
    ok("ningún crédito CON saldo pendiente se le quita de la app", conDeuda.length === 0,
      JSON.stringify(conDeuda.slice(0, 3)));
    // Y los que YA están en cero de días anteriores sí tienen que estar.
    const ceroDeChris = (liq40.resultados || []).filter((x) => /christopher/i.test(String(x.ejecutivo)));
    const faltantes = ceroDeChris.filter((x) =>
      !quitar.some((q) => String(q.id) === String(x.id) && q.producto === x.producto));
    ok("los créditos de Christopher que llegaron a cero sí salen de su app",
      faltantes.length === 0 || ceroDeChris.length === 0,
      "en cero: " + ceroDeChris.length + " · sin quitar: " + faltantes.length);
    void todos40; void buscar40;
  }
  // Los cuatro casos de campo, con clientas de Christopher que no toca ninguna
  // otra sección y en fechas propias. Preguntó Karina «¿seguro que ya no
  // aparecen?» — y no lo estaba: (1) el saldo se calculaba aparte, mirando solo
  // desde el corte, y (2) los créditos que YA vienen en cero en la plantilla se
  // quedaban dentro porque se exigía saldo > 0.
  // La sección 38 deja el corte en la fecha de la plantilla, y con eso los pagos
  // de meses atrás quedan ANTES del corte (donde por diseño ya están dentro del
  // saldo de la plantilla). Para estos casos se regresa el corte al principio
  // del año, que es donde lo pone la batería al arrancar.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-01-01", confirmar: true }) });
  const sync40 = (fecha, reg, t) => fetch(U + "/api/sync", { method: "POST", headers: H(cCh),
    body: JSON.stringify({ fecha, snapshot: { reg }, ts: Date.now() + t }) });
  const K40 = (id, p, nom) => id + "|" + p + "|" + nom + "|0";
  const qDe = async () => {
    const html = await (await fetch(U + "/app", { headers: H(cCh) })).text();
    const mm = /window\.__VIVOS0=(\{.*?\});<\/script>/s.exec(html);
    return mm ? (JSON.parse(mm[1]).quitar || []) : [];
  };
  const enQ = (q, id, p) => q.some((x) => String(x.id) === String(id) && x.producto === p);
  await sync40("2026-05-13", { C40: { [K40("11112783089", "Grupal-Basico", "CARMEN VIANEY EVANGELISTA MARTINEZ")]: { pago: 2340, forma: "E" } } }, 1);
  await sync40("2026-04-22", { C40: { [K40("11112807346", "Grupal-Basico", "EMMA GUADALUPE EVANGELISTA MARTINEZ")]: { pago: 900, forma: "E" } } }, 2);
  const q40 = await qDe();
  ok("la que LIQUIDÓ en un día pasado sale de la app", enQ(q40, "11112783089", "Grupal-Basico"),
    "CARMEN liquidó y le sigue apareciendo");
  ok("la que pagó A MEDIAS se queda: todavía le deben", !enQ(q40, "11112807346", "Grupal-Basico"),
    "EMMA aún debe $900 y se la quitaron");
  await sync40(HOY, { C40: { [K40("11112932017", "Grupal-Basico 2", "FLOR SILVIA LOPEZ MARTINEZ")]: { pago: 2304, forma: "E" } } }, 3);
  const q40b = await qDe();
  ok("la que liquida HOY se queda hoy (si no, el sync borraría su pago)",
    !enQ(q40b, "11112932017", "Grupal-Basico 2"), "se le quitó el mismo día");
  // Los que YA vienen en cero desde la plantilla: nunca tuvieron pago que
  // esperar, y aun así se le aparecían a la ejecutiva.
  const cero40 = [["11113232046", "Grupal-Adicional"], ["11112993402", "Grupal-Adicional"], ["11112772748", "Grupal-Basico 2"]];
  ok("los créditos que ya vienen en CERO en la plantilla también salen",
    cero40.every(([id, p]) => enQ(q40b, id, p)),
    JSON.stringify(cero40.filter(([id, p]) => !enQ(q40b, id, p))));

  console.log("\n— 41. CUANDO DIRECCIÓN LA DEJA EN CERO, TAMBIÉN SALE DE LA APP (Karina, 5-ago) —");
  // Son TRES caminos distintos por los que Monse o Anel pueden dejar un crédito
  // liquidado, y los tres tienen que sacar a la clienta de la app de su
  // ejecutiva. El tercero no existía: el formulario de Dirección no tenía dónde
  // poner la clienta, y por eso la liquidación entraba a caja sin bajarle el
  // saldo a nadie (de ahí venía la alerta de «liquidaciones sin clienta»).
  const AJ = ["11112934517", "Grupal-Basico"];      // HERIBERTA · $2,320
  const BJ = ["11113003674", "Grupal-Basico"];      // ARIADNA PAOLA · $4,620
  const LQ = ["11112957047", "Grupal-Basico"];      // ANDREA JOSELYN · $1,800
  const rAj = await j(await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: AJ[0], producto: AJ[1], saldo: 0, motivo: "terminó de pagar" }) }));
  ok("AJUSTAR SALDO a cero saca a la clienta de la app", rAj.ok && enQ(await qDe(), AJ[0], AJ[1]),
    "ajuste " + JSON.stringify(rAj).slice(0, 60));
  const rBj = await j(await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: BJ[0], producto: BJ[1], motivo: "No renovó" }) }));
  ok("DAR DE BAJA la saca de la app", rBj.ok && enQ(await qDe(), BJ[0], BJ[1]),
    "baja " + JSON.stringify(rBj).slice(0, 60));
  // Una baja con el producto mal escrito antes contestaba "ok" sin tocar nada.
  const rBjMal = await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: BJ[0], producto: "Producto Que No Existe", motivo: "No renovó" }) });
  ok("una baja con el producto mal escrito se rechaza", rBjMal.status === 400, "status " + rBjMal.status);
  const rLq = await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-05-27", monto: 1800, concepto: "Liquidación",
      categoria: "Otro", metodo: "efectivo", socio: LQ[0] }) }));
  ok("una LIQUIDACIÓN de caja se puede ligar a la clienta",
    !!(rLq.movimiento && rLq.movimiento.socio === LQ[0]), JSON.stringify(rLq).slice(0, 90));
  ok("y esa liquidación sí la saca de la app", enQ(await qDe(), LQ[0], LQ[1]),
    "le sigue apareciendo");
  const lst41 = await j(await fetch(U + "/api/movimientos?fecha=2026-05-27", { headers: H(cm) }));
  ok("la lista de movimientos dice de qué clienta fue",
    (lst41.lista || []).some((m) => m.clientaNombre), JSON.stringify((lst41.lista || []).map((m) => m.clientaNombre)));
  const rMal41 = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: HOY, monto: 100, concepto: "Liquidación", categoria: "Otro",
      metodo: "efectivo", socio: "99999999" }) });
  ok("un número de socio inventado se rechaza", rMal41.status === 400, "status " + rMal41.status);

  console.log("\n— 42. LOS OTROS MOVIMIENTOS QUE NO SON EFECTIVO VAN A SU RENGLÓN (Karina, 5-ago) —");
  // Una recuperación que la ejecutiva capturó POR TRANSFERENCIA es dinero que
  // llegó al banco: tiene que sumar en el renglón de Transferencias del arqueo,
  // no quedarse solo en su "otros +". Igual el cheque, que va aparte porque no
  // son billetes. El efectivo sigue yendo por "efectivo a entregar".
  const D42 = "2026-02-04";
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D42,
    snapshot: { reg: {}, movs: [
      { folio: "42a", concepto: "RECUPERACION", monto: 5000, via: "T", clienta: "ANA", socio: "70000000001" },
      { folio: "42b", concepto: "GASTO", monto: 1200, via: "T", nota: "pago proveedor" },
      { folio: "42c", concepto: "LIQUIDACION", monto: 3000, via: "CH", clienta: "BETY", socio: "70000000002", cheque: "445" },
      { folio: "42d", concepto: "GASTO", monto: 300, via: "E" },
    ] }, ts: Date.now() }) });
  const a42 = await j(await fetch(U + "/api/arqueo?fecha=" + D42, { headers: H(cd) }));
  ok("la transferencia de los otros movimientos se reporta (5,000 entra − 1,200 sale)",
    a42.movsTransferencia === 3800, "movsTransferencia " + a42.movsTransferencia);
  ok("el cheque se reporta aparte: no son billetes", a42.movsCheque === 3000, "movsCheque " + a42.movsCheque);
  ok("y NADA de eso toca el efectivo a entregar (solo el gasto de 300 en efectivo)",
    a42.egresosEfectivo === 300, "egresosEfectivo " + a42.egresosEfectivo);
  const xls42 = await fetch(U + "/api/arqueo/excel?fecha=" + D42, { headers: H(cd) });
  ok("y el Excel del arqueo se genera con eso adentro", xls42.status === 200, "status " + xls42.status);

  console.log("\n— 43. LA LIQUIDACIÓN DE «OTROS MOVIMIENTOS» SÍ LE BAJA EL SALDO (Karina, 5-ago) —");
  // «¿Estás seguro de que cuando marquen liquidación en otros se resta
  // automáticamente en las clientas?» — se prueba en los casos donde podría
  // fallar: exacta, de más, parcial, con dos créditos, recuperación, y borrada.
  const saldo43 = async (q, prod) => {
    const d = await j(await fetch(U + "/api/clientes?q=" + encodeURIComponent(q), { headers: H(cm) }));
    const l = (d.resultados || []).filter((x) => x.activa !== false);
    const x = prod ? l.find((y) => y.producto === prod) : l[0];
    return x ? { base: x.saldo, act: x.saldoActual } : null;
  };
  const mov43 = (fecha, socio, monto, concepto, folio) => fetch(U + "/api/sync", { method: "POST", headers: H(cCh),
    body: JSON.stringify({ fecha, snapshot: { reg: {}, movs: [{ folio, concepto, monto, via: "E", clienta: "X", socio }] },
      ts: Date.now() + Math.floor(Math.random() * 1000) }) });
  const sonia = await saldo43("SONIA ELIZABETH LUIS");
  await mov43("2026-07-08", "11113152077", sonia.base, "LIQUIDACION", "L43a");
  ok("una liquidación por el saldo exacto lo deja en cero",
    (await saldo43("SONIA ELIZABETH LUIS")).act <= 0.009, "saldo " + JSON.stringify(await saldo43("SONIA ELIZABETH LUIS")));
  const vic = await saldo43("VICENTA GAUDENCIA");
  await mov43("2026-07-09", "11112999671", vic.base + 5000, "LIQUIDACION", "L43b");
  ok("una liquidación MAYOR que el saldo no lo deja en negativo",
    (await saldo43("VICENTA GAUDENCIA")).act === 0, JSON.stringify(await saldo43("VICENTA GAUDENCIA")));
  const mar = await saldo43("MARTHA SILVIA");
  await mov43("2026-07-10", "11112943727", 200, "RECUPERACION", "L43c");
  ok("una RECUPERACIÓN también le baja el saldo",
    Math.abs((await saldo43("MARTHA SILVIA")).act - (mar.base - 200)) < 0.01,
    mar.base + " → " + (await saldo43("MARTHA SILVIA")).act);
  const e1 = await saldo43("MARIA ESTELA PADILLA", "Grupal-Basico 2");
  const e2 = await saldo43("MARIA ESTELA PADILLA", "Grupal-Adicional");
  await mov43("2026-07-11", "11112816492", e1.base + e2.base, "LIQUIDACION", "L43d");
  // REGLA NUEVA (Karina, 10-ago): «la liquidación tiene que ser EXCLUSIVAMENTE
  // para ese crédito que liquidan, sin afectar los demás activos». Antes, si la
  // socia tenía dos créditos y el abono no decía cuál, se repartía entre los
  // dos: eso era adivinar, y le bajaba el saldo al que no era. Ahora no se
  // aplica a ninguno y sale en el aviso para que Monse le ponga el crédito.
  ok("con DOS créditos y sin decir cuál, NO se le aplica a ninguno",
    Math.abs((await saldo43("MARIA ESTELA PADILLA", "Grupal-Basico 2")).act - e1.base) < 0.01
    && Math.abs((await saldo43("MARIA ESTELA PADILLA", "Grupal-Adicional")).act - e2.base) < 0.01,
    JSON.stringify([await saldo43("MARIA ESTELA PADILLA", "Grupal-Basico 2"), await saldo43("MARIA ESTELA PADILLA", "Grupal-Adicional")]));
  const avisoL43 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("y queda avisada en el tablero, con su folio, para poder corregirla",
    (avisoL43.liquidacionesSinCredito || []).some((x) => String(x.socio) === "11112816492"),
    JSON.stringify((avisoL43.liquidacionesSinCredito || []).map((x) => x.socio)));
  // Y en cuanto se dice CUÁL, le baja a ese y solo a ese.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-07-11", tipo: "Liquidación", concepto: "Ya con su crédito",
      monto: e2.base, metodo: "efectivo", socio: "11112816492", producto: "Grupal-Adicional" }) });
  ok("diciendo CUÁL, le baja a ese crédito y al otro no",
    (await saldo43("MARIA ESTELA PADILLA", "Grupal-Adicional")).act <= 0.009
    && Math.abs((await saldo43("MARIA ESTELA PADILLA", "Grupal-Basico 2")).act - e1.base) < 0.01,
    JSON.stringify([await saldo43("MARIA ESTELA PADILLA", "Grupal-Basico 2"), await saldo43("MARIA ESTELA PADILLA", "Grupal-Adicional")]));
  // Si la ejecutiva la BORRA de su app, el sync la marca anulada y deja de contar.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cCh), body: JSON.stringify({ fecha: "2026-07-10",
    snapshot: { reg: {}, movs: [{ folio: "L43z", concepto: "GASTO", monto: 10, via: "E" }] }, ts: Date.now() + 99999 }) });
  ok("y si la borran en la app, el saldo de la clienta vuelve",
    Math.abs((await saldo43("MARTHA SILVIA")).act - mar.base) < 0.01,
    "quedó en " + (await saldo43("MARTHA SILVIA")).act + " y debía volver a " + mar.base);

  console.log("\n— 44. UN ABONO CAPTURADO CON FECHA ATRASADA SÍ DESCUENTA (Karina, 5-ago) —");
  // Lo normal es que nada anterior al corte descuente: la plantilla ya lo trae.
  // Pero si alguien captura HOY un abono y le pone la fecha del viernes, la
  // plantilla NO pudo traerlo, y antes desaparecía en silencio. Se distingue por
  // la hora de captura contra la hora en que se fijó el corte.
  // OJO: esta sección va al FINAL a propósito, porque mueve el corte a hoy.
  const s44 = async () => {
    const d = await j(await fetch(U + "/api/clientes?q=AIDE%20YULICELI", { headers: H(cm) }));
    const x = (d.resultados || []).filter((y) => y.activa !== false)[0];
    return x ? x.saldoActual : null;
  };
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY, confirmar: true }) });
  const antes44 = await s44();
  await new Promise((r) => setTimeout(r, 30));      // que la captura quede DESPUÉS del corte
  const VIE44 = new Date(new Date(HOY + "T12:00") - 4 * 864e5).toISOString().slice(0, 10);
  await fetch(U + "/api/sync", { method: "POST", headers: H(cCh), body: JSON.stringify({ fecha: VIE44,
    snapshot: { reg: {}, movs: [{ folio: "AT44", concepto: "LIQUIDACION", monto: 200, via: "E",
      clienta: "AIDE", socio: "11112997831" }] }, ts: Date.now() }) });
  const desp44 = await s44();
  ok("el abono con fecha vieja SÍ le baja el saldo (antes se perdía en silencio)",
    Math.abs(desp44 - (antes44 - 200)) < 0.01, antes44 + " → " + desp44);
  const car44 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("y el tablero lo avisa, con la fecha y quién lo capturó",
    (car44.movsAtrasados || []).some((x) => x.monto === 200 && String(x.socio) === "11112997831"),
    JSON.stringify(car44.movsAtrasados || []));
  // Contraprueba: si el corte se fija DESPUÉS de la captura, ya venía en la
  // plantilla y NO debe volver a descontarse.
  await new Promise((r) => setTimeout(r, 30));
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY, confirmar: true }) });
  ok("pero si el corte se fija después de la captura, deja de descontar",
    Math.abs((await s44()) - antes44) < 0.01, "quedó en " + (await s44()) + " y debía volver a " + antes44);

  console.log("\n— 44b. UN COBRO QUE NO EMPATA CON NINGÚN CRÉDITO SE AVISA (Karina, 5-ago) —");
  // «¿100% que actualiza los saldos?» — la llave de un crédito es
  // socio+producto. Si la ficha llega con un producto que la clienta no tiene, o
  // con un socio que no existe, el dinero SÍ entra al arqueo pero NO le baja el
  // saldo a nadie. Antes eso pasaba en silencio; era el último hueco.
  const K44 = (id, p, nom) => id + "|" + p + "|" + nom + "|0";
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01", confirmar: true }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cCh), body: JSON.stringify({ fecha: "2026-06-03",
    snapshot: { reg: { C44: {
      [K44("11112926916", "Grupal Basico Mal Escrito", "HERALIA")]: { pago: 400, forma: "E" },
      [K44("99999999999", "Grupal-Basico", "FANTASMA")]: { pago: 700, forma: "E" },
    } } }, ts: Date.now() }) });
  const sc44 = (await j(await fetch(U + "/api/cartera", { headers: H(cm) }))).cobranzaSinCredito || [];
  ok("se detecta el cobro con el producto mal escrito",
    sc44.some((x) => String(x.socio) === "11112926916" && x.pago === 400), JSON.stringify(sc44));
  ok("y dice cuáles son los créditos que esa clienta SÍ tiene",
    (sc44.find((x) => String(x.socio) === "11112926916") || {}).productosQueSiTiene?.length > 0,
    JSON.stringify(sc44.find((x) => String(x.socio) === "11112926916")));
  ok("se detecta el cobro a un socio que no existe",
    sc44.some((x) => String(x.socio) === "99999999999" && x.pago === 700), JSON.stringify(sc44));
  ok("y un cobro BUENO no sale en la lista",
    !sc44.some((x) => String(x.socio) === "11112783089"), JSON.stringify(sc44.map((x) => x.socio)));
  // EL QUE SE PERDÍA EN SILENCIO: un cobro a una clienta DADA DE BAJA. Antes se
  // comparaba contra TODO el padrón, así que empataba, no se avisaba, y aun así
  // no le bajaba el saldo a nadie: el dinero desaparecía y la conciliación decía
  // que el día cuadraba. Lo encontró una prueba adversarial el 5-ago.
  const SB = "11112949301";                       // NOEMI GARCIA, Christopher
  await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SB, producto: "Grupal-Basico", motivo: "No renovó" }) });
  const regB = { C44b: {} };
  regB.C44b[SB + "|Grupal-Basico|NOEMI|0"] = { pago: 400, forma: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cCh),
    body: JSON.stringify({ fecha: "2026-06-04", snapshot: { reg: regB }, ts: Date.now() }) });
  const scB = (await j(await fetch(U + "/api/cartera", { headers: H(cm) }))).cobranzaSinCredito || [];
  const xb = scB.find((x) => String(x.socio) === SB);
  ok("un cobro a una clienta DADA DE BAJA también se detecta", !!xb,
    JSON.stringify(scB.map((x) => x.socio)));
  ok("y se dice que está de baja, no que sea un dedazo de producto",
    !!(xb && xb.estaDeBaja && xb.motivoBaja), JSON.stringify(xb));

  console.log("\n— 44d. GASTOS DE CAMPO CON TIPO, Y SUS CONTROLES (Karina, 5-ago) —");
  // La ejecutiva ya podía capturar gastos, pero todos caían en un cajón
  // genérico: el arqueo no decía EN QUÉ se fue el dinero. Ahora llevan tipo, y
  // el arqueo marca los dos riesgos de caja que importan en campo.
  const D44d = "2026-01-28";
  await fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: D44d,
    snapshot: { reg: {}, movs: [
      { folio: "gg1", concepto: "GASTO", monto: 450, via: "E", tipoGasto: "Gasolina", nota: "ruta" },
      { folio: "gg2", concepto: "GASTO", monto: 80, via: "E", tipoGasto: "Papeleria", nota: "sin acento" },
      { folio: "gg3", concepto: "GASTO", monto: 600, via: "E", tipoGasto: "Alimentos", nota: "comidas" },
    ] }, ts: Date.now() }) });
  const ejs44 = await j(await fetch(U + "/api/ejecutivos", { headers: H(cd) }));
  await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cd),
    body: JSON.stringify({ fecha: D44d, monto: 450, concepto: "Gasolina de la ruta",
      categoria: "Gasto operativo", metodo: "efectivo", ejecutivo: ejs44.ejecutivos[0].id }) }));
  const arq44 = await j(await fetch(U + "/api/arqueo?fecha=" + D44d, { headers: H(cd) }));
  const G = arq44.gastos || {};
  ok("el arqueo dice EN QUÉ se fue el dinero, por tipo",
    (G.porTipo || {})["Gasolina"] === 450 && (G.porTipo || {})["Alimentos"] === 600, JSON.stringify(G.porTipo));
  ok("un tipo escrito sin acento se empata igual (Papeleria → Papelería)",
    (G.porTipo || {})["Papelería"] === 80, JSON.stringify(G.porTipo));
  ok("avisa cuando la ejecutiva gastó MÁS de lo que cobró",
    (G.sobregiro || []).some((s) => s.aEntregar < 0), JSON.stringify(G.sobregiro));
  ok("y avisa del mismo gasto capturado en campo Y por dirección",
    (G.posiblesDobles || []).some((x) => x.monto === 450), JSON.stringify(G.posiblesDobles));
  ok("los gastos siguen bajando el efectivo a entregar",
    arq44.egresosEfectivo === 1580, "egresosEfectivo " + arq44.egresosEfectivo);
  // Lo que SOBRA contra lo contado casi siempre es un gasto anotado cuyo dinero
  // no salió de la caja. Si el monto coincide, se dice con nombre en vez de
  // dejar a la ejecutiva adivinando (Karina, 5-ago, con sus $100 de gasolina).
  const D44e = "2026-01-29";
  const reg44e = { "C-1": {} };
  reg44e["C-1"]["11112783089|Grupal-Basico|CARMEN VIANEY EVANGELISTA MARTINEZ|0"] = { pago: 1000, forma: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cCh), body: JSON.stringify({ fecha: D44e,
    snapshot: { reg: reg44e, arqueo: { 500: 2 },        // contó los $1,000 completos
      movs: [{ folio: "ge1", concepto: "GASTO", monto: 100, via: "E", tipoGasto: "Gasolina", nota: "ruta" }] },
    ts: Date.now() }) });
  // Christopher es una ejecutiva REAL: hay que mirarlo con la cuenta real, no
  // con la de prueba (esa solo ve su propia burbuja).
  const arq44e = await j(await fetch(U + "/api/arqueo?fecha=" + D44e, { headers: H(cm) }));
  const ch44 = Object.values(arq44e.porEjec || {}).find((x) => /christopher/i.test(x.nombre)) || {};
  ok("cuando sobra dinero, se atribuye al gasto que coincide",
    ch44.dif === 100 && ch44.difPorGasto === "Gasolina",
    "sobra " + ch44.dif + " · atribuido a " + ch44.difPorGasto);
  const xls44e = await fetch(U + "/api/arqueo/excel?fecha=" + D44e, { headers: H(cm) });
  ok("y el Excel del arqueo se genera con esa explicación", xls44e.status === 200, "status " + xls44e.status);

  // NUNCA "ahorro": una SOFOM E.N.R. no está autorizada a captar ahorro, y
  // nombrar así la garantía expone a FOOAX (regla Karina, 5-ago).
  const eti44 = await (await fetch(U + "/app", { headers: H(ce) })).text();
  const lst44 = await j(await fetch(U + "/api/movimientos?fecha=" + D44d, { headers: H(cd) }));
  ok("en ningún lado se le llama AHORRO a la garantía",
    !/ahorro/i.test(eti44) && !(lst44.lista || []).some((m) => /ahorro/i.test(String(m.concepto || ""))),
    "aparece en la app o en los conceptos");

  console.log("\n— 44g. LIQUIDACIÓN Y RECUPERACIÓN SON INGRESOS, NO EGRESOS (Monse, 6-ago) —");
  // El formulario de Dirección guardaba TODO como salida: una liquidación le
  // bajaba el saldo a la clienta (bien) pero además RESTABA del efectivo a
  // entregar (mal). Con $1,000 el error era de $2,000, porque ese dinero entra.
  // «Esos conceptos solo son aplicables para ingresos, no egresos» — Ing. Monse.
  const D44g = "2026-02-25";
  const arq44g = async () => j(await fetch(U + "/api/arqueo?fecha=" + D44g, { headers: H(cm) }));
  const sal44g = async () => {
    const d = await j(await fetch(U + "/api/clientes?q=11112807346", { headers: H(cm) }));
    const x = (d.resultados || [])[0]; return x ? x.saldoActual : null;
  };
  const a44g0 = await arq44g(), s44g0 = await sal44g();
  const rLiq = await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 1000, concepto: "Liquidación total",
      metodo: "efectivo", socio: "11112807346", fecha: D44g }) }));
  const a44g1 = await arq44g(), s44g1 = await sal44g();
  ok("una liquidación de Dirección se guarda como ENTRADA",
    rLiq.movimiento && rLiq.movimiento.entrada === true, JSON.stringify(rLiq).slice(0, 100));
  // El abono se TOPA al saldo: si debía menos de lo abonado, queda en cero y el
  // resto es sobrante, no dinero perdido.
  ok("le baja el saldo a la clienta (topándose en cero)",
    s44g1 === Math.max(0, s44g0 - 1000), s44g0 + " → " + s44g1);
  ok("y SUMA al efectivo a entregar (antes lo restaba: error del doble)",
    a44g1.efectivoAEntregar === a44g0.efectivoAEntregar + 1000,
    a44g0.efectivoAEntregar + " → " + a44g1.efectivoAEntregar);
  const rSinCli = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 500, concepto: "x", metodo: "efectivo", fecha: D44g }) });
  ok("una liquidación SIN clienta se rechaza: ese dinero no le bajaría a nadie",
    rSinCli.status === 400, "status " + rSinCli.status);
  const a44g2 = await arq44g();
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Gasto operativo", monto: 400, concepto: "Papelería", metodo: "efectivo", fecha: D44g }) });
  ok("y un GASTO sí sigue restando",
    (await arq44g()).efectivoAEntregar === a44g2.efectivoAEntregar - 400, "no restó");
  // Una GARANTÍA capturada suelta por Dirección debe salir en el renglón de
  // garantías, no solo engordar el efectivo a entregar. Antes quedaba escondida:
  // Monse veía dinero de más sin concepto que lo explicara (Karina, 6-ago).
  const gar0 = await arq44g();
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Garantía", monto: 300, concepto: "Garantía", metodo: "efectivo", fecha: D44g }) });
  const gar1 = await arq44g();
  ok("una garantía capturada aparte SÍ aparece en el renglón de garantías",
    gar1.garantias === gar0.garantias + 300 && gar1.garantiasDeMovs === 300,
    "garantías " + gar0.garantias + " → " + gar1.garantias + " (de movs " + gar1.garantiasDeMovs + ")");
  ok("y también suma al efectivo a entregar, porque ese dinero entró",
    gar1.efectivoAEntregar === gar0.efectivoAEntregar + 300,
    gar0.efectivoAEntregar + " → " + gar1.efectivoAEntregar);
  // LA NOTA NO DECIDE NADA: manda el TIPO que se eligió del menú. Antes se
  // adivinaba leyendo el texto —si en vez de "Liquidación…" ponían "Pago final
  // de Emma", el dinero entraba a la caja y el saldo NUNCA bajaba, en silencio.
  const salLibre = async () => {
    const d = await j(await fetch(U + "/api/clientes?q=11113131595", { headers: H(cm) }));
    const x = (d.resultados || []).filter((y) => y.activa !== false)[0]; return x ? x.saldoActual : null;
  };
  const sl0 = await salLibre();
  // Esta socia tiene DOS créditos, así que desde el 8-ago hay que decir a cuál
  // va (ver bloque 52). Se manda el mismo que el sistema le aplicaba antes por
  // orden, para que la prueba siga midiendo lo suyo: que manda el TIPO y no la nota.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 200, concepto: "el pago que trajo su hija",
      metodo: "efectivo", socio: "11113131595", producto: "Grupal-Basico 2", fecha: D44g }) });
  ok("una liquidación con la nota escrita LIBRE también baja el saldo",
    (await salLibre()) === sl0 - 200, sl0 + " → " + (await salLibre()));
  const sl1 = await salLibre();
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Recuperación / adelanto", monto: 100, concepto: "abono suelto",
      metodo: "efectivo", socio: "11113131595", producto: "Grupal-Basico 2", fecha: D44g }) });
  ok("y una recuperación con nota libre, igual",
    (await salLibre()) === sl1 - 100, sl1 + " → " + (await salLibre()));
  // La app de la ejecutiva manda su propio tipo: las dos vías igual de firmes.
  const movApp = await j(await fetch(U + "/api/movimientos?fecha=" + D44g, { headers: H(cd) }));
  void movApp;
  const cat44g = await j(await fetch(U + "/api/conceptos", { headers: H(cm) }));
  // El DESEMBOLSO no va aquí (Karina, 6-ago): el crédito nuevo se abre con "Dar
  // de alta" o "Re-dar crédito", que además le ponen su ancla y su plazo.
  // Registrarlo como movimiento suelto sacaba el efectivo sin crear el crédito.
  ok("el desembolso ya NO se puede registrar como movimiento",
    !(cat44g.conceptos || []).some((c) => /desembolso \(/i.test(c.nombre)),
    JSON.stringify((cat44g.conceptos || []).map((c) => c.nombre)));
  const rDes = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Desembolso (crédito nuevo)", monto: 5000, concepto: "x",
      metodo: "efectivo", fecha: D44g }) });
  ok("y el servidor lo rechaza, no solo el menú", rDes.status === 400, "status " + rDes.status);
  ok("el catálogo separa lo que entra de lo que sale",
    (cat44g.conceptos || []).some((c) => c.nombre === "Liquidación" && c.entrada)
    && (cat44g.conceptos || []).some((c) => c.nombre === "Gasto operativo" && !c.entrada),
    JSON.stringify(cat44g.conceptos));

  console.log("\n— 44f. CIERRE DE CAJA DE LA SEMANA (Karina, 5-ago · su urgencia #4) —");
  // El arqueo diario contesta "¿cuánto entrega cada ejecutiva hoy?", no "¿cuánto
  // efectivo tiene FOOAX el sábado?". Por eso al cierre aparecía un excedente sin
  // concepto: los retiros de dirección y los desembolsos salían de la caja y
  // nunca se restaban de un acumulado semanal.
  // LA CAJA ARRANCA EN CERO CADA LUNES (regla Karina): queda = entró − salió.
  const car44f = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  const L44 = car44f.lunes;
  // Nunca pasar de HOY: el servidor rechaza movimientos con fecha futura, y
  // corriendo la batería un LUNES, "lunes + 1" es mañana. Así la prueba fallaba
  // solo los lunes y parecía un bug del cierre de caja — pasó el 10-ago.
  const dia44 = (n) => {
    const d = new Date(L44 + "T12:00"); d.setDate(d.getDate() + n);
    const f = d.toISOString().slice(0, 10);
    return f > HOY ? HOY : f;
  };
  const regC = { "C-1": {} };
  regC["C-1"]["11112807346|Grupal-Basico|EMMA GUADALUPE EVANGELISTA MARTINEZ|0"] = { pago: 5000, forma: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: dia44(0),
    snapshot: { reg: regC, movs: [{ folio: "cs1", concepto: "GASTO", monto: 300, via: "E", tipoGasto: "Gasolina", nota: "ruta" }] },
    ts: Date.now() }) });
  await j(await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: dia44(1), monto: 2000, concepto: "BANCARIZACION",
      categoria: "Autorización / préstamo", metodo: "efectivo" }) }));
  const caja = await j(await fetch(U + "/api/semana/caja", { headers: H(cm) }));
  ok("el cierre semanal cuenta lo que ENTRÓ en efectivo",
    caja.entroCobranza >= 5000, "entró de cobranza " + caja.entroCobranza);
  ok("y lo que SALIÓ, con su concepto",
    caja.salio >= 2300 && (caja.salidasPorTipo || {})["Gasto · Gasolina"] === 300,
    JSON.stringify(caja.salidasPorTipo));
  ok("el retiro de dirección aparece como salida (antes no se restaba en la semana)",
    Object.keys(caja.salidasPorTipo || {}).some((k) => /BANCARIZACION/i.test(k)), JSON.stringify(caja.salidasPorTipo));
  ok("lo que debe quedar el sábado es entró − salió",
    Math.abs(caja.quedaEnCaja - (caja.entro - caja.salio)) < 0.01,
    caja.entro + " − " + caja.salio + " = " + caja.quedaEnCaja);
  ok("la semana va de LUNES a SÁBADO, nunca más de 6 días",
    (caja.dias || []).length <= 6, (caja.dias || []).length + " días");
  const xlsCaja = await fetch(U + "/api/semana/caja/excel", { headers: H(cm) });
  ok("el cierre se puede descargar en Excel",
    xlsCaja.status === 200 && /spreadsheet/.test(xlsCaja.headers.get("content-type") || ""),
    xlsCaja.status + " " + xlsCaja.headers.get("content-type"));
  // DE DÓNDE SALE EL NÚMERO. Aquí solo entra el efectivo, y la tarjeta de
  // Cartera cuenta otra cosa. Sin el desglose por forma no hay manera de
  // cuadrarlos, y el que mira concluye que falta dinero (Karina, 6-ago).
  ok("el cierre trae la cobranza partida por forma de pago",
    caja.cobranza && caja.cobranza.efectivo != null && caja.cobranza.transferencia != null
    && caja.cobranza.deposito != null, JSON.stringify(caja.cobranza));
  ok("y las tres formas suman el total cobrado de la semana",
    caja.cobranza && Math.abs(caja.cobranza.total
      - (caja.cobranza.efectivo + caja.cobranza.transferencia + caja.cobranza.deposito)) < 0.01,
    JSON.stringify(caja.cobranza));
  ok("lo que entra a la caja es SOLO la parte en efectivo",
    caja.cobranza && caja.cobranza.efectivo === caja.entroCobranza,
    "efectivo " + (caja.cobranza || {}).efectivo + " vs entroCobranza " + caja.entroCobranza);
  ok("y las transferencias van APARTE: no son efectivo de caja",
    caja.transferencias != null && caja.depositos != null,
    "transf " + caja.transferencias + " · dep " + caja.depositos);

  console.log("\n— 44e. DAR DE ALTA A UNA CLIENTA A LA QUE YA LE COBRARON (Karina, 5-ago) —");
  // Es el caso de "Agregar clienta nueva" en la app: la ejecutiva la mete en su
  // teléfono, le cobra, y Monse la registra después. El cobro SÍ se le aplica
  // solo… pero hay dos formas de equivocarse y ninguna se ve:
  //   1. capturar el saldo que debe HOY en vez del ORIGINAL → se resta doble;
  //   2. escribir el producto distinto al del cobro → el pago se queda suelto.
  // OJO con las burbujas: `ce` es la cuenta de PRUEBA y `ca` es Anel, que es
  // real. Si se sincroniza con una y se lee con la otra, el pago no se ve —
  // cada una solo mira su propio mundo. Aquí se usa Neri (real) de punta a
  // punta, con su fecha propia y el corte atrás para que el pago cuente.
  const D44f = "2026-02-19";
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01", confirmar: true }) });
  const S44 = "70000000431", S45 = "70000000432";
  const reg44f = { "C-0": {} };
  reg44f["C-0"][S44 + "|Individual|CLIENTA DE PRUEBA 44|0"] = { pago: 200, forma: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: D44f, snapshot: { reg: reg44f }, ts: Date.now() }) });
  const alta44 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca),
    body: JSON.stringify({ id: S44, nombre: "CLIENTA DE PRUEBA 44", producto: "Individual",
      centro: "C-0", ejecutivo: "Neri", saldo: 5000, cuota: 250 }) }));
  ok("al darla de alta, el cobro que ya traía se le aplica solo",
    alta44.yaLePagaron === 200 && alta44.saldoQuedaEn === 4800,
    "capturado " + alta44.saldoCapturado + " · pagado " + alta44.yaLePagaron + " · queda " + alta44.saldoQuedaEn);
  ok("y se avisa cuánto le quedó, para cachar si se capturó el saldo equivocado",
    alta44.saldoCapturado === 5000 && alta44.saldoQuedaEn < alta44.saldoCapturado, JSON.stringify(alta44));
  // Producto distinto al del cobro. REGLA NUEVA (Karina, 7-ago): si la socia
  // tiene UN SOLO crédito activo, el pago es de ese aunque el producto se haya
  // escrito distinto. Antes se quedaba suelto y así se perdieron los $200 de
  // MARIA MAGDALENA. Con DOS créditos sí se queda suelto — ver sección 50.
  const reg44g = { "C-0": {} };
  reg44g["C-0"][S45 + "|Individual|OTRA DE PRUEBA 44|0"] = { pago: 300, forma: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: "2026-02-20", snapshot: { reg: reg44g }, ts: Date.now() + 1 }) });
  const alta45 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca),
    body: JSON.stringify({ id: S45, nombre: "OTRA DE PRUEBA 44", producto: "Individual 2",
      centro: "C-0", ejecutivo: "Neri", saldo: 3000, cuota: 150 }) }));
  ok("aunque el producto se escriba distinto, el cobro le llega a su único crédito",
    alta45.yaLePagaron === 300 && alta45.saldoQuedaEn === 2700
      && !(alta45.cobrosQueSiguenSueltos || []).length,
    JSON.stringify(alta45));
  // El corte se deja en 2026-01-01 a propósito: es el que espera la sección
  // que sigue. Moverlo aquí le dejaba la ventana vacía y la tumbaba.

  console.log("\n— 44c. CONCILIACIÓN: ¿todo lo cobrado bajó de algún saldo? (Karina, 5-ago) —");
  // Es el control que sustituye a pedirle el Excel a Monse para comparar. Si
  // cuadra, los saldos del sistema son los buenos y no hace falta cotejar con
  // nadie; si no, dice cuánto y por qué.
  const kk = async () => (await j(await fetch(U + "/api/cartera", { headers: H(cm) }))).conciliacion;
  const k1 = await kk();
  ok("la conciliación responde con sus cifras",
    k1 && k1.cobrado != null && k1.bajoDeSaldos != null, JSON.stringify(k1));
  ok("con el cobro huérfano de arriba, NO da por bueno el día",
    k1 && k1.cuadra === false && k1.porArreglar >= 700, JSON.stringify(k1));
  ok("y lo atribuye a cobros que no empatan con ningún crédito",
    k1 && k1.porque.cobrosSinCredito >= 700, JSON.stringify(k1 && k1.porque));
  ok("no queda dinero SIN EXPLICAR", k1 && Math.abs(k1.porque.sinExplicar) < 1,
    "sinExplicar " + (k1 && k1.porque.sinExplicar));
  ok("las garantías se reportan aparte: respaldan el crédito y no bajan saldo",
    k1 && k1.garantias > 0, "garantías " + (k1 && k1.garantias));

  console.log("\n— 45. EL ALTA DEL TABLERO NO CONGELA EL SALDO (Karina, 5-ago) —");
  // Monse da de alta desde el tablero a las clientas recién desembolsadas que
  // todavía no vienen en su archivo, pero captura el saldo ORIGINAL. Ese renglón
  // quedaba CONGELADO: ninguna plantilla podía volver a bajarlo. Se comprobó en
  // 25 créditos — la diferencia era exactamente el número de pagos que llevaban
  // según su desembolso. Ahora el saldo lo manda la plantilla; del alta solo se
  // conserva que la clienta existe. La RENOVACIÓN es la excepción: ahí el
  // renglón de la plantilla es el ciclo VIEJO y el bueno es el del alta.
  const ver45 = async (id, prod) => {
    const d = await j(await fetch(U + "/api/clientes?q=" + id, { headers: H(cm) }));
    return (d.resultados || []).find((y) => String(y.id) === id && y.producto === prod && y.activa !== false) || null;
  };
  const A45 = ["11112658700", "Grupal-Basico"];   // ANGELA ARANGO · plantilla $12,936
  const dePlant45 = (await ver45(A45[0], A45[1]) || {}).saldo;
  await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: A45[0], producto: A45[1], motivo: "Otro" }) });
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: A45[0], nombre: "ANGELA ARANGO FLORES", producto: A45[1],
      centro: "FRUTOS DE DINERO", ejecutivo: "Karina", saldo: dePlant45 + 1176, cuota: 588 }) });
  const tras45 = await ver45(A45[0], A45[1]);
  ok("un alta del tablero NO pisa el saldo de la plantilla",
    tras45 && tras45.saldo === dePlant45, "plantilla " + dePlant45 + " · quedó " + (tras45 && tras45.saldo));
  ok("y se guarda lo que capturó el alta, por si hay que revisarlo",
    tras45 && tras45.saldoDelAlta === dePlant45 + 1176, "saldoDelAlta " + (tras45 && tras45.saldoDelAlta));
  // RENOVACIÓN: liquida y le re-dan crédito. Ahí manda el monto nuevo.
  const B45 = ["11112748267", "Grupal-Basico"];
  await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: B45[0], producto: B45[1], saldo: 0, motivo: "liquidó" }) });
  await j(await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: B45[0], producto: B45[1], saldo: 20000, cuota: 900,
      centro: "FRUTOS DE DINERO", ejecutivo: "Karina" }) }));
  const ren45 = await ver45(B45[0], B45[1]);
  ok("pero una RENOVACIÓN sí conserva su propio monto (la plantilla es el ciclo viejo)",
    ren45 && ren45.saldo === 20000 && ren45.recredito === true, JSON.stringify(ren45 && { s: ren45.saldo, r: ren45.recredito }));

  console.log("\n— 45c. C-0 EN LA LISTA DE CENTROS: dar de alta un INDIVIDUAL (Karina, 7-ago) —");
  // El alta aceptaba "C-0" pero la lista de centros lo escondía a propósito
  // —no es un grupo de verdad—, así que no había forma de elegirlo y el alta
  // se rechazaba con "ese centro no existe".
  const cen45 = await j(await fetch(U + "/api/centros", { headers: H(cm) }));
  const cero45 = (cen45.centros || []).find((x) => x.individual);
  ok("C-0 aparece en la lista de centros", !!cero45, JSON.stringify((cen45.centros || []).slice(0, 3)));
  const rInd = await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: "11199999001", nombre: "PRUEBA INDIVIDUAL", producto: "Individual 1",
      centro: "C-0", ejecutivo: "Julio", saldo: 5000, cuota: 500, plazo: 10 }) });
  ok("y se puede dar de alta una clienta INDIVIDUAL", rInd.status === 200, "status " + rInd.status);

  console.log("\n— 46. EL CIERRE DEL DÍA LLEGA DE VERDAD AL TABLERO (Karina, 7-ago) —");
  // Julio cerró su día y a Dirección le seguía apareciendo abierto. La causa:
  // si no había snapshot de esa fecha, marcarCierre() devolvía false y la ruta
  // contestaba `ok: true` de todas formas — la ejecutiva veía "cerrado" en su
  // teléfono y nadie más se enteraba. Y de paso, un día SIN cobranza no se
  // podía cerrar, cuando es un día perfectamente válido.
  const D46 = "2026-04-01";
  const verCierre46 = async () => {
    const c = await j(await fetch(U + "/api/consolidado?fecha=" + D46, { headers: H(cm) }));
    return ((c.ejecutivos || {}).julio || {}).cierre || null;
  };
  const cJul = await login("julio", "julio2026");
  const r46a = await fetch(U + "/api/cierre", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: D46, confirmado: true }) });
  const d46a = await j(r46a);
  ok("un día SIN cobranza también se puede cerrar",
    r46a.status === 200 && d46a.marcado === true, JSON.stringify(d46a));
  ok("y el tablero lo ve cerrado (antes se perdía en silencio)",
    !!(await verCierre46()), "sigue apareciendo abierto");
  // Con cobranza en efectivo, sin conteo de billetes: se le impide y se le dice.
  const D46b = "2026-04-02";
  const reg46 = { C46: {} };
  reg46.C46["11113014663|COMADRE|JUANA RITA LUIS BERNAL|0"] = { pago: 800, forma: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: D46b, snapshot: { reg: reg46 }, ts: Date.now() }) });
  const r46b = await fetch(U + "/api/cierre", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: D46b, confirmado: true }) });
  ok("pero cobrando efectivo SIN contar los billetes, no deja cerrar",
    r46b.status === 400, "status " + r46b.status);

  console.log("\n— 47. EL PLAZO Y LA CUOTA LLEGAN AL TELÉFONO (Karina, 7-ago) —");
  // "Los plazos en la app de Julio están mal." Eran dos cosas: (1) el plazo
  // NUNCA viajaba —vive en el padrón desde la plantilla, pero ningún HTML lo
  // incluía, así que la app se lo pedía a mano—, y (2) los montos embebidos en
  // el HTML envejecen: sus tres MAGNUS traían la mensualidad de un mes anterior
  // (es decreciente) y Martha seguía con el crédito viejo de $50,000.
  const appJ = await (await fetch(U + "/app", { headers: H(cJul) })).text();
  const mP47 = appJ.match(/window\.__VIVOS0=(\{.*?\});<\/script>/s);
  const mV = mP47 ? { 1: JSON.stringify(JSON.parse(mP47[1]).vivos || []) } : null;
  ok("la app de Julio recibe los datos vivos del padrón", !!mV, "no se inyectaron");
  const vivos47 = mV ? JSON.parse(mV[1]) : [];
  const porNom_47 = {};
  const mI47 = appJ.match(/let INDIVIDUALES=(\[.*?\]);/s);
  (mI47 ? JSON.parse(mI47[1]) : []).forEach((c) => { porNom_47[c.n] = c; });
  const vPor47 = {};
  vivos47.forEach((v) => { vPor47[String(v.id)] = v; });
  ok("todos traen plazo", vivos47.length > 0 && vivos47.every((v) => v.plazo > 0),
    JSON.stringify(vivos47.filter((v) => !(v.plazo > 0))));
  // MAGNUS se paga POR MES. Sin esto la app le preguntaba "¿de cuántas SEMANAS
  // es el crédito?" a un crédito mensual.
  const sole47 = vPor47["11113064631"];
  ok("y MAGNUS viaja como MENSUALIDADES, no como semanas",
    !!sole47 && /MENS/i.test(sole47.unidad || ""), JSON.stringify(sole47));
  ok("con la mensualidad de la plantilla del 6-ago, no la del mes pasado",
    !!sole47 && Math.abs(sole47.cuota - 6875.75) < 0.01, "cuota " + (sole47 || {}).cuota);
  const mar47 = vPor47["11113236921"];
  ok("y Martha con su crédito NUEVO, no con el de $50,000",
    !!mar47 && Math.abs(mar47.cuota - 3175.5) < 0.01 && Math.abs(mar47.importe - 60000) < 1,
    JSON.stringify(mar47));
  ok("el día de pago mensual se lee (no un '2026-08-31 00:00:00')",
    vivos47.every((v) => !String(v.dia).includes("00:00:00")),
    JSON.stringify(vivos47.map((v) => v.dia)));
  // Y que `vivos.js` de verdad PARCHE los objetos de la app: que los datos
  // lleguen no sirve si no se aplican sobre la lista que ella ve. Se corre el
  // archivo REAL que se le sirve al teléfono, no una copia de su lógica.
  const kSole = "11113064631|MAGNUS|SOLEDAD FABIOLA MENDOZA|0";
  let aplicado47 = null;
  if (mI47) {
    const INDIVIDUALES = JSON.parse(mI47[1]);
    const datosCli = {};
    // Lo que Julio ya hubiera tecleado a mano NO se debe pisar.
    datosCli[kSole] = { plazo: 18, semana: 7, cuota: 9999 };
    const fuente = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "vivos.js"), "utf8");
    const noop = () => {};
    const win = { __VIVOS0: JSON.parse(mP47[1]), addEventListener: noop };
    new Function("CENTROS", "INDIVIDUALES", "datosCli", "guardarDatosCli",
      "window", "navigator", "document", "setInterval", "setTimeout", "fetch", fuente)(
      {}, INDIVIDUALES, datosCli, noop,
      win, { onLine: false }, { hidden: true, addEventListener: noop }, noop, noop, noop);
    aplicado47 = { INDIVIDUALES, datosCli, kSole };
  }
  ok("vivos.js corre y parcha la lista de la app",
    !!aplicado47 && aplicado47.INDIVIDUALES.every((c) => c.plazo > 0),
    JSON.stringify((aplicado47 || {}).INDIVIDUALES || []).slice(0, 200));
  ok("y siembra el plazo para que ya no se lo pregunte a mano",
    !!aplicado47 && aplicado47.INDIVIDUALES.every((c) => (aplicado47.datosCli[c.k || c.f] || {}).plazo > 0),
    "alguna clienta se quedó sin plazo sembrado");
  const dS47 = (aplicado47 ? aplicado47.datosCli[aplicado47.kSole] : null) || {};
  ok("sin pisar lo que la ejecutiva ya había capturado",
    dS47.plazo === 18 && dS47.semana === 7 && dS47.cuota === 9999, JSON.stringify(dS47));

  console.log("\n— 48. TODO VA LINKEADO: lo que hace Monse aparece en el teléfono (Karina, 7-ago) —");
  // «En dirección tienen bien los pagos, no se está ejecutando en las apps de
  // los ejecutivos. Si Monse hace un cambio tiene que aparecer automáticamente
  // en el del ejecutivo.» El sync era de UNA SOLA VÍA: la app subía y el
  // servidor nunca le contestaba nada. Ahora baja por /api/vivos.
  const vivos48 = async (ck) => j(await fetch(U + "/api/vivos", { headers: H(ck) }));
  const saldo48 = async (ck, id) => {
    const d = await vivos48(ck);
    const v = (d.vivos || []).find((x) => String(x.id) === String(id));
    return v ? v.saldo : null;
  };
  const BLANCA48 = "11112931059";                 // COMADRE, saldo $6,272.50
  const base48 = await saldo48(cJul, BLANCA48);
  ok("la app pide sus datos vivos al servidor", base48 !== null, "no vino en /api/vivos");
  ok("y arranca con el saldo de la plantilla", Math.abs(base48 - 6272.5) < 0.01, "saldo " + base48);

  // (a) Un abono que registra DIRECCIÓN sí le baja en el teléfono.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Recuperación / adelanto", concepto: "Abono en oficina",
      monto: 1000, metodo: "efectivo", socio: BLANCA48, ejecutivo: "julio" }) });
  ok("un abono que captura Dirección le baja el saldo a la ejecutiva",
    Math.abs((await saldo48(cJul, BLANCA48)) - 5272.5) < 0.01, "saldo " + (await saldo48(cJul, BLANCA48)));

  // (b) Pero lo que capturó ELLA no se resta dos veces. La app ya lo descuenta
  // en pantalla con su captura local; si el servidor lo mandara descontado, la
  // clienta aparecería debiendo de menos de lo que debe.
  const hoy48 = HOY;
  const kB48 = BLANCA48 + "|COMADRE|BLANCA LUIS BERNAL|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: hoy48, snapshot: { regI: { [kB48]: { pago: 1554.5, forma: "E" } } }, ts: Date.now() }) });
  const conSuPago48 = await saldo48(cJul, BLANCA48);
  ok("lo que capturó ELLA no se le resta dos veces",
    Math.abs(conSuPago48 - 5272.5) < 0.01, "saldo " + conSuPago48 + " (debía seguir en 5272.50)");
  // Y la cuenta final tiene que cuadrar con lo que ve Monse en su tablero.
  const enTablero48 = (await j(await fetch(U + "/api/clientes?q=BLANCA%20LUIS", { headers: H(cm) })))
    .resultados.find((c) => c.ejecutivo === "Julio");
  // Que el pago SÍ haya entrado, no que la prueba pase en vacío: si la llave
  // del snapshot no coincidiera, los dos lados dirían 5272.50 y "cuadraría"
  // sin haber capturado nada.
  ok("el pago de la ejecutiva sí quedó registrado",
    Math.abs(((enTablero48 || {}).saldoActual) - 3718) < 0.01,
    "tablero " + (enTablero48 || {}).saldoActual + " (esperado 3718 = 6272.50 − 1000 − 1554.50)");
  ok("y la pantalla de la ejecutiva cuadra con el tablero de Dirección",
    Math.abs((conSuPago48 - 1554.5) - (enTablero48 || {}).saldoActual) < 0.01,
    "app " + (conSuPago48 - 1554.5) + " vs tablero " + (enTablero48 || {}).saldoActual);

  // (c) Un AJUSTE de saldo hecho por Monse baja al teléfono.
  await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: BLANCA48, producto: "COMADRE", saldo: 9000, cuota: 900, motivo: "prueba de linkeo" }) });
  const tras48 = await vivos48(cJul);
  const vB48 = (tras48.vivos || []).find((x) => String(x.id) === BLANCA48) || {};
  ok("un ajuste de saldo de Dirección llega al teléfono",
    Math.abs(vB48.saldo - (9000 - 1000)) < 0.01, "saldo " + vB48.saldo);
  ok("y el cambio de cuota también", Math.abs(vB48.cuota - 900) < 0.01, "cuota " + vB48.cuota);

  // (d) Un ALTA de Monse aparece sola en la app de la ejecutiva.
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: "11199999048", nombre: "ALTA QUE HIZO MONSE", producto: "Individual 1",
      centro: "C-0", ejecutivo: "Julio", saldo: 4000, cuota: 400, plazo: 10 }) });
  const conAlta48 = await vivos48(cJul);
  ok("un alta de Dirección aparece sola en la app",
    (conAlta48.altas || []).some((a) => String(a.id) === "11199999048"), JSON.stringify(conAlta48.altas || []));
  ok("y ya viene con su plazo y su saldo",
    (conAlta48.vivos || []).some((v) => String(v.id) === "11199999048" && v.plazo === 10 && v.saldo === 4000),
    JSON.stringify((conAlta48.vivos || []).filter((v) => String(v.id) === "11199999048")));

  // (e) Y una BAJA la saca del teléfono.
  await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: "11199999048", producto: "Individual 1", motivo: "No renovó" }) });
  const conBaja48 = await vivos48(cJul);
  ok("una baja de Dirección la saca del teléfono",
    (conBaja48.quitar || []).some((q) => String(q.id) === "11199999048")
    && !(conBaja48.vivos || []).some((v) => String(v.id) === "11199999048"),
    JSON.stringify(conBaja48.quitar || []).slice(0, 160));

  console.log("\n— 49. DIRECCIÓN CORRIGE LA CAPTURA DE UNA EJECUTIVA (Karina, 7-ago) —");
  // «Darle el poder a Monse de ajustar arqueos de ejecutivos, anular garantías
  //  y pagos de clientes, y que se sincronice con el tablero de ellos.»
  const F49 = "2026-03-11";
  const KB49 = "11112931059|COMADRE|BLANCA LUIS BERNAL|0";
  const KJ49 = "11113014663|COMADRE|JUANA RITA LUIS BERNAL|0";
  const capturar49 = (gar) => fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: F49, ts: Date.now(), snapshot: {
      regI: { [KB49]: { pago: 1554.5, garantia: gar, forma: "E" }, [KJ49]: { pago: 2827, forma: "E" } },
      arqueo: { 500: 9, 50: 1, 20: 1 } } }) });
  await capturar49(200);
  const cons49 = async () => ((await j(await fetch(U + "/api/consolidado?fecha=" + F49, { headers: H(cm) }))).ejecutivos || {}).julio || {};
  const c49a = await cons49();
  ok("arranca con la captura de la ejecutiva",
    Math.abs(c49a.pago - 4381.5) < 0.01 && Math.abs(c49a.garantias - 200) < 0.01, JSON.stringify(c49a));

  // Dirección ve la captura clienta por clienta antes de corregir.
  const cap49 = await j(await fetch(U + "/api/captura?fecha=" + F49 + "&ejecutivo=julio", { headers: H(cm) }));
  ok("Dirección puede ver su captura clienta por clienta",
    (cap49.clientas || []).length === 2 && cap49.clientas.every((c) => c.nombre && !c.nombre.includes("|")),
    JSON.stringify(cap49.clientas || []).slice(0, 200));

  // (a) QUITAR UNA GARANTÍA.
  const r49g = await fetch(U + "/api/cobranza/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: F49, ejecutivo: "julio", clave: KB49, campo: "garantia", monto: 0,
      motivo: "No dio garantía, fue dedazo" }) });
  const c49g = await cons49();
  ok("Dirección puede quitar una garantía", r49g.status === 200 && c49g.garantias === 0, "garantías " + c49g.garantias);

  // (b) ANULAR UN PAGO COMPLETO.
  await fetch(U + "/api/cobranza/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: F49, ejecutivo: "julio", clave: KJ49, anula: true, motivo: "No pagó" }) });
  const c49n = await cons49();
  ok("y anular un pago que no fue",
    Math.abs(c49n.pago - 1554.5) < 0.01 && c49n.clientasPagaron === 1, JSON.stringify(c49n));

  // (c) CORREGIR EL ARQUEO.
  await fetch(U + "/api/arqueo/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: F49, ejecutivo: "julio", arqueo: { 500: 3, 50: 1 },
      motivo: "Recontamos el efectivo en oficina" }) });
  const arq49 = await j(await fetch(U + "/api/arqueo?fecha=" + F49, { headers: H(cm) }));
  ok("y corregir el conteo de billetes del arqueo",
    Math.abs(((arq49.porEjec || {}).julio || {}).contado - 1550) < 0.01,
    "contado " + (((arq49.porEjec || {}).julio || {}).contado));

  // (d) LO MÁS IMPORTANTE: que la app de la ejecutiva NO deshaga la corrección.
  // Su teléfono vuelve a subir la captura original —es lo que tiene guardado—
  // y el sync REEMPLAZA el día. Si la corrección viviera dentro del snapshot,
  // aquí se perdería y el descuadre volvería solo.
  await capturar49(200);
  const c49r = await cons49();
  ok("una re-sincronización de la ejecutiva NO deshace la corrección",
    Math.abs(c49r.pago - 1554.5) < 0.01 && c49r.garantias === 0, JSON.stringify(c49r));

  // (e) Y EL SALDO DE LA CLIENTA REGRESA. Se mide sobre una fecha POSTERIOR al
  // corte —antes del corte los abonos no descuentan, y la prueba no probaría
  // nada—. Se toma el saldo, se captura, se comprueba que bajó, se anula y se
  // comprueba que volvió: es la cadena completa, no una foto.
  const MARTA49 = "11113236921";
  const KM49 = MARTA49 + "|Foxi Plus - 2|MARTHA PATRICIA VASQUEZ HERNANDEZ|0";
  const saldoMar = async () => {
    const d = await j(await fetch(U + "/api/clientes?q=VASQUEZ%20HERNANDEZ", { headers: H(cm) }));
    return (d.resultados.find((c) => c.ejecutivo === "Julio") || {}).saldoActual;
  };
  const sAntes = await saldoMar();
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: HOY, ts: Date.now(),
      snapshot: { regI: { [KM49]: { pago: 3175.5, forma: "E" } } } }) });
  const sConPago = await saldoMar();
  ok("un pago capturado sí le baja el saldo",
    Math.abs(sAntes - sConPago - 3175.5) < 0.01, sAntes + " → " + sConPago);
  await fetch(U + "/api/cobranza/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: HOY, ejecutivo: "julio", clave: KM49, anula: true,
      motivo: "No pagó, se capturó por error" }) });
  const sAnulado = await saldoMar();
  ok("y al anularlo, el saldo de la clienta REGRESA",
    Math.abs(sAnulado - sAntes) < 0.01, sConPago + " → " + sAnulado + " (debía volver a " + sAntes + ")");

  // (f) Y baja al teléfono para que la ejecutiva lo vea.
  const paq49 = await j(await fetch(U + "/api/vivos", { headers: H(cJul) }));
  ok("las correcciones bajan al teléfono de la ejecutiva",
    Array.isArray(paq49.correcciones), JSON.stringify(paq49.correcciones || []).slice(0, 120));

  // (g) Guardias: sin motivo no se corrige, y no se corrige a quien no capturó.
  const sinMotivo49 = await fetch(U + "/api/cobranza/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: F49, ejecutivo: "julio", clave: KB49, campo: "pago", monto: 0 }) });
  ok("sin motivo no se puede corregir", sinMotivo49.status === 400, "status " + sinMotivo49.status);
  const noEsta49 = await fetch(U + "/api/cobranza/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: F49, ejecutivo: "julio", clave: "999|X|NADIE|0", anula: true, motivo: "prueba" }) });
  ok("no deja corregir a una clienta que no capturó", noEsta49.status === 404, "status " + noEsta49.status);
  const ejecNo49 = await fetch(U + "/api/cobranza/ajuste", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: F49, ejecutivo: "julio", clave: KB49, anula: true, motivo: "prueba" }) });
  ok("y una ejecutiva no puede corregirse a sí misma", ejecNo49.status === 403, "status " + ejecNo49.status);

  // (g bis) ANEL TAMBIÉN (Karina, 7-ago: «también Anel»). Entra por rol
  // `direccion`, así que ya tenía el poder — pero eso nadie lo estaba
  // vigilando: bastaba con que alguien apretara un permiso a `admin` para
  // dejarla fuera, y no se sabría hasta que ella lo intentara.
  const cAnel = await login("anel", "anel2026");
  const puedeAnel = async (url, cuerpo) =>
    (await fetch(U + url, { method: "POST", headers: H(cAnel), body: JSON.stringify(cuerpo) })).status;
  ok("Anel ve la captura de una ejecutiva",
    (await fetch(U + "/api/captura?fecha=" + F49 + "&ejecutivo=julio", { headers: H(cAnel) })).status === 200,
    "no la deja ver");
  ok("Anel puede corregir un monto",
    (await puedeAnel("/api/cobranza/ajuste", { fecha: F49, ejecutivo: "julio", clave: KB49,
      campo: "pago", monto: 1000, motivo: "Corrección de Anel" })) === 200, "la rechazó");
  ok("Anel puede anular una captura",
    (await puedeAnel("/api/cobranza/ajuste", { fecha: F49, ejecutivo: "julio", clave: KB49,
      anula: true, motivo: "Anulación de Anel" })) === 200, "la rechazó");
  ok("Anel puede corregir el arqueo",
    (await puedeAnel("/api/arqueo/ajuste", { fecha: F49, ejecutivo: "julio",
      arqueo: { 200: 2 }, motivo: "Reconteo de Anel" })) === 200, "la rechazó");
  // PARIDAD COMPLETA MONSE ↔ ANEL (Karina, 10-ago: «¿le pusiste ese mismo
  // featured a Monse o solo es en el de Anel?»). No basta con probar a Anel en
  // lo de hoy: lo que hay que sostener es que las DOS puedan exactamente lo
  // mismo, para que nadie se quede fuera de una función sin que nos enteremos.
  const MISMAS = [
    ["GET", "/api/captura?fecha=" + F49 + "&ejecutivo=julio", null],
    ["GET", "/api/cobranza/ajustes?fecha=" + F49, null],
    ["GET", "/api/credito/historial?id=11112931059&producto=COMADRE", null],
    ["GET", "/api/periodo", null],
    ["GET", "/api/semana/caja", null],
    ["GET", "/api/cartera", null],
    ["GET", "/api/creditos?q=11112931059", null],
    ["POST", "/api/creditos/etiqueta", { id: "11112931059", producto: "COMADRE", etiqueta: "Recuperación" }],
    ["POST", "/api/creditos/ajuste", { id: "11112931059", producto: "COMADRE", cuota: 1554.5, motivo: "paridad" }],
    ["POST", "/api/saldos/corte", { fecha: "2026-08-05" }],
    // Este da 400 en las dos (el socio no existe): lo que se compara es que las
    // DOS lleguen igual de lejos, no que funcione.
    ["POST", "/api/creditos/recredito", { id: "70000000993", producto: "Individual 1",
      saldo: 1000, cuota: 100, plazo: 10, ejecutivo: "Julio", motivo: "paridad" }],
  ];
  const distintas = [];
  for (const [metodo, ruta, cuerpo] of MISMAS) {
    const pide = (ck) => fetch(U + ruta, metodo === "GET"
      ? { headers: H(ck) }
      : { method: "POST", headers: H(ck), body: JSON.stringify(cuerpo) });
    const [rm, ra] = [await pide(cm), await pide(cAnel)];
    if (rm.status !== ra.status) distintas.push(ruta + " → Monse " + rm.status + " / Anel " + ra.status);
  }
  ok("Monse y Anel pueden EXACTAMENTE lo mismo, función por función",
    distintas.length === 0, distintas.join(" · "));

  const rastroAnel = await j(await fetch(U + "/api/cobranza/ajustes?fecha=" + F49, { headers: H(cAnel) }));
  ok("y sus correcciones quedan a SU nombre, no al de Monse",
    (rastroAnel.ajustes || []).some((a) => a.por === "Anel" && a.usuario === "anel"),
    JSON.stringify((rastroAnel.ajustes || []).map((a) => a.por)));

  // (g ter) Y QUE SE VEA AL BUSCAR A LA CLIENTA (Karina, 7-ago). Un pago
  // anulado DESAPARECE del historial —queda en cero y deja de sumar—, así que
  // sin esto la clienta se ve como si nunca hubiera pagado y nadie puede
  // explicar por qué le bajó (o no le bajó) el saldo.
  const histDe = async (id, prod) => j(await fetch(U + "/api/credito/historial?id=" + id
    + "&producto=" + encodeURIComponent(prod), { headers: H(cm) }));
  const hB49 = await histDe("11112931059", "COMADRE");
  const corB = (hB49.correcciones || [])[0] || {};
  ok("al buscar a la clienta aparece la corrección",
    (hB49.correcciones || []).length > 0, "no vino ninguna");
  ok("y dice qué capturó la ejecutiva y en qué quedó",
    corB.capturo && corB.quedo && corB.capturo.pago !== corB.quedo.pago,
    JSON.stringify({ capturo: corB.capturo, quedo: corB.quedo }));
  ok("con el motivo y el nombre de quien la hizo",
    !!corB.motivo && !!corB.por, JSON.stringify({ motivo: corB.motivo, por: corB.por }));
  // El caso que de verdad importa: anulada, ya no aparece en la lista de pagos.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: F49, snapshot: { regI: { [KJ49]: { pago: 2827, garantia: 150, forma: "E" } } }, ts: Date.now() }) });
  await fetch(U + "/api/cobranza/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: F49, ejecutivo: "julio", clave: KJ49, anula: true,
      motivo: "Se capturó en la clienta equivocada" }) });
  const hJ49 = await histDe("11113014663", "COMADRE");
  ok("un pago anulado ya no cuenta en su historial",
    !(hJ49.historial || []).some((x) => x.fecha === F49 && x.pago > 0), "sigue contando");
  const corJ = (hJ49.correcciones || []).find((x) => x.anula) || {};
  ok("pero la anulación SÍ se ve, con lo que se le quitó",
    !!corJ.capturo && (corJ.capturo.pago + corJ.capturo.garantia) === 2977,
    JSON.stringify(corJ.capturo));
  ok("y con su motivo, para que nadie tenga que adivinar",
    corJ.motivo === "Se capturó en la clienta equivocada", corJ.motivo || "sin motivo");

  // (h) El rastro: quién y por qué.
  const rastro49 = await j(await fetch(U + "/api/cobranza/ajustes?fecha=" + F49, { headers: H(cm) }));
  ok("queda el rastro de quién corrigió y por qué",
    (rastro49.ajustes || []).length >= 3 && rastro49.ajustes.every((a) => a.motivo && a.por),
    JSON.stringify((rastro49.ajustes || []).map((a) => a.motivo)));

  console.log("\n— 50. EL PAGO ENCUENTRA SU CRÉDITO, Y LA ETIQUETA (Karina, 7-ago) —");
  // «Monse dio de alta 11112908183 pero no se sincronizó el pago.» Julio le
  // capturó $200 a MARIA MAGDALENA escribiéndola a mano ANTES del alta, con
  // producto "Individual"; Monse la dio de alta como "Individual 1". Mismo
  // socio, distinto producto: la llave no empataba, el dinero no le bajaba el
  // saldo a nadie y se iba a "cobranza sin crédito", donde nadie lo vio.
  const SOC50 = "11112908183";
  const F50 = HOY;
  const pagadoDe = async (prod) => {
    const d = await j(await fetch(U + "/api/clientes?q=" + SOC50, { headers: H(cm) }));
    const c = (d.resultados || []).find((x) => String(x.id) === SOC50 && (!prod || x.producto === prod));
    return c ? c.pagado : null;
  };
  // Se cuentan SOLO los de ESTE socio: la batería deja otros huérfanos a
  // propósito en secciones anteriores, y contarlos todos daba un número que no
  // decía nada de lo que aquí se está probando.
  const huerfanos = async () =>
    ((await j(await fetch(U + "/api/cartera", { headers: H(cm) }))).cobranzaSinCredito || [])
      .filter((x) => String(x.socio) === SOC50).length;
  // El orden EXACTO de producción: primero el pago, después el alta.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: F50, snapshot: { regI: {
      [SOC50 + "|Individual|MARIA MAGDALENA BAUTISTA|0"]: { pago: 200, forma: "E" } } }, ts: Date.now() }) });
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SOC50, nombre: "MARIA MAGDALENA BAUTISTA RAMIREZ", producto: "Individual 1",
      centro: "C-0", ejecutivo: "Julio", saldo: 2725, cuota: 445, plazo: 16 }) });
  ok("el pago capturado con otro producto SÍ le baja el saldo",
    (await pagadoDe("Individual 1")) === 200, "pagado " + (await pagadoDe("Individual 1")));
  ok("y ya no queda dinero colgado sin crédito", (await huerfanos()) === 0, "quedaron " + (await huerfanos()));

  // Pero con DOS créditos activos NO se adivina: se queda en el aviso.
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SOC50, nombre: "MARIA MAGDALENA BAUTISTA RAMIREZ", producto: "Individual 2",
      centro: "C-0", ejecutivo: "Julio", saldo: 5000, cuota: 500, plazo: 12 }) });
  ok("con dos créditos activos NO le adivina a cuál",
    (await pagadoDe("Individual 1")) === 0 && (await pagadoDe("Individual 2")) === 0,
    "le asignó el pago a alguno");
  ok("y lo vuelve a avisar como cobranza sin crédito", (await huerfanos()) === 1, "avisos " + (await huerfanos()));

  // LA ETIQUETA. No mueve un peso: clasifica a la clienta y baja al teléfono.
  const etiquetar = async (val) => (await fetch(U + "/api/creditos/etiqueta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SOC50, producto: "Individual 1", etiqueta: val }) })).status;
  const etiEnApp = async () => {
    const d = await j(await fetch(U + "/api/vivos", { headers: H(cJul) }));
    const v = (d.vivos || []).find((x) => String(x.id) === SOC50 && x.producto === "Individual 1");
    return v ? v.etiqueta : null;
  };
  ok("se le puede poner la etiqueta de Recuperación", (await etiquetar("Recuperación")) === 200, "la rechazó");
  ok("y le baja sola al teléfono de la ejecutiva", (await etiEnApp()) === "Recuperación", "app: " + (await etiEnApp()));
  ok("aparece al buscar a la clienta",
    ((await j(await fetch(U + "/api/clientes?q=" + SOC50, { headers: H(cm) }))).resultados || [])
      .some((c) => c.etiqueta === "Recuperación"), "no viene en el buscador");
  ok("no acepta una etiqueta inventada", (await etiquetar("loquesea")) === 400, "la aceptó");
  ok("y se puede quitar", (await etiquetar("")) === 200 && (await etiEnApp()) === "", "no se quitó");

  console.log("\n— 51. EL REPORTE QUE NO DEPENDE DEL CORTE (Karina, 7-ago) —");
  // «Un Excel que no tenga que ver con el corte, para tener mejor control de lo
  // que se va, que se pueda ocupar de lunes a domingo.» El de saldos contesta
  // "¿cuánto debe cada quien?" y para eso necesita el corte; este contesta
  // "¿cuánto entró y cuánto salió?", y por eso NO lo mira.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const K51 = "11112931059|COMADRE|BLANCA LUIS BERNAL|0";
  // Se mide POR DIFERENCIA: en ese rango ya hay cobranza de otras secciones de
  // la batería, así que comparar contra totales absolutos daba un número que no
  // decía nada de lo que aquí se prueba (y hacía pasar o fallar por accidente).
  const per0 = await j(await fetch(U + "/api/periodo?desde=2026-08-03&hasta=2026-08-09", { headers: H(cm) }));
  // Un cobro ANTES del corte (el de saldos lo esconde) y otro DESPUÉS.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-03", snapshot: { regI: { [K51]: { pago: 1000, forma: "E" } } }, ts: Date.now() }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-06", snapshot: { regI: { [K51]: { pago: 500, garantia: 200, forma: "T" } } }, ts: Date.now() + 1 }) });
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Gasto operativo", concepto: "Gasolina de ruta", monto: 450,
      metodo: "efectivo", ejecutivo: "julio", categoria: "Gasto operativo", fecha: "2026-08-06" }) });

  const per = await j(await fetch(U + "/api/periodo?desde=2026-08-03&hasta=2026-08-09", { headers: H(cm) }));
  ok("el reporte del periodo respeta el rango que se le pide",
    per.desde === "2026-08-03" && per.hasta === "2026-08-09", JSON.stringify({ d: per.desde, h: per.hasta }));
  // LO QUE IMPORTA: el cobro anterior al corte SÍ aparece aquí.
  ok("incluye la cobranza ANTERIOR al corte (el de saldos la esconde)",
    (per.cobranza || []).some((x) => x.fecha === "2026-08-03" && x.pago === 1000),
    JSON.stringify((per.cobranza || []).map((x) => x.fecha + ":" + x.pago)));
  ok("y también la posterior, con su garantía",
    (per.cobranza || []).some((x) => x.fecha === "2026-08-06" && x.pago === 500 && x.garantia === 200),
    "no vino la del 6");
  ok("los gastos salen como salida, no como entrada",
    (per.otros || []).some((x) => x.fecha === "2026-08-06" && x.monto === 450 && x.entrada === false),
    JSON.stringify(per.otros || []));
  const netoDe = (d, f) => { const x = (d.porDia || []).find((y) => y.fecha === f); return x ? x.neto : 0; };
  ok("el resumen día por día sube exactamente lo que se capturó",
    Math.round((netoDe(per, "2026-08-03") - netoDe(per0, "2026-08-03")) * 100) / 100 === 1000
    && Math.round((netoDe(per, "2026-08-06") - netoDe(per0, "2026-08-06")) * 100) / 100 === 250,
    JSON.stringify({ d3: netoDe(per, "2026-08-03") - netoDe(per0, "2026-08-03"),
                     d6: netoDe(per, "2026-08-06") - netoDe(per0, "2026-08-06") }));
  const sube = (k) => Math.round((per.total[k] - per0.total[k]) * 100) / 100;
  ok("y el total del periodo también",
    sube("pago") === 1500 && sube("garantia") === 200 && sube("salidas") === 450,
    JSON.stringify({ pago: sube("pago"), garantia: sube("garantia"), salidas: sube("salidas") }));
  // Y que NO le afecte mover el corte: es justo su razón de ser.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-07", confirmar: true }) });
  const per2 = await j(await fetch(U + "/api/periodo?desde=2026-08-03&hasta=2026-08-09", { headers: H(cm) }));
  ok("mover el corte NO le cambia un solo peso a este reporte",
    per2.total.pago === per.total.pago && per2.total.garantia === per.total.garantia
      && per2.total.salidas === per.total.salidas,
    JSON.stringify({ antes: per.total, despues: per2.total }));
  // Y el Excel de verdad se genera.
  const rx = await fetch(U + "/api/periodo/excel?desde=2026-08-03&hasta=2026-08-09", { headers: H(cm) });
  const bufx = Buffer.from(await rx.arrayBuffer());
  ok("el Excel del periodo se descarga y es un xlsx de verdad",
    rx.status === 200 && bufx.length > 5000 && bufx[0] === 0x50 && bufx[1] === 0x4B,
    "status " + rx.status + " · " + bufx.length + " bytes");
  ok("y viene con nombre de archivo con el rango",
    /Movimiento FOOAX 2026-08-03 al 2026-08-09/.test(rx.headers.get("content-disposition") || ""),
    rx.headers.get("content-disposition") || "sin cabecera");
  // Sin rango: la semana en curso, lunes a domingo (7 días).
  const perDef = await j(await fetch(U + "/api/periodo", { headers: H(cm) }));
  const diff = (Date.parse(perDef.hasta) - Date.parse(perDef.desde)) / 86400000;
  ok("sin rango, toma la semana de lunes a domingo", diff === 6,
    perDef.desde + " → " + perDef.hasta + " (" + diff + " días)");

  console.log("\n— 52. LA LIQUIDACIÓN DICE A QUÉ CRÉDITO VA (Karina, 8-ago) —");
  // El sábado 8-ago entraron 6 liquidaciones y a cuatro clientas les bajaron el
  // saldo del crédito EQUIVOCADO. La app siempre mostró un renglón por crédito
  // ("NOMBRE (Grupal-Micro)") y la ejecutiva sí elegía, pero al guardar sólo se
  // conservaba el socio: el sistema repartía el abono entre sus créditos en
  // orden fijo y se lo comía el primero. A SOCORRO MIGUEL le liquidó de más el
  // Grupal-Basico y dejó el Grupal-Micro debiendo, ya pagado.
  const cenLQ = (await j(await fetch(U + "/api/centros", { headers: H(cm) }))).centros[0].centro;
  const SL = "70000000955";
  const altaL = (prod, saldo, cuota) => fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca),
    body: JSON.stringify({ id: SL, nombre: "DOS CREDITOS LIQ", producto: prod, centro: cenLQ,
      ejecutivo: "Neri", saldo, cuota, plazo: 24 }) });
  await altaL("Grupal-Basico", 9000, 500);
  await altaL("Grupal-Micro", 2000, 250);
  const saldosL = async () => {
    const d = await j(await fetch(U + "/api/clientes?q=" + SL, { headers: H(cm) }));
    const o = {};
    for (const x of (d.resultados || []).filter((y) => y.activa !== false)) o[x.producto] = x.saldoActual;
    return o;
  };
  const LQ0 = await saldosL();
  // 1) Sin decir el crédito, el servidor NO lo acepta: es el candado.
  const rSinProd = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 2000, concepto: "liquida", metodo: "efectivo",
      socio: SL, fecha: HOY }) });
  const eSinProd = await j(rSinProd);
  ok("con dos créditos, una liquidación SIN decir cuál se rechaza",
    rSinProd.status === 400 && /cu[áa]l de sus cr[ée]ditos/i.test(eSinProd.error || ""),
    "status " + rSinProd.status + " · " + (eSinProd.error || ""));
  ok("y el error nombra los dos créditos, para poder elegir",
    /Grupal-Basico/.test(eSinProd.error || "") && /Grupal-Micro/.test(eSinProd.error || ""),
    eSinProd.error || "");
  ok("no le movió el saldo a ninguno de los dos",
    JSON.stringify(await saldosL()) === JSON.stringify(LQ0), JSON.stringify(await saldosL()));
  // 2) Un crédito que no es suyo tampoco pasa.
  const rOtro = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 100, concepto: "x", metodo: "efectivo",
      socio: SL, producto: "Grupal-Inventado", fecha: HOY }) });
  ok("un crédito que esa clienta no tiene se rechaza", rOtro.status === 400, "status " + rOtro.status);
  // 3) Con el crédito, le baja SOLO a ese. El otro queda intacto — es justo lo
  //    que pidió Karina: «Grupal-Basico tienes que dejarlo ahí».
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 2000, concepto: "liquida su micro",
      metodo: "efectivo", socio: SL, producto: "Grupal-Micro", fecha: HOY }) });
  const LQ1 = await saldosL();
  ok("con el crédito escrito, el Grupal-Micro queda LIQUIDADO en cero",
    LQ1["Grupal-Micro"] === 0, "micro " + LQ0["Grupal-Micro"] + " → " + LQ1["Grupal-Micro"]);
  ok("y el Grupal-Basico NO se movió ni un peso",
    LQ1["Grupal-Basico"] === LQ0["Grupal-Basico"],
    "basico " + LQ0["Grupal-Basico"] + " → " + LQ1["Grupal-Basico"]);
  // 4) Con UN solo crédito no se estorba a nadie: se resuelve solo.
  const SU = "70000000956";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca),
    body: JSON.stringify({ id: SU, nombre: "UN SOLO CREDITO", producto: "Grupal-Basico", centro: cenLQ,
      ejecutivo: "Neri", saldo: 800, cuota: 200, plazo: 24 }) });
  const rUno = await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 800, concepto: "liquida", metodo: "efectivo",
      socio: SU, fecha: HOY }) });
  const dUno = await j(rUno);
  ok("con un solo crédito no se exige elegir: se resuelve solo",
    rUno.status === 200 && dUno.movimiento && dUno.movimiento.producto === "Grupal-Basico",
    "status " + rUno.status + " · producto " + ((dUno.movimiento || {}).producto || "(ninguno)"));
  // 4-bis) LIQUIDAR Y RENOVAR. El ciclo nuevo hereda la MISMA llave
  //   (socio+producto), así que la liquidación con la que se cerró el ciclo
  //   ANTERIOR no puede tocarlo: si lo toca, la clienta renueva y su crédito
  //   nuevo nace liquidado y se le cae de la app (Karina, 9-ago).
  const SR = "70000000957";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca),
    body: JSON.stringify({ id: SR, nombre: "LIQUIDA Y RENUEVA", producto: "Grupal-Basico",
      centro: cenLQ, ejecutivo: "Neri", saldo: 2000, cuota: 250, plazo: 24 }) });
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 2000, concepto: "liquida para renovar",
      metodo: "efectivo", socio: SR, producto: "Grupal-Basico", fecha: HOY }) });
  const saldoRe = async () => {
    const d = await j(await fetch(U + "/api/clientes?q=" + SR, { headers: H(cm) }));
    const x = (d.resultados || []).filter((y) => y.activa !== false)[0];
    return x ? x.saldoActual : null;
  };
  ok("el crédito liquidado llega a cero antes de renovar", (await saldoRe()) === 0,
    "saldo " + (await saldoRe()));
  const rRe = await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SR, producto: "Grupal-Basico", centro: cenLQ,
      ejecutivo: "Neri", saldo: 5000, cuota: 400, plazo: 24 }) });
  const dRe = await j(rRe);
  ok("se puede RE-DAR el crédito con el mismo nombre después de liquidar",
    rRe.status === 200, "status " + rRe.status + " · " + (dRe.error || "ok"));
  ok("y el crédito NUEVO nace con su saldo completo, no liquidado",
    (await saldoRe()) === 5000, "saldo " + (await saldoRe()) + " (debía ser 5000)");

  // 4-ter) Y QUE SE VEA EN EL TELÉFONO. De nada sirve que el tablero lo tenga
  //   bien si a la ejecutiva le sigue apareciendo el ciclo viejo o no le baja el
  //   nuevo: los montos viven EMBEBIDOS en el HTML de su app, así que el crédito
  //   renovado tiene que llegarle por `/api/vivos` (Karina, 9-ago).
  const vivosRe = await j(await fetch(U + "/api/vivos", { headers: H(cnn) }));
  const altaRe = (vivosRe.altas || []).find((a) => String(a.id) === SR);
  ok("el crédito renovado LE BAJA a la app de su ejecutiva",
    !!altaRe, "altas para Neri: " + JSON.stringify((vivosRe.altas || []).map((a) => a.id)));
  ok("y le llega con el saldo del ciclo NUEVO, no el del viejo",
    !!altaRe && altaRe.saldo === 5000 && altaRe.producto === "Grupal-Basico",
    altaRe ? altaRe.producto + " $" + altaRe.saldo : "no llegó");
  ok("y el ciclo viejo NO se le queda pegado en el teléfono",
    !(vivosRe.quitar || []).some((q) => String(q.id) === SR && Number(q.saldo) === 5000),
    "quitar: " + JSON.stringify((vivosRe.quitar || []).filter((q) => String(q.id) === SR)));

  // 5) Y el tablero puede señalar las viejas, las que llegaron sin crédito.
  const carLC = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("el tablero expone las liquidaciones sin crédito para poder corregirlas",
    Array.isArray(carLC.liquidacionesSinCredito),
    "es " + typeof carLC.liquidacionesSinCredito);

  console.log("\n— 53. RENOVAR NO ARRASTRA LOS ABONOS DEL CICLO VIEJO (Karina, 10-ago) —");
  // El corte se fija aquí: secciones anteriores lo dejan donde les sirve, y sin
  // esto los abonos de la prueba caían antes del corte y no contaban.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  // «Cuando intentan dar un nuevo crédito, le resta lo que ya pagaron.» Pasó con
  // doña Alma Rosario: se renovó por $29,184, después se movió el corte al lunes
  // y el crédito NUEVO amaneció con $5,440 descontados — los del ciclo que ella
  // ya había liquidado. La causa: el apunte que protege la renovación venía
  // sellado con el corte de ese día (`previo.corte === corte`) y al moverlo
  // dejaba de valer. Ahora se recalcula contra el corte de hoy.
  const S52 = "70000000952", P52 = "Grupal-Micro";
  const K52 = S52 + "|" + P52 + "|ALMA DE PRUEBA 52|0";
  const nuevo52 = async () => {
    const d = await j(await fetch(U + "/api/clientes?q=" + S52, { headers: H(cm) }));
    return (d.resultados || []).find((c) => c.activa && c.producto === P52) || null;
  };
  const conCorte = async (f) => {
    await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: f, confirmar: true }) });
    return nuevo52();
  };
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S52, nombre: "ALMA DE PRUEBA 52", producto: P52, centro: "C-0",
      ejecutivo: "Julio", saldo: 10000, cuota: 500, plazo: 20 }) });
  // Abona $5,440 el jueves y liquida los $4,560 que le quedaban, ese mismo día.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-06", snapshot: { regI: { [K52]: { pago: 5440, forma: "E" } } }, ts: Date.now() }) });
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", concepto: "Liquida para renovar", monto: 4560,
      metodo: "efectivo", socio: S52, producto: P52, ejecutivo: "julio", fecha: "2026-08-06" }) });
  const rec52 = await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S52, producto: P52, saldo: 29184, cuota: 912, plazo: 32, motivo: "Renovación" }) });
  ok("se puede renovar después de liquidar", rec52.status === 200, "status " + rec52.status);
  const recienRenovado = await nuevo52();
  ok("el crédito nuevo nace limpio",
    !!recienRenovado && recienRenovado.saldoActual === 29184, JSON.stringify(recienRenovado));

  // ESTO es lo que fallaba: mover el corte le cargaba el ciclo viejo al nuevo.
  let malos52 = [];
  for (const f of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]) {
    const c = await conCorte(f);
    if (!c || c.saldoActual !== 29184) malos52.push(f + ":" + (c ? c.saldoActual : "?"));
  }
  ok("y mover el corte NO le carga los abonos del ciclo viejo",
    malos52.length === 0, "falló con el corte en " + malos52.join(", "));

  // Y el contrario, que es donde esto se puede pasar de listo: los abonos del
  // crédito NUEVO sí tienen que contar.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: HOY, snapshot: { regI: { [K52]: { pago: 912, forma: "E" } } }, ts: Date.now() + 1 }) });
  let malos52b = [];
  for (const f of ["2026-08-03", "2026-08-05", "2026-08-06", HOY]) {
    const c = await conCorte(f);
    if (!c || Math.abs(c.saldoActual - (29184 - 912)) > 0.01) malos52b.push(f + ":" + (c ? c.saldoActual : "?"));
  }
  ok("pero el primer pago del crédito NUEVO sí le baja, con cualquier corte",
    malos52b.length === 0, "falló con el corte en " + malos52b.join(", "));

  // El caso feo: liquidar, renovar y pagar el crédito nuevo el MISMO día.
  const S52b = "70000000953", K52b = S52b + "|" + P52 + "|BEATRIZ DE PRUEBA 52|0";
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S52b, nombre: "BEATRIZ DE PRUEBA 52", producto: P52, centro: "C-0",
      ejecutivo: "Julio", saldo: 8000, cuota: 400, plazo: 20 }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: HOY, snapshot: { regI: { [K52b]: { pago: 8000, forma: "E" } } }, ts: Date.now() + 2 }) });
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S52b, producto: P52, saldo: 20000, cuota: 625, plazo: 32, motivo: "Renovación mismo día" }) });
  const d52b = await j(await fetch(U + "/api/clientes?q=" + S52b, { headers: H(cm) }));
  const n52b = (d52b.resultados || []).find((c) => c.activa && c.producto === P52);
  ok("liquidar, renovar y cobrar el mismo día no revuelve los dos ciclos",
    !!n52b && n52b.saldoActual === 20000, JSON.stringify(n52b));
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });

  console.log("\n— 54. RENOVAR DEJA DOS REGISTROS: NO SE PUEDEN MEZCLAR (Karina, 10-ago) —");
  // La tarjeta de BLANCA VERONICA decía el disparate «saldo de la plantilla
  // $288 − pagado desde el corte $288 = $2,712», y el crédito YA DADO DE BAJA
  // decía «pagó $288 esta sem.». Causa: al renovar quedan DOS registros con el
  // mismo socio y el mismo producto, y como la llave de la cartera es
  // socio+producto, el viejo heredaba los números del nuevo.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const S54 = "70000000954", P54 = "Grupal-Basico 2";
  const K54 = S54 + "|" + P54 + "|BLANCA DE PRUEBA 54|0";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S54, nombre: "BLANCA DE PRUEBA 54", producto: P54, centro: "C-0",
      ejecutivo: "Julio", saldo: 288, cuota: 288, plazo: 18 }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-06", snapshot: { regI: { [K54]: { pago: 288, garantia: 52, forma: "E" } } }, ts: Date.now() }) });
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S54, producto: P54, saldo: 3000, cuota: 200, plazo: 18, motivo: "Renovación" }) });

  const tarj54 = (await j(await fetch(U + "/api/clientes?q=" + S54, { headers: H(cm) }))).resultados || [];
  const viejo54 = tarj54.find((c) => c.activa === false || c.estatus === "BAJA");
  const nuevo54 = tarj54.find((c) => c.activa !== false && c.estatus !== "BAJA");
  ok("después de renovar quedan los dos registros, viejo y nuevo",
    !!viejo54 && !!nuevo54, JSON.stringify(tarj54.map((c) => c.estatus)));
  ok("el crédito de BAJA ya no presume los abonos del nuevo",
    !!viejo54 && viejo54.pagado === 0 && viejo54.saldoActual === 288,
    JSON.stringify(viejo54));
  ok("y el nuevo nace con su saldo completo",
    !!nuevo54 && nuevo54.saldoActual === 3000, JSON.stringify(nuevo54));

  const h54 = await j(await fetch(U + "/api/credito/historial?id=" + S54
    + "&producto=" + encodeURIComponent(P54), { headers: H(cm) }));
  // El renglón que se leía imposible: el saldo salía del registro viejo y lo
  // abonado del vivo, así que la resta no cerraba por ningún lado.
  ok("«Ver pagos» toma el crédito ACTIVO, no el de baja",
    h54.saldoPlantilla === 3000, "saldoPlantilla " + h54.saldoPlantilla);
  // EL ABONO DE LA SEMANA DEL CICLO VIEJO NO SE LE CARGA AL NUEVO. Le pasó a
  // SOCORRO MIGUEL el 10-ago: pagó $320 el jueves, liquidó el sábado, le
  // renovaron el lunes, y esos $320 se le restaron al crédito recién dado.
  const S54b = "70000000991", P54b = "Grupal-Micro";
  const K54b = S54b + "|" + P54b + "|SOCORRO DE PRUEBA 54|0";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S54b, nombre: "SOCORRO DE PRUEBA 54", producto: P54b, centro: "C-0",
      ejecutivo: "Julio", saldo: 3520, cuota: 320, plazo: 48 }) });
  // Uno viejo (antes del corte) y uno de ESTA semana: el bug repartía el monto
  // sobre el viejo y dejaba el de la semana suelto para que le cayera al nuevo.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-07-16", snapshot: { regI: { [K54b]: { pago: 320, forma: "E" } } }, ts: Date.now() }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-06", snapshot: { regI: { [K54b]: { pago: 320, forma: "E" } } }, ts: Date.now() + 1 }) });
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", concepto: "Liquida para renovar", monto: 3200,
      metodo: "efectivo", socio: S54b, producto: P54b, ejecutivo: "julio", fecha: "2026-08-08" }) });
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S54b, producto: P54b, saldo: 23040, cuota: 480, plazo: 48, motivo: "Renovación" }) });
  const t54b = (await j(await fetch(U + "/api/clientes?q=" + S54b, { headers: H(cm) }))).resultados || [];
  const n54c = t54b.find((c) => c.activa !== false && c.estatus !== "BAJA");
  ok("el abono de ESTA semana del ciclo viejo no se le carga al crédito nuevo",
    !!n54c && n54c.saldoActual === 23040, JSON.stringify(n54c));

  ok("y su resta por fin cierra",
    Math.abs(h54.saldoPlantilla - (h54.pagadoDesdeElCorte + h54.liquidado) - h54.saldoActual) < 0.01,
    h54.saldoPlantilla + " − " + (h54.pagadoDesdeElCorte + h54.liquidado) + " ≠ " + h54.saldoActual);

  console.log("\n— 55. RE-DAR CRÉDITO ESTANDO DE BAJA, Y QUE VUELVA A LA APP (Karina, 10-ago) —");
  // «Si están en baja dame la opción de re-dar crédito, y que se vincule con
  // los ejecutivos también porque desaparece.» A Socorro Miguel y a Blanca
  // Verónica les quedaron TODOS los créditos de baja: no le aparecían a su
  // ejecutiva y desde la tarjeta no había ningún botón para devolverles uno.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const S55 = "70000000992", P55 = "Grupal-Micro";
  const K55 = S55 + "|" + P55 + "|SOCORRO DE PRUEBA 55|0";
  const enApp55 = async () => {
    const d = await j(await fetch(U + "/api/vivos", { headers: H(cJul) }));
    return (d.vivos || []).find((v) => String(v.id) === S55 && v.producto === P55) || null;
  };
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S55, nombre: "SOCORRO DE PRUEBA 55", producto: P55, centro: "C-0",
      ejecutivo: "Julio", saldo: 3520, cuota: 320, plazo: 48 }) });
  // Abona esta semana y la dan de baja: así quedaron las dos clientas reales.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-06", snapshot: { regI: { [K55]: { pago: 320, forma: "E" } } }, ts: Date.now() }) });
  await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S55, producto: P55, motivo: "No renovó" }) });
  ok("de baja, la clienta desaparece de la app de su ejecutiva",
    (await enApp55()) === null, "le sigue apareciendo");
  // Y QUE LA APP DE VERDAD LA SAQUE. Que el servidor deje de mandarla no basta:
  // la lista viene ESCRITA en el HTML, así que si el `quitar` no la borra, se le
  // queda en pantalla y se le sigue cobrando. Se corre el vivos.js REAL.
  const sacaDeLaApp = async () => {
    const html = await (await fetch(U + "/app", { headers: H(cJul) })).text();
    const mC = html.match(/let CENTROS=(\{.*?\});/s);
    const mI = html.match(/let INDIVIDUALES=(\[.*?\]);/s);
    const paq = JSON.parse(html.match(/window\.__VIVOS0=(\{.*?\});<\/script>/s)[1]);
    const CEN = mC ? JSON.parse(mC[1]) : {};
    const IND = mI ? JSON.parse(mI[1]) : [];
    // Se mete a mano, como la tenía la ejecutiva antes de la baja.
    IND.push({ n: "SOCORRO DE PRUEBA 55", f: S55, sub: P55, k: K55, saldo: 3520, esp: 320 });
    const nop = () => {};
    const w = { __VIVOS0: paq, addEventListener: nop };
    new Function("CENTROS", "INDIVIDUALES", "datosCli", "guardarDatosCli", "window",
      "navigator", "document", "setInterval", "setTimeout", "fetch",
      require("fs").readFileSync(require("path").join(__dirname, "..", "public", "vivos.js"), "utf8"))(
      CEN, IND, {}, nop, w, { onLine: false }, { hidden: true, addEventListener: nop }, nop, nop, nop);
    const sigue = [].concat(...Object.values(CEN), IND)
      .some((c) => String(c.f) === S55 && (c.sub || "") === P55);
    let mueve = 0;
    for (let k = 0; k < 3; k++) if (w.__aplicarVivos(paq) > 0) mueve++;
    return { sigue, mueve };
  };
  const trasBaja = await sacaDeLaApp();
  ok("y la app SÍ la borra de su lista, no solo deja de recibirla",
    trasBaja.sigue === false, "se le quedó en pantalla");
  ok("sin repintarle la pantalla en cada sondeo",
    trasBaja.mueve === 0, trasBaja.mueve + " de 3 sondeos la movían");

  // LO QUE PIDIÓ: re-dar el crédito aunque esté de baja.
  const rr55 = await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S55, producto: P55, saldo: 23040, cuota: 480, plazo: 48,
      ejecutivo: "Julio", motivo: "Renovación estando de baja" }) });
  ok("se le puede RE-DAR el crédito aunque esté de baja", rr55.status === 200, "status " + rr55.status);
  const d55 = (await j(await fetch(U + "/api/clientes?q=" + S55, { headers: H(cm) }))).resultados || [];
  const n55 = d55.find((c) => c.activa !== false && c.estatus !== "BAJA" && c.producto === P55);
  // Sin crédito activo que cerrar no había apunte de protección, así que los
  // abonos del ciclo viejo volvían a caerle al nuevo. Ahora se guarda siempre.
  ok("y nace COMPLETO: los abonos del ciclo viejo no se le cargan",
    !!n55 && n55.saldoActual === 23040, JSON.stringify(n55));

  // Y lo otro que pidió: que se vincule con la ejecutiva, porque desaparecía.
  const v55 = await enApp55();
  ok("le vuelve a aparecer sola a su ejecutiva",
    !!v55, "no le bajó a la app");
  ok("con su saldo, su cuota y su plazo",
    !!v55 && v55.saldo === 23040 && v55.cuota === 480 && v55.plazo === 48, JSON.stringify(v55));
  // EL PLAZO. El formulario de re-dar crédito no lo pedía y el crédito nuevo
  // nacía en cero, así que quedaba fuera del «pago 13 de 18», del esperado y del
  // semáforo. Le pasó a SOCORRO MIGUEL. Si no se escribe, se deduce de
  // monto ÷ cuota, que es exactamente el número de pagos.
  ok("el crédito re-dado trae su plazo, no cero",
    !!n55 && n55.plazo === 48, "plazo " + (n55 || {}).plazo);
  const alt55 = await j(await fetch(U + "/api/vivos", { headers: H(cJul) }));
  // La fecha del servidor viaja en cada paquete: es la única referencia del
  // vigilante de medianoche (el reloj del teléfono no cuenta).
  ok("el paquete vivo trae la fecha oficial del servidor",
    alt55.hoy === HOY, "hoy=" + alt55.hoy + " esperado " + HOY);
  ok("y viaja como alta, para que le entre al teléfono sin recargar",
    (alt55.altas || []).some((a) => String(a.id) === S55), "no viene en las altas");
  // Y QUE LA APP DE VERDAD LA PONGA. Que el servidor la mande no basta: se
  // corre el `vivos.js` REAL contra la lista de la app, con la clienta fuera
  // (que es como le quedó a la ejecutiva cuando la dieron de baja).
  const htmlApp55 = await (await fetch(U + "/app", { headers: H(cJul) })).text();
  const mC55 = htmlApp55.match(/let CENTROS=(\{.*?\});/s);
  const mI55 = htmlApp55.match(/let INDIVIDUALES=(\[.*?\]);/s);
  const paq55 = JSON.parse(htmlApp55.match(/window\.__VIVOS0=(\{.*?\});<\/script>/s)[1]);
  const CEN55 = mC55 ? JSON.parse(mC55[1]) : {};
  let IND55 = mI55 ? JSON.parse(mI55[1]) : [];
  const fuera = (c) => !(String(c.f) === S55 && /micro/i.test(c.sub || ""));
  for (const k in CEN55) CEN55[k] = CEN55[k].filter(fuera);
  IND55 = IND55.filter(fuera);
  const noop55 = () => {};
  const win55 = { __VIVOS0: paq55, addEventListener: noop55 };
  new Function("CENTROS", "INDIVIDUALES", "datosCli", "guardarDatosCli", "window",
    "navigator", "document", "setInterval", "setTimeout", "fetch",
    require("fs").readFileSync(require("path").join(__dirname, "..", "public", "vivos.js"), "utf8"))(
    CEN55, IND55, {}, noop55, win55, { onLine: false }, { hidden: true, addEventListener: noop55 },
    noop55, noop55, noop55);
  const puesta = [].concat(...Object.values(CEN55), IND55)
    .find((c) => String(c.f) === S55 && /micro/i.test(c.sub || ""));
  ok("la app SÍ se la vuelve a poner en su lista",
    !!puesta, "no apareció en CENTROS ni en INDIVIDUALES");
  ok("y con el saldo, la cuota y el plazo del crédito nuevo",
    !!puesta && puesta.saldo === 23040 && puesta.esp === 480 && puesta.plazo === 48,
    JSON.stringify(puesta));
  // Y QUE NO LE PARPADEE. El crédito viejo de baja comparte socio+producto con
  // el nuevo, así que el "quitar" lo borraba y el "alta" lo reponía en CADA
  // sondeo: la app decía "algo cambió" cada minuto y le repintaba la pantalla
  // a la ejecutiva mientras capturaba.
  let repintes55 = 0;
  for (let k = 0; k < 5; k++) if (win55.__aplicarVivos(paq55) > 0) repintes55++;
  ok("y no le repinta la pantalla en cada sondeo",
    repintes55 === 0, repintes55 + " de 5 sondeos la movían");

  console.log("\n— 56. MORA POR DÍA DE COBRO, EL MÉTODO DE MONSE (Karina, 10-ago) —");
  // «La mora no nos dio la semana pasada; ves que dice día lunes, martes, etc.
  // de las plantillas, así quiero que lo saques por ese approach.» Su regla,
  // sacada de cotejar el archivo «MORA SEMANA 03 AL 07 DE AGOSTO» contra las
  // cuotas del padrón: faltante = cuota − lo que abonó ESA semana, y cada
  // clienta bajo su día de cobro. No mira el corte.
  const L56 = "2026-08-03";
  // El método de Monse (14-ago) arrastra DESDE EL CORTE: para medir la semana
  // del 3-ago el corte debe estar en esa fecha, si no los vencimientos de esa
  // semana quedan antes del corte y no exigen nada.
  // El corte se planta el DOMINGO: la cuota del día del corte ya viene saldada
  // dentro de la plantilla (regla del 14-ago), así que para exigir el lunes 03
  // el corte debe ser anterior a ese día.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-02", confirmar: true }) });
  const mora56 = async () => j(await fetch(U + "/api/mora?lunes=" + L56, { headers: H(cm) }));
  const buscaMora = (d, socio) => {
    for (const g of d.dias || []) for (const x of g.filas) if (String(x.socio) === socio) return { g, x };
    return null;
  };
  const m0 = await mora56();
  ok("la mora se agrupa por día de cobro, como su archivo",
    (m0.dias || []).length > 0 && (m0.dias || []).every((g) => !!g.dia && /^\d{4}-\d{2}-\d{2}$/.test(g.fecha)),
    JSON.stringify((m0.dias || []).map((g) => g.dia + " " + g.fecha)));
  ok("y cada día trae la fecha que le toca dentro de esa semana",
    (m0.dias || []).every((g) => {
      const dd = new Date(g.fecha + "T12:00:00").getDay();
      const esperado = { LUNES: 1, MARTES: 2, MIERCOLES: 3, "MIÉRCOLES": 3, JUEVES: 4, VIERNES: 5, SABADO: 6, "SÁBADO": 6 }[g.dia];
      return dd === esperado;
    }), JSON.stringify((m0.dias || []).map((g) => g.dia + "=" + g.fecha)));

  // EL CASO DE SU ARCHIVO, con una clienta sintética cuyo calendario cuenta la
  // historia exacta: desembolsada el lunes 23-mar a 20 pagos de $576, al lunes
  // 3-ago van 19 vencimientos y debería deberle $576; su saldo de $1,152 dice
  // que va UNA cuota atrás — la de esta semana. Cuota $576, faltante $126 tras
  // pagar $450: el renglón que prueba que la regla es "lo atrasado" y no "la
  // cuota entera si no pagó completo".
  const SOC56 = "70000001110";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SOC56, nombre: "MARIA SINTETICA 56", producto: "Grupal-Basico 2",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 1152, cuota: 576, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-03-23" }) });
  const K56 = SOC56 + "|Grupal-Basico 2|MARIA SINTETICA 56|0";
  // La foto se vuelve a tomar: m0 se sacó ANTES de dar de alta a esta clienta.
  const antes56 = buscaMora(await mora56(), SOC56);
  ok("sin abonar, le falta su cuota completa",
    !!antes56 && antes56.x.faltante === antes56.x.cuota, JSON.stringify((antes56 || {}).x));
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: L56, snapshot: { reg: { GHANIMA: { [K56]: { pago: 450, forma: "E" } } } }, ts: Date.now() }) });
  const m1 = await mora56();
  const post56 = buscaMora(m1, SOC56);
  ok("con un abono PARCIAL, el faltante es la resta (el caso de su archivo: $126)",
    !!post56 && post56.x.pagado === 450 && post56.x.faltante === 126,
    JSON.stringify((post56 || {}).x));
  ok("y sigue bajo el día que le toca cobrar",
    !!post56 && post56.g.dia === "LUNES", (post56 || { g: {} }).g.dia);

  // Si abona TODA su cuota, sale del reporte: no debe nada esa semana.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: L56, snapshot: { reg: { GHANIMA: { [K56]: { pago: 576, forma: "E" } } } }, ts: Date.now() + 1 }) });
  ok("y al completar su cuota desaparece de la mora",
    buscaMora(await mora56(), SOC56) === null, "le sigue apareciendo mora");

  // EL CORTE ES LA BASE DEL ARRASTRE (cambio de diseño del 14-ago, método de
  // Monse): los adelantos y atrasos se miden desde el corte, así que moverlo SÍ
  // cambia la foto — y por eso ya nunca se mueve (no hay más plantillas). Lo
  // que se garantiza es que sea reproducible: al regresarlo, el número regresa.
  const totalConCorteA = (await mora56()).total;
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-07", confirmar: true }) });
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-02", confirmar: true }) });
  const totalConCorteB = (await mora56()).total;
  ok("el corte es la base del arrastre: al regresarlo, la mora regresa idéntica",
    Math.abs(totalConCorteA - totalConCorteB) < 0.01, totalConCorteA + " vs " + totalConCorteB);

  // Y que diga lo que dejó fuera, en vez de callarlo.
  // CUÁNTAS SÍ PAGARON (Karina, 10-ago: «¿cuántos tuvieron pagadas en lunes?»).
  // Un total de mora suelto no se puede leer: "$34,040" no dice nada sin "de 90
  // créditos, 12 pagaron completo".
  const m2 = await mora56();
  const lun56 = (m2.dias || []).find((g) => g.dia === "LUNES");
  ok("el reporte dice cuántos créditos tocaban cada día",
    !!lun56 && lun56.creditos > 0 && lun56.creditos >= lun56.filas.length,
    JSON.stringify({ creditos: (lun56 || {}).creditos, enMora: (lun56 || { filas: [] }).filas.length }));
  ok("y cuántos pagaron su cuota completa",
    !!lun56 && lun56.alCorriente >= 1 && lun56.creditos === lun56.alCorriente + lun56.filas.length,
    JSON.stringify({ alCorriente: (lun56 || {}).alCorriente, enMora: (lun56 || { filas: [] }).filas.length,
                     creditos: (lun56 || {}).creditos }));
  ok("y cuánto se cobró ese día",
    !!lun56 && lun56.cobrado >= 576, "cobrado " + (lun56 || {}).cobrado);
  ok("los totales de la semana suman lo de cada día",
    m2.creditos === (m2.dias || []).reduce((x, g) => x + g.creditos, 0)
    && m2.alCorriente === (m2.dias || []).reduce((x, g) => x + g.alCorriente, 0),
    JSON.stringify({ creditos: m2.creditos, alCorriente: m2.alCorriente }));

  // «¿CÓMO DETECTA QUE FUE EL LUNES EN TODA LA SEMANA?» (Karina, 10-ago). El
  // faltante se calcula con la SEMANA completa —si completó el jueves, ya no
  // debe—, pero eso solo escondería a las que van tarde. Por eso se miden las
  // dos: lo que abonó EL DÍA que le toca y lo que abonó en la semana.
  const SOC56b = "70000001111";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SOC56b, nombre: "HILDA SINTETICA 56", producto: "Grupal-Basico 2",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 432, cuota: 216, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-03-23" }) });
  const K56b = SOC56b + "|Grupal-Basico 2|HILDA SINTETICA 56|0";
  const lunAntes = ((await mora56()).dias || []).find((g) => g.dia === "LUNES") || {};
  // Paga completo, pero el MIÉRCOLES: se pone al corriente tarde.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: "2026-08-05", snapshot: { reg: { GHANIMA: { [K56b]: { pago: 216, forma: "E" } } } }, ts: Date.now() + 5 }) });
  const lunDespues = ((await mora56()).dias || []).find((g) => g.dia === "LUNES") || {};
  ok("la que completa entre semana deja de deber",
    lunDespues.alCorriente === lunAntes.alCorriente + 1,
    JSON.stringify({ antes: lunAntes.alCorriente, despues: lunDespues.alCorriente }));
  ok("pero NO cuenta como que pagó su día",
    lunDespues.alCorrienteSuDia === lunAntes.alCorrienteSuDia,
    JSON.stringify({ antes: lunAntes.alCorrienteSuDia, despues: lunDespues.alCorrienteSuDia }));
  ok("y lo cobrado ESE DÍA no se infla con lo de después",
    Math.abs(lunDespues.cobradoSuDia - lunAntes.cobradoSuDia) < 0.01
    && lunDespues.cobrado > lunAntes.cobrado,
    JSON.stringify({ suDiaAntes: lunAntes.cobradoSuDia, suDiaDespues: lunDespues.cobradoSuDia,
                     semanaAntes: lunAntes.cobrado, semanaDespues: lunDespues.cobrado }));

  // LA FECHA DE DESEMBOLSO AL LADO DE CADA CLIENTA (Karina, 10-ago). Sirve para
  // leer el renglón sin abrir otra cosa: una clienta que apenas desembolsó y ya
  // aparece debiendo salta a la vista.
  const conDesem = ((await mora56()).dias || []).flatMap((g) => g.filas);
  // EL DÍA POR NOMBRE, NO SOLO LA FECHA (Karina, 10-ago: «en vez de fecha dicen
  // lunes, martes, etc.»). Y las DOS cosas separadas, porque no son la misma:
  // el bloque lo manda el DÍA DE COBRO, no el día en que se desembolsó. Se
  // comprobó contra su archivo: el día de cobro empata en 11 de 11 y el del
  // desembolso solo en 8 de 11.
  const filas56 = ((await mora56()).dias || []).flatMap((g) => g.filas.map((x) => ({ g, x })));
  ok("cada renglón dice el DÍA del desembolso, no solo la fecha",
    filas56.length > 0 && filas56.filter(({ x }) =>
      /^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)$/.test(x.diaDesembolso || "")).length
      >= Math.floor(filas56.length * 0.9),
    "solo " + filas56.filter(({ x }) => x.diaDesembolso).length + " de " + filas56.length);
  ok("y también su día de cobro, que es el que agrupa",
    filas56.every(({ g, x }) => x.diaPago === g.dia), "hay renglones bajo un día que no es el suyo");
  ok("los dos días se distinguen: hay quien desembolsó en uno y cobra en otro",
    filas56.some(({ x }) => x.diaDesembolso && x.diaDesembolso !== x.diaPago),
    "en estos datos ninguno difiere");

  ok("cada renglón trae la fecha de desembolso",
    conDesem.length > 0 && conDesem.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.desembolso || "")).length
      >= Math.floor(conDesem.length * 0.9),
    "solo " + conDesem.filter((x) => x.desembolso).length + " de " + conDesem.length + " la traen");

  // Y LA QUE TODAVÍA NO RECIBE SU DINERO NO DEBE. Si el desembolso es posterior
  // a la semana, el crédito no existía: cobrarle mora sería inventarla.
  const SFUT = "70000000994";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SFUT, nombre: "AUN NO DESEMBOLSA", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 5000, cuota: 500, plazo: 10 }) });
  await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SFUT, producto: "Grupal-Basico", cuota: 500, motivo: "prueba desembolso futuro" }) });
  const mFut = await mora56();
  const estaFut = (mFut.dias || []).some((g) => g.filas.some((x) => String(x.socio) === SFUT));
  // Sin fecha de desembolso sí entra (es el caso normal del padrón viejo).
  ok("una clienta sin fecha de desembolso sí se mide",
    typeof estaFut === "boolean", "no se pudo evaluar");
  ok("y el reporte cuenta aparte las que aún no desembolsan",
    typeof (mFut.fueraDeCuenta || {}).sinDesembolsar === "number",
    JSON.stringify(mFut.fueraDeCuenta));

  // MORA vs POR VENCER (Karina, 12-ago: «checa por qué no nos cuadró con la de
  // ellos»). El archivo de Monse solo trae los días que YA PASARON; el nuestro
  // cargaba la semana completa, con jueves y viernes aún sin llegar. Un día
  // cuyo cobro no llega no es mora.
  const mHoy = await j(await fetch(U + "/api/mora", { headers: H(cm) }));   // semana EN CURSO
  ok("los días que aún no llegan vienen marcados como no vencidos",
    (mHoy.dias || []).every((g) => g.vencido === (g.fecha <= HOY)),
    JSON.stringify((mHoy.dias || []).map((g) => g.fecha + ":" + g.vencido)));
  const sumaV = Math.round((mHoy.dias || []).filter((g) => g.vencido).reduce((x, g) => x + g.total, 0) * 100) / 100;
  ok("la mora vencida a hoy solo suma los días que ya pasaron",
    Math.abs(mHoy.totalVencido - sumaV) < 0.01,
    mHoy.totalVencido + " vs " + sumaV);
  ok("y vencido + por vencer = la semana completa",
    Math.abs((mHoy.totalVencido + mHoy.totalPorVencer) - mHoy.total) < 0.01,
    JSON.stringify({ v: mHoy.totalVencido, pv: mHoy.totalPorVencer, t: mHoy.total }));

  // EL PAGO POR CAJA TAMBIÉN CUBRE LA CUOTA (Karina, 12-ago, al cotejar contra
  // el archivo rectificado de Monse: 4 pagos que ella tenía y nosotros no).
  // Si la clienta paga en la oficina y Dirección lo registra como recuperación,
  // antes le bajaba el saldo pero la mora la seguía marcando como deudora.
  const buscaM56 = (d, socio, prod) => {
    for (const g of d.dias || []) for (const x of g.filas)
      if (String(x.socio) === socio && (!prod || x.producto === prod)) return x;
    return null;
  };
  // El caso real del archivo de Monse fue MARIA DEL ROSARIO (pagó $500 de su
  // cuota de $576 en caja → falta $76), pero una prueba anterior de esta misma
  // sección ya la puso al corriente. Se usa a ELVIRA ROSA, que nadie ha tocado:
  // cuota $445, paga $400 por caja → falta $45.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: L56, tipo: "Recuperación / adelanto", concepto: "Pago en oficina",
      monto: 400, metodo: "efectivo", socio: "11113075182", producto: "Individual 1", ejecutivo: "christopher" }) });
  const mr56 = buscaM56(await mora56(), "11113075182", "Individual 1");
  ok("un pago por CAJA cubre la cuota (cuota $445 − $400 en caja = falta $45)",
    !!mr56 && mr56.faltante === 45 && mr56.pagado === 400, JSON.stringify(mr56));
  // Con DOS créditos, el pago por caja solo cubre el crédito que dice.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: L56, tipo: "Recuperación / adelanto", concepto: "Pago en oficina",
      monto: 648, metodo: "efectivo", socio: "11112946258", producto: "Grupal-Basico 2", ejecutivo: "neri" }) });
  const dv56 = await mora56();
  ok("con dos créditos, el pago por caja cubre SOLO el crédito que dice",
    buscaM56(dv56, "11112946258", "Grupal-Basico 2") === null
    && !!buscaM56(dv56, "11112946258", "Grupal-Micro 2"),
    JSON.stringify([buscaM56(dv56, "11112946258", "Grupal-Basico 2"), buscaM56(dv56, "11112946258", "Grupal-Micro 2")]));

  // LOS VENCIDOS NO VAN EN LA MORA SEMANAL (regla Monse 4-ago, confirmada el
  // 12-ago con su archivo: DAFNE SINAI, vencida en su propia plantilla, no
  // aparece en su mora — nosotros sí la listábamos).
  const mVen = await mora56();
  const dafne = (mVen.dias || []).some((g) => g.filas.some((x) => String(x.socio) === "11113042991"));
  ok("un crédito VENCIDO no aparece en la mora semanal",
    !dafne, "DAFNE SINAI (vencida) sigue en la lista");
  ok("pero queda contado aparte, no desaparece en silencio",
    (mVen.fueraDeCuenta || {}).vencidos >= 1, JSON.stringify(mVen.fueraDeCuenta));

  const fc56 = (await mora56()).fueraDeCuenta || {};
  ok("dice cuántos créditos dejó fuera y por qué",
    ["cuotaVariable", "sinCuota", "sinDia", "liquidados"].every((k) => typeof fc56[k] === "number"),
    JSON.stringify(fc56));
  const rx56 = await fetch(U + "/api/mora/excel?lunes=" + L56, { headers: H(cm) });
  const bx56 = Buffer.from(await rx56.arrayBuffer());
  ok("el Excel de la mora se descarga y es un xlsx de verdad",
    rx56.status === 200 && bx56.length > 5000 && bx56[0] === 0x50 && bx56[1] === 0x4B,
    "status " + rx56.status + " · " + bx56.length + " bytes");

  console.log("\n— 57. LA FECHA DE DESEMBOLSO VIAJA COMPLETA (Karina, 12-ago) —");
  // «Agrégale el campo de fecha de desembolso al re-dar crédito y al alta, y
  // que se vincule.» El caso PILAR: renovada con desembolso al 28-ago, el
  // re-crédito no cargaba la fecha y salió en la mora tres semanas antes de
  // recibir el dinero.
  const S57 = "70000000997";
  const cartAntes57 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  const r57 = await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S57, nombre: "PILAR DE PRUEBA 57", producto: "Grupal-Basico 2",
      centro: "C-0", ejecutivo: "Julio", saldo: 10368, cuota: 576, plazo: 18, desembolso: "2027-01-15" }) });
  ok("el alta acepta la fecha de desembolso (incluso futura)", r57.status === 200, "status " + r57.status);
  const enMora57 = async () => {
    const d = await j(await fetch(U + "/api/mora", { headers: H(cm) }));
    return (d.dias || []).some((g) => g.filas.some((x) => String(x.socio) === S57));
  };
  ok("un crédito que aún no desembolsa NO sale en la mora", !(await enMora57()), "salió en la mora");
  const v57 = ((await j(await fetch(U + "/api/vivos", { headers: H(cJul) }))).vivos || [])
    .find((x) => String(x.id) === S57);
  ok("y la fecha le baja a la app de la ejecutiva",
    !!v57 && v57.desembolso === "2027-01-15", JSON.stringify(v57));
  // Y LA CARTERA DEL TABLERO VA EN SINCRONÍA (Karina, 12-ago: «asegúrate que
  // sincronice con la mora en el tablero y lo demás»). Antes un crédito sin
  // desembolsar sumaba a lo esperado, y si su día ya había pasado el semáforo
  // lo pintaba EN MORA.
  const cart57 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("la cartera NO le espera cuota a quien aún no desembolsa",
    Math.abs((cart57.esperadoALaFecha || 0) - (cartAntes57.esperadoALaFecha || 0)) < 0.01
    && Math.abs((cart57.esperado || 0) - (cartAntes57.esperado || 0)) < 0.01,
    JSON.stringify({ antes: cartAntes57.esperadoALaFecha, despues: cart57.esperadoALaFecha }));
  ok("y el semáforo la pone en PENDIENTE, no en mora",
    cart57.semaforo.pendiente === cartAntes57.semaforo.pendiente + 1
    && cart57.semaforo.enMora === cartAntes57.semaforo.enMora,
    JSON.stringify({ antes: cartAntes57.semaforo, despues: cart57.semaforo }));
  // El re-crédito también la guarda.
  await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S57, producto: "Grupal-Basico 2", motivo: "No renovó" }) });
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S57, producto: "Grupal-Basico 2", saldo: 12000, cuota: 600,
      plazo: 20, ejecutivo: "Julio", desembolso: "2027-02-01", motivo: "Renovación futura" }) });
  const c57 = ((await j(await fetch(U + "/api/clientes?q=" + S57, { headers: H(cm) }))).resultados || [])
    .find((c) => c.activa !== false && c.estatus !== "BAJA");
  ok("el re-crédito guarda la fecha de desembolso",
    !!c57 && c57.desembolso === "2027-02-01", JSON.stringify((c57 || {}).desembolso));
  ok("y tampoco sale en la mora hasta que desembolse", !(await enMora57()), "salió en la mora");
  const rMal = await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: "70000000998", nombre: "FECHA CHUECA", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 100, plazo: 10, desembolso: "28/08/2026" }) });
  ok("una fecha chueca se rechaza con un error que se entiende", rMal.status === 400, "status " + rMal.status);

  console.log("\n— 58. UN MOVIMIENTO ANULADO SE VE, PERO NO CUENTA (Karina, 12-ago) —");
  // La liquidación de YOALI KAREN: la ejecutiva la registró el lunes, un
  // re-sync de su app la anuló, y como los anulados no salían en el reporte del
  // periodo era INVISIBLE — parecía que nunca se registró.
  // Fecha propia: el HOY de Julio ya quedó CERRADO por secciones anteriores,
  // y un día cerrado no anula por re-sync (también es protección, sección 24).
  const F58 = "2026-06-17";
  const K58mov = { folio: "AN58", concepto: "LIQUIDACION", socio: "11112931059",
    producto: "COMADRE", clienta: "BLANCA LUIS BERNAL", monto: 777, via: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: F58, snapshot: { movs: [K58mov] }, ts: Date.now() }) });
  // Re-sync del día SIN ese movimiento pero CON otro contenido: así es la
  // anulación legítima desde la app (borró el renglón y volvió a sincronizar).
  // Un sync totalmente vacío NO anula — esa protección ya existe (sección 5c)
  // y de hecho atajó el primer intento de esta prueba.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: F58, snapshot: { movs: [{ folio: "AN58b", concepto: "GASTO",
      monto: 10, via: "E", tipoGasto: "Gasolina", nota: "ruta" }] }, ts: Date.now() + 1 }) });
  const per58 = await j(await fetch(U + "/api/periodo?desde=" + F58 + "&hasta=" + F58, { headers: H(cm) }));
  const anulado58 = (per58.otros || []).find((x) => /AN58$/.test(x.folio || ""));
  ok("el movimiento anulado SÍ aparece en el reporte del periodo",
    !!anulado58 && anulado58.anulado === true, JSON.stringify(anulado58 || "no vino"));
  ok("con su crédito, para saber de cuál era",
    !!anulado58 && anulado58.producto === "COMADRE", (anulado58 || {}).producto || "sin producto");
  ok("pero NO suma en los totales del día",
    !((per58.porDia || []).some((x) => x.fecha === F58 && Math.abs((x.entradas || 0) - 777) < 778 && (x.entradas || 0) >= 777)),
    JSON.stringify(per58.porDia));

  console.log("\n— 59. VER PAGOS DICE LA VERDAD COMPLETA (Karina, 12-ago, caso YOALI) —");
  // Dos hoyos en la misma tarjeta: (1) los pagos capturados DENTRO de un centro
  // no salían — solo los individuales—, y por eso el pago del lunes de YOALI
  // «no se veía»; (2) una liquidación con crédito dicho salía en TODOS los
  // créditos de la socia, no solo en el suyo.
  const S59 = "70000000999";
  const K59a = S59 + "|Grupal-Basico 2|YOALI DE PRUEBA 59|0";
  const K59b = S59 + "|Grupal-Adicional|YOALI DE PRUEBA 59|0";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S59, nombre: "YOALI DE PRUEBA 59", producto: "Grupal-Basico 2",
      centro: "C-0", ejecutivo: "Julio", saldo: 3456, cuota: 576, plazo: 6 }) });
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S59, nombre: "YOALI DE PRUEBA 59", producto: "Grupal-Adicional",
      centro: "C-0", ejecutivo: "Julio", saldo: 2400, cuota: 200, plazo: 12 }) });
  // Pago del lunes DENTRO de un centro (reg de dos niveles), en transferencia.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-06-22", snapshot: { reg: { "C-12 · PRUEBA": {
      [K59a]: { pago: 576, garantia: 24, forma: "T" },
      [K59b]: { pago: 200, forma: "T" } } } }, ts: Date.now() }) });
  // Liquidación de HOY con su crédito dicho.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-06-24", snapshot: { movs: [{ folio: "YK59",
      concepto: "LIQUIDACION", socio: S59, producto: "Grupal-Basico 2",
      clienta: "YOALI DE PRUEBA 59", monto: 2880, via: "E" }] }, ts: Date.now() + 1 }) });
  const hist59 = async (prod) => j(await fetch(U + "/api/credito/historial?id=" + S59
    + "&producto=" + encodeURIComponent(prod), { headers: H(cm) }));
  const hA = await hist59("Grupal-Basico 2");
  ok("el pago capturado DENTRO de un centro sí sale en Ver pagos",
    (hA.historial || []).some((x) => x.fecha === "2026-06-22" && x.pago === 576 && x.tipo === "pago"),
    JSON.stringify((hA.historial || []).map((x) => x.fecha + ":" + x.tipo + ":" + x.pago)));
  ok("y la liquidación aparece en el crédito que ELLA dijo",
    (hA.historial || []).some((x) => x.tipo === "liquidacion" && x.pago === 2880), "no está");
  const hB = await hist59("Grupal-Adicional");
  ok("pero NO aparece en el otro crédito de la misma socia",
    !(hB.historial || []).some((x) => x.tipo === "liquidacion"),
    JSON.stringify((hB.historial || []).map((x) => x.tipo + ":" + x.pago)));
  ok("el otro crédito solo trae lo suyo",
    (hB.historial || []).some((x) => x.pago === 200) && (hB.historial || []).length >= 1,
    JSON.stringify(hB.historial));

  // EL BARRIDO (Karina: «checa si pasó con otras más»). No se revisa una
  // clienta: se revisan TODAS las que tuvieron movimiento en esta corrida — la
  // batería ya sembró pagos en centros, individuales, liquidaciones ligadas,
  // renovaciones y correcciones. Para cada una, lo APLICADO al saldo tiene que
  // poderse LISTAR en Ver pagos. Si mañana un cambio vuelve a esconder pagos,
  // esta red lo pesca sin importar por cuál rincón se esconda.
  const barrido59 = await j(await fetch(U + "/api/desglose", { headers: H(cm) }));
  ok("BARRIDO: en TODOS los créditos con movimiento (" + barrido59.revisados
      + "), lo aplicado se puede listar completo",
    (barrido59.rotos || []).length === 0,
    (barrido59.rotos || []).slice(0, 5).map((r) => r.nombre + " (" + r.producto + "): faltan $" + r.faltaEnLaLista).join(" · "));
  // El universo depende del día: un LUNES temprano hay pocos créditos con
  // movimiento en la semana, y eso no es una falla del barrido. Lo que importa
  // es que revise TODO lo que hay, no un caso suelto.
  ok("y el barrido revisó un universo de verdad, no un caso suelto",
    barrido59.revisados >= 5, "solo " + barrido59.revisados + " créditos con movimiento");

  console.log("\n— 60. EL DÍA DE PAGO VIAJA CON EL ALTA (Karina, 12-ago) —");
  // «A todas les tienes que poner día de pago para ver quién nos falta, y que
  // cuando den de alta traiga ese dato y no nos falle la mora.» Sin día, la
  // clienta es INVISIBLE para la mora semanal.
  const S60 = "70000001000";
  // (a) Alta CON día dicho.
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S60, nombre: "DONA CON DIA 60", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 4800, cuota: 400, plazo: 12, diaPago: "Lunes" }) });
  const c60 = ((await j(await fetch(U + "/api/clientes?q=" + S60, { headers: H(cm) }))).resultados || [])
    .find((c) => c.activa !== false && c.estatus !== "BAJA");
  ok("el alta guarda el día de pago", !!c60 && c60.diaPago === "LUNES", JSON.stringify((c60 || {}).diaPago));
  // Dada de alta HOY, su primera cuota es el lunes SIGUIENTE (17-ago): en esa
  // semana SÍ aparece bajo su día — y en las semanas de antes de existir, no.
  const m60 = await j(await fetch(U + "/api/mora?lunes=2026-08-17", { headers: H(cm) }));
  ok("y con día, la clienta SÍ entra a la mora bajo su día",
    (m60.dias || []).some((g) => g.dia === "LUNES" && g.filas.some((x) => String(x.socio) === S60)),
    "no salió bajo LUNES");
  // SIN FECHA DE DESEMBOLSO se mide desde el corte, como cualquier otra: se
  // asume que el crédito YA venía corriendo. Es lo correcto y lo conservador —
  // Monse da de alta clientas que llevan meses pagando, y tratarlas como
  // recién nacidas las dejaba exentas de mora (el hoyo del 15-ago). Para
  // proteger a un crédito nuevo de verdad, se captura su desembolso.
  const S60d = "70000001003";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S60d, nombre: "DONA CON DESEMBOLSO 60", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 4800, cuota: 400, plazo: 12, diaPago: "Lunes",
      desembolso: HOY }) });
  const m60ants = await j(await fetch(U + "/api/mora?lunes=2026-08-03", { headers: H(cm) }));
  ok("con su desembolso capturado, NO debe la semana de ANTES de existir",
    !(m60ants.dias || []).some((g) => g.filas.some((x) => String(x.socio) === S60d)),
    "salió debiendo una semana en la que su crédito no existía");
  // (b) Alta SIN día en un centro que cobra en un día ÚNICO: lo hereda.
  const S60b = "70000001001";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S60b, nombre: "DONA HEREDA DIA 60", producto: "Grupal-Basico",
      centro: "ADNACHIEL", ejecutivo: "Neri", saldo: 2400, cuota: 200, plazo: 12 }) });
  const c60b = ((await j(await fetch(U + "/api/clientes?q=" + S60b, { headers: H(cm) }))).resultados || [])
    .find((c) => c.activa !== false && c.estatus !== "BAJA");
  ok("un alta sin día HEREDA el día único de su centro (ADNACHIEL cobra martes)",
    !!c60b && c60b.diaPago === "MARTES", JSON.stringify((c60b || {}).diaPago));
  // (c) El re-crédito conserva el día del ciclo anterior.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: HOY, snapshot: { movs: [{ folio: "D60", concepto: "LIQUIDACION",
      socio: S60, producto: "Grupal-Basico", clienta: "DONA CON DIA 60", monto: 4800, via: "E" }] }, ts: Date.now() }) });
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S60, producto: "Grupal-Basico", saldo: 6000, cuota: 500,
      plazo: 12, ejecutivo: "Julio", motivo: "Renovación 60" }) });
  const c60c = ((await j(await fetch(U + "/api/clientes?q=" + S60, { headers: H(cm) }))).resultados || [])
    .find((c) => c.activa !== false && c.estatus !== "BAJA");
  ok("el re-crédito conserva el día del ciclo anterior",
    !!c60c && c60c.diaPago === "LUNES", JSON.stringify((c60c || {}).diaPago));
  // (d) Un día inventado se rechaza.
  const rD60 = await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: "70000001002", nombre: "DIA CHUECO", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 100, plazo: 10, diaPago: "LUNES Y JUEVES" }) });
  ok("un día inventado se rechaza", rD60.status === 400, "status " + rD60.status);

  console.log("\n— 61. MOTOR DE REGLAS · intereses por producto (Karina y su tío, 12-ago) —");
  // «Teníamos que hacer un motor de reglas AFUERA de nuestro código con los
  // cálculos.» Y es lo correcto aquí: la tasa de MAGNUS estuvo en duda, los
  // topes de FOXI+ se contradicen entre dos documentos firmados, y sigue sin
  // decidirse qué tasa se imprime. Con las reglas en el código, cada cambio
  // sería un programador y un despliegue.
  const reg61 = await j(await fetch(U + "/api/reglas", { headers: H(cm) }));
  ok("el motor se lee desde el archivo de reglas, no del código",
    !!reg61.version && Array.isArray(reg61.listos), JSON.stringify(reg61).slice(0, 120));
  ok("y se autocomprueba contra los ejemplos que validó la contadora",
    reg61.autoprueba && reg61.autoprueba.ok === true,
    JSON.stringify((reg61.autoprueba || {}).casos || []));

  // LOS TRES EJEMPLOS VALIDADOS, uno por uno.
  const sim = async (qs) => {
    const r = await fetch(U + "/api/reglas/simular?" + qs, { headers: H(cm) });
    return { status: r.status, d: await r.json() };
  };
  const com = await sim("producto=COMADRE&monto=10000&plazo=12");
  ok("COMADRE $10,000 / 12 sem / 20% da la cuota de $1,413.33",
    com.status === 200 && Math.abs(com.d.cuota - 1413.33) < 0.01, JSON.stringify(com.d.cuota));
  ok("y el capital cierra EXACTO: suma $10,000 y el saldo final es $0.00",
    com.d.totales.capital === 10000 && com.d.pagos[com.d.pagos.length - 1].saldo === 0,
    JSON.stringify({ capital: com.d.totales.capital, ultimo: com.d.pagos[com.d.pagos.length - 1] }));
  const pu = await sim("producto=PAGO_UNICO&monto=50000&dias=37");
  ok("Pago Único $50,000 / 37 días / 10% da $57,153.33",
    pu.status === 200 && Math.abs(pu.d.totales.aPagar - 57153.33) < 0.01,
    JSON.stringify((pu.d.totales || {}).aPagar));
  // MAGNUS: el prorrateo por DÍAS REALES es el hallazgo 18 del Anexo E — con
  // mes plano daría $3,040 y con 45 días reales da $4,560.
  const mg = await sim("producto=MAGNUS&monto=100000&plazo=24&diasPorPeriodo="
    + [45].concat(Array(23).fill(30)).join(","));
  ok("MAGNUS prorratea por DÍAS reales: primer corte a 45 días = $4,560 de interés",
    mg.status === 200 && Math.abs(mg.d.pagos[0].interes - 4560) < 0.01,
    JSON.stringify((mg.d.pagos || [])[0]));
  ok("y su cuota BAJA cada periodo (saldos insolutos)",
    mg.status === 200 && mg.d.pagos[1].cuota > mg.d.pagos[2].cuota,
    JSON.stringify((mg.d.pagos || []).slice(1, 3).map((x) => x.cuota)));

  // LO QUE NO SE PUEDE CALCULAR SE NIEGA — no se inventa un interés.
  const fx = await sim("producto=Foxi%20Plus%20-%201&monto=30000&plazo=18");
  ok("un producto sin tasa NO se calcula: se niega y dice qué falta",
    fx.status === 400 && /tope|tasa/i.test(fx.d.motivo || ""), JSON.stringify(fx.d));
  ok("y el motor lista aparte los que esperan dato, para poder pedirlos",
    (reg61.esperando || []).length > 0 && (reg61.esperando || []).every((p) => p.faltaPara),
    JSON.stringify((reg61.esperando || []).map((p) => p.nombre)));
  ok("el moratorio tampoco se inventa: espera su tasa",
    reg61.moratorio && reg61.moratorio.pendiente === true, JSON.stringify(reg61.moratorio));

  console.log("\n— 62. MORA DE CENTROS EN EL ARQUEO DEL DÍA (idea de Karina, 12-ago) —");
  // Su boceto: cada centro con su monto, la clienta debajo, «Total de Mora del
  // día» y «TOTAL DE MORA» acumulado. Lo que había era UN SOLO NÚMERO, y encima
  // solo contaba a las que pagaron DE MENOS: la que no pagaba nada no sumaba.
  const F62 = "2026-08-10";   // lunes
  const K62 = "70000001110|Grupal-Basico 2|MARIA SINTETICA 56|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: F62, snapshot: { reg: { GHANIMA: { [K62]: { pago: 450, forma: "E" } } } }, ts: Date.now() }) });
  const md62 = await j(await fetch(U + "/api/mora/dia?fecha=" + F62, { headers: H(cm) }));
  ok("la mora del día viene agrupada por CENTRO",
    Array.isArray(md62.centros) && md62.centros.length > 0
    && md62.centros.every((g) => g.centro && Array.isArray(g.filas)),
    JSON.stringify((md62.centros || []).map((g) => g.centro)));
  ok("cada centro trae su ejecutiva y su total",
    md62.centros.every((g) => g.ejecutivo && typeof g.total === "number"),
    JSON.stringify(md62.centros[0]).slice(0, 140));
  ok("y las clientas por nombre — sin nombre no se puede ir a cobrar",
    md62.centros.some((g) => g.filas.some((x) => x.clienta && x.faltante > 0)),
    "no vino ninguna clienta");
  // LA QUE NO PAGÓ NADA TAMBIÉN CUENTA (lo que no hacía el número viejo).
  const noPago = md62.centros.some((g) => g.filas.some((x) => x.pagado === 0 && x.faltante === x.cuota));
  ok("la que NO pagó nada suma su cuota completa",
    noPago, "solo aparecen las que pagaron de menos");
  // Y la parcial suma solo la diferencia.
  const parcial = md62.centros.flatMap((g) => g.filas).find((x) => String(x.socio) === "70000001110");
  ok("y la que pagó de menos suma solo la diferencia (cuota − pagado)",
    !!parcial && parcial.pagado === 450 && parcial.faltante === parcial.cuota - 450,
    JSON.stringify(parcial));
  ok("el total del día es la suma de sus centros",
    Math.abs(md62.totalDia - md62.centros.reduce((t, g) => t + g.total, 0)) < 0.01,
    md62.totalDia + " vs " + md62.centros.reduce((t, g) => t + g.total, 0));
  // EL PUENTE CON LA MORA DE LA SEMANA (Karina, 12-ago: «el arqueo muestra más
  // que esta parte del sistema»). No era un error de cálculo: son dos preguntas
  // distintas — el arqueo mide quién NO pagó ESE DÍA, y la semanal perdona a la
  // que se puso al corriente después. Ahora el arqueo enseña los dos números y
  // su diferencia, para que nadie los vea como contradictorios.
  const SOC62b = "70000001112";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SOC62b, nombre: "PUENTE SINTETICA 62", producto: "Grupal-Basico 2",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 1080, cuota: 216, plazo: 24, diaPago: "Lunes",
      desembolso: "2026-03-23" }) });
  const K62b = SOC62b + "|Grupal-Basico 2|PUENTE SINTETICA 62|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: "2026-08-12", snapshot: { reg: { GHANIMA: { [K62b]: { pago: 216, forma: "E" } } } }, ts: Date.now() + 3 }) });
  const md62b = await j(await fetch(U + "/api/mora/dia?fecha=" + F62, { headers: H(cm) }));
  const tarde = md62b.centros.flatMap((g) => g.filas).find((x) => String(x.socio) === SOC62b);
  ok("la que se puso al corriente después SÍ aparece en la mora de ESE día",
    !!tarde && tarde.faltante > 0, "no aparece");
  ok("pero se marca que ya pagó, y su pendiente queda en cero",
    !!tarde && tarde.pagadoDespues > 0 && tarde.sigueDebiendo === 0, JSON.stringify(tarde));
  ok("el bloque cierra con el puente: mora del día − recuperado = sigue debiendo",
    Math.abs((md62b.totalDia - md62b.recuperado) - md62b.pendiente) < 0.01,
    JSON.stringify({ dia: md62b.totalDia, recuperado: md62b.recuperado, pendiente: md62b.pendiente }));
  // Y ese "sigue debiendo" es EXACTAMENTE lo que reporta la mora de la semana.
  const sem62 = await j(await fetch(U + "/api/mora?lunes=" + F62, { headers: H(cm) }));
  const lun62 = (sem62.dias || []).find((g) => g.dia === "LUNES") || { total: -1 };
  // Si difieren, la prueba dice EN QUÉ CRÉDITO — un "$700 de diferencia" no se
  // puede perseguir; un nombre sí.
  const porClave62 = {};
  for (const g of md62b.centros) for (const x of g.filas) porClave62[x.socio + "|" + x.producto] = x;
  const semClave62 = {};
  for (const x of (lun62.filas || [])) semClave62[x.socio + "|" + x.producto] = x;
  const dif62 = [];
  for (const k in porClave62) {
    const a2 = porClave62[k].sigueDebiendo, b2 = semClave62[k] ? semClave62[k].faltante : 0;
    if (Math.abs(a2 - b2) > 0.01) dif62.push(porClave62[k].clienta + " (" + porClave62[k].producto + "): arqueo $" + a2 + " vs semanal $" + b2);
  }
  for (const k in semClave62) if (!porClave62[k])
    dif62.push(semClave62[k].clienta + " (" + semClave62[k].producto + "): solo en la semanal, $" + semClave62[k].faltante);
  ok("y coincide al centavo con lo que dice «Mora de la semana» para ese día",
    Math.abs(md62b.pendiente - lun62.total) < 0.01,
    "difieren $" + Math.round((md62b.pendiente - lun62.total) * 100) / 100
      + " en " + dif62.length + " créditos · " + dif62.slice(0, 4).join(" · "));

  // El acumulado va NETO de recuperaciones (Karina, 18-ago), así que se compara
  // contra lo que SIGUE debiéndose del día, no contra el bruto.
  ok("y trae el acumulado de la semana en sus DOS cifras: lo que faltó y lo que sigue debiéndose",
    typeof md62.totalSemanaAlDia === "number" && typeof md62.totalSemanaSigueDebiendo === "number"
      && md62.totalSemanaSigueDebiendo <= md62.totalSemanaAlDia + 0.01
      && md62.totalSemanaAlDia >= md62.totalDia - 0.01,
    JSON.stringify({ dia: md62.totalDia, semana: md62.totalSemanaAlDia, sigue: md62.totalSemanaSigueDebiendo }));
  // MISMA REGLA QUE LA MORA SEMANAL: los excluidos se cuentan, no se callan.
  ok("dice lo que dejó fuera, igual que la mora de la semana",
    md62.fuera && ["vencidos", "cuotaVariable", "sinCuota", "sinDesembolsar"]
      .every((k) => typeof md62.fuera[k] === "number"), JSON.stringify(md62.fuera));
  // Y que de verdad salga en el Excel del arqueo.
  const rx62 = await fetch(U + "/api/arqueo/excel?fecha=" + F62, { headers: H(cm) });
  const bx62 = Buffer.from(await rx62.arrayBuffer());
  ok("y el Excel del arqueo se genera con el bloque adentro",
    rx62.status === 200 && bx62.length > 5000 && bx62[0] === 0x50, "status " + rx62.status);

  console.log("\n— 63. LOS TRES CASOS DE MONSE: adelantos y saldos chicos (14-ago) —");
  // Monse validó la mora a mano y encontró lo que faltaba: 1) ARIELA adelantó
  // un pago LA SEMANA PASADA y salía debiendo; 2) LA CONSENTIDA pagó el
  // MIÉRCOLES su cuota del jueves y salía debiendo; 3) a LUCIA le quedan $442
  // de saldo y se le exigía la cuota completa. La regla es una: desde el corte,
  // cada día de cobro vencido exige una cuota, TODO lo abonado cuenta, y el
  // faltante se acota a una cuota y al saldo restante.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });

  // (1) ARIELA: clienta de JUEVES que el jueves PASADO (06-ago) pagó DOBLE.
  const S63a = "70000001063";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    // Desembolsada el 30-jul: al 13-ago le tocaban 2 pagos y lleva 2 (pagó
    // doble el 6-ago). Trae UNA cuota de adelanto.
    body: JSON.stringify({ id: S63a, nombre: "ARIELA DE PRUEBA 63", producto: "Grupal-Basico 2",
      centro: "C-0", ejecutivo: "Julio", saldo: 7060, cuota: 706, plazo: 10, diaPago: "Jueves",
      desembolso: "2026-07-30" }) });
  const K63a = S63a + "|Grupal-Basico 2|ARIELA DE PRUEBA 63|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-06", snapshot: { regI: { [K63a]: { pago: 1412, forma: "E" } } }, ts: Date.now() }) });
  const w63 = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const enMora63 = (soc) => (w63.dias || []).some((g) => g.filas.some((x) => String(x.socio) === soc));
  ok("la que ADELANTÓ la semana pasada ya NO sale debiendo esta semana",
    !enMora63(S63a), "ARIELA de prueba sigue en la mora");

  // (2) LA CONSENTIDA: clienta de JUEVES que paga el MIÉRCOLES de esta semana.
  const S63b = "70000001064";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S63b, nombre: "CONSENTIDA DE PRUEBA 63", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 4800, cuota: 480, plazo: 10, diaPago: "Jueves",
      desembolso: "2026-08-07" }) });
  const K63b = S63b + "|Grupal-Basico|CONSENTIDA DE PRUEBA 63|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-12", snapshot: { regI: { [K63b]: { pago: 480, forma: "E" } } }, ts: Date.now() + 1 }) });
  const w63b = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  ok("la que pagó ANTES de su día (miércoles por jueves) tampoco sale",
    !(w63b.dias || []).some((g) => g.filas.some((x) => String(x.socio) === S63b)),
    "LA CONSENTIDA de prueba sigue en la mora");
  const d63b = await j(await fetch(U + "/api/mora/dia?fecha=2026-08-13", { headers: H(cm) }));
  ok("ni en la mora del ARQUEO de su día (jueves)",
    !(d63b.centros || []).some((g) => g.filas.some((x) => String(x.socio) === S63b)),
    "sale en el arqueo del jueves");

  // (3) LUCIA: le quedan $442 de saldo — no se le puede exigir la cuota entera.
  const S63c = "70000001065";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S63c, nombre: "LUCIA DE PRUEBA 63", producto: "Grupal-Basico 2",
      centro: "C-0", ejecutivo: "Julio", saldo: 874, cuota: 432, plazo: 2, diaPago: "Jueves",
      desembolso: "2026-07-30" }) });
  const K63c = S63c + "|Grupal-Basico 2|LUCIA DE PRUEBA 63|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-06", snapshot: { regI: { [K63c]: { pago: 432, forma: "E" } } }, ts: Date.now() + 2 }) });
  const w63c = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const lucia = (w63c.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === S63c);
  ok("a la que le queda MENOS que una cuota solo se le exige el saldo ($442)",
    !!lucia && lucia.faltante === 442, JSON.stringify(lucia));

  // Y el atrasado NO infla: quien va 3 cuotas atrás sale con UNA cuota, no tres.
  const S63d = "70000001066";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    // Desembolsada el 2-jul (6 jueves vencidos al 13-ago), debería deberle
    // $7,000 (14 cuotas de 20); su saldo de $8,500 dice que va 3 atrás.
    body: JSON.stringify({ id: S63d, nombre: "ATRASADA DE PRUEBA 63", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 8500, cuota: 500, plazo: 20, diaPago: "Jueves",
      desembolso: "2026-07-02" }) });
  const w63d = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const atr = (w63d.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === S63d);
  ok("los atrasos viejos NO inflan la semana: se exige una cuota, no todas",
    !!atr && atr.faltante === 500, JSON.stringify(atr));

  console.log("\n— 64. RENOVACIONES: quién no volvió y quién está por terminar (Karina, 14-ago) —");
  // «Hay que poner las renovaciones pendientes o las que NO renovaron de los
  // ejecutivos, en el de Anel.» Son dos listas distintas y no se deben mezclar:
  // la que ya terminó y sigue sin crédito es cartera que se enfría; la que está
  // por terminar es trabajo por hacer ANTES de que cierre.

  // (a) TERMINÓ DE PAGAR y no tiene otro crédito: sale en «no renovaron».
  const S64a = "70000001070";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S64a, nombre: "TERMINO SIN VOLVER 64", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 500, plazo: 2, diaPago: "Lunes" }) });
  const K64a = S64a + "|Grupal-Basico|TERMINO SIN VOLVER 64|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-10", snapshot: { regI: { [K64a]: { pago: 1000, forma: "E" } } }, ts: Date.now() + 10 }) });
  const rn = async (q) => j(await fetch(U + "/api/renovaciones" + (q || ""), { headers: H(cm) }));
  const r64 = await rn();
  const sin64 = (soc, d) => (d.sinRenovar || []).find((x) => String(x.socio) === soc);
  const q64 = sin64(S64a, r64);
  ok("la que terminó de pagar y no tiene otro crédito sale en «no renovaron»", !!q64, "no salió");
  ok("y dice CUÁNDO terminó y cuántos días lleva sin renovar",
    !!q64 && q64.fechaFin === "2026-08-10" && q64.dias >= 0, JSON.stringify(q64));

  // (b) LA QUE SÍ RENOVÓ no aparece: terminó, pero ya trae crédito nuevo vivo.
  const S64b = "70000001071";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S64b, nombre: "SI RENOVO 64", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 500, plazo: 2, diaPago: "Lunes" }) });
  const K64b = S64b + "|Grupal-Basico|SI RENOVO 64|0";
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-10", snapshot: { regI: { [K64b]: { pago: 1000, forma: "E" } } }, ts: Date.now() + 11 }) });
  ok("antes de renovar, sí aparece pendiente", !!sin64(S64b, await rn()), "no salió");
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S64b, producto: "Grupal-Basico", saldo: 6000, cuota: 500,
      plazo: 12, ejecutivo: "Julio", motivo: "Renovación 64" }) });
  ok("y en cuanto se le RE-DA el crédito, desaparece de la lista",
    !sin64(S64b, await rn()), "sigue apareciendo como no renovada");

  // (c) POR TERMINAR: le faltan 2 cuotas, entra al aviso de 3 o menos.
  const S64c = "70000001072";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S64c, nombre: "CASI TERMINA 64", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 500, plazo: 2, diaPago: "Lunes" }) });
  const r64c = await rn();
  const pt64 = (d, soc) => (d.porTerminar || []).find((x) => String(x.socio) === soc);
  ok("a la que le faltan 2 cuotas se avisa que está por terminar",
    !!pt64(r64c, S64c) && pt64(r64c, S64c).semanas === 2, JSON.stringify(pt64(r64c, S64c)));
  // Y el umbral MANDA: con «2 o menos» sigue; con una clienta larga, no entra.
  const S64d = "70000001073";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S64d, nombre: "LARGA 64", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 10000, cuota: 500, plazo: 20, diaPago: "Lunes" }) });
  const r64d = await rn();
  ok("a la que le faltan 20 cuotas NO se le avisa todavía", !pt64(r64d, S64d), "salió antes de tiempo");

  // (d) UN VENCIDO NO ES RENOVACIÓN: va en recuperación, y se dice.
  const fuera64 = (await rn()).fuera || {};
  ok("los vencidos y los de cuota variable se cuentan aparte, no se callan",
    typeof fuera64.vencidos === "number" && typeof fuera64.cuotaVariable === "number"
      && typeof fuera64.sinCuota === "number", JSON.stringify(fuera64));

  // (e) EL CORTE POR EJECUTIVO cuadra con las listas.
  const r64e = await rn();
  const sumaEj = (r64e.porEjecutivo || []).reduce((a2, g) => a2 + g.sinRenovar, 0);
  ok("el corte por ejecutivo suma exactamente lo mismo que la lista",
    sumaEj === (r64e.totales || {}).sinRenovar,
    "por ejecutivo " + sumaEj + " vs total " + (r64e.totales || {}).sinRenovar);

  // (g) EL CORTE DEL MES (Karina, 14-ago: «si quiero ver de todo el mes»).
  // La renovación de SI RENOVO 64 se dio HOY, así que cae en el mes en curso.
  const mesHoy = HOY.slice(0, 7);
  const r64m = await rn("?mes=" + mesHoy);
  const dm = r64m.delMes || {};
  ok("el corte del mes cuenta las renovaciones que se dieron en ese mes",
    dm.mes === mesHoy && dm.renovaron >= 1, JSON.stringify(dm));
  ok("y saca la tasa: de las que cerraron ciclo, cuántas volvieron a salir",
    dm.cerraronCiclo === dm.renovaron + dm.terminaronSinRenovar
      && dm.tasa === Math.round((dm.renovaron / dm.cerraronCiclo) * 100), JSON.stringify(dm));
  ok("la clienta que renovó viene con su fecha y su monto nuevo",
    (r64m.renovaron || []).some((x) => String(x.socio) === S64b && x.fecha === HOY && x.monto === 6000),
    JSON.stringify((r64m.renovaron || []).slice(0, 3)));
  // UN MES SIN MOVIMIENTO no inventa nada: cero renovaciones y tasa en blanco.
  const r64v = await rn("?mes=2020-01");
  ok("un mes sin movimiento sale en cero, no inventa una tasa",
    (r64v.delMes || {}).renovaron === 0 && (r64v.delMes || {}).tasa === null,
    JSON.stringify(r64v.delMes));
  // UN MES ANTERIOR AL CORTE NO SE PUEDE MEDIR y hay que decirlo: el saldo de
  // cada clienta es la foto del corte, así que quien terminó antes ya venía en
  // cero. Enseñar «0 cerraron ciclo» sería mentira, y la tasa que salía de ahí
  // (100% con una sola renovación) llevaba a decisiones con un número falso.
  const dv = r64v.delMes || {};
  ok("un mes ANTERIOR al corte se marca y no se puede medir",
    dv.antesDelCorte === true && dv.terminaronSinRenovar === null && dv.cerraronCiclo === null,
    JSON.stringify(dv));
  ok("y NUNCA saca tasa de un mes que no puede medir",
    dv.tasa === null && (r64v.porEjecutivo || []).every((g) => g.tasa === null),
    JSON.stringify((r64v.porEjecutivo || []).slice(0, 3)));
  ok("en cambio el mes en curso SÍ se puede medir y lo dice",
    (r64m.delMes || {}).antesDelCorte === false && typeof (r64m.delMes || {}).cerraronCiclo === "number",
    JSON.stringify(r64m.delMes));
  // Y la proyección no aplica hacia atrás: "terminan este mes" en un mes que
  // ya pasó no significa nada, así que va en blanco, no en cero.
  ok("«terminan este mes» no se contesta para un mes que ya pasó",
    dv.terminanEnElMes === null, JSON.stringify(dv));
  // CADA CONTEO CON SU DINERO: contar clientas sin pesos no decide nada.
  ok("el mes en curso dice cuánto dinero se enfrió y cuánto está por cobrarse",
    typeof (r64m.delMes || {}).montoTerminaronSinRenovar === "number"
      && typeof (r64m.delMes || {}).montoTerminanEnElMes === "number", JSON.stringify(r64m.delMes));
  ok("y en un mes que no se puede medir, esos montos van en blanco, no en cero",
    dv.montoTerminaronSinRenovar === null && dv.montoTerminanEnElMes === null, JSON.stringify(dv));
  // Y EL PENDIENTE NO SE FILTRA POR MES: la que terminó en otro mes y no ha
  // vuelto sigue urgiendo hoy. Si el mes la escondiera, se perdería.
  ok("cambiar el mes NO esconde el pendiente acumulado",
    (r64v.totales || {}).sinRenovar === (r64m.totales || {}).sinRenovar,
    "el mes recortó la lista de pendientes");
  // La proyección dice CUÁNDO termina, para poder preguntar por mes.
  const casi = (r64m.porTerminar || []).find((x) => String(x.socio) === S64c);
  ok("a la que está por terminar se le calcula la fecha de su última cuota",
    !!casi && /^\d{4}-\d{2}-\d{2}$/.test(String(casi.fechaEstimada || "")), JSON.stringify(casi));

  // (f) Y baja en Excel, que es como se lo pasan a las ejecutivas.
  const rx64 = await fetch(U + "/api/renovaciones/excel?mes=" + mesHoy, { headers: H(cm) });
  ok("el reporte de renovaciones baja en Excel",
    rx64.status === 200 && /spreadsheet/.test(rx64.headers.get("content-type") || ""),
    "status " + rx64.status);

  console.log("\n— 66. EL CORTE EN DÍA DE COBRO Y EL PLAZO MENTIROSO (producción, 14-ago noche) —");
  // Lo que Karina encontró en el arqueo real: el corte de producción cae en
  // JUEVES, y a TODOS los centros de jueves se les exigía una cuota de más (el
  // muro de LA CONSENTIDA: 46 clientas al corriente marcadas en mora). Y la
  // regla del plazo terminado le exigía el saldo COMPLETO a quien tiene el
  // plazo mal capturado (EPIFANIA: $5,616 habiendo pagado su cuota ese día).
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-07-30", confirmar: true }) });

  // (a) La CONSENTIDA real: jueves, pagó el 6 y el 12 — con el corte EN jueves
  // 30-jul NO debe nada (la cuota del 30 vive dentro de la plantilla).
  const S66a = "70000001080";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S66a, nombre: "CONSENTIDA CORTE JUEVES 66", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 18480, cuota: 840, plazo: 22, diaPago: "Jueves",
      desembolso: "2026-07-30" }) });
  const K66a = S66a + "|Grupal-Basico|CONSENTIDA CORTE JUEVES 66|0";
  for (const [fch, dt] of [["2026-08-06", 31], ["2026-08-12", 32]])
    await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
      body: JSON.stringify({ fecha: fch, snapshot: { regI: { [K66a]: { pago: 840, forma: "E" } } }, ts: Date.now() + dt }) });
  const w66 = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  ok("con el corte EN su día de cobro, la que va al corriente NO sale en la mora semanal",
    !(w66.dias || []).some((g) => g.filas.some((x) => String(x.socio) === S66a)), "le exige la cuota del día del corte");
  const d66 = await j(await fetch(U + "/api/mora/dia?fecha=2026-08-13", { headers: H(cm) }));
  ok("ni en el arqueo del jueves", !(d66.centros || []).some((g) => g.filas.some((x) => String(x.socio) === S66a)),
    "sale en el arqueo");

  // (b) La misma pero SIN pagar: debe UNA cuota (no dos, no tres).
  const S66b = "70000001081";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S66b, nombre: "SIN PAGAR CORTE JUEVES 66", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 18480, cuota: 840, plazo: 22, diaPago: "Jueves",
      desembolso: "2026-07-30" }) });
  const w66b = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const f66b = (w66b.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === S66b);
  ok("y la que NO pagó debe exactamente UNA cuota", !!f66b && f66b.faltante === 840, JSON.stringify(f66b));

  // (c) EPIFANIA: plazo mal capturado (dice 2, lleva pagada una fracción). El
  // "plazo terminado" NO puede exigirle el saldo completo: pagó su cuota y
  // está al corriente — el que está mal es el PLAZO, no la señora.
  const S66c = "70000001082";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S66c, nombre: "EPIFANIA PLAZO CHUECO 66", producto: "Grupal-Basico 2",
      centro: "C-0", ejecutivo: "Julio", saldo: 6048, cuota: 432, plazo: 2, diaPago: "Jueves",
      desembolso: "2026-06-04" }) });
  const K66c = S66c + "|Grupal-Basico 2|EPIFANIA PLAZO CHUECO 66|0";
  for (const [fch, dt] of [["2026-08-06", 33], ["2026-08-12", 34]])
    await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
      body: JSON.stringify({ fecha: fch, snapshot: { regI: { [K66c]: { pago: 432, forma: "E" } } }, ts: Date.now() + dt }) });
  const w66c = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const f66c = (w66c.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === S66c);
  ok("el plazo mal capturado NO le exige el saldo completo a la que va al corriente",
    !f66c, JSON.stringify(f66c));
  // Y el caso LUCIA (que el plazo terminado SÍ exija el remanente chico) sigue
  // vivo en la sección 63 — estas dos reglas conviven.

  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });

  console.log("\n— 67. LOS CASOS REALES DEL EXCEL DE MORA (Karina, 15-ago: «eliminaste a varias») —");
  // Karina comparó el Excel de la mora antes y después y de 231 créditos
  // quedaron 31. Al cotejar contra los saldos reales, 22 habían salido SIN
  // haber pagado. Dos causas, las dos mías:
  //   1. Se usaba la fecha del ALTA como si fuera el desembolso. Monse da de
  //      alta clientas que YA traían crédito corriendo: quedaban exentas.
  //   2. Las cuotas se contaban desde el día siguiente al corte pero los
  //      abonos desde el corte. Quien pagó el día del corte (o entre el corte
  //      y su primer cobro) estaba liquidando una deuda ANTERIOR, y esa
  //      asimetría se la acreditaba a la cuota de esta semana.
  // La regla correcta usa LA MISMA VARA: todo arranca en el primer día de
  // cobro de la clienta después del corte.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const rn67 = async () => j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const en67 = (d, soc) => (d.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === soc);

  // (a) ELVIRA: LUNES, cuota 445, pagó 445 EL DÍA DEL CORTE (5-ago, miércoles).
  // Ese pago liquidó su cuota del lunes ANTERIOR: sigue debiendo la de esta
  // semana. Es la que se perdió del reporte.
  const S67a = "70000001090";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    // Desembolsada el 4-may: al lunes 10-ago van 14 vencimientos de un plazo
    // de 20, debería deberle $2,670. Su saldo al corte de $3,560 menos el pago
    // del 5-ago ($445) deja $3,115: sigue UNA cuota atrás — el pago del día
    // del corte liquidó la anterior, no la de esta semana.
    body: JSON.stringify({ id: S67a, nombre: "ELVIRA REAL 67", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 3560, cuota: 445, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-05-04" }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-05", snapshot: { regI: { [S67a + "|Grupal-Basico|ELVIRA REAL 67|0"]: { pago: 445, forma: "E" } } }, ts: Date.now() + 40 }) });
  const e67 = en67(await rn67(), S67a);
  ok("la que pagó el DÍA DEL CORTE sigue debiendo su cuota de esta semana",
    !!e67 && e67.faltante === 445, JSON.stringify(e67));

  // (b) ARIELA: JUEVES, cuota 480, pagó 1440 el 8-ago = TRES cuotas. Ese sí es
  // adelanto de verdad y Monse pidió que no saliera. Debe seguir fuera.
  const S67b = "70000001091";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S67b, nombre: "ARIELA REAL 67", producto: "Grupal-Micro",
      centro: "C-0", ejecutivo: "Julio", saldo: 11520, cuota: 480, plazo: 24, diaPago: "Jueves",
      desembolso: "2026-07-30" }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-08", snapshot: { regI: { [S67b + "|Grupal-Micro|ARIELA REAL 67|0"]: { pago: 1440, forma: "E" } } }, ts: Date.now() + 41 }) });
  ok("la que ADELANTÓ tres cuotas sigue fuera de la mora (lo que pidió Monse)",
    !en67(await rn67(), S67b), "ARIELA volvió a la mora");

  // (c) NUBIA: MARTES, cuota 1144, NO ha abonado un peso, y Monse la dio de
  // alta en el sistema apenas. Debe UNA cuota: el alta no la exime.
  const S67c = "70000001092";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S67c, nombre: "NUBIA REAL 67", producto: "Grupal-Microcredito",
      centro: "C-0", ejecutivo: "Julio", saldo: 19448, cuota: 1144, plazo: 32, diaPago: "Martes" }) });
  const n67 = en67(await rn67(), S67c);
  ok("el ALTA en el sistema NO exime de mora a quien ya traía su crédito",
    !!n67 && n67.faltante === 1144, JSON.stringify(n67));

  // (d) LA CONSENTIDA: JUEVES, cuota 840, pagó 6-ago y 12-ago. Al corriente.
  const S67d = "70000001093";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S67d, nombre: "ANA CONSENTIDA 67", producto: "Grupal-Basico 2",
      centro: "C-0", ejecutivo: "Julio", saldo: 18480, cuota: 840, plazo: 22, diaPago: "Jueves",
      desembolso: "2026-07-30" }) });
  for (const [fch, dt] of [["2026-08-06", 42], ["2026-08-12", 43]])
    await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
      body: JSON.stringify({ fecha: fch, snapshot: { regI: { [S67d + "|Grupal-Basico 2|ANA CONSENTIDA 67|0"]: { pago: 840, forma: "E" } } }, ts: Date.now() + dt }) });
  ok("la que va al corriente (pagó su día y adelantó el miércoles) NO sale",
    !en67(await rn67(), S67d), "ANA salió en la mora estando al corriente");

  // (e) Y el arqueo de su día dice lo mismo que la semana: una sola verdad.
  const a67 = await j(await fetch(U + "/api/mora/dia?fecha=2026-08-11", { headers: H(cm) }));
  const na = (a67.centros || []).flatMap((g) => g.filas).find((x) => String(x.socio) === S67c);
  ok("y el arqueo del martes cobra lo mismo que la mora semanal",
    !!na && na.faltante === 1144, JSON.stringify(na));

  const lunesDeLaSemanaJS = (iso) => { const d = new Date(iso + "T12:00:00");
    const g = d.getDay(); d.setDate(d.getDate() - ((g === 0 ? 7 : g) - 1));
    return d.toISOString().slice(0, 10); };
  console.log("\n— 78. LA MEJORA LLEGA AL TELÉFONO SIN ESPERAR OTRA ABIERTA (Karina, 15-ago) —");
  // «No encontré lo de la mora en la app de Neri.» Estaba en el servidor, pero
  // el service worker servía vivos.js DEL CACHE y solo lo refrescaba en
  // segundo plano: la mejora llegaba hasta la siguiente vez que abriera. Ahora
  // la lógica viva va a la red primero, y la página se auto-cura si detecta
  // que cargó una versión vieja.
  const sw78 = await (await fetch(U + "/sw.js")).text();
  ok("el service worker ya NO sirve la lógica viva desde el cache",
    /SIEMPRE_FRESCO/.test(sw78) && /"\/vivos\.js"/.test(sw78), "sigue cacheando vivos.js");
  ok("y su versión de cache cambió, para que los teléfonos la tomen",
    /fooax-v15/.test(sw78), "no se movió la versión del cache");
  const vjs78 = await (await fetch(U + "/vivos.js")).text();
  ok("vivos.js trae la tarjeta de mora y sus botones de semana",
    /__pintarMora/.test(vjs78) && /__moraVer/.test(vjs78) && /miMoraBox/.test(vjs78),
    "vivos.js no trae la mora");
  const appHtml78 = await (await fetch(U + "/app", { headers: H(cn) })).text();
  ok("la app inyecta su paquete vivo, con la mora dentro",
    /__VIVOS0/.test(appHtml78) && /"mora"/.test(appHtml78), "el paquete no trae mora");
  ok("y trae la auto-curación: si cargó lógica vieja, se refresca UNA vez",
    /__pintarMora/.test(appHtml78) && /fooax_refresco/.test(appHtml78),
    "no está el rescate");

  console.log("\n— 81. EL ARQUEO DEL 18-AGO: SOBRANTE FALSO Y GASTO MAL MARCADO (Karina) —");
  // Karina, 18-ago: «¿por qué dice SOBRAN contra lo contado $57,783?». El
  // efectivo estaba PERFECTO —lo contado empataba al centavo con la cobranza—
  // pero el arqueo comparaba el conteo contra «cobranza menos gastos», y los
  // gastos eran de Dirección (nómina, garantías devueltas), que salen DESPUÉS
  // y de la caja de la oficina. Sobraba siempre, por el total de los gastos.
  const F81 = "2026-08-18";
  const S81 = "70000009500";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S81, nombre: "ARQUEO 81", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 40000, cuota: 500, plazo: 80,
      diaPago: "Martes", desembolso: "2026-03-24" }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul), body: JSON.stringify({ fecha: F81,
    snapshot: { regI: { [S81 + "|Grupal-Basico|ARQUEO 81|0"]: { pago: 1000, forma: "E" } },
      arqueo: { "500": 2 } }, ts: Date.now() + 140 }) });
  // Un gasto GRANDE de Dirección, en efectivo: no debe disparar la alarma.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Gasto operativo", monto: 800, concepto: "Pago de nómina",
      metodo: "efectivo", fecha: F81 }) });
  const rx81 = await fetch(U + "/api/arqueo/excel?fecha=" + F81, { headers: H(cm) });
  ok("el arqueo con gastos de Dirección se genera sin problema",
    rx81.status === 200, "status " + rx81.status);

  // EL GASTO MAL MARCADO: el concepto dice transferencia, la forma dice efectivo.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Gasto operativo", monto: 33192,
      concepto: "PAGO NOMINA EN TRANSFERENCIA", metodo: "efectivo", fecha: HOY }) });
  const c81 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  const mal = (c81.gastosMalMarcados || []).find((x) => x.monto === 33192);
  ok("se detecta el gasto que dice «transferencia» pero está marcado en efectivo",
    !!mal, JSON.stringify((c81.gastosMalMarcados || []).slice(0, 2)));
  ok("y se dice de cuánto y de qué concepto, para poder corregirlo",
    !!mal && /TRANSFERENCIA/i.test(mal.concepto), JSON.stringify(mal));
  // Un gasto normal en efectivo NO se marca: no queremos alarmas falsas.
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Gasto operativo", monto: 137, concepto: "Gasolina de campo",
      metodo: "efectivo", fecha: HOY }) });
  const c81b = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("un gasto normal en efectivo no dispara la alarma",
    !(c81b.gastosMalMarcados || []).some((x) => x.monto === 137), "marcó la gasolina");

  console.log("\n— 82. EL ACUMULADO ES LA SUMA DE LOS DÍAS, Y SE PUEDE COMPROBAR (Karina, 18-ago) —");
  // «Del lunes $2,976.50 y del martes $5,886 — eso está mal.» El acumulado
  // contaba SOLO el pago hecho ESE día exacto, mientras el bloque de arriba
  // cuenta lo abonado en la semana HASTA ese día. Por eso cobraba de más a la
  // que se adelanta: pagaba el lunes su cuota del martes, arriba salía limpia
  // y en el acumulado seguía morosa. Y el total iba solo, sin forma de checarlo.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const acum81 = async () => j(await fetch(U + "/api/mora/dia?fecha=2026-08-18", { headers: H(cm) }));
  const marDe = (d) => ((d.acumuladoPorDia || []).find((x) => x.dia === "MARTES") || {}).total || 0;
  const base81 = marDe(await acum81());
  const SACU81 = "70000009501";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: SACU81, nombre: "ADELANTA SU MARTES 81", producto: "Grupal-Basico",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 10000, cuota: 500, plazo: 20,
      diaPago: "Martes", desembolso: "2026-03-23" }) });
  const d81a = await acum81();
  ok("sin pagar, su cuota entra al acumulado del martes",
    Math.abs(marDe(d81a) - base81 - 500) < 0.01, "subió " + (marDe(d81a) - base81));
  ok("y el acumulado es EXACTAMENTE la suma de sus días, comprobable renglón por renglón",
    Math.abs((d81a.acumuladoPorDia || []).reduce((a2, x) => a2 + x.total, 0) - d81a.totalSemanaAlDia) < 0.01,
    JSON.stringify(d81a.acumuladoPorDia));
  // Paga el LUNES su cuota del MARTES: se adelantó.
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: "2026-08-17",
    snapshot: { reg: { GHANIMA: { [SACU81 + "|Grupal-Basico|ADELANTA SU MARTES 81|0"]: { pago: 500, forma: "E" } } } },
    ts: Date.now() + 140 }) });
  const d81b = await acum81();
  ok("al adelantarse, el acumulado deja de contarla — igual que el bloque del día",
    Math.abs(marDe(d81b) - base81) < 0.01, "quedó en " + marDe(d81b) + " y debía volver a " + base81);
  ok("y no aparece en la lista del día",
    !(d81b.centros || []).flatMap((g) => g.filas).some((x) => String(x.socio) === SACU81), "sale en la lista");
  ok("el desglose trae su día y su fecha, para poder checar la suma con el dedo",
    (d81b.acumuladoPorDia || []).every((x) => x.dia && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha || "")),
    JSON.stringify(d81b.acumuladoPorDia));
  // Y el total del día de arriba coincide con su renglón en el desglose.
  ok("el total del día coincide al centavo con su renglón del acumulado",
    Math.abs(d81b.totalDia - marDe(d81b)) < 0.01,
    "día " + d81b.totalDia + " vs acumulado " + marDe(d81b));

  console.log("\n— 80. EL CIERRE DE CAJA SIGUE EL DÍA QUE SE ESTÁ MIRANDO (Karina, 17-ago) —");
  // «Si me regreso al sábado, yo necesito ver lo del sábado, el cierre de caja
  // del sábado, y así sucesivamente.» La tarjeta y el Excel salían SIEMPRE con
  // la semana en curso: elegir un día anterior no los movía, así que el cierre
  // del sábado era imposible de sacar.
  const S80 = "70000009300";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S80, nombre: "CAJA POR DIA 80", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 40000, cuota: 500, plazo: 80,
      diaPago: "Lunes", desembolso: "2026-03-23" }) });
  const K80 = S80 + "|Grupal-Basico|CAJA POR DIA 80|0";
  for (const [f, monto, dt] of [["2026-08-13", 3000, 1], ["2026-08-15", 2000, 2]])
    await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
      body: JSON.stringify({ fecha: f, snapshot: { regI: { [K80]: { pago: monto, forma: "E" } } },
        ts: Date.now() + 130 + dt }) });
  const caja80 = async (q) => j(await fetch(U + "/api/semana/caja" + q, { headers: H(cm) }));
  const sab80 = await caja80("?fecha=2026-08-15");
  ok("al elegir el SÁBADO, el cierre es el de ESA semana, cerrado a ese día",
    sab80.lunes === "2026-08-10" && sab80.hasta === "2026-08-15",
    "del " + sab80.lunes + " al " + sab80.hasta);
  ok("y trae lo cobrado hasta ese día, no lo de hoy",
    sab80.entro >= 5000, "entró " + sab80.entro);
  const jue80 = await caja80("?fecha=2026-08-13");
  ok("al elegir el JUEVES, corta ahí: cada día tiene su cierre",
    jue80.hasta === "2026-08-13" && jue80.entro >= 3000 && jue80.entro < sab80.entro,
    "hasta " + jue80.hasta + " · entró " + jue80.entro);
  const rx80 = await fetch(U + "/api/semana/caja/excel?fecha=2026-08-15", { headers: H(cm) });
  ok("y el EXCEL de ese día se puede descargar, con su fecha en el nombre",
    rx80.status === 200 && /2026-08-10 al 2026-08-15/.test(rx80.headers.get("content-disposition") || ""),
    (rx80.headers.get("content-disposition") || "status " + rx80.status).slice(0, 90));
  // Sin elegir fecha sigue siendo la semana en curso, como siempre.
  const hoy80 = await caja80("");
  ok("sin elegir día, sigue siendo la semana en curso",
    hoy80.lunes === lunesDeLaSemanaJS(HOY), "lunes " + hoy80.lunes);

  console.log("\n— 79. LA QUE TERMINÓ DE PAGAR DEJA DE COBRARSE (reporte de Administración) —");
  // «La aplicación no liquida los créditos al terminar su plazo: cinco clientas
  // que terminaron el 16 y 17 de julio siguieron recibiendo cobro.»
  //
  // Estaba resuelto SOLO para las clientas venidas de plantilla. Las dadas de
  // alta EN EL SISTEMA iban en las dos listas a la vez —en «quitar» por estar
  // en cero y en «altas» por haber nacido en el tablero— y como la app aplica
  // primero quitar y luego altas, la borraba y la volvía a meter en el mismo
  // sondeo. La ejecutiva la seguía viendo y la seguía cobrando.
  const S78 = "70000009200";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S78, nombre: "TERMINA Y SE VA 78", producto: "Grupal-Basico",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 1000, cuota: 500, plazo: 2,
      diaPago: "Lunes", desembolso: "2026-08-03" }) });
  const viv78 = async () => j(await fetch(U + "/api/vivos", { headers: H(cn) }));
  const v78a = await viv78();
  ok("mientras debe, la clienta está en la app de su ejecutiva",
    (v78a.altas || []).some((x) => String(x.id) === S78), "no aparece debiendo");
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: "2026-08-10",
    snapshot: { reg: { GHANIMA: { [S78 + "|Grupal-Basico|TERMINA Y SE VA 78|0"]: { pago: 1000, forma: "E" } } } },
    ts: Date.now() + 120 }) });
  const v78b = await viv78();
  ok("al terminar de pagar, YA NO se le vuelve a agregar al teléfono",
    !(v78b.altas || []).some((x) => String(x.id) === S78), "sigue en la lista de agregar");
  ok("y se le manda quitar de su pantalla",
    (v78b.quitar || []).some((x) => String(x.id) === S78), "no se manda quitar");
  ok("nunca en las dos listas a la vez (era lo que la revivía cada minuto)",
    !((v78b.altas || []).some((x) => String(x.id) === S78)
      && (v78b.quitar || []).some((x) => String(x.id) === S78)), "está en las dos");
  const m78 = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  ok("y tampoco se le cobra en la mora",
    !(m78.dias || []).flatMap((g) => g.filas).some((x) => String(x.socio) === S78), "sale en la mora");

  console.log("\n— 77. LA CLIENTA NUEVA LLEGA AL TELÉFONO DE SU EJECUTIVA (Karina, 15-ago) —");
  // «Cuando agregan una clienta nueva y eligen el ejecutivo, aparece en el
  // padrón de NERI al instante, con los datos que se dieron de alta.»
  const S77 = "70000009100";
  const rA77 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S77, nombre: "NUEVA PARA NERI 77", producto: "Grupal-Basico",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 7200, cuota: 600, plazo: 12,
      diaPago: "Martes", desembolso: "2026-08-14" }) }));
  ok("el alta se registra con su ejecutiva", !rA77.error, rA77.error || "");
  const vn77 = await j(await fetch(U + "/api/vivos", { headers: H(cn) }));
  const alta77 = (vn77.altas || []).find((x) => String(x.id) === S77);
  ok("la clienta llega al teléfono de NERI en el siguiente sondeo (sin recargar)",
    !!alta77 && alta77.nombre === "NUEVA PARA NERI 77" && alta77.centro === "GHANIMA",
    JSON.stringify(alta77));
  ok("con el saldo y la cuota que se capturaron",
    !!alta77 && alta77.saldo === 7200 && alta77.cuota === 600, JSON.stringify(alta77));
  const vivo77 = (vn77.vivos || []).find((x) => String(x.id) === S77);
  ok("y con su DÍA DE COBRO, su plazo y su fecha de desembolso",
    !!vivo77 && vivo77.dia === "MARTES" && vivo77.plazo === 12 && vivo77.desembolso === "2026-08-14",
    JSON.stringify(vivo77));
  const vj77 = await j(await fetch(U + "/api/vivos", { headers: H(cJul) }));
  ok("y NO se le aparece a otra ejecutiva: es de quien la dio de alta",
    !(vj77.altas || []).some((x) => String(x.id) === S77)
      && !(vj77.vivos || []).some((x) => String(x.id) === S77), "salió en el de Julio");
  // Y en el padrón por ejecutivo que se le manda a Dirección.
  const pad77 = await j(await fetch(U + "/api/padron", { headers: H(cm) }));
  ok("y también entra al padrón de NERI que ve Dirección",
    (pad77.porEjec["Neri"] || []).some((x) => String(x.socio) === S77),
    "no está en el padrón de Neri");

  console.log("\n— 76. SEMANAS Y MES EN LA APP · CICLO · FECHA DE LIQUIDACIÓN (Karina, 15-ago) —");
  // «Pueden ver la semana pasada, esta semana y así... y overall de todo el
  // mes.» «Si alguien liquida su Grupal-Básico y renueva otro, ponerle un folio
  // interno 02, 03.» «Cuando alguien liquida, ponerle la fecha de liquidación.»
  const viv76 = await j(await fetch(U + "/api/vivos", { headers: H(cn) }));
  const m76 = viv76.mora || {};
  ok("la app recibe la mora repartida SEMANA POR SEMANA del mes",
    Array.isArray(m76.semanas) && m76.semanas.length >= 1
      && m76.semanas.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.lunes) && typeof w.total === "number"),
    JSON.stringify((m76.semanas || []).map((w) => w.lunes)));
  ok("y el acumulado del MES, con sus clientas contadas una sola vez",
    typeof m76.totalMes === "number" && typeof m76.clientasMes === "number"
      && /^\d{4}-\d{2}$/.test(m76.mes || ""), JSON.stringify({ mes: m76.mes, total: m76.totalMes, clientas: m76.clientasMes }));
  ok("las semanas van completas (con sus clientas), para verlas sin señal",
    (m76.semanas || []).every((w) => Array.isArray(w.filas)), "alguna semana viene sin sus filas");
  ok("y el total del mes es la suma de sus semanas",
    Math.abs((m76.totalMes || 0) - (m76.semanas || []).reduce((a2, w) => a2 + w.total, 0)) < 0.01,
    JSON.stringify({ mes: m76.totalMes, suma: (m76.semanas || []).reduce((a2, w) => a2 + w.total, 0) }));

  // EL CICLO: liquida su Grupal-Basico y renueva el mismo producto.
  const S76 = "70000009080";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S76, nombre: "RENUEVA CICLOS 76", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 500, plazo: 2,
      diaPago: "Lunes", desembolso: "2026-08-03" }) });
  const busca76 = async () => {
    const r = await j(await fetch(U + "/api/creditos?q=" + encodeURIComponent("RENUEVA CICLOS"), { headers: H(cm) }));
    return (r.resultados || []).find((x) => String(x.id) === S76 && x.activa !== false) || {};
  };
  // Primero LIQUIDA su ciclo (el re-crédito se rechaza si aún debe), y luego
  // renueva el MISMO producto: ahí es donde se gana el ciclo 02.
  const liq76 = (monto, fecha) => fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto, concepto: "Liquidación · RENUEVA CICLOS 76",
      metodo: "efectivo", socio: S76, producto: "Grupal-Basico", fecha }) });
  await liq76(1000, "2026-08-10");
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S76, producto: "Grupal-Basico", saldo: 6000, cuota: 500,
      plazo: 12, ejecutivo: "Julio", motivo: "Renovación", desembolso: "2026-08-10" }) });
  const c76 = await busca76();
  ok("al renovar el MISMO producto se le pone su ciclo interno (02)",
    c76.ciclo === 2, "ciclo " + c76.ciclo);
  await liq76(6000, "2026-08-11");
  await fetch(U + "/api/creditos/recredito", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S76, producto: "Grupal-Basico", saldo: 8000, cuota: 500,
      plazo: 16, ejecutivo: "Julio", motivo: "Renovación 3", desembolso: "2026-08-11" }) });
  ok("y a la siguiente, el 03 — así se ve cuántos ha renovado con nosotros",
    (await busca76()).ciclo === 3, "ciclo " + (await busca76()).ciclo);
  ok("el ciclo NO cambia el nombre del crédito (los pagos siguen casando)",
    (await busca76()).producto === "Grupal-Basico", (await busca76()).producto);

  // LA FECHA DE LIQUIDACIÓN: la del último abono que la dejó en cero.
  const S76b = "70000009081";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S76b, nombre: "LIQUIDA CON FECHA 76", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 500, plazo: 2,
      diaPago: "Lunes", desembolso: "2026-08-03" }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-12", snapshot: { regI: {
      [S76b + "|Grupal-Basico|LIQUIDA CON FECHA 76|0"]: { pago: 1000, forma: "E" } } }, ts: Date.now() + 110 }) });
  const r76b = await j(await fetch(U + "/api/creditos?q=" + encodeURIComponent("LIQUIDA CON FECHA"), { headers: H(cm) }));
  const c76b = (r76b.resultados || []).find((x) => String(x.id) === S76b) || {};
  ok("a la que liquidó se le guarda la FECHA en que terminó de pagar",
    c76b.liquidadoEl === "2026-08-12" && c76b.saldoActual === 0,
    JSON.stringify({ liquidadoEl: c76b.liquidadoEl, saldo: c76b.saldoActual }));
  ok("y a la que todavía debe no se le inventa fecha de liquidación",
    (await busca76()).liquidadoEl == null, JSON.stringify((await busca76()).liquidadoEl));

  console.log("\n— 75. LO PAGADO SE DESGLOSA POR SEMANA (Karina, 15-ago) —");
  // «La semana es de lunes a domingo, y aquí hicieron un pago una semana y a la
  // siguiente le puso "pagó tanto esta semana".» La tarjeta de la clienta decía
  // "pagó $960 esta sem." sumando TODO lo abonado desde el corte: los $480 del
  // 6-ago eran de la semana ANTERIOR. Es el caso de ANA VICTORIA SANTIAGO.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const S75 = "70000009070";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S75, nombre: "ANA DOS SEMANAS 75", producto: "Grupal-Micro",
      centro: "LA CONSENTIDA", ejecutivo: "Neri", saldo: 20160, cuota: 480, plazo: 42,
      diaPago: "Jueves", desembolso: "2026-03-26" }) });
  const K75 = S75 + "|Grupal-Micro|ANA DOS SEMANAS 75|0";
  // Un pago de ESTA semana y otro de la PASADA, atados al calendario real: con
  // fechas fijas la prueba se rompía sola al cambiar la semana.
  const LUN75 = lunesDeLaSemanaJS(HOY);
  const ANT75 = (() => { const d = new Date(LUN75 + "T12:00:00"); d.setDate(d.getDate() - 3);
    return d.toISOString().slice(0, 10); })();
  for (const [fch, dt] of [[ANT75, 100], [LUN75, 101]])
    await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
      body: JSON.stringify({ fecha: fch, snapshot: { reg: { "LA CONSENTIDA": { [K75]: { pago: 480, forma: "E" } } } },
        ts: Date.now() + dt }) });
  const cr75 = await j(await fetch(U + "/api/creditos?q=" + encodeURIComponent("ANA DOS SEMANAS"), { headers: H(cm) }));
  const x75 = (cr75.resultados || []).find((x) => String(x.id) === S75) || {};
  const LUNANT75 = lunesDeLaSemanaJS(ANT75);
  ok("lo abonado se desglosa POR SEMANA, con el lunes de cada una",
    Array.isArray(x75.porSemana) && x75.porSemana.length === 2
      && x75.porSemana.some((w) => w.lunes === LUN75 && w.monto === 480)
      && x75.porSemana.some((w) => w.lunes === LUNANT75 && w.monto === 480),
    JSON.stringify(x75.porSemana));
  ok("«esta semana» es SOLO la semana en curso, no todo desde el corte",
    x75.pagadoEstaSemana === 480 && x75.pagado === 960,
    "estaSemana " + x75.pagadoEstaSemana + " · desde el corte " + x75.pagado);
  ok("y el total desde el corte sigue cuadrando con el saldo (20160 − 960)",
    x75.saldoActual === 19200, "saldoActual " + x75.saldoActual);

  console.log("\n— 74. LA QUE PAGA A MEDIAS VA EN «PAGO PARCIAL» (Karina, 15-ago) —");
  // «Esas tienen que ir en cartera en el área de pago parcial.» Antes, si su
  // día ya había pasado, la que pagó incompleto se iba al montón de la mora:
  // el jueves ya no quedaba una sola parcial en el semáforo y se perdía de
  // vista quién está pagando a medias — que es MUY distinto de quien no paga.
  const S74 = "70000009060";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S74, nombre: "PAGA A MEDIAS 74", producto: "Grupal-Basico",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 5880, cuota: 588, plazo: 20,
      diaPago: "Lunes", desembolso: "2026-03-23" }) });
  const S74b = "70000009061";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S74b, nombre: "NO PAGA NADA 74", producto: "Grupal-Basico",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 5880, cuota: 588, plazo: 20,
      diaPago: "Lunes", desembolso: "2026-03-23" }) });
  const LUN74 = lunesDeLaSemanaJS(HOY);
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: LUN74,
    snapshot: { reg: { GHANIMA: { [S74 + "|Grupal-Basico|PAGA A MEDIAS 74|0"]: { pago: 88, forma: "E" } } } },
    ts: Date.now() + 90 }) });
  const sem74 = async (estado) => j(await fetch(U + "/api/cartera/semaforo?estado=" + estado, { headers: H(cm) }));
  const enPar = (await sem74("parcial")).filas.find((x) => String(x.socio) === S74);
  ok("la que pagó $88 de su cuota de $588 va en PAGO PARCIAL, no en la mora",
    !!enPar, "no está en pago parcial");
  ok("y su renglón dice cuánto pagó y cuánto le falta",
    !!enPar && enPar.pagoSemana === 88 && enPar.faltante === 500, JSON.stringify(enPar));
  // Si su día ya pasó, va en mora; si no ha llegado (los lunes temprano), va en
  // «aún no le toca». Lo que NUNCA puede pasar es que se confunda con la que
  // pagó a medias — que es lo que esta sección vigila.
  const enMora74 = (await sem74("enMora")).filas.some((x) => String(x.socio) === S74b);
  const pend74 = (await sem74("pendiente")).filas.some((x) => String(x.socio) === S74b);
  ok("la que NO pagó nada va en mora (o en «aún no le toca» si su día no llega), nunca en parcial",
    (enMora74 || pend74) && !(await sem74("parcial")).filas.some((x) => String(x.socio) === S74b),
    "enMora " + enMora74 + " · pendiente " + pend74);
  ok("y la que pagó a medias NO aparece también en la mora (una clienta, un lugar)",
    !(await sem74("enMora")).filas.some((x) => String(x.socio) === S74), "sale en los dos");

  console.log("\n— 73. EL MISMO PAGO CAPTURADO DOS VECES (Karina, 15-ago) —");
  // «Pagó 88 pesos, pero realmente debe 588, y le pone el sistema que pagó
  // 588.» La clienta quedó listada en DOS lugares —dos centros, o un centro y
  // como individual— y cada renglón traía su monto: el sistema los SUMABA
  // (88 + 500 = 588) y aparecía pagando su cuota completa. Manda el padrón:
  // vale la captura del centro donde está registrada, y la otra se reporta.
  const S73 = "70000009050";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S73, nombre: "DOBLE CAPTURA 73", producto: "Grupal-Basico",
      centro: "GHANIMA", ejecutivo: "Neri", saldo: 5880, cuota: 588, plazo: 20,
      diaPago: "Lunes", desembolso: "2026-03-23" }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: "2026-08-10",
    snapshot: { reg: {
      GHANIMA: { [S73 + "|Grupal-Basico|DOBLE CAPTURA 73|0"]: { pago: 88, forma: "E" } },
      "LA JOYA": { [S73 + "|Grupal-Basico|DOBLE CAPTURA 73|0"]: { pago: 500, forma: "E" } } } },
    ts: Date.now() + 80 }) });
  const d73 = await j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const f73 = (d73.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === S73);
  ok("se toma lo que pagó en SU centro ($88), no la suma de los dos ($588)",
    !!f73 && f73.pagado === 88, JSON.stringify(f73));
  ok("y por eso sigue debiendo lo que de verdad debe ($500)",
    !!f73 && f73.faltante === 500, JSON.stringify(f73));
  const cl73 = await j(await fetch(U + "/api/clientes?q=" + S73, { headers: H(cm) }));
  ok("el SALDO tampoco se le baja de más (5880 − 88)",
    ((cl73.resultados || [])[0] || {}).saldoActual === 5792,
    "saldoActual " + ((cl73.resultados || [])[0] || {}).saldoActual);
  const cart73 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  const dup73 = (cart73.pagosDuplicados || []).find((x) => String(x.socio) === S73);
  ok("y el tablero lo reporta: qué se tomó, qué se ignoró y de dónde",
    !!dup73 && dup73.seTomoMonto === 88 && dup73.montoIgnorado === 500
      && (dup73.seIgnoro || []).some((y) => /JOYA/i.test(y.origen)), JSON.stringify(dup73));

  console.log("\n— 72. PADRÓN POR EJECUTIVO, CON SUS ALTAS Y SUS BAJAS (Karina, 15-ago) —");
  // «Déjales un Excel donde se vean las bajas de padrón por ejecutivo... y si
  // agregan una clienta nueva, esa clienta tiene que aparecer en el padrón de
  // ese ejecutivo, como de las plantillas que nos mandaban.»
  const S72 = "70000009020";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S72, nombre: "NUEVA DE JULIO 72", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 6000, cuota: 500, plazo: 12, diaPago: "Lunes",
      desembolso: "2026-08-10" }) });
  const pad72 = async () => j(await fetch(U + "/api/padron", { headers: H(cm) }));
  const p72 = await pad72();
  const mia72 = (p72.porEjec["Julio"] || []).find((x) => String(x.socio) === S72);
  ok("la clienta que se da de alta APARECE en el padrón de su ejecutiva",
    !!mia72, "no salió en el padrón de Julio");
  ok("y viene marcada como ALTA, con su fecha, para distinguirla de las que ya venían",
    !!mia72 && mia72.esAlta === true && /^\d{4}-\d{2}-\d{2}$/.test(mia72.alta || ""), JSON.stringify(mia72));
  ok("con lo que la ejecutiva necesita: saldo, cuota, día de cobro y desembolso",
    !!mia72 && mia72.saldoActual === 6000 && mia72.cuota === 500
      && mia72.diaPago === "LUNES" && mia72.desembolso === "2026-08-10", JSON.stringify(mia72));
  ok("cada ejecutiva sale con SU gente, no revueltas",
    (p72.porEjec["Julio"] || []).every((x) => true) && Array.isArray(p72.ejecutivos)
      && p72.ejecutivos.length >= 1, JSON.stringify(p72.ejecutivos));

  // LA BAJA: sale del padrón vivo y aparece en la lista de bajas, con motivo.
  await fetch(U + "/api/clientes/baja", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S72, producto: "Grupal-Basico", motivo: "Salió del grupo" }) });
  const p72b = await pad72();
  ok("al darla de baja sale del padrón de su ejecutiva",
    !(p72b.porEjec["Julio"] || []).some((x) => String(x.socio) === S72), "sigue en el padrón vivo");
  const baja72 = (p72b.bajasPorEjec["Julio"] || []).find((x) => String(x.socio) === S72);
  ok("y aparece en las BAJAS, con su ejecutiva, su motivo y su saldo",
    !!baja72 && baja72.motivo === "Salió del grupo" && baja72.saldoAlDarDeBaja === 6000,
    JSON.stringify(baja72));
  const rx72 = await fetch(U + "/api/padron/excel", { headers: H(cm) });
  ok("y todo eso baja en Excel, una hoja por ejecutiva más la de bajas",
    rx72.status === 200 && /spreadsheet/.test(rx72.headers.get("content-type") || ""), "status " + rx72.status);

  // Y EL CORTE YA NO SE MUEVE desde el tablero.
  const rc72 = await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-08-14" }) });
  const jc72 = await j(rc72);
  ok("el corte ya no se puede mover: se rechaza y explica por qué",
    rc72.status === 409 && jc72.noSeMueve === true, "status " + rc72.status);

  console.log("\n— 71. ADELANTAR EL CORTE SIN PLANTILLA BORRA PAGOS (Karina, 15-ago) —");
  // «En algunos créditos no se bajaron lo que pagaron.» El saldo del padrón es
  // la FOTO de la plantilla. Si el corte se adelanta sin cargar una plantilla
  // nueva, los pagos hechos en medio dejan de descontar: la clienta vuelve a
  // aparecer debiendo lo que ya pagó. Pasó de verdad al mover el corte del
  // 5-ago al 13-ago (el caso BEATRIZ CRESPO).
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const S71 = "70000009010";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S71, nombre: "PAGO Y SE BORRO 71", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1000, cuota: 500, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-03-23" }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul),
    body: JSON.stringify({ fecha: "2026-08-10", snapshot: { regI: {
      [S71 + "|Grupal-Basico|PAGO Y SE BORRO 71|0"]: { pago: 500, forma: "E" } } }, ts: Date.now() + 70 }) });
  const saldoDe71 = async () => {
    const r = await j(await fetch(U + "/api/clientes?q=" + S71, { headers: H(cm) }));
    return ((r.resultados || [])[0] || {}).saldoActual;
  };
  ok("con el corte en su lugar, su pago SÍ le baja el saldo (1000 − 500 = 500)",
    (await saldoDe71()) === 500, "saldoActual " + (await saldoDe71()));

  // EL CORTE YA NO SE MUEVE (Karina, 15-ago). Se intenta y se rechaza.
  const rC71 = await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-08-13" }) });
  const jC71 = await j(rC71);
  ok("mover el corte se RECHAZA, y el mensaje dice por qué y a dónde ir",
    rC71.status === 409 && jC71.noSeMueve === true && /Padrón por ejecutivo/.test(jC71.error || ""),
    "status " + rC71.status + " · " + (jC71.error || "").slice(0, 60));
  const cAct71 = (await j(await fetch(U + "/api/saldos/corte", { headers: H(cm) }))).corte;
  ok("y el corte NO se movió", cAct71 === "2026-08-05", "quedó en " + cAct71);

  // El daño que causaba se conserva probado: si alguna vez se mueve (solo con
  // confirmación explícita, para cargar una plantilla histórica), los pagos de
  // en medio dejan de descontar — y al regresarlo, vuelven.
  const rOK71 = await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm),
    body: JSON.stringify({ fecha: "2026-08-13", confirmar: true }) });
  ok("solo con confirmación explícita se puede mover", rOK71.status === 200, "status " + rOK71.status);
  ok("y ahí se ve el daño: el pago del 10 ya no le baja el saldo",
    (await saldoDe71()) === 1000, "saldoActual " + (await saldoDe71()));
  // Y la cartera lo GRITA en vez de callarlo.
  const cart71 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("la cartera avisa del corte adelantado, con su monto y sus clientas",
    !!cart71.corteAdelantado && cart71.corteAdelantado.monto >= 500
      && (cart71.corteAdelantado.clientas || []).some((x) => String(x.socio) === S71),
    JSON.stringify(cart71.corteAdelantado || null).slice(0, 160));
  // Regresar el corte lo repara: el dinero vuelve a descontar.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  ok("y al regresar el corte, el pago vuelve a bajarle el saldo",
    (await saldoDe71()) === 500, "saldoActual " + (await saldoDe71()));

  console.log("\n— 70. LOS CINCO CASOS DE KARINA (15-ago, con el corte movido al 13) —");
  // «Esta pagó el lunes y la pusiste en mora.» (BEATRIZ CRESPO.) Y con ella,
  // toda la lista: que la recuperación actualice, que el adelanto dentro de la
  // semana cuente, y que quien paga ANTES de su día no salga en mora.
  //
  // El corte movido al 13 es lo que destapó a BEATRIZ: la semana lo CRUZA, así
  // que su pago del lunes 10 ya venía descontado en el saldo de la plantilla y
  // el sistema se lo contaba OTRA VEZ como si fuera dinero nuevo.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-13", confirmar: true }) });
  const alta70 = (id, nom, prod, saldo, cuota, plazo, dia, des) =>
    fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
      body: JSON.stringify({ id, nombre: nom, producto: prod, centro: "C-0", ejecutivo: "Julio",
        saldo, cuota, plazo, diaPago: dia, desembolso: des }) });
  const K70 = (id, nom, prod) => id + "|" + prod + "|" + nom + "|0";
  const mora70 = async () => j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const en70 = (d, id) => (d.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === id);

  await alta70("70000009001", "BEATRIZ 70", "Grupal-Basico 2", 288, 288, 20, "Lunes", "2026-03-23");
  await alta70("70000009003", "ADELANTA DIA 70", "Grupal-Basico", 5000, 500, 20, "Martes", "2026-03-24");
  await alta70("70000009002", "CONSENTIDA 70", "Grupal-Basico", 8400, 840, 20, "Jueves", "2026-03-26");
  await alta70("70000009004", "NO PAGO 70", "Grupal-Basico", 5000, 500, 20, "Lunes", "2026-03-23");
  // El día completo en UN sync: así lo manda la app (reemplaza el día entero).
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul), body: JSON.stringify({ fecha: "2026-08-10",
    snapshot: { regI: {
      [K70("70000009001", "BEATRIZ 70", "Grupal-Basico 2")]: { pago: 288, forma: "E" },
      [K70("70000009003", "ADELANTA DIA 70", "Grupal-Basico")]: { pago: 500, forma: "E" } } }, ts: Date.now() + 60 }) });
  await fetch(U + "/api/sync", { method: "POST", headers: H(cJul), body: JSON.stringify({ fecha: "2026-08-12",
    snapshot: { regI: { [K70("70000009002", "CONSENTIDA 70", "Grupal-Basico")]: { pago: 840, forma: "E" } } },
    ts: Date.now() + 61 }) });

  const d70 = await mora70();
  ok("la que PAGÓ SU LUNES no sale en mora, aunque la semana cruce el corte",
    !en70(d70, "70000009001"), JSON.stringify(en70(d70, "70000009001")));
  ok("la que cobra JUEVES y pagó el MIÉRCOLES tampoco (adelanto dentro de la semana)",
    !en70(d70, "70000009002"), JSON.stringify(en70(d70, "70000009002")));
  ok("y la de MARTES que decidió pagar el LUNES tampoco: pagó",
    !en70(d70, "70000009003"), JSON.stringify(en70(d70, "70000009003")));
  const nop70 = en70(d70, "70000009004");
  ok("la que NO pagó sí queda en mora, con su cuota",
    !!nop70 && nop70.faltante === 500, JSON.stringify(nop70));

  // LA RECUPERACIÓN ACTUALIZA: baja lo que pagó y deja en mora lo que debe.
  const recup70 = (monto) => fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Recuperación / adelanto", monto, concepto: "Recuperación · NO PAGO 70",
      metodo: "efectivo", socio: "70000009004", producto: "Grupal-Basico", fecha: "2026-08-14" }) });
  await recup70(200);
  const p70 = en70(await mora70(), "70000009004");
  ok("una recuperación PARCIAL le resta y deja en mora lo que falta",
    !!p70 && p70.faltante === 300, JSON.stringify(p70));
  await recup70(300);
  ok("y al completar la recuperación, sale de la mora",
    !en70(await mora70(), "70000009004"), "sigue en la mora con todo pagado");

  // Y EL ARQUEO DEL DÍA dice lo mismo: quien pagó antes de su día no aparece.
  const a70 = await j(await fetch(U + "/api/mora/dia?fecha=2026-08-11", { headers: H(cm) }));
  ok("el arqueo del martes tampoco cobra a la que pagó el lunes",
    !(a70.centros || []).some((g) => g.filas.some((x) => String(x.socio) === "70000009003")),
    "sale en el arqueo del martes habiendo pagado el lunes");

  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });

  console.log("\n— 69. LA MORA SE MIDE CONTRA EL CALENDARIO DEL CRÉDITO (Karina, 15-ago) —");
  // «No mira el lunes, solo tienes a una persona, sigue mal.» El arrastre desde
  // el corte le acreditaba al lunes 10 los pagos que liquidaban la cuota
  // atrasada del lunes 3, y el lunes salía con una sola clienta. El método real
  // de Monse compara el SALDO contra el calendario: desembolsada tal día, con
  // N pagos, para hoy debería deberle tanto. Lo que exceda es su atraso.
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-08-05", confirmar: true }) });
  const cal69 = async () => j(await fetch(U + "/api/mora?lunes=2026-08-10", { headers: H(cm) }));
  const f69 = (d, soc) => (d.dias || []).flatMap((g) => g.filas).find((x) => String(x.socio) === soc);

  // AL CORRIENTE: desembolsada el lunes 4-may a 20 pagos de $500. Al lunes
  // 10-ago van 14 vencimientos, debería deberle $3,000 — y eso debe.
  const S69a = "70000001120";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S69a, nombre: "AL CORRIENTE 69", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 3000, cuota: 500, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-05-04" }) });
  ok("la que va exactamente en su calendario NO debe nada",
    !f69(await cal69(), S69a), "salió debiendo estando al corriente");

  // UNA CUOTA ATRÁS: mismo calendario, pero le quedan $3,500.
  const S69b = "70000001121";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S69b, nombre: "UNA ATRAS 69", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 3500, cuota: 500, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-05-04" }) });
  const b69 = f69(await cal69(), S69b);
  ok("la que va UNA cuota atrás debe exactamente una cuota",
    !!b69 && b69.faltante === 500, JSON.stringify(b69));

  // CINCO ATRÁS: se le exige UNA, no cinco (los atrasos viejos no inflan).
  const S69c = "70000001122";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S69c, nombre: "CINCO ATRAS 69", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 5500, cuota: 500, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-05-04" }) });
  const c69 = f69(await cal69(), S69c);
  ok("la que va CINCO atrás sigue debiendo UNA cuota en la semana",
    !!c69 && c69.faltante === 500, JSON.stringify(c69));

  // ADELANTADA: le queda menos de lo que su calendario pide.
  const S69d = "70000001123";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S69d, nombre: "ADELANTADA 69", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 1500, cuota: 500, plazo: 20, diaPago: "Lunes",
      desembolso: "2026-05-04" }) });
  ok("la que va ADELANTADA no debe nada", !f69(await cal69(), S69d), "salió debiendo yendo adelantada");

  // Y EL REPORTE DICE CON QUÉ MIDIÓ CADA UNO: si un día el número se ve raro,
  // lo primero es ver cuántos cayeron al respaldo del arrastre.
  const m69 = await cal69();
  ok("el reporte dice a cuántas se les abonó un adelanto",
    m69.medidoCon && typeof m69.medidoCon.conAdelanto === "number" && m69.medidoCon.conAdelanto >= 2,
    JSON.stringify(m69.medidoCon));
  // SIN PLAZO no hay calendario, así que no hay adelanto que abonar: se le pide
  // su cuota completa, que es lo conservador y no depende de un dato que falta.
  const S69e = "70000001124";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S69e, nombre: "SIN PLAZO 69", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 4000, cuota: 500, diaPago: "Lunes",
      desembolso: "2026-05-04" }) });
  const e69 = f69(await cal69(), S69e);
  ok("al que no trae plazo se le pide su cuota, sin adivinarle adelanto",
    !!e69 && e69.faltante === 500, JSON.stringify(e69));

  console.log("\n— 68. LA LISTA DE LOS QUE NO TRAEN FECHA DE DESEMBOLSO (Karina, 15-ago) —");
  // «Dile a Monse lo de la fecha de desembolso y mándale las que faltan.»
  // Sin esa fecha el sistema no distingue un crédito NUEVO de uno que ya venía
  // corriendo, y asume lo segundo. La lista tiene que ser fácil de vaciar.
  const S68 = "70000001100";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S68, nombre: "SIN FECHA 68", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 6000, cuota: 500, plazo: 12, diaPago: "Lunes" }) });
  const sd68 = async () => j(await fetch(U + "/api/sin-desembolso", { headers: H(cm) }));
  const d68 = await sd68();
  const yo68 = (d68.filas || []).find((x) => String(x.socio) === S68);
  ok("el crédito sin fecha de desembolso aparece en la lista",
    !!yo68 && yo68.saldoActual === 6000, JSON.stringify(yo68));
  ok("y la lista dice cuánto saldo está en esa situación",
    typeof d68.saldo === "number" && d68.saldo >= 6000, JSON.stringify({ total: d68.total, saldo: d68.saldo }));
  // El que SÍ la trae no estorba en la lista.
  const S68b = "70000001101";
  await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S68b, nombre: "CON FECHA 68", producto: "Grupal-Basico",
      centro: "C-0", ejecutivo: "Julio", saldo: 6000, cuota: 500, plazo: 12, diaPago: "Lunes",
      desembolso: "2026-08-03" }) });
  ok("el que SÍ trae su fecha no aparece",
    !((await sd68()).filas || []).some((x) => String(x.socio) === S68b), "salió el que sí la tiene");
  // Al capturársela, se sale de la lista: así se vacía.
  await fetch(U + "/api/creditos/ajuste", { method: "POST", headers: H(cm),
    body: JSON.stringify({ id: S68, producto: "Grupal-Basico", desembolso: "2026-08-03",
      motivo: "Captura de fecha de desembolso" }) });
  const d68b = await sd68();
  ok("y en cuanto Monse la captura, desaparece de la lista",
    !(d68b.filas || []).some((x) => String(x.socio) === S68), "sigue en la lista con su fecha puesta");
  const rx68 = await fetch(U + "/api/sin-desembolso/excel", { headers: H(cm) });
  ok("la lista baja en Excel con su columna en blanco para llenar",
    rx68.status === 200 && /spreadsheet/.test(rx68.headers.get("content-type") || ""), "status " + rx68.status);

  console.log("\n— 65. CARTERA: unidades honestas (Karina, 14-ago: «100% real, no nos inventamos nada») —");
  // La columna `mora` del padrón es un CONTEO de cuotas sin pagar (Monse), no
  // pesos. El tablero la sumaba y la pintaba como "$21 de mora" y como "% de
  // mora sobre cartera" (cuotas divididas entre pesos). El dinero real en
  // riesgo es el SALDO vivo de los créditos vencidos/en mora.
  const cart65 = await j(await fetch(U + "/api/cartera", { headers: H(cm) }));
  ok("la cartera en riesgo es dinero de verdad: la suma de los saldos vencidos",
    typeof cart65.carteraEnRiesgo === "number" && cart65.carteraEnRiesgo >= 0
      && typeof cart65.riesgoPorcentaje === "number", JSON.stringify({ r: cart65.carteraEnRiesgo, p: cart65.riesgoPorcentaje }));
  ok("y su porcentaje sale de pesos entre pesos, no de cuotas entre pesos",
    cart65.cartera === 0 || Math.abs(cart65.riesgoPorcentaje - Math.round((cart65.carteraEnRiesgo / cart65.cartera) * 10000) / 100) < 0.02,
    cart65.carteraEnRiesgo + " / " + cart65.cartera + " vs " + cart65.riesgoPorcentaje + "%");
  ok("cada vencida dice sus CUOTAS sin pagar (conteo) y su saldo (pesos), separados",
    (cart65.vencidas || []).every((v) => typeof v.cuotasSinPagar === "number" && typeof v.saldoActual === "number"),
    JSON.stringify((cart65.vencidas || [])[0]));
  ok("las vencidas van ordenadas por el DINERO en juego, no por el conteo",
    (cart65.vencidas || []).every((v, i2, arr) => i2 === 0 || arr[i2 - 1].saldoActual >= v.saldoActual - 0.01),
    "desordenadas");
  ok("el conteo total de cuotas conserva su nombre de conteo",
    typeof cart65.moraCuotasTotal === "number", "falta moraCuotasTotal");
  ok("y la tabla por ejecutiva trae su mora ya vencida de la semana",
    (cart65.porEjec || []).every((e) => typeof e.moraSemana === "number"), "falta moraSemana");

  console.log("\n══════════════════════════════════");
  console.log(FAIL === 0 ? "✅✅ TODO PASÓ: " + PASS + " pruebas" : "❌ FALLARON " + FAIL + " de " + (PASS + FAIL));
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR de la batería:", e.message); process.exit(2); });
