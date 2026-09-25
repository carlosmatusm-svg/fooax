// HOJA DE LIBERACIÓN POR CENTRO ("GARANTIA GRUPAL") + JEFAS DE CENTRO +
// REGRESO ESCANEADO Y VALIDACIÓN DE ALEJANDRA + REPORTE SEMANAL COMPLETO
// (CU-006 / CU-008, 25-sep-2026 — audio de Karina y mensaje de Anel). Ver
// dominios/hoja_liberacion_grupal.js y, en dominios/garantia_liquida.js,
// observacionesDeSalida / reporteSalidaGarantiasSemanal.
//
// Cubre: la hoja junta SOLO las entregas de ese centro y ese día; trae el
// periodo + "CIERRE AL PAGO" por clienta; la jefa de centro sale del catálogo
// (y sin catálogo, la hoja avisa pero no se bloquea); el regreso exige
// evidencia; SOLO Alejandra valida o rechaza; al validar se apaga la alerta de
// 5 días de cada folio; el periodo de una clienta que renovó arranca en SU
// ciclo; el reporte de salidas semanal trae observaciones + ejecutivo; el
// reporte semanal trae el neto; y el Excel se lee de vuelta con exceljs.
//
//   D=/tmp/fooax-prueba-hoja-grupal; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   sleep 2
//   node tests/garantia_hoja_liberacion_grupal.js
"use strict";

const ExcelJS = require("exceljs");

const U = "http://localhost:3899";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

function sumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
const ddmmaaaa = (f) => f.split("-").reverse().join("-");

// /api/login no trae `hoy`; GET /api/me sí (hoyMX del servidor, nunca el UTC
// del cliente — gotcha de CLAUDE.md).
async function login(u, p) {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: p }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) return { cookie: null, hoy: null };
  const me = await j(await fetch(U + "/api/me", { headers: { Cookie: cookie } }));
  return { cookie, hoy: me.hoy };
}
const H = (c) => ({ "Content-Type": "application/json", Cookie: c });
const post = async (cookie, ruta, cuerpo) => {
  const r = await fetch(U + ruta, { method: "POST", headers: H(cookie), body: JSON.stringify(cuerpo) });
  return { status: r.status, d: await j(r) };
};
const get = async (cookie, ruta) => {
  const r = await fetch(U + ruta, { headers: H(cookie) });
  return { status: r.status, d: await j(r) };
};

(async () => {
  const { cookie: ca, hoy } = await login("anel", "anel2026");
  const { cookie: cAle } = await login("alejandra", "alejandra2026");
  const { cookie: cMonse } = await login("monse", "monse2026");
  const { cookie: cKarina } = await login("karina", "karina2026");
  if (!ca || !cAle || !cMonse || !cKarina) { console.log("No pude entrar con las cuentas locales de prueba."); process.exit(1); }

  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const numeroCentro = String(900 + (Number(RUN) % 99));
  const CENTRO = "PRUEBA HLG " + RUN;
  const OTRO_CENTRO = "PRUEBA HLG OTRO " + RUN;
  const producto = "Grupal-Basico";
  const ENTREGA = sumarDias(hoy, -6);      // hace 6 días: ya excede el plazo de 5 para regresar la hoja
  const APORTE = sumarDias(hoy, -20);
  const socio = (n) => n + RUN.padStart(9, "0");
  const A = socio("61"), B = socio("62"), C = socio("63"), R = socio("64");

  console.log("\n— 0. Dos centros de prueba y cuatro clientas —");
  const rC1 = await post(ca, "/api/centros", { numero: numeroCentro, nombre: CENTRO, ejecutivo: "Karina", dia: "MARTES" });
  ok("centro de prueba creado", rC1.d.ok === true, JSON.stringify(rC1.d));
  const rC2 = await post(ca, "/api/centros", { numero: String(Number(numeroCentro) + 1), nombre: OTRO_CENTRO, ejecutivo: "Karina", dia: "MARTES" });
  ok("segundo centro creado", rC2.d.ok === true, JSON.stringify(rC2.d));
  // Sin `desembolso` a propósito: así el alta no genera la retención
  // automática de garantía (registrarGarantiaLiquidaAlDesembolsar necesita la
  // fecha) y el guardado de cada clienta es EXACTAMENTE lo que esta prueba
  // aporta — sin depender de si ya se mergeó el fix de "solo Magnus retiene".
  const alta = (id, nombre, centro) => post(ca, "/api/clientes/alta", {
    id, nombre, centro, ejecutivo: "Karina", producto,
    saldo: 5800, cuota: 725, plazo: 8, importe: 5000, diaPago: "MARTES",
  });
  for (const [id, nombre, centro] of [[A, "ALFA PRUEBA " + RUN, CENTRO], [B, "BETA PRUEBA " + RUN, CENTRO],
    [R, "RENUEVA PRUEBA " + RUN, CENTRO], [C, "OTRA CENTRO PRUEBA " + RUN, OTRO_CENTRO]]) {
    const r = await alta(id, nombre, centro);
    ok("alta " + nombre, r.d.ok === true, JSON.stringify(r.d));
  }

  const MOTIVO = "Prueba automatizada: entrega de garantía en la reunión del centro.";
  const mov = (id, tipo, monto, fecha, extra = {}) => post(ca, "/api/movimiento", {
    tipo, concepto: tipo, monto, metodo: "efectivo", socio: id, producto, fecha, ...extra,
  });

  console.log("\n— 1. Aportaciones y entregas —");
  // R: un ciclo ANTERIOR ya liberado completo (aporta hace 30 días, se le
  // entrega hace 25) y un ciclo nuevo que se entrega el día de la hoja.
  const ciclo1 = sumarDias(hoy, -30), fin1 = sumarDias(hoy, -25), ciclo2 = sumarDias(hoy, -15);
  const pasos = [
    [R, "Garantía líquida", 250, ciclo1, {}],
    [R, "Garantía líquida entregada", 250, fin1, { motivoSalidaAnticipada: MOTIVO }],
    [R, "Garantía líquida", 180, ciclo2, {}],
    [A, "Garantía líquida", 400, APORTE, {}],
    [A, "Garantía A", 100, APORTE, {}],
    [B, "Garantía líquida", 300, APORTE, {}],
    [C, "Garantía líquida", 90, APORTE, {}],
    [A, "Garantía líquida entregada", 400, ENTREGA, { motivoSalidaAnticipada: MOTIVO }],
    [A, "Garantía A entregada", 100, ENTREGA, { motivoSalidaAnticipada: MOTIVO }],
    [B, "Garantía líquida entregada", 300, ENTREGA, { motivoSalidaAnticipada: MOTIVO }],
    [R, "Garantía líquida entregada", 180, ENTREGA, { motivoSalidaAnticipada: MOTIVO }],
    [C, "Garantía líquida entregada", 90, ENTREGA, { motivoSalidaAnticipada: MOTIVO }],
  ];
  const folios = {};
  for (const [id, tipo, monto, fecha, extra] of pasos) {
    const r = await mov(id, tipo, monto, fecha, extra);
    ok(`${tipo} ${monto} (${id.slice(0, 2)}) ${fecha}`, !r.d.error && r.status === 200, JSON.stringify(r.d));
    if (/entregada/.test(tipo) && fecha === ENTREGA) folios[id + tipo] = r.d.movimiento && r.d.movimiento.folio;
  }

  console.log("\n— 2. Centros con entregas ese día —");
  const rCentros = await get(ca, "/api/garantias/hoja-grupal/centros?fecha=" + ENTREGA);
  const fila = (rCentros.d.centros || []).find((c) => c.centro === CENTRO);
  ok("aparece el centro con 4 entregas y $980", fila && fila.entregas === 4 && fila.total === 980, JSON.stringify(fila));
  ok("su estado inicial es 'pendiente'", fila && fila.estado === "pendiente", JSON.stringify(fila));
  ok("el otro centro aparece aparte", (rCentros.d.centros || []).some((c) => c.centro === OTRO_CENTRO && c.entregas === 1));

  console.log("\n— 3. La hoja del centro —");
  const q = "centro=" + encodeURIComponent(CENTRO) + "&fecha=" + ENTREGA;
  let hoja = (await get(ca, "/api/garantias/hoja-grupal?" + q)).d;
  ok("trae 4 partidas (A líquida, A garantía A, B, R) y NO la del otro centro",
    hoja.partidas && hoja.partidas.length === 4 && !hoja.partidas.some((p) => p.socio === C), JSON.stringify(hoja.partidas || hoja));
  ok("total $980, subtotal Líquida $880 y Garantía A $100",
    hoja.total === 980
    && (hoja.subtotales || []).some((s) => s.tipoGarantia === "Garantía Líquida" && s.monto === 880)
    && (hoja.subtotales || []).some((s) => s.tipoGarantia === "Garantía A" && s.monto === 100), JSON.stringify(hoja.subtotales));
  const pA = (hoja.partidas || []).find((p) => p.socio === A && p.tipoGarantia === "Garantía Líquida");
  ok("observaciones con el periodo real: GARANTIAS DEL <aporte> AL <entrega>",
    pA && pA.observaciones.startsWith("GARANTIAS DEL " + ddmmaaaa(APORTE) + " AL " + ddmmaaaa(ENTREGA)), pA && pA.observaciones);
  ok("observaciones trae CIERRE AL PAGO cuando el crédito lo permite", pA && /CIERRE AL PAGO \d+$/.test(pA.observaciones), pA && pA.observaciones);
  const pR = (hoja.partidas || []).find((p) => p.socio === R);
  ok("clienta que renovó: el periodo arranca en SU ciclo, no en el anterior",
    pR && pR.observaciones.startsWith("GARANTIAS DEL " + ddmmaaaa(ciclo2) + " AL " + ddmmaaaa(ENTREGA)), pR && pR.observaciones);
  ok("gerente de sucursal = ejecutivo del centro (Karina)", hoja.firmas && hoja.firmas.gerente === "Karina", JSON.stringify(hoja.firmas));
  ok("sin jefa cargada: firma vacía + aviso, sin bloquear",
    hoja.firmas && hoja.firmas.jefaDeCentro === null && (hoja.avisos || []).some((a) => /jefa de centro/i.test(a)), JSON.stringify(hoja.avisos));

  const rTicket = await get(ca, "/api/garantias/liberacion?id=" + R + "&producto=" + encodeURIComponent(producto));
  ok("el ticket individual también usa el periodo del ciclo (clienta que renovó)",
    new RegExp("GARANTIAS DEL " + ddmmaaaa(ciclo2)).test(rTicket.d.comentarios || ""), rTicket.d.comentarios);

  console.log("\n— 4. Catálogo de jefas de centro —");
  const rKar = await post(cKarina, "/api/garantias/jefas-centro", { texto: CENTRO + "\tNADIE" });
  ok("una ejecutiva no puede cargar jefas (403)", rKar.status === 403, JSON.stringify(rKar));
  const texto = "Centro\tJefa de centro\n"
    + "C-" + numeroCentro + " " + CENTRO + "\tMaría Jefa Prueba " + RUN + "\n"
    + "CENTRO QUE NO EXISTE " + RUN + "\tFulana\n"
    + "C-0\tNo aplica";
  const rJefas = await post(ca, "/api/garantias/jefas-centro", { texto });
  ok("guarda 1 y rechaza el centro inexistente y el C-0",
    rJefas.d.ok && rJefas.d.guardadas.length === 1 && rJefas.d.rechazadas.length === 2, JSON.stringify(rJefas.d));
  const rJefas2 = await post(ca, "/api/garantias/jefas-centro", { filas: [{ centro: CENTRO, nombre: "maría jefa prueba " + RUN }] });
  ok("volver a cargar la misma jefa no duplica (sinCambio)", rJefas2.d.sinCambio && rJefas2.d.sinCambio.length === 1, JSON.stringify(rJefas2.d));
  const rCat = await get(ca, "/api/garantias/jefas-centro");
  ok("el catálogo muestra la jefa del centro",
    (rCat.d.centros || []).some((c) => c.centro === CENTRO && c.jefa && c.jefa.nombre === ("MARÍA JEFA PRUEBA " + RUN)), "");
  ok("el catálogo cuenta centros sin jefa", typeof rCat.d.sinJefa === "number" && rCat.d.sinJefa > 0, JSON.stringify(rCat.d.sinJefa));
  hoja = (await get(ca, "/api/garantias/hoja-grupal?" + q)).d;
  ok("la hoja ya trae el nombre de la jefa y sin aviso",
    hoja.firmas.jefaDeCentro === "MARÍA JEFA PRUEBA " + RUN && !(hoja.avisos || []).some((a) => /jefa/i.test(a)), JSON.stringify(hoja.firmas));

  console.log("\n— 5. Vista imprimible —");
  const html = await (await fetch(U + "/api/garantias/hoja-grupal/imprimir?" + q, { headers: H(ca) })).text();
  ok("es la hoja GRUPAL con las dos firmas al pie",
    /GARANTÍA GRUPAL/.test(html) && /Firma del gerente de sucursal/.test(html) && /Firma de la jefa de centro/.test(html), "");
  ok("trae a cada clienta, la jefa y el total",
    html.includes("ALFA PRUEBA " + RUN) && html.includes("BETA PRUEBA " + RUN) && html.includes("MARÍA JEFA PRUEBA " + RUN) && html.includes("$980.00"), "");
  ok("NO trae a la clienta del otro centro", !html.includes("OTRA CENTRO PRUEBA " + RUN), "");

  console.log("\n— 6. Regreso escaneado y validación de Alejandra —");
  const alertasAntes = (await get(ca, "/api/garantias/hoja-liberacion/alertas-plazo-regreso")).d;
  const folioA = folios[A + "Garantía líquida entregada"];
  ok("antes de validar, la alerta de 5 días incluye los folios de la hoja",
    (alertasAntes.alertas || []).some((a) => a.folio === folioA), folioA);

  const valAntes = await post(cAle, "/api/garantias/hoja-grupal/validacion", { centro: CENTRO, fecha: ENTREGA, resultado: "validada" });
  ok("no se puede validar antes de registrar el regreso", valAntes.status === 400, JSON.stringify(valAntes.d));
  const sinEvid = await post(ca, "/api/garantias/hoja-grupal/regreso", { centro: CENTRO, fecha: ENTREGA, evidencia: "" });
  ok("el regreso exige evidencia de dónde quedó el escaneo", sinEvid.status === 400, JSON.stringify(sinEvid.d));
  const reg1 = await post(ca, "/api/garantias/hoja-grupal/regreso", { centro: CENTRO, fecha: ENTREGA, evidencia: "WhatsApp de Karina " + RUN });
  ok("regreso registrado", reg1.d.ok === true && reg1.d.estado.estado === "regreso", JSON.stringify(reg1.d));
  const reg1b = await post(ca, "/api/garantias/hoja-grupal/regreso", { centro: CENTRO, fecha: ENTREGA, evidencia: "Otra vez " + RUN });
  ok("no se registra dos veces mientras espera validación", reg1b.status === 400, JSON.stringify(reg1b.d));

  const pend = (await get(ca, "/api/garantias/hoja-grupal/pendientes-validar")).d;
  ok("la hoja aparece en la bandeja de Alejandra", (pend.pendientes || []).some((p) => p.centro === CENTRO), JSON.stringify(pend));
  ok("Anel NO es validadora (puedoValidar=false)", pend.puedoValidar === false, JSON.stringify(pend.puedoValidar));

  const vMonse = await post(cMonse, "/api/garantias/hoja-grupal/validacion", { centro: CENTRO, fecha: ENTREGA, resultado: "validada" });
  ok("Monse no puede validar (403)", vMonse.status === 403, JSON.stringify(vMonse.d));
  const vAnel = await post(ca, "/api/garantias/hoja-grupal/validacion", { centro: CENTRO, fecha: ENTREGA, resultado: "validada" });
  ok("Anel no puede validar (403)", vAnel.status === 403, JSON.stringify(vAnel.d));
  const rechSinNota = await post(cAle, "/api/garantias/hoja-grupal/validacion", { centro: CENTRO, fecha: ENTREGA, resultado: "rechazada" });
  ok("rechazar exige anotar el motivo", rechSinNota.status === 400, JSON.stringify(rechSinNota.d));
  const rech = await post(cAle, "/api/garantias/hoja-grupal/validacion", { centro: CENTRO, fecha: ENTREGA, resultado: "rechazada", nota: "Falta la firma de la jefa de centro" });
  ok("Alejandra rechaza con motivo", rech.d.ok === true && rech.d.estado.estado === "rechazada", JSON.stringify(rech.d));
  ok("al rechazar NO se apaga ninguna alerta", Array.isArray(rech.d.foliosMarcados) && rech.d.foliosMarcados.length === 0, JSON.stringify(rech.d.foliosMarcados));

  const reg2 = await post(ca, "/api/garantias/hoja-grupal/regreso", { centro: CENTRO, fecha: ENTREGA, evidencia: "WhatsApp de Karina, ya con firma " + RUN });
  ok("tras un rechazo, la hoja puede regresar de nuevo", reg2.d.ok === true, JSON.stringify(reg2.d));
  const val = await post(cAle, "/api/garantias/hoja-grupal/validacion", { centro: CENTRO, fecha: ENTREGA, resultado: "validada" });
  ok("Alejandra valida", val.d.ok === true && val.d.estado.estado === "validada", JSON.stringify(val.d));
  ok("al validar se marca el regreso de los 4 folios", (val.d.foliosMarcados || []).length === 4, JSON.stringify(val.d.foliosMarcados));

  const alertasDespues = (await get(ca, "/api/garantias/hoja-liberacion/alertas-plazo-regreso")).d;
  ok("después de validar, esos folios salen de la alerta de 5 días",
    !(alertasDespues.alertas || []).some((a) => Object.values(folios).includes(a.folio) && a.socio !== C), "");
  ok("la entrega del OTRO centro sigue en alerta (no se tocó)",
    (alertasDespues.alertas || []).some((a) => a.folio === folios[C + "Garantía líquida entregada"]), "");
  const reg3 = await post(ca, "/api/garantias/hoja-grupal/regreso", { centro: CENTRO, fecha: ENTREGA, evidencia: "Una más " + RUN });
  ok("una hoja validada ya no acepta otro regreso", reg3.status === 400, JSON.stringify(reg3.d));
  const pend2 = (await get(ca, "/api/garantias/hoja-grupal/pendientes-validar")).d;
  ok("ya no está en la bandeja", !(pend2.pendientes || []).some((p) => p.centro === CENTRO), "");

  console.log("\n— 7. Reporte de salidas por clienta: semanal, con observaciones —");
  const sem = (await get(ca, "/api/garantias/reporte-salidas?semana=" + ENTREGA)).d;
  const filaA = (sem.salidas || []).find((s) => s.socio === A && s.tipoGarantia === "Garantía Líquida");
  ok("corte semanal lunes a domingo", sem.semana && sem.semana.desde <= ENTREGA && sem.semana.hasta >= ENTREGA, JSON.stringify(sem.semana));
  ok("cada fila trae observaciones y ejecutivo del crédito",
    filaA && /^GARANTIAS DEL /.test(filaA.observaciones) && filaA.ejecutivo === "Karina", JSON.stringify(filaA));
  ok("los campos de siempre siguen ahí (folio, quien, tipoGarantia, modalidad)",
    filaA && filaA.folio && filaA.quien && filaA.modalidad, JSON.stringify(filaA));
  ok("trae rollup por centro y ejecutivo",
    (sem.rollupPorCentroYEjecutivo || []).some((x) => x.centro === CENTRO && x.ejecutivo === "Karina" && x.total === 980), JSON.stringify(sem.rollupPorCentroYEjecutivo));
  const mensual = (await get(ca, "/api/garantias/reporte-salidas?mes=" + ENTREGA.slice(0, 7))).d;
  ok("el reporte mensual sigue respondiendo igual (mes + salidas)", mensual.mes === ENTREGA.slice(0, 7) && Array.isArray(mensual.salidas), "");

  console.log("\n— 8. Reporte semanal: neto + desglose por ejecutivo —");
  const semanal = (await get(ca, "/api/garantias/reporte-semanal?fecha=" + ENTREGA)).d;
  ok("movimientoNeto = entradas − salidas",
    Math.abs(semanal.movimientoNeto - Math.round((semanal.totalEntradas - semanal.totalSalidas) * 100) / 100) < 0.001, JSON.stringify(semanal));
  ok("trae entradasPorQuienYForma", Array.isArray(semanal.entradasPorQuienYForma), "");

  console.log("\n— 9. Excel del reporte semanal (leído de vuelta con exceljs) —");
  const rx = await fetch(U + "/api/garantias/reporte-semanal/excel?fecha=" + ENTREGA, { headers: H(ca) });
  ok("responde un .xlsx", rx.status === 200 && /spreadsheetml/.test(rx.headers.get("content-type") || ""), String(rx.status));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await rx.arrayBuffer()));
  const hojaSem = wb.getWorksheet("Reporte semanal");
  const hojaSal = wb.getWorksheet("Salida por cliente");
  ok("trae las dos hojas", !!hojaSem && !!hojaSal, wb.worksheets.map((w) => w.name).join(","));
  const textos = [];
  hojaSal.eachRow((row) => row.eachCell((c) => textos.push(String(c.value))));
  ok("la hoja de salidas trae a la clienta y su observación",
    textos.includes("ALFA PRUEBA " + RUN) && textos.some((t) => t.startsWith("GARANTIAS DEL " + ddmmaaaa(APORTE))), "");
  const textosSem = [];
  hojaSem.eachRow((row) => row.eachCell((c) => textosSem.push(String(c.value))));
  ok("la hoja semanal trae el resumen de movimiento neto", textosSem.some((t) => /MOVIMIENTO NETO/.test(t)), "");
  ok("nunca dice 'ahorro'", !textos.concat(textosSem).some((t) => /ahorro/i.test(t)), "");

  const rKar2 = await get(cKarina, "/api/garantias/hoja-grupal?" + q);
  ok("una ejecutiva no puede ver la hoja desde el tablero (403)", rKar2.status === 403, String(rKar2.status));

  console.log(`\n${PASS} pasaron, ${FAIL} fallaron`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
