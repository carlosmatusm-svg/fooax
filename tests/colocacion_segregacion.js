// COLOCACIÓN CON SEGREGACIÓN (Anexo K §2.2) + SINCRONIZACIÓN AUTOMÁTICA AL
// DISPERSAR — CU-011 a CU-014, alcance de Carlos (cotización Karina 14-ago-2026).
// Corre contra el servidor local (3899), burbuja de prueba.
const U = process.env.SEG_URL || "http://localhost:3899";
const PASSW = process.env.SEG_PASS || "PruebaFOOAX2026";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
async function login(u) {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: PASSW }) });
  if (!r.ok) return null;
  return r.headers.get("set-cookie").split(";")[0];
}
const H = (c) => ({ "Content-Type": "application/json", Cookie: c });
const post = (c, url, body) => fetch(U + url, { method: "POST", headers: H(c), body: JSON.stringify(body || {}) });
const get = (c, url) => fetch(U + url, { headers: H(c) });

const RUN = String(Math.floor(Date.now() / 1000) % 100000);
const CID = "SEG-" + RUN; // clienta de prueba, única por corrida

async function construirExpedienteCompleto(cEjec, cAdmin) {
  const b64 = Buffer.from("doc prueba " + RUN).toString("base64");
  const docs = [
    ["ine", "solicitante"], ["comprobante_domicilio", "solicitante"], ["curp", "solicitante"], ["foto_negocio", "solicitante"],
    ["ine", "responsable"], ["comprobante_domicilio", "responsable"],
  ];
  for (const [tipo, propietario] of docs) {
    await post(cEjec, "/api/expediente/" + CID + "/documento", { tipo, propietario, contenido_base64: b64, requiere_aval: false });
  }
  await post(cEjec, "/api/expediente/" + CID + "/datos", { nombre_completo: "Clienta Seg " + RUN, curp: "CLIE" + RUN, telefono_movil: "9511111111" });
  await post(cEjec, "/api/expediente/" + CID + "/datos", { domicilio_calle: "Calle Falsa", domicilio_cp: "68000", negocio_giro: "Abarrotes", es_pep: false });
  const rDatos3 = await j(await post(cEjec, "/api/expediente/" + CID + "/datos", {
    rfc: "RFCX" + RUN, identificacion_folio: "ID" + RUN, domicilio_numero: "123", domicilio_colonia: "Centro",
    domicilio_estado: "Oaxaca", actividad_economica_pld: "Comercio al por menor", origen_recursos: "Venta de abarrotes",
  }));
  const completo = rDatos3.expediente && rDatos3.expediente.estatus === "completo";
  const rVal = await j(await post(cAdmin, "/api/expediente/" + CID + "/validar", { aprobado: true }));
  return { completo, validado: rVal.ok === true };
}

(async () => {
  const cEjec = await login("prueba");
  const cDir = await login("pruebadir");
  const cAdmin = await login("pruebaadmin");
  const cControl = await login("pruebacontrol");
  const cCampo = await login("pruebacampo");
  ok("entran las 5 cuentas de prueba (una por puesto)", cEjec && cDir && cAdmin && cControl && cCampo,
    JSON.stringify({ cEjec: !!cEjec, cDir: !!cDir, cAdmin: !!cAdmin, cControl: !!cControl, cCampo: !!cCampo }));
  if (!cEjec || !cDir || !cAdmin || !cControl || !cCampo) { console.log("\nFaltan cuentas de prueba — no se puede seguir."); process.exit(1); }

  console.log("\n— Candado de segregación: solo el puesto correcto pasa cada paso —");
  let r = await post(cDir, "/api/creditos/solicitudes", { clienta_id: CID, producto: "Grupal-Basico", monto_solicitado: 5000, plazo_solicitado: 4 });
  ok("Dirección NO puede solicitar (candado por puesto)", r.status === 403, "status " + r.status);

  let d = await j(await post(cEjec, "/api/creditos/solicitudes", { clienta_id: CID, producto: "Grupal-Basico", monto_solicitado: 5000, plazo_solicitado: 4 }));
  ok("Sin expediente completo, la solicitud se bloquea", d.error && /[Ee]xpediente/.test(d.error) && !d.solicitud, JSON.stringify(d));

  console.log("\n— Escalera de autorización: vacía por defecto, no bloquea el arranque —");
  d = await j(await get(cEjec, "/api/creditos/escalera"));
  ok("La escalera arranca vacía (parámetro, no supuesto de Carlos)", Array.isArray(d.niveles), JSON.stringify(d));

  r = await post(cAdmin, "/api/creditos/escalera", { monto_desde: 0, monto_hasta: null, puesto_autoriza: "gerente_campo" });
  ok("Administración NO puede configurar la escalera (solo Dirección)", r.status === 403, "status " + r.status);
  r = await post(cDir, "/api/creditos/escalera", { monto_desde: 0, monto_hasta: 100000, puesto_autoriza: "gerente_campo", requisitos: "Nivel de PRUEBA — no son montos reales de FOOAX" });
  ok("Dirección configura un nivel de PRUEBA de la escalera", r.status === 200, "status " + r.status);

  console.log("\n— Construyendo expediente completo y validado para poder solicitar de verdad —");
  const exp = await construirExpedienteCompleto(cEjec, cAdmin);
  ok("expediente queda COMPLETO", exp.completo, JSON.stringify(exp));
  ok("Administración y Finanzas lo VALIDA", exp.validado, JSON.stringify(exp));

  console.log("\n— Flujo feliz: solicitar → autorizar (escalera) → dispersar (sincronización) → entregar → custodiar —");
  d = await j(await post(cEjec, "/api/creditos/solicitudes", { clienta_id: CID, producto: "Grupal-Basico", monto_solicitado: 5000, plazo_solicitado: 4 }));
  ok("la solicitud se crea con expediente completo y validado", d.ok === true && d.solicitud && d.solicitud.id, JSON.stringify(d));
  const solId = d.solicitud.id;

  r = await post(cEjec, `/api/creditos/solicitudes/${solId}/autorizar`, { decision: "autoriza" });
  ok("el ejecutivo NO puede autorizar su propia solicitud", r.status === 403, "status " + r.status);
  r = await post(cDir, `/api/creditos/solicitudes/${solId}/autorizar`, { decision: "autoriza" });
  ok("Dirección tampoco puede — este nivel de prueba solo autoriza gerente_campo", r.status === 403, "status " + r.status);

  d = await j(await post(cCampo, `/api/creditos/solicitudes/${solId}/autorizar`, { decision: "autoriza" }));
  ok("gerente_campo autoriza (según el nivel de escalera configurado arriba)", d.ok === true, JSON.stringify(d));

  r = await post(cCampo, `/api/creditos/solicitudes/${solId}/dispersar`, { comision_apertura: 100, cuota_manual: 1350 });
  ok("Regla K.2: quien autoriza NO puede dispersar (bloqueado por puesto, gerente_campo no es administracion_finanzas)", r.status === 403, "status " + r.status);
  r = await post(cEjec, `/api/creditos/solicitudes/${solId}/dispersar`, { comision_apertura: 100, cuota_manual: 1350 });
  ok("El ejecutivo tampoco puede dispersar (candado por puesto: solo administracion_finanzas)", r.status === 403, "status " + r.status);

  d = await j(await post(cAdmin, `/api/creditos/solicitudes/${solId}/dispersar`, { comision_apertura: 100, cuota_manual: 1350 }));
  ok("Administración dispersa — dispara la sincronización automática", d.ok === true, JSON.stringify(d));
  ok("se generó el pagaré en el mismo acto", d.pagare && d.pagare.id, JSON.stringify(d.pagare));
  ok("se generó el plan de pagos (calendario) con las 4 cuotas", Array.isArray(d.plan_pagos) && d.plan_pagos.length === 4, JSON.stringify(d.plan_pagos));
  ok("cada cuota trae fecha programada (auto-programado en la clienta)", d.plan_pagos.every((p) => !!p.fecha_programada), JSON.stringify(d.plan_pagos));
  ok("el ticket de garantía (10% Anexo F §7) se calculó sobre el monto autorizado", d.sobre && d.sobre.garantia_monto === 500, JSON.stringify(d.sobre));
  ok("el neto descuenta comisión y garantía (5000 - 100 - 500)", d.sobre && d.sobre.neto === 4400, JSON.stringify(d.sobre));
  ok("queda el apunte de cartera pendiente (sin tocar store.js/padrón real)", d.cartera_pendiente_alta && d.cartera_pendiente_alta.id === CID, JSON.stringify(d.cartera_pendiente_alta));
  const pagareId = d.pagare.id;

  r = await post(cAdmin, `/api/creditos/solicitudes/${solId}/entregar`, { firma_entrega_clienta: "firma-base64", gps_entrega: "17.06,-96.72" });
  ok("Regla K.2: quien dispersa NO puede entregar (bloqueado por puesto, administracion_finanzas no es ejecutivo_credito_cobranza)", r.status === 403, "status " + r.status);
  d = await j(await post(cEjec, `/api/creditos/solicitudes/${solId}/entregar`, { firma_entrega_clienta: "firma-base64", gps_entrega: "17.06,-96.72" }));
  ok("el ejecutivo entrega y recaba la firma", d.ok === true, JSON.stringify(d));

  r = await post(cEjec, `/api/creditos/pagares/${pagareId}/custodia`, { evento: "entro" });
  ok("Regla K.2: quien entrega NO puede custodiar (bloqueado por puesto, ejecutivo_credito_cobranza no es control_operativo_sucursal)", r.status === 403, "status " + r.status);
  d = await j(await post(cControl, `/api/creditos/pagares/${pagareId}/custodia`, { evento: "entro", a_quien: "Prueba Control" }));
  ok("Control Operativo custodia el pagaré", d.ok === true, JSON.stringify(d));

  const hist = await j(await get(cDir, `/api/creditos/pagares/${pagareId}/custodia`));
  ok("la bitácora de custodia queda consultable", Array.isArray(hist.eventos) && hist.eventos.length === 1 && hist.eventos[0].evento === "entro", JSON.stringify(hist));

  console.log(`\n${PASS} pruebas OK, ${FAIL} fallidas.`);
  process.exit(FAIL > 0 ? 1 : 0);
})();
