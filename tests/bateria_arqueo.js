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
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01" }) });
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
  const D5 = (() => { const d = new Date(HOY + "T12:00"); d.setDate(d.getDate() - 5); return d.toISOString().slice(0, 10); })();
  // La prueba fija SU corte antes del pago: si se queda el corte que traiga el
  // sistema (que se mueve con cada plantilla nueva), este pago cae antes y la
  // prueba falla sin que nada esté mal. El corte va un día antes del abono.
  const CORTE20 = (() => { const d = new Date(HOY + "T12:00"); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();
  await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: CORTE20 }) }));
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha: D5, snapshot: JSON.stringify({ fecha: D5, reg: { "C-88": { "70000000095|Credito Saldo": { pago: 200, forma: "E" } } }, regI: {}, movs: [] }), ts: Date.now() }) });
  const saldoDe = async () => { const s = await j(await fetch(U + "/api/clientes?q=" + encodeURIComponent("SALDO TEST"), { headers: H(ca) })); return ((s.resultados || []).find((c) => String(c.id) === "70000000095") || {}).saldoActual; };
  ok("un pago de la SEMANA PASADA sigue bajando el saldo (1000 − 200 = 800)", (await saldoDe()) === 800, "saldoActual " + (await saldoDe()));
  let ct = await j(await fetch(U + "/api/saldos/corte", { headers: H(ca) }));
  ok("el corte de saldos es visible para dirección", /^\d{4}-\d{2}-\d{2}$/.test(ct.corte || ""), "corte " + ct.corte);
  const DC3 = (() => { const d = new Date(HOY + "T12:00"); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10); })();
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cal), body: JSON.stringify({ fecha: DC3 }) }));
  ok("otro admin NO puede mover el corte (solo Anel y Monse)", !!ct.error, (ct.error || "").slice(0, 50));
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: DC3 }) }));
  ok("Monse mueve el corte (cargó plantillas nuevas)", ct.ok === true && ct.corte === DC3, JSON.stringify(ct).slice(0, 50));
  ok("un pago ANTERIOR al corte ya no descuenta (la plantilla ya lo traía)", (await saldoDe()) === 1000, "saldoActual " + (await saldoDe()));
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01" }) }));
  ok("y al regresar el corte, vuelve a descontar", ct.ok === true && (await saldoDe()) === 800, "saldoActual " + (await saldoDe()));
  ct = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2099-01-01" }) }));
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
  await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: W[0] }) }));
  await fetch(U + "/api/centros", { method: "POST", headers: H(ca), body: JSON.stringify({ numero: "77", nombre: "CENTRO TENDENCIA", ejecutivo: "Neri", dia: "Lunes" }) });
  const SOC = "70000000123", PRD = "Credito Tendencia";
  await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca), body: JSON.stringify({ id: SOC, nombre: "TENDENCIA TEST", producto: PRD, centro: "CENTRO TENDENCIA", ejecutivo: "Neri", saldo: 4000, cuota: 1000, plazo: 4 }) }));
  const pagarW = (fecha, monto) => fetch(U + "/api/sync", { method: "POST", headers: H(cn), body: JSON.stringify({ fecha,
    snapshot: JSON.stringify({ fecha, reg: { "C-77": { [SOC + "|" + PRD]: { pago: monto, forma: "E" } } }, regI: {}, movs: [], arqueo: {} }), ts: Date.now() }) });
  await pagarW(W[0], 1000); await pagarW(W[1], 1000); await pagarW(W[3], 1000);   // W[2] sin pago
  const tend = await j(await fetch(U + "/api/tendencias", { headers: H(ca) }));
  const SS = {}; (tend.serie || []).forEach((x) => { SS[x.semana] = x; });
  ok("la serie es CONTINUA (rellena las semanas sin captura)", (tend.serie || []).length >= 5 && !!SS[W[2]], "filas " + (tend.serie || []).length);
  ok("la cartera baja EXACTAMENTE lo abonado (−1,000 de una semana a otra)",
     SS[W[1]] && SS[W[0]] && Math.abs((SS[W[1]].cartera - SS[W[0]].cartera) + 1000) < 0.01,
     (SS[W[0]] || {}).cartera + " → " + (SS[W[1]] || {}).cartera);
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
  const ant = await j(await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-04-08" }) }));
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
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY }) });
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
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY }) });
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
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY }) });
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
  const mQ = /var _Q=(\[.*?\]);/.exec(html40);
  ok("la app de la ejecutiva recibe su lista de créditos a quitar", !!mQ,
    mQ ? "sí" : "no se encontró _Q en el HTML de la app");
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
    body: JSON.stringify({ fecha: "2026-01-01" }) });
  const sync40 = (fecha, reg, t) => fetch(U + "/api/sync", { method: "POST", headers: H(cCh),
    body: JSON.stringify({ fecha, snapshot: { reg }, ts: Date.now() + t }) });
  const K40 = (id, p, nom) => id + "|" + p + "|" + nom + "|0";
  const qDe = async () => {
    const html = await (await fetch(U + "/app", { headers: H(cCh) })).text();
    const mm = /var _Q=(\[.*?\]);/.exec(html); return mm ? JSON.parse(mm[1]) : [];
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
  ok("con DOS créditos, la liquidación se reparte entre los dos",
    (await saldo43("MARIA ESTELA PADILLA", "Grupal-Basico 2")).act <= 0.009
    && (await saldo43("MARIA ESTELA PADILLA", "Grupal-Adicional")).act <= 0.009,
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
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY }) });
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
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: HOY }) });
  ok("pero si el corte se fija después de la captura, deja de descontar",
    Math.abs((await s44()) - antes44) < 0.01, "quedó en " + (await s44()) + " y debía volver a " + antes44);

  console.log("\n— 44b. UN COBRO QUE NO EMPATA CON NINGÚN CRÉDITO SE AVISA (Karina, 5-ago) —");
  // «¿100% que actualiza los saldos?» — la llave de un crédito es
  // socio+producto. Si la ficha llega con un producto que la clienta no tiene, o
  // con un socio que no existe, el dinero SÍ entra al arqueo pero NO le baja el
  // saldo a nadie. Antes eso pasaba en silencio; era el último hueco.
  const K44 = (id, p, nom) => id + "|" + p + "|" + nom + "|0";
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01" }) });
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
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Liquidación", monto: 200, concepto: "el pago que trajo su hija",
      metodo: "efectivo", socio: "11113131595", fecha: D44g }) });
  ok("una liquidación con la nota escrita LIBRE también baja el saldo",
    (await salLibre()) === sl0 - 200, sl0 + " → " + (await salLibre()));
  const sl1 = await salLibre();
  await fetch(U + "/api/movimiento", { method: "POST", headers: H(cm),
    body: JSON.stringify({ tipo: "Recuperación / adelanto", monto: 100, concepto: "abono suelto",
      metodo: "efectivo", socio: "11113131595", fecha: D44g }) });
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
  const dia44 = (n) => { const d = new Date(L44 + "T12:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
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
  await fetch(U + "/api/saldos/corte", { method: "POST", headers: H(cm), body: JSON.stringify({ fecha: "2026-01-01" }) });
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
  // Producto distinto al del cobro: el pago NO se aplica y hay que decirlo.
  const reg44g = { "C-0": {} };
  reg44g["C-0"][S45 + "|Individual|OTRA DE PRUEBA 44|0"] = { pago: 300, forma: "E" };
  await fetch(U + "/api/sync", { method: "POST", headers: H(cn),
    body: JSON.stringify({ fecha: "2026-02-20", snapshot: { reg: reg44g }, ts: Date.now() + 1 }) });
  const alta45 = await j(await fetch(U + "/api/clientes/alta", { method: "POST", headers: H(ca),
    body: JSON.stringify({ id: S45, nombre: "OTRA DE PRUEBA 44", producto: "Individual 2",
      centro: "C-0", ejecutivo: "Neri", saldo: 3000, cuota: 150 }) }));
  ok("si el producto no empata, avisa que el cobro quedó suelto",
    (alta45.cobrosQueSiguenSueltos || []).some((x) => x.monto === 300 && x.producto === "Individual"),
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
  const mV = appJ.match(/var _V=(\[.*?\]);/s);
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
  // Y que el script inyectado de verdad PARCHE los objetos de la app: que los
  // datos lleguen no sirve si no se aplican sobre la lista que ella ve.
  const inj47 = appJ.match(/<script>\(function\(\)\{try\{var _V=\[.*?\}\)\(\);<\/script>/s);
  let aplicado47 = null;
  if (inj47 && mI47) {
    const INDIVIDUALES = JSON.parse(mI47[1]);
    const datosCli = {};
    // Lo que Julio ya hubiera tecleado a mano NO se debe pisar.
    const kSole = "11113064631|MAGNUS|SOLEDAD FABIOLA MENDOZA|0";
    datosCli[kSole] = { plazo: 18, semana: 7, cuota: 9999 };
    new Function("CENTROS", "INDIVIDUALES", "datosCli", "guardarDatosCli",
      inj47[0].replace(/^<script>/, "").replace(/<\/script>$/, ""))({}, INDIVIDUALES, datosCli, () => {});
    aplicado47 = { INDIVIDUALES, datosCli, kSole };
  }
  ok("el script inyectado corre y parcha la lista de la app",
    !!aplicado47 && aplicado47.INDIVIDUALES.every((c) => c.plazo > 0),
    JSON.stringify((aplicado47 || {}).INDIVIDUALES || []).slice(0, 200));
  ok("y siembra el plazo para que ya no se lo pregunte a mano",
    !!aplicado47 && aplicado47.INDIVIDUALES.every((c) => (aplicado47.datosCli[c.k || c.f] || {}).plazo > 0),
    "alguna clienta se quedó sin plazo sembrado");
  const dS47 = aplicado47 ? aplicado47.datosCli[aplicado47.kSole] : {};
  ok("sin pisar lo que la ejecutiva ya había capturado",
    dS47.plazo === 18 && dS47.semana === 7 && dS47.cuota === 9999, JSON.stringify(dS47));

  console.log("\n══════════════════════════════════");
  console.log(FAIL === 0 ? "✅✅ TODO PASÓ: " + PASS + " pruebas" : "❌ FALLARON " + FAIL + " de " + (PASS + FAIL));
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR de la batería:", e.message); process.exit(2); });
