// PRUEBAS DEL MOTOR DE REGLAS (motor_reglas.js) — reglas de negocio COMO
// DATOS versionados, aplicadas retroactivamente al tope de responsable/aval y
// al checklist de documentos (antes constantes fijas en store_expediente.js).
// Mismo estilo que expediente.js: fetch contra un servidor YA corriendo.
//
// Uso:
//   node tests/reglas.js
//   EXP_URL=https://fooax-production.up.railway.app node tests/reglas.js
//
// Corre DESPUÉS de tests/expediente.js a propósito (ver correr-todo.sh): esta
// prueba cambia temporalmente el tope de responsable y el checklist_base
// compartidos, para demostrar que el cambio surte efecto SIN redeploy — y los
// revierte al final, dejando los valores como los asume expediente.js.
const U = process.env.EXP_URL || "http://localhost:3899";
const PASS = process.env.EXP_PASS || "PruebaFOOAX2026";
let PASS_N = 0, FAIL_N = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS_N++; console.log("  ✅ " + nombre); }
  else { FAIL_N++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const post = (url, body, cookie) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body || {}) });

const SEG = Math.floor(Date.now() / 1000);
const RUN = String(SEG % 100000);
const cid = (n) => "REGLA-" + RUN + "-" + n;

(async () => {
  console.log("MOTOR DE REGLAS FOOAX · " + U + " · corrida " + RUN);

  console.log("\n— A. SESIONES DE PRUEBA —");
  const login = async (u) => {
    const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: PASS }) });
    return r.ok ? r.headers.get("set-cookie").split(";")[0] : null;
  };
  const cEje = await login("prueba");         // ejecutivo
  const cDir = await login("pruebadir");       // dirección · puesto direccion_general — la única que puede CAMBIAR una regla
  const cAdmin = await login("pruebaadmin");   // admin · puesto administracion_finanzas — puede LEER, no cambiar
  ok("entra la ejecutiva de prueba", !!cEje);
  ok("entra la dirección de prueba", !!cDir);
  ok("entra administración/finanzas de prueba", !!cAdmin);
  if (!cEje || !cDir || !cAdmin) { console.log("\nSin las tres cuentas de prueba no se puede seguir."); process.exit(1); }
  const H = (c) => ({ Cookie: c });

  console.log("\n— B. LECTURA — quién puede ver las reglas vigentes y su historial —");
  const rNoLee = await fetch(U + "/api/reglas", { headers: H(cEje) });
  ok("la ejecutiva NO puede leer las reglas (403)", rNoLee.status === 403, "status " + rNoLee.status);
  const rVigentes = await j(await fetch(U + "/api/reglas", { headers: H(cDir) }));
  ok("dirección SÍ puede leer las reglas vigentes", Array.isArray(rVigentes.reglas), JSON.stringify(rVigentes).slice(0, 100));
  const claves = (rVigentes.reglas || []).map((r) => r.clave);
  for (const clave of ["tope_responsable", "tope_aval", "checklist_base", "checklist_aval"]) {
    ok("existe la regla sembrada " + clave, claves.includes(clave), "vigentes: " + claves.join(", "));
  }
  const topeRespVigente = (rVigentes.reglas || []).find((r) => r.clave === "tope_responsable");
  ok("el tope de responsable sembrado es el mismo que ya usaba el sistema (2)", topeRespVigente && topeRespVigente.valor.maximo === 2, JSON.stringify(topeRespVigente));

  const rHist = await j(await fetch(U + "/api/reglas/tope_responsable/historial", { headers: H(cDir) }));
  ok("el historial trae al menos la versión sembrada (version 1)", Array.isArray(rHist.versiones) && rHist.versiones.some((v) => v.version === 1), JSON.stringify(rHist).slice(0, 150));

  console.log("\n— C. ESCRITURA — SOLO Dirección General puede cambiar una regla —");
  const rEjeEscribe = await post(U + "/api/reglas/tope_responsable", { valor: { maximo: 3 }, motivo: "prueba" }, cEje);
  ok("la ejecutiva NO puede cambiar una regla (403)", rEjeEscribe.status === 403, "status " + rEjeEscribe.status);
  const rAdminEscribe = await post(U + "/api/reglas/tope_responsable", { valor: { maximo: 3 }, motivo: "prueba" }, cAdmin);
  ok("administración/finanzas TAMPOCO puede cambiar una regla (403 — solo Dirección General)", rAdminEscribe.status === 403, "status " + rAdminEscribe.status);
  const rSinMotivo = await post(U + "/api/reglas/tope_responsable", { valor: { maximo: 3 } }, cDir);
  ok("un cambio SIN motivo se rechaza (400 — el motivo queda en el historial)", rSinMotivo.status === 400, "status " + rSinMotivo.status);

  console.log("\n— D. CAMBIAR EL TOPE DE RESPONSABLE Y VER EL EFECTO EN VIVO, SIN REDEPLOY —");
  const rCambio = await j(await post(U + "/api/reglas/tope_responsable", { valor: { maximo: 3, nota: "prueba temporal — revertido al final de tests/reglas.js" }, motivo: "prueba automatizada del motor de reglas" }, cDir));
  ok("Dirección General SÍ puede cambiar la regla", rCambio.ok === true && rCambio.regla.version === (topeRespVigente.version + 1), JSON.stringify(rCambio).slice(0, 200));

  const rHistTras = await j(await fetch(U + "/api/reglas/tope_responsable/historial", { headers: H(cDir) }));
  const vAnterior = (rHistTras.versiones || []).find((v) => v.version === topeRespVigente.version);
  ok("la versión ANTERIOR queda cerrada (vigente_hasta ya no es null) — nunca se borra, se cierra", vAnterior && vAnterior.vigente_hasta != null, JSON.stringify(vAnterior));

  // Ahora sí: una responsable debe poder respaldar a 3 clientas (antes el
  // máximo era 2) — la prueba real de que vincularResponsable() lee el motor
  // de reglas y no un literal en el código.
  const c1 = cid("1"), c2 = cid("2"), c3 = cid("3"), c4 = cid("4");
  const rResp1 = await j(await post(U + "/api/expediente/" + c1 + "/responsable", { nombre: "Responsable Tope3 " + RUN, curp: "TOP3" + RUN }, cEje));
  ok("se crea y vincula la responsable a la 1ª clienta", rResp1.ok === true, JSON.stringify(rResp1).slice(0, 100));
  const respId = rResp1.responsable && rResp1.responsable.id;
  await post(U + "/api/expediente/" + c2 + "/responsable", { responsable_id: respId }, cEje);
  const rResp3 = await j(await post(U + "/api/expediente/" + c3 + "/responsable", { responsable_id: respId }, cEje));
  ok("con el tope en 3, la MISMA responsable SÍ se puede vincular a una 3ª clienta (antes hubiera fallado)", rResp3.ok === true, JSON.stringify(rResp3).slice(0, 100));
  const rResp4 = await fetch(U + "/api/expediente/" + c4 + "/responsable", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cEje }, body: JSON.stringify({ responsable_id: respId }) });
  ok("una 4ª clienta SÍ sigue rechazándose (409) — el tope de 3 se respeta igual", rResp4.status === 409, "status " + rResp4.status);

  console.log("\n— E. TRAZABILIDAD — la bitácora registra QUÉ VERSIÓN de la regla se usó —");
  const rBit = await j(await fetch(U + "/api/bitacora?entidad_id=" + c3 + "&limite=20", { headers: H(cDir) }));
  const evVinculo = (rBit.eventos || []).find((e) => e.accion === "expediente.responsable.alta" && e.entidad_id === c3);
  ok("el alta de responsable registra la regla usada (clave + versión), no solo el resultado",
    evVinculo && evVinculo.detalle && evVinculo.detalle.regla && evVinculo.detalle.regla.clave === "tope_responsable" && evVinculo.detalle.regla.version === rCambio.regla.version,
    JSON.stringify(evVinculo));

  const rBitReglas = await j(await fetch(U + "/api/bitacora?entidad_id=tope_responsable&limite=20", { headers: H(cDir) }));
  const evCambioRegla = (rBitReglas.eventos || []).find((e) => e.accion === "reglas.actualizar" && e.detalle && e.detalle.motivo === "prueba automatizada del motor de reglas");
  ok("el CAMBIO de la regla también queda en la bitácora, con el motivo", !!evCambioRegla, JSON.stringify(rBitReglas).slice(0, 200));

  console.log("\n— F. CHECKLIST — cambiar los documentos requeridos también surte efecto en vivo —");
  const rChecklistVigente = await j(await fetch(U + "/api/reglas", { headers: H(cDir) }));
  const checklistBaseAntes = rChecklistVigente.reglas.find((r) => r.clave === "checklist_base");
  const listaCorta = { documentos: ["solicitante_ine"], nota: "prueba temporal — revertido al final de tests/reglas.js" };
  await post(U + "/api/reglas/checklist_base", { valor: listaCorta, motivo: "prueba automatizada del motor de reglas" }, cDir);

  const cChecklist = cid("checklist");
  const b64 = Buffer.from("doc de prueba " + RUN).toString("base64");
  // Desde que existe el candado de campos PLD (store_expediente.js,
  // datosClientaFaltantes), el checklist de DOCUMENTOS ya no es lo único que
  // determina "completo" — para aislar esta prueba (que es sobre el
  // checklist, no sobre los datos de la clienta) se llenan esos campos antes.
  await post(U + "/api/expediente/" + cChecklist + "/datos", {
    curp: "CHK" + RUN, rfc: "CHK" + RUN, identificacion_folio: "ID" + RUN,
    domicilio_calle: "Calle", domicilio_numero: "1", domicilio_colonia: "Centro", domicilio_cp: "68000", domicilio_estado: "Oaxaca",
    actividad_economica_pld: "Comercio", origen_recursos: "Negocio propio",
  }, cEje);
  const rDoc = await j(await fetch(U + "/api/expediente/" + cChecklist + "/documento", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cEje }, body: JSON.stringify({ tipo: "ine", propietario: "solicitante", contenido_base64: b64 }) }));
  ok("con el checklist reducido a un solo documento (y los datos PLD ya completos), subir SOLO ese documento ya deja el expediente 'completo'",
    rDoc.ok === true && rDoc.expediente && rDoc.expediente.estatus === "completo", JSON.stringify(rDoc.expediente));

  console.log("\n— G. SE REVIERTEN LOS CAMBIOS — para no afectar otras pruebas ni quedar como valor 'de prueba' —");
  const rRevierteTope = await j(await post(U + "/api/reglas/tope_responsable", { valor: { maximo: 2, nota: topeRespVigente.valor.nota }, motivo: "revertir el cambio de la prueba automatizada tests/reglas.js" }, cDir));
  ok("se revierte el tope de responsable a 2 (nueva versión, no se borra el historial)", rRevierteTope.ok === true && rRevierteTope.regla.valor.maximo === 2, JSON.stringify(rRevierteTope).slice(0, 150));
  const rRevierteChecklist = await j(await post(U + "/api/reglas/checklist_base", { valor: checklistBaseAntes.valor, motivo: "revertir el cambio de la prueba automatizada tests/reglas.js" }, cDir));
  ok("se revierte el checklist_base a su lista original", rRevierteChecklist.ok === true && rRevierteChecklist.regla.valor.documentos.length === checklistBaseAntes.valor.documentos.length, JSON.stringify(rRevierteChecklist).slice(0, 200));

  const rFinal = await j(await fetch(U + "/api/reglas", { headers: H(cDir) }));
  const topeFinal = rFinal.reglas.find((r) => r.clave === "tope_responsable");
  const checklistFinal = rFinal.reglas.find((r) => r.clave === "checklist_base");
  ok("al terminar, el tope de responsable vuelve a ser 2 (lo que expediente.js asume)", topeFinal.valor.maximo === 2, JSON.stringify(topeFinal));
  ok("al terminar, el checklist_base vuelve a tener sus 6 documentos originales (lo que expediente.js asume)", checklistFinal.valor.documentos.length === checklistBaseAntes.valor.documentos.length, JSON.stringify(checklistFinal));

  console.log("\n— RESULTADO —");
  console.log(`  ${PASS_N} pruebas OK, ${FAIL_N} fallidas.`);
  process.exit(FAIL_N > 0 ? 1 : 0);
})().catch((e) => {
  console.error("Error corriendo las pruebas del motor de reglas:", e);
  process.exit(1);
});
