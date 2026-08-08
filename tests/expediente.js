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

  console.log("\n— D. REFERENCIAS — exigen su propio consentimiento —");
  const rRefSin = await fetch(U + "/api/expediente/" + c1 + "/referencia", { method: "POST", headers: H(cEje), body: JSON.stringify({ nombre: "Ref Prueba", relacion: "vecina" }) });
  ok("sin consentimiento se rechaza (400)", rRefSin.status === 400);
  const rRefCon = await j(await fetch(U + "/api/expediente/" + c1 + "/referencia", { method: "POST", headers: H(cEje), body: JSON.stringify({ nombre: "Ref Prueba", relacion: "vecina", consentimiento: true }) }));
  ok("con consentimiento se guarda", rRefCon.ok === true, JSON.stringify(rRefCon).slice(0, 90));

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
