// CU-010 · ARMADO DEL EXPEDIENTE CON CHECKLIST Y VALIDACIÓN ANTES DE DISPERSAR — pruebas.
// Servidor local (3899) con DATA_DIR desechable, cuentas locales REALES: la
// validación es de Administración y Finanzas (rol admin) y la burbuja de prueba
// no tiene admin. El candado sobre el desembolso real se prueba en
// tests/sobres_segregacion.js (sección 3b).
//
//   D=/tmp/fooax-prueba-exp2; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/expediente_validacion.js
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
const post = (ruta, body, c) => fetch(U + ruta, { method: "POST", headers: H(c), body: JSON.stringify(body) });
const get = (ruta, c) => fetch(U + ruta, { headers: H(c) });
const { capturaValida } = require("./_captura_expediente");

(async () => {
  const cEje = await login("karina", "karina2026");        // ejecutiva: captura
  const cDir = await login("alejandra", "alejandra2026");  // Administración y Finanzas (admin): valida
  const cAnel = await login("anel", "anel2026");           // dirección: NO valida
  if (!cEje || !cDir || !cAnel) { console.log("No pude entrar con las cuentas locales."); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const estatus = async (socio, c) => (await j(await get("/api/expediente/" + socio, c || cDir))).estatus;

  console.log("\n— 1. EXPEDIENTE INCOMPLETO: le falta un documento del checklist —");
  const c1 = capturaValida(RUN);
  c1.documentos = c1.documentos.filter((d) => !(d.propietario === "solicitante" && d.tipo === "foto_negocio"));
  let r = await post("/api/expediente/captura", c1, cEje);
  let d = await j(r);
  ok("la captura se guarda aunque el checklist no esté completo (armar ≠ validar)", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 200));
  const socio = d.socio;
  ok("la respuesta ya trae el semáforo: incompleto, falta solicitante:foto_negocio", d.estatus.semaforo === "incompleto" && d.estatus.completo === false && d.estatus.faltantes.join() === "solicitante:foto_negocio", JSON.stringify(d.estatus));
  ok("el checklist exige 6 documentos (4 de la clienta + 2 de la responsable; sin aval no pide los del aval)", d.estatus.requeridos.length === 6 && d.estatus.presentes === 5);
  ok("los campos PLD obligatorios están completos (CURP, RFC, identificación, domicilio, actividad, origen)", d.estatus.camposFaltantes.length === 0);
  ok("bloquea el desembolso", d.estatus.bloqueaDesembolso === true && d.estatus.listoParaValidar === false);

  console.log("\n— 2. NO SE PUEDE VALIDAR UN EXPEDIENTE INCOMPLETO — sin excepciones —");
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: true }, cDir);
  d = await j(r);
  ok("aprobar con documento faltante: 400 y dice qué falta", r.status === 400 && /foto_negocio/.test(d.error), JSON.stringify(d).slice(0, 200));
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: true }, cEje);
  ok("una ejecutiva NO valida (403)", r.status === 403);
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: true }, cAnel);
  ok("Dirección tampoco valida: es de Administración y Finanzas (403, EXPEDIENTE_ROLES_VALIDAR=admin)", r.status === 403);
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: false }, cDir);
  d = await j(r);
  ok("rechazar sin motivo: 400 (el motivo regresa a Control Operativo)", r.status === 400 && /motivo/i.test(d.error));
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: false, motivo: "Falta la foto del negocio; tomarla en la próxima visita" }, cDir);
  d = await j(r);
  ok("rechazar con motivo: queda 'rechazado' con quién y por qué", r.status === 200 && d.estatus.semaforo === "rechazado" && d.estatus.validacion.aprobado === false && /foto/.test(d.estatus.validacion.motivo) && d.estatus.validacion.porId === "alejandra", JSON.stringify(d.estatus).slice(0, 300));
  const lista = await j(await get("/api/expedientes", cDir));
  const fila = lista.expedientes.find((e) => e.socio === socio);
  ok("la lista para Control Operativo muestra el semáforo 'rechazado' y cuántos faltan", fila && fila.semaforo === "rechazado" && fila.faltantes === 1, JSON.stringify(fila));

  console.log("\n— 3. CONTROL OPERATIVO COMPLETA EL CHECKLIST —");
  r = await post("/api/expediente/" + socio + "/documento", { propietario: "solicitante", tipo: "foto_negocio", ubicacionFisica: "Carpeta 7" }, cEje);
  d = await j(r);
  ok("se agrega el documento faltante y el semáforo pasa a 'completo'", r.status === 200 && d.estatus.completo === true && d.estatus.semaforo === "completo", JSON.stringify(d.estatus).slice(0, 200));
  ok("el rechazo anterior sigue en el historial pero ya no manda (listo para validar)", d.estatus.listoParaValidar === true && d.expediente.historial.some((e) => e.evento === "validacion" && e.aprobado === false));

  console.log("\n— 4. ADMINISTRACIÓN Y FINANZAS VALIDA —");
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: true }, cDir);
  d = await j(r);
  ok("con el expediente al 100% la validación procede: semáforo 'validado'", r.status === 200 && d.ok && d.estatus.semaforo === "validado" && d.estatus.bloqueaDesembolso === false, JSON.stringify(d.estatus).slice(0, 200));
  ok("queda registrado quién validó y cuándo", d.validacion.porId === "alejandra" && /^\d{4}-\d{2}-\d{2}T/.test(d.validacion.fechaHora));
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: true }, cDir);
  ok("validar dos veces: 400 (ya está)", r.status === 400);

  console.log("\n— 5. UNA RECAPTURA DESPUÉS DE VALIDAR OBLIGA A REVALIDAR —");
  const c2 = capturaValida(RUN, { socio });
  c2.folioCaptura = "CAP-RECAP-" + RUN;
  c2.datos.telefonoMovil = "9517654321";
  r = await post("/api/expediente/captura", c2, cEje);
  d = await j(r);
  ok("la recaptura de la misma clienta se acepta como evento nuevo (no pisa nada)", r.status === 200 && d.recaptura === true && d.socio === socio, JSON.stringify(d).slice(0, 200));
  ok("el dato nuevo manda (teléfono) y la captura anterior sigue en el historial", d.expediente.datos.telefonoMovil === "9517654321" && d.expediente.capturas === 2);
  ok("la validación previa queda OBSOLETA: vuelve a 'completo', bloquea hasta revalidar", d.estatus.semaforo === "completo" && d.estatus.validacionObsoleta === true && d.estatus.bloqueaDesembolso === true, JSON.stringify(d.estatus).slice(0, 200));
  r = await post("/api/expediente/" + socio + "/validar", { aprobado: true }, cDir);
  d = await j(r);
  ok("Ale revalida", r.status === 200 && d.estatus.semaforo === "validado");

  console.log("\n— 6. CAMPOS PLD: con documentos completos pero un campo vacío el expediente NO está íntegro —");
  const c3 = capturaValida(RUN + "3");
  c3.datos.rfc = "";   // pasa la validación de forma? No: RFC es obligatorio en la captura...
  r = await post("/api/expediente/captura", c3, cEje);
  d = await j(r);
  ok("…de hecho la captura misma ya exige el RFC (CU-009): 400", r.status === 400 && d.errores.some((e) => /rfc/i.test(e)));
  // Un aval sin sus documentos: el checklist crece y el expediente queda incompleto.
  const c4 = capturaValida(RUN + "4", { tipoCredito: "individual", importeSolicitado: 15000, responsable: null,
    aval: { nombre: "Aval V " + RUN, curp: "AEAL900101HOCXXX1" + String(Number(RUN) % 10), telefono: "9518888888", domicilio: "Calle 3", ocupacion: "Empleado", identificacion: "INE 777", consentimiento: true } });
  c4.documentos = c4.documentos.filter((x) => x.propietario === "solicitante");
  r = await post("/api/expediente/captura", c4, cEje);
  d = await j(r);
  ok("con aval, el checklist pide también sus 2 documentos: faltan aval:ine y aval:comprobante_domicilio", r.status === 200 && d.estatus.faltantes.join() === "aval:ine,aval:comprobante_domicilio", JSON.stringify(d.estatus && d.estatus.faltantes));

  console.log("\n— 7. VIGENCIA: un documento vencido se SEÑALA (informa; el candado es de presencia, DOC-01) —");
  const c5 = capturaValida(RUN + "5");
  c5.documentos.find((x) => x.tipo === "ine" && x.propietario === "solicitante").fechaVencimiento = "2024-01-01";
  c5.documentos.find((x) => x.tipo === "comprobante_domicilio" && x.propietario === "solicitante").fechaEmision = "2025-01-01";
  r = await post("/api/expediente/captura", c5, cEje);
  d = await j(r);
  ok("INE vencida y comprobante viejo aparecen en `vencidos`", r.status === 200 && d.estatus.vencidos.includes("solicitante:ine") && d.estatus.vencidos.includes("solicitante:comprobante_domicilio"), JSON.stringify(d.estatus && d.estatus.vencidos));
  ok("los documentos de la responsable sin fecha propia aparecen en `sinFecha` (no se sabe si vencieron)", d.estatus.sinFecha.includes("responsable:ine"));

  console.log("\n— 8. LOS PENDIENTES DE DIRECCIÓN VIAJAN COMO DATOS —");
  d = await j(await get("/api/expediente/catalogos", cDir));
  ok("excepción manual al candado y qué revalidar en renovación, listados como pendientes", d.pendientes.some((p) => /Excepción manual/.test(p.tema)) && d.pendientes.some((p) => /renovación/.test(p.tema)));

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
