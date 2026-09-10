// SINCRONIZACIÓN AUTOMÁTICA AL DESEMBOLSAR (CU-013/CU-014) — pruebas.
// Corre contra el servidor local (3899) con DATA_DIR desechable (mismo patrón
// que bateria_arqueo.js: requiere datos limpios, no es re-ejecutable sobre un
// día ya cerrado).
//
//   D=/tmp/fooax-prueba-sync; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/sincronizacion_desembolso.js
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

// Nombre de día (LUNES..SABADO/DOMINGO) de una fecha ISO — para verificar el
// plan de pagos sin duplicar la lógica del servidor.
const NOMBRES = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
const diaDe = (iso) => NOMBRES[new Date(iso + "T12:00:00").getDay()];
const sumaDias = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  // `anel` (Dirección General, cuenta REAL — no de prueba): alta/recrédito
  // exigen soloAnelMonse en varios endpoints. Seguro contra DATA_DIR
  // desechable, nunca contra data/ real.
  const ca = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const socio = "9" + RUN.padStart(10, "0");
  const producto = "Prueba Sync " + RUN;

  console.log("\n— 1. ALTA genera pagaré + plan de pagos + sobre, en el mismo acto —");
  // Desembolso en un DOMINGO fijo del pasado (no depende de la fecha de hoy);
  // día de pago LUNES → la primera cuota cae el lunes siguiente.
  const desembolso = "2026-01-04"; // domingo
  const r1 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio, nombre: "Prueba Sync " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto, saldo: 4640, cuota: 580, plazo: 8, importe: 4000,
      desembolso, diaPago: "LUNES", comision: 100, seguro: 50,
    }),
  }));
  ok("el alta responde ok", r1.ok === true, JSON.stringify(r1).slice(0, 200));
  ok("trae el pagaré (folio + monto + plazo)", !!(r1.clienta && r1.clienta.pagare && r1.clienta.pagare.folio),
    JSON.stringify(r1.clienta && r1.clienta.pagare));
  ok("el pagaré usa el importe (no el saldo con interés)", r1.clienta && r1.clienta.pagare && r1.clienta.pagare.monto === 4000);
  ok("el pagaré trae el plazo", r1.clienta && r1.clienta.pagare && r1.clienta.pagare.plazo === 8);

  const plan = (r1.clienta && r1.clienta.planPagos) || [];
  ok("el plan de pagos tiene exactamente 8 cuotas (una por plazo)", plan.length === 8, "trajo " + plan.length);
  ok("la cuota 1 cae el primer LUNES después del desembolso", plan[0] && plan[0].fecha_programada === sumaDias(desembolso, 1),
    JSON.stringify(plan[0]));
  ok("todas las fechas del plan son LUNES (el día de cobranza del crédito)",
    plan.every((p) => diaDe(p.fecha_programada) === "LUNES"), JSON.stringify(plan.map((p) => p.fecha_programada)));
  ok("las cuotas van en orden y una semana exacta de diferencia",
    plan.every((p, i) => i === 0 || p.fecha_programada === sumaDias(plan[i - 1].fecha_programada, 7)));
  ok("cada cuota del plan trae el monto de la cuota (dato manual, no recalculado)",
    plan.every((p) => p.monto === 580));
  ok("la numeración va de 1 a 8 sin saltos", plan.map((p) => p.numero).join(",") === "1,2,3,4,5,6,7,8");

  const sobre = (r1.clienta && r1.clienta.sobreDispersion) || {};
  ok("la garantía es el 10% del importe (Anexo F, Secciones 7/8)", sobre.garantia === 400, JSON.stringify(sobre));
  ok("el sobre respeta la comisión y el seguro capturados (datos manuales, sin catálogo)",
    sobre.comision === 100 && sobre.seguro === 50);
  ok("el neto = importe − comisión − seguro − garantía", sobre.neto === 4000 - 100 - 50 - 400, JSON.stringify(sobre));
  ok("el sobre dice qué porcentaje de garantía usó (parámetro, no un número mudo)",
    sobre.porcentajeGarantia === 10);

  console.log("\n— 2. El registro en CARTERA no necesitó ningún paso aparte —");
  const lista = await j(await fetch(U + "/api/creditos?q=" + encodeURIComponent(socio), { headers: H(ca) }));
  const enCartera = (lista.resultados || []).find((c) => String(c.id) === socio);
  ok("el crédito recién dado de alta YA aparece en /api/creditos (cartera)", !!enCartera);
  ok("y ya trae el mismo pagaré/plan/sobre, sin volver a mandarlos", !!(enCartera && enCartera.pagare && enCartera.pagare.folio === r1.clienta.pagare.folio));

  console.log("\n— 3. Endpoint de verificación GET /api/creditos/plan-pagos —");
  const pp = await j(await fetch(U + "/api/creditos/plan-pagos?id=" + socio + "&producto=" + encodeURIComponent(producto), { headers: H(ca) }));
  ok("regresa el mismo pagaré", pp.pagare && pp.pagare.folio === r1.clienta.pagare.folio);
  ok("regresa el mismo plan de pagos (8 cuotas)", (pp.planPagos || []).length === 8);
  ok("regresa el mismo sobre de dispersión", pp.sobreDispersion && pp.sobreDispersion.neto === sobre.neto);

  console.log("\n— 4. RECRÉDITO (renovación) también sincroniza, para el ciclo nuevo —");
  // Producto DISTINTO a propósito: el primer crédito sigue con saldo (nadie le
  // ha pagado en esta prueba), y /api/creditos/recredito bloquea renovar el
  // MISMO nombre de producto mientras aún deba ("todavía tiene saldo..."). Un
  // nombre distinto es justo el caso real de "crédito aparte" que el propio
  // servidor sugiere en ese mensaje — no afecta lo que se está probando (que
  // el recrédito también sincroniza pagaré+plan+sobre para el ciclo nuevo).
  const productoR = producto + " R";
  const desembolso2 = "2026-06-07"; // domingo distinto, ciclo nuevo
  const r2 = await j(await fetch(U + "/api/creditos/recredito", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio, nombre: "Prueba Sync " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoR, saldo: 3480, cuota: 580, plazo: 6, importe: 3000,
      desembolso: desembolso2, diaPago: "MARTES", comision: 0, seguro: 0,
    }),
  }));
  ok("el recrédito responde ok", r2.ok === true, JSON.stringify(r2).slice(0, 200));
  const plan2 = (r2.clienta && r2.clienta.planPagos) || [];
  ok("el plan de pagos del ciclo NUEVO tiene 6 cuotas (el plazo nuevo, no el viejo)", plan2.length === 6, "trajo " + plan2.length);
  ok("las fechas del ciclo nuevo son MARTES (su nuevo día de cobranza)",
    plan2.every((p) => diaDe(p.fecha_programada) === "MARTES"));
  ok("la primera cuota del ciclo nuevo parte del NUEVO desembolso, no del viejo",
    plan2[0] && plan2[0].fecha_programada === sumaDias(desembolso2, 2));
  const sobre2 = (r2.clienta && r2.clienta.sobreDispersion) || {};
  ok("el sobre del recrédito usa el importe nuevo (garantía 10% de 3000 = 300)", sobre2.garantia === 300, JSON.stringify(sobre2));

  console.log("\n— 5. Sin desembolso/día de pago/plazo no se inventa un plan (falla en silencio, no en error) —");
  const socio2 = "8" + RUN.padStart(10, "0");
  const r3 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio2, nombre: "Prueba Sync Sin Fecha " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: "Prueba Sync SinFecha " + RUN, saldo: 1000, cuota: 200, plazo: 5, importe: 900,
      // sin desembolso ni diaPago
    }),
  }));
  ok("el alta sigue funcionando sin desembolso/día de pago", r3.ok === true);
  ok("el plan de pagos sale vacío (no confiable), no inventado", Array.isArray(r3.clienta.planPagos) && r3.clienta.planPagos.length === 0);
  ok("el pagaré y el sobre sí se generan (no dependen de la fecha)", !!(r3.clienta.pagare && r3.clienta.pagare.folio) && !!r3.clienta.sobreDispersion);

  console.log("\n— 6. El plan de pagos usa el motor de reglas real cuando el producto SÍ está en el catálogo —");
  // "Grupal-Basico" a 24 semanas SÍ resuelve contra data/equivalencias-productos.json
  // (-> GRUPAL_BASICO_24, 6.32% mensual) — a diferencia del producto de prueba de
  // la sección 1, que no existe en el catálogo y por eso cae al respaldo manual.
  const socio3 = "7" + RUN.padStart(10, "0");
  const desembolso3 = "2026-02-01"; // domingo
  const r4 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio3, nombre: "Prueba Motor " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: "Grupal-Basico", saldo: 12000, cuota: 999, plazo: 24, importe: 10000,
      desembolso: desembolso3, diaPago: "MIERCOLES",
    }),
  }));
  ok("el alta con producto de catálogo responde ok", r4.ok === true, JSON.stringify(r4).slice(0, 200));
  const plan3 = (r4.clienta && r4.clienta.planPagos) || [];
  ok("el plan trae las 24 cuotas del plazo", plan3.length === 24, "trajo " + plan3.length);
  ok("cada cuota del plan viene del motor real, no del respaldo manual",
    plan3.every((p) => p.fuente === "motor"), JSON.stringify(plan3[0]));
  ok("la cuota calculada por el motor ignora la cuota manual capturada (999) — usa la real (600)",
    plan3[0] && plan3[0].monto === 600, JSON.stringify(plan3[0]));
  ok("cada pago trae su desglose capital/interés/IVA (no solo el total)",
    plan3.every((p) => typeof p.capital === "number" && typeof p.interes === "number" && typeof p.iva === "number"));
  ok("el desglose de la primera cuota es el que valida motor-reglas.js (416.67 + 158 + 25.28 = 600)",
    plan3[0] && plan3[0].capital === 416.67 && plan3[0].interes === 158 && plan3[0].iva === 25.28, JSON.stringify(plan3[0]));
  ok("el saldo del último pago llega a 0 (la tabla sí amortiza capital, no solo repite un número)",
    plan3[23] && plan3[23].saldo === 0, JSON.stringify(plan3[23]));
  ok("las fechas siguen viniendo del mismo calendario de siempre (todas MIÉRCOLES)",
    plan3.every((p) => diaDe(p.fecha_programada) === "MIERCOLES"));
  ok("el producto de la sección 1 (no está en ningún catálogo) SIGUE cayendo al respaldo manual",
    plan[0] && plan[0].fuente === "manual", JSON.stringify(plan[0]));

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
