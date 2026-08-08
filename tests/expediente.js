// PRUEBAS DEL MÓDULO DE EXPEDIENTE — CU-009 (alta/captura) y CU-010 (armado y
// validación del expediente). Mismo estilo que smoke.js: fetch contra un
// servidor YA corriendo (correr-todo.sh lo levanta con DOC_ENCRYPTION_KEY
// puesta solo para esta corrida desechable — ver ese script).
//
// Uso:
//   node tests/expediente.js                                   (local, puerto 3899)
//   EXP_URL=https://fooax-production.up.railway.app node tests/expediente.js
//
// Qué valida, con la burbuja de prueba (prueba / pruebadir / pruebaadmin):
//   - Tope de responsable (máximo 2 clientas activas) y de aval (máximo 1).
//   - Referencia exige su propio consentimiento (400 si falta).
//   - Documentos: tipo/propietario inválidos se rechazan; el checklist avanza
//     a "completo" solo cuando están los documentos requeridos.
//   - Candado CU-010: bloquea desembolso hasta que Ale (puesto
//     administracion_finanzas) valide el expediente completo.
//   - El candado es TÉCNICO: un usuario sin ese puesto recibe 403 al validar,
//     aunque tenga rol de dirección/admin clásico.
//   - La bitácora registra los eventos y solo Dirección/Admin puede leerla.
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
const RUN = String(SEG % 100000);  // sufijo único por corrida — no se pisa con otra
const cid = (n) => "EXP-" + RUN + "-" + n; // ids de clienta de prueba, solo para esta corrida

(async () => {
  console.log("EXPEDIENTE FOOAX · " + U + " · corrida " + RUN);

  console.log("\n— A. SESIONES DE PRUEBA —");
  const login = async (u) => {
    const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: PASS }) });
    return r.ok ? r.headers.get("set-cookie").split(";")[0] : null;
  };
  const cEje = await login("prueba");           // ejecutivo · puesto ejecutivo_credito_cobranza
  const cDir = await login("pruebadir");         // dirección · puesto direccion_general
  const cAdmin = await login("pruebaadmin");     // admin · puesto administracion_finanzas (Ale)
  ok("entra la ejecutiva de prueba", !!cEje);
  ok("entra la dirección de prueba", !!cDir);
  ok("entra la cuenta de administración/finanzas de prueba (Ale)", !!cAdmin);
  if (!cEje || !cDir || !cAdmin) { console.log("\nSin las tres cuentas de prueba no se puede seguir."); process.exit(1); }
  const H = (c) => ({ "Content-Type": "application/json", Cookie: c });

  console.log("\n— B. RESPONSABLE — tope de 2 clientas activas —");
  const c1 = cid("1"), c2 = cid("2"), c3 = cid("3");
  const rResp1 = await j(await fetch(U + "/api/expediente/" + c1 + "/responsable", { method: "POST", headers: H(cEje), body: JSON.stringify({ nombre: "Responsable Prueba " + RUN, curp: "RESP" + RUN }) }));
  ok("se crea y vincula la responsable a la 1ª clienta", rResp1.ok === true, JSON.stringify(rResp1).slice(0, 90));
  const respId = rResp1.responsable && rResp1.responsable.id;
  ok("regresa un id de responsable", !!respId);

  const rResp2 = await j(await fetch(U + "/api/expediente/" + c2 + "/responsable", { method: "POST", headers: H(cEje), body: JSON.stringify({ responsable_id: respId }) }));
  ok("la MISMA responsable se puede vincular a una 2ª clienta (dentro del tope)", rResp2.ok === true, JSON.stringify(rResp2).slice(0, 90));

  const rResp3 = await fetch(U + "/api/expediente/" + c3 + "/responsable", { method: "POST", headers: H(cEje), body: JSON.stringify({ responsable_id: respId }) });
  const rResp3Body = await j(rResp3);
  ok("la MISMA responsable NO se puede vincular a una 3ª clienta (tope excedido → 409)", rResp3.status === 409, "status " + rResp3.status + " · " + JSON.stringify(rResp3Body).slice(0, 90));

  console.log("\n— C. AVAL — tope de 1 clienta activa —");
  const rAval1 = await j(await fetch(U + "/api/expediente/" + c1 + "/aval", { method: "POST", headers: H(cEje), body: JSON.stringify({ nombre: "Aval Prueba " + RUN, curp: "AVAL" + RUN }) }));
  ok("se crea y vincula el aval a la 1ª clienta", rAval1.ok === true, JSON.stringify(rAval1).slice(0, 90));
  const avalId = rAval1.aval && rAval1.aval.id;

  const rAval2 = await fetch(U + "/api/expediente/" + c2 + "/aval", { method: "POST", headers: H(cEje), body: JSON.stringify({ aval_id: avalId }) });
  const rAval2Body = await j(rAval2);
  ok("el MISMO aval NO se puede vincular a una 2ª clienta (tope de 1 excedido → 409)", rAval2.status === 409, "status " + rAval2.status + " · " + JSON.stringify(rAval2Body).slice(0, 90));

  console.log("\n— C2. BUSCAR responsable/aval existente (para reutilizar, no duplicar) —");
  const rBuscaResp = await j(await fetch(U + "/api/responsables?q=" + encodeURIComponent("Responsable Prueba " + RUN), { headers: H(cEje) }));
  const encontradaResp = (rBuscaResp.resultados || []).find((x) => x.id === respId);
  ok("la búsqueda por nombre encuentra a la responsable ya creada", !!encontradaResp, JSON.stringify(rBuscaResp).slice(0, 120));
  ok("la búsqueda trae cuántas clientas ya respalda (2 de 2 — llegó al tope)", encontradaResp && encontradaResp.clientas_activas === 2 && encontradaResp.tope === 2, JSON.stringify(encontradaResp));

  const rBuscaRespCurp = await j(await fetch(U + "/api/responsables?q=" + encodeURIComponent("RESP" + RUN), { headers: H(cEje) }));
  ok("la búsqueda por CURP también la encuentra", (rBuscaRespCurp.resultados || []).some((x) => x.id === respId), JSON.stringify(rBuscaRespCurp).slice(0, 120));

  const rBuscaAval = await j(await fetch(U + "/api/avales?q=" + encodeURIComponent("Aval Prueba " + RUN), { headers: H(cEje) }));
  const encontradoAval = (rBuscaAval.resultados || []).find((x) => x.id === avalId);
  ok("la búsqueda de avales encuentra al aval ya creado, con su tope (1 de 1)", encontradoAval && encontradoAval.clientas_activas === 1 && encontradoAval.tope === 1, JSON.stringify(encontradoAval));

  const rBuscaVacia = await j(await fetch(U + "/api/responsables?q=NombreQueNoExiste" + RUN, { headers: H(cEje) }));
  ok("una búsqueda sin coincidencias regresa vacío, no error", Array.isArray(rBuscaVacia.resultados) && rBuscaVacia.resultados.length === 0, JSON.stringify(rBuscaVacia));

  console.log("\n— D. REFERENCIAS — exigen su propio consentimiento —");
  const rRefSin = await fetch(U + "/api/expediente/" + c1 + "/referencia", { method: "POST", headers: H(cEje), body: JSON.stringify({ nombre: "Ref Prueba", relacion: "vecina" }) });
  ok("sin consentimiento se rechaza (400)", rRefSin.status === 400);
  const rRefCon = await j(await fetch(U + "/api/expediente/" + c1 + "/referencia", { method: "POST", headers: H(cEje), body: JSON.stringify({ nombre: "Ref Prueba 1", relacion: "vecina", curp: "REFA" + RUN, telefono: "9511234567", consentimiento: true }) }));
  ok("con consentimiento se guarda, con CURP y teléfono", rRefCon.ok === true && rRefCon.referencia.curp === "REFA" + RUN, JSON.stringify(rRefCon).slice(0, 120));
  await j(await fetch(U + "/api/expediente/" + c1 + "/referencia", { method: "POST", headers: H(cEje), body: JSON.stringify({ nombre: "Ref Prueba 2", relacion: "compañera", consentimiento: true }) }));

  console.log("\n— E. DOCUMENTOS — cifrado, tipos válidos y checklist —");
  const b64 = Buffer.from("contenido de prueba " + RUN).toString("base64");
  const rDocMal = await fetch(U + "/api/expediente/" + c1 + "/documento", { method: "POST", headers: H(cEje), body: JSON.stringify({ tipo: "no_existe", propietario: "solicitante", contenido_base64: b64 }) });
  ok("tipo de documento inválido se rechaza (400)", rDocMal.status === 400);

  const docs = [
    ["ine", "solicitante"], ["comprobante_domicilio", "solicitante"], ["curp", "solicitante"], ["foto_negocio", "solicitante"],
    ["ine", "responsable"], ["comprobante_domicilio", "responsable"],
  ];
  let expDespues = null;
  for (const [tipo, propietario] of docs) {
    const r = await j(await fetch(U + "/api/expediente/" + c1 + "/documento", { method: "POST", headers: H(cEje), body: JSON.stringify({ tipo, propietario, contenido_base64: b64, requiere_aval: false }) }));
    ok("se guarda documento " + propietario + "_" + tipo, r.ok === true, JSON.stringify(r).slice(0, 90));
    expDespues = r.expediente;
  }
  ok("el checklist queda COMPLETO tras subir todo lo requerido (sin aval)", expDespues && expDespues.estatus === "completo", JSON.stringify(expDespues && expDespues.checklist));

  const rDocs = await j(await fetch(U + "/api/expediente/" + c1, { headers: H(cEje) }));
  ok("el detalle del expediente lista documentos SOLO con metadatos (nunca el contenido)", Array.isArray(rDocs.documentos) && rDocs.documentos.length === docs.length && !rDocs.documentos.some((d) => "contenido" in d || "contenido_cifrado" in d), "documentos " + JSON.stringify(rDocs.documentos).slice(0, 120));
  ok("el detalle trae las 2 referencias que exige la Solicitud (Sección 8)", Array.isArray(rDocs.referencias) && rDocs.referencias.length === 2, "referencias " + JSON.stringify(rDocs.referencias).slice(0, 120));
  ok("el detalle trae el domicilio institucional (social y fiscal) fijo, no editable", rDocs.domicilio_institucional && /Oaxaca de Juárez/.test(rDocs.domicilio_institucional.social) && /San Lorenzo Cacaotepec/.test(rDocs.domicilio_institucional.fiscal), JSON.stringify(rDocs.domicilio_institucional));

  console.log("\n— E2. DATOS DE LA CLIENTA — identidad, domicilio, negocio, PLD/PEP (CU-009 §3) —");
  const rDatos1 = await j(await post(U + "/api/expediente/" + c1 + "/datos", { nombre_completo: "Clienta de Prueba " + RUN, curp: "CLIE" + RUN, telefono_movil: "9511111111" }, cEje));
  ok("guarda la primera tanda de datos de identidad", rDatos1.ok === true && rDatos1.datos.datos.nombre_completo === "Clienta de Prueba " + RUN, JSON.stringify(rDatos1).slice(0, 150));

  const rDatos2 = await j(await post(U + "/api/expediente/" + c1 + "/datos", { domicilio_calle: "Calle Falsa", domicilio_cp: "68000", negocio_giro: "Abarrotes", es_pep: false }, cEje));
  ok("guardar una SEGUNDA tanda no borra la primera (merge, no reemplazo)",
    rDatos2.ok === true && rDatos2.datos.datos.nombre_completo === "Clienta de Prueba " + RUN && rDatos2.datos.datos.domicilio_calle === "Calle Falsa",
    JSON.stringify(rDatos2).slice(0, 200));

  const rDetalleConDatos = await j(await fetch(U + "/api/expediente/" + c1, { headers: H(cEje) }));
  ok("el detalle del expediente trae los datos de la clienta acumulados",
    rDetalleConDatos.datos && rDetalleConDatos.datos.curp === "CLIE" + RUN && rDetalleConDatos.datos.negocio_giro === "Abarrotes",
    JSON.stringify(rDetalleConDatos.datos));

  console.log("\n— E3. UBICACIÓN FÍSICA del papel (CU-010 §3 — trazabilidad, no candado) —");
  const rUbiSinExp = await post(U + "/api/expediente/" + cid("sin_expediente") + "/ubicacion-fisica", { folio_fisico: "F-1", ubicacion_fisica: "Archivero A" }, cEje);
  ok("no se puede anotar ubicación física de un expediente que no existe (400)", rUbiSinExp.status === 400);

  const rUbi = await j(await post(U + "/api/expediente/" + c1 + "/ubicacion-fisica", { folio_fisico: "EXP-" + RUN, ubicacion_fisica: "Archivero A, gaveta 3, Sucursal 1" }, cEje));
  ok("se guarda el folio y la ubicación del original en papel", rUbi.ok === true && rUbi.expediente.folio_fisico === "EXP-" + RUN, JSON.stringify(rUbi).slice(0, 150));

  const rExpTrasSubirOtroDoc = await j(await fetch(U + "/api/expediente/" + c1 + "/documento", { method: "POST", headers: H(cEje), body: JSON.stringify({ tipo: "curp", propietario: "solicitante", contenido_base64: b64, requiere_aval: false }) }));
  ok("subir OTRO documento después NO borra la ubicación física ya anotada",
    rExpTrasSubirOtroDoc.expediente && rExpTrasSubirOtroDoc.expediente.folio_fisico === "EXP-" + RUN,
    JSON.stringify(rExpTrasSubirOtroDoc.expediente));

  console.log("\n— F. CANDADO CU-010 — expediente completo pero SIN validar bloquea desembolso —");
  const cand1 = await j(await fetch(U + "/api/expediente/" + c1 + "/candado", { headers: H(cEje) }));
  ok("bloquea el desembolso mientras Ale no valide, aunque el checklist esté completo", cand1.bloquea === true, JSON.stringify(cand1));

  console.log("\n— G. VALIDACIÓN — candado TÉCNICO por puesto, no solo por rol —");
  const rValNoPuesto = await fetch(U + "/api/expediente/" + c1 + "/validar", { method: "POST", headers: H(cEje), body: JSON.stringify({ aprobado: true }) });
  ok("la ejecutiva (puesto equivocado) NO puede validar (403)", rValNoPuesto.status === 403, "status " + rValNoPuesto.status);
  const rValNoPuestoDir = await fetch(U + "/api/expediente/" + c1 + "/validar", { method: "POST", headers: H(cDir), body: JSON.stringify({ aprobado: true }) });
  ok("dirección (rol alto pero puesto equivocado) TAMPOCO puede validar (403)", rValNoPuestoDir.status === 403, "status " + rValNoPuestoDir.status);
  const rVal = await j(await fetch(U + "/api/expediente/" + c1 + "/validar", { method: "POST", headers: H(cAdmin), body: JSON.stringify({ aprobado: true }) }));
  ok("Ale (puesto administracion_finanzas) SÍ puede validar", rVal.ok === true, JSON.stringify(rVal).slice(0, 90));

  const cand2 = await j(await fetch(U + "/api/expediente/" + c1 + "/candado", { headers: H(cEje) }));
  ok("ya validado, el candado deja pasar el desembolso", cand2.bloquea === false, JSON.stringify(cand2));

  console.log("\n— H. FIRMAS — las tres, siempre separadas —");
  const rFirmaMala = await fetch(U + "/api/expediente/" + c1 + "/firma", { method: "POST", headers: H(cEje), body: JSON.stringify({ tipo: "no_existe" }) });
  ok("tipo de firma inválido se rechaza (400)", rFirmaMala.status === 400);
  for (const tipo of ["solicitud", "buro", "datos_sensibles"]) {
    const r = await j(await fetch(U + "/api/expediente/" + c1 + "/firma", { method: "POST", headers: H(cEje), body: JSON.stringify({ tipo, gps: "17.07,-96.72", dispositivo: "prueba", version_aviso: "2026-08" }) }));
    ok("se registra la firma de " + tipo, r.ok === true, JSON.stringify(r).slice(0, 90));
  }
  const rFirmas = await j(await fetch(U + "/api/expediente/" + c1, { headers: H(cEje) }));
  ok("quedan las TRES firmas, cada una por separado", Array.isArray(rFirmas.firmas) && ["solicitud", "buro", "datos_sensibles"].every((t) => rFirmas.firmas.some((f) => f.tipo === t)), JSON.stringify(rFirmas.firmas));

  console.log("\n— I. BITÁCORA — solo lectura, solo Dirección/Admin —");
  const rBitNo = await fetch(U + "/api/bitacora?entidad_id=" + c1, { headers: H(cEje) });
  ok("la ejecutiva NO puede leer la bitácora (403)", rBitNo.status === 403, "status " + rBitNo.status);
  const rBitSi = await j(await fetch(U + "/api/bitacora?entidad_id=" + c1, { headers: H(cDir) }));
  ok("dirección SÍ puede leer la bitácora", Array.isArray(rBitSi.eventos), JSON.stringify(rBitSi).slice(0, 90));
  ok("la bitácora tiene un evento por cada acción relevante de esta corrida", (rBitSi.eventos || []).length >= docs.length + 3, "eventos " + (rBitSi.eventos || []).length);
  ok("la bitácora registra QUIÉN hizo cada acción", (rBitSi.eventos || []).every((e) => !!e.usuario), "faltó usuario en algún evento");

  console.log("\n— RESULTADO —");
  console.log(`  ${PASS_N} pruebas OK, ${FAIL_N} fallidas.`);
  process.exit(FAIL_N > 0 ? 1 : 0);
})().catch((e) => {
  console.error("Error corriendo las pruebas de expediente:", e);
  process.exit(1);
});
