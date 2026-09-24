// CU-009 · ALTA Y CAPTURA DE CLIENTA EN CAMPO, SIN CONEXIÓN — pruebas.
// Servidor local (3899) con DATA_DIR desechable (el registro `expediente` se
// escribe de verdad). Usa la burbuja de PRUEBA (prueba / pruebadir): el
// expediente no toca el padrón real, así que aquí sí se puede.
//
//   D=/tmp/fooax-prueba-exp; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/expediente_captura.js
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

// Una captura completa y válida (CU-009 §3), parametrizable.
function captura(RUN, extra) {
  // CURP con formato oficial válido; la homoclave (2 últimos) varía por RUN.
  const n = Number(RUN) || 0;
  const curp = "GARL900101MOCRPR" + "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[n % 34] + String(n % 10);
  const base = {
    folioCaptura: "CAP-TEST-" + RUN + "-" + Math.random().toString(36).slice(2, 6),
    centro: "C-0", tipoCredito: "grupal", importeSolicitado: 6000,
    datos: {
      apellidoPaterno: "García", apellidoMaterno: "López", nombres: "Prueba " + RUN, curp, rfc: "GALP900101" + "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[n % 34] + "B" + String(n % 10),
      fechaNacimiento: "1990-01-01", lugarNacimiento: "Oaxaca", nacionalidad: "Mexicana", estadoCivil: "Casada(o)", genero: "Mujer",
      telefonoMovil: "9511234567", identificacion: { tipo: "INE", folio: "IDMEX" + RUN },
      domicilio: { calle: "Calle Falsa", numero: "123", colonia: "Centro", cp: "68000", municipio: "Oaxaca de Juárez", ciudad: "Oaxaca", estado: "Oaxaca", tiempoResidenciaMeses: 36 },
      gps: { lat: 17.0654, lng: -96.7237, precision: 8 },
      negocio: { giro: "Abarrotes", antiguedadMeses: 24, ingresoDeclarado: 4500 }, actividadEconomica: "Comercio",
      capacidadPago: { ingresoSemanal: 4500, gastosNegocio: 2000, gastosHogar: 1500, mesIngresoMasBajo: "Enero", capacidadPago: 900 },
      creditosOtros: { tiene: false },
      vivienda: { tipo: "propia", superficie: 80, niveles: 1, habitaciones: 3, paredes: "block", piso: "cemento", techo: "lámina" },
      familia: { dependientes: 2, hijosMenores: 1, otroIngreso: "esposo", ingresoTotalHogar: 7000 },
    },
    pld: { origenRecursos: "Ingresos del negocio", pep: { es: false } },
    referencias: [
      { nombre: "Ref Uno", relacion: "Vecina(o)", telefono: "9510000001", consentimiento: true },
      { nombre: "Ref Dos", relacion: "Familiar", telefono: "9510000002", consentimiento: true },
    ],
    responsable: { nombre: "Responsable " + RUN, curp: "RESP900101MOCXXX0" + String(n % 10), telefono: "9519999999", domicilio: "Calle 2", ocupacion: "Comerciante", identificacion: "INE 999", consentimiento: true },
    firma1: { aceptada: true, fechaHora: new Date().toISOString(), gps: { lat: 17.0654, lng: -96.7237 }, dispositivo: "Prueba/1.0 (node)", nombreFirmante: "Prueba " + RUN },
    documentos: [
      { propietario: "solicitante", tipo: "ine", fechaVencimiento: "2029-12-31" },
      { propietario: "solicitante", tipo: "comprobante_domicilio", fechaEmision: "2026-08-15" },
      { propietario: "solicitante", tipo: "curp" }, { propietario: "solicitante", tipo: "foto_negocio" },
      { propietario: "responsable", tipo: "ine" }, { propietario: "responsable", tipo: "comprobante_domicilio" },
    ],
  };
  return Object.assign(base, extra || {});
}
const clon = (o) => JSON.parse(JSON.stringify(o));

(async () => {
  const cEje = await login("prueba", "PruebaFOOAX2026");
  const cDir = await login("pruebadir", "PruebaFOOAX2026");
  const cKarina = await login("karina", "karina2026");
  if (!cEje || !cDir) { console.log("No pude entrar con la burbuja de prueba."); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);

  console.log("\n— 1. LA APP TRAE LA CAPA DE ALTA EN CAMPO Y LOS CATÁLOGOS —");
  const app = await fetch(U + "/app", { headers: { Cookie: cEje } });
  const appHtml = app.ok ? await app.text() : "";
  ok("la app del ejecutivo inyecta alta-campo.js", app.ok && appHtml.includes("alta-campo.js"));
  ok("la pieza /alta-campo.js se sirve", (await fetch(U + "/alta-campo.js")).ok);
  const sw = await (await fetch(U + "/sw.js")).text();
  ok("el service worker la sirve siempre fresca y la cachea para offline", /SIEMPRE_FRESCO[^\n]*alta-campo/.test(sw) && /ASSETS[^\n]*alta-campo/.test(sw));
  let r = await get("/api/expediente/catalogos", cEje);
  let d = await j(r);
  ok("catálogos cerrados: PEP (tipo/parentesco), actividad económica, origen de recursos", r.status === 200 && d.pepTipos.length === 3 && d.pepParentescos.length === 6 && d.actividadesEconomicas.length && d.origenesRecursos.length);
  ok("topes como parámetros: responsable 2, aval 1; aval desde $10,000", d.topeResponsable === 2 && d.topeAval === 1 && d.montoRequiereAval === 10000);
  ok("el checklist viaja como datos (solicitante 4, responsable 2, aval 2)", d.checklist.solicitante.length === 4 && d.checklist.responsable.length === 2 && d.checklist.aval.length === 2);

  console.log("\n— 2. CAPTURA COMPLETA: la clienta nace EN CAPTURA, con número único y sin tocar el padrón —");
  const c1 = captura(RUN);
  r = await post("/api/expediente/captura", c1, cEje);
  d = await j(r);
  ok("la ejecutiva captura y el servidor acepta", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 300));
  const socio = d.socio;
  ok("el sistema asignó el número de clienta (no venía)", d.socioGenerado === true && /^\d{5,15}$/.test(socio), socio);
  ok("estado 'captura' — dar de alta NO es autorizar", d.expediente.estado === "captura");
  ok("hereda ejecutiva y centro de quien captura", d.expediente.ejecutivo === "Prueba" && d.expediente.centro === "C-0");
  ok("PEP quedó estructurado (No)", d.expediente.pld.pep.es === false && d.expediente.pld.origenRecursos === "Ingresos del negocio");
  ok("6 documentos fotografiados (metadatos), con vigencia de INE y emisión del comprobante", Object.keys(d.expediente.documentos).length === 6
    && d.expediente.documentos["solicitante:ine"].fechaVencimiento === "2029-12-31" && d.expediente.documentos["solicitante:comprobante_domicilio"].fechaEmision === "2026-08-15");
  ok("la Firma 1 quedó sellada con fecha/hora, GPS y dispositivo", d.expediente.firma1.aceptada === true && d.expediente.firma1.gps && d.expediente.firma1.dispositivo);
  const enPadron = await j(await get("/api/padron", cDir));
  ok("NO se escribió al padrón de cobranza", !JSON.stringify(enPadron).includes(socio));

  console.log("\n— 3. REINTENTO SIN SEÑAL: el mismo folio NUNCA duplica —");
  r = await post("/api/expediente/captura", c1, cEje);
  d = await j(r);
  ok("re-mandar la misma captura regresa el mismo socio, marcada como repetida", r.status === 200 && d.repetida === true && d.socio === socio);
  r = await get("/api/expedientes", cEje);
  d = await j(r);
  ok("la lista trae UNA sola vez a la clienta", d.expedientes.filter((e) => e.socio === socio).length === 1);

  console.log("\n— 4. CANDADOS DE CAMPOS OBLIGATORIOS Y CATÁLOGOS —");
  let c = captura(RUN + "1"); delete c.datos.curp;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("sin CURP: 400 y lista de errores", r.status === 400 && d.errores.some((e) => /curp/i.test(e)), JSON.stringify(d).slice(0, 200));
  c = captura(RUN + "2"); c.datos.curp = "MAL";
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("CURP inválido: 400", r.status === 400 && d.errores.some((e) => /CURP inválido/.test(e)));
  c = captura(RUN + "3"); c.pld.pep = { es: true, tipo: "Nacional" };
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("PEP=Sí sin parentesco de catálogo: 400", r.status === 400 && d.errores.some((e) => /parentesco/.test(e)));
  c = captura(RUN + "4"); c.pld.pep = { es: true, tipo: "Nacional", parentesco: "Hijo(a)", cargo: "Regidor" };
  c.datos.actividadEconomica = "Vender cosas";
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("actividad económica fuera del catálogo PLD: 400 (nunca texto libre)", r.status === 400 && d.errores.some((e) => /Actividad económica/.test(e)));
  c = captura(RUN + "5"); c.referencias[1].consentimiento = false;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("referencia sin consentimiento propio: 400 (es un tercero)", r.status === 400 && d.errores.some((e) => /Referencia 2.*consentimiento/.test(e)));
  c = captura(RUN + "6"); c.firma1 = null;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("sin Firma 1: 400", r.status === 400 && d.errores.some((e) => /Firma 1/.test(e)));
  c = captura(RUN + "7"); c.tipoCredito = "grupal"; c.responsable = null;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("crédito grupal sin responsable: 400", r.status === 400 && d.errores.some((e) => /Responsable/.test(e)));
  c = captura(RUN + "8"); c.tipoCredito = "individual"; c.responsable = null; c.importeSolicitado = 12000; c.aval = null;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("crédito > $10,000 sin aval: 400", r.status === 400 && d.errores.some((e) => /Aval/.test(e)));
  c = captura(RUN + "9"); delete c.folioCaptura;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("sin folioCaptura: 400 (la app siempre lo manda para poder reintentar)", r.status === 400 && /folioCaptura/.test(d.error));

  console.log("\n— 5. UNICIDAD DE CURP/RFC (hallazgo CU-009 §10.5) —");
  c = captura(RUN + "10"); c.datos.curp = c1.datos.curp;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("otra clienta con el MISMO CURP: 400", r.status === 400 && d.errores.some((e) => /mismo CURP|ese CURP/i.test(e)), JSON.stringify(d).slice(0, 200));
  c = captura(RUN + "11"); c.datos.rfc = c1.datos.rfc;
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("otra clienta con el MISMO RFC: 400", r.status === 400 && d.errores.some((e) => /RFC/.test(e)));
  c = captura(RUN + "12"); c.socio = "11113028250";   // clienta real del padrón de cobranza
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("un número de socio que ya está en el padrón de cobranza: 400 (no es alta nueva)", r.status === 400 && /ya existe/.test(d.error), JSON.stringify(d).slice(0, 160));

  console.log("\n— 6. TOPES: responsable respalda máximo 2, aval máximo 1 —");
  // La misma responsable de c1 respalda a una segunda clienta (2/2)…
  c = captura(RUN + "20"); c.responsable = clon(c1.responsable);
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("la responsable puede respaldar a una segunda clienta", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 200));
  // …pero no a una tercera.
  c = captura(RUN + "21"); c.responsable = clon(c1.responsable);
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("a la tercera se rechaza: tope de 2", r.status === 400 && d.errores.some((e) => /tope es 2/.test(e)), JSON.stringify(d).slice(0, 200));
  const avalX = { nombre: "Aval " + RUN, curp: "AEAL900101HOCXXX0" + String(Number(RUN) % 10), telefono: "9518888888", domicilio: "Calle 3", ocupacion: "Empleado", identificacion: "INE 777", consentimiento: true };
  c = captura(RUN + "22"); c.tipoCredito = "individual"; c.responsable = null; c.importeSolicitado = 15000; c.aval = clon(avalX);
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("el aval avala a su primera clienta", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 200));
  c = captura(RUN + "23"); c.tipoCredito = "individual"; c.responsable = null; c.importeSolicitado = 15000; c.aval = clon(avalX);
  r = await post("/api/expediente/captura", c, cEje); d = await j(r);
  ok("a la segunda se rechaza: tope de 1", r.status === 400 && d.errores.some((e) => /tope es 1/.test(e)));

  console.log("\n— 7. VISIBILIDAD: burbuja y ejecutiva dueña —");
  r = await get("/api/expediente/" + socio, cEje); ok("la ejecutiva que capturó lo ve", r.status === 200);
  r = await get("/api/expediente/" + socio, cDir); ok("la dirección de su burbuja lo ve", r.status === 200);
  r = await get("/api/expediente/" + socio, cKarina); ok("otra ejecutiva (burbuja real) NO lo ve (404)", r.status === 404);
  r = await get("/api/expediente/" + socio, { Cookie: "" }); ok("sin sesión: 401", r.status === 401);
  r = await post("/api/expediente/captura", captura(RUN + "30"), cDir);
  ok("la captura de campo es de la EJECUTIVA: dirección NO captura (403)", r.status === 403);

  console.log("\n— 8. DOCUMENTO SUELTO DESPUÉS (paso 5 tardío) —");
  r = await post("/api/expediente/" + socio + "/documento", { propietario: "aval", tipo: "ine", fechaVencimiento: "2030-01-01", ubicacionFisica: "Archivero 2, folio 15" }, cEje);
  d = await j(r);
  ok("se registra el documento con ubicación física del papel", r.status === 200 && d.documento.ubicacionFisica === "Archivero 2, folio 15" && d.expediente.documentos["aval:ine"]);
  r = await post("/api/expediente/" + socio + "/documento", { propietario: "primo", tipo: "ine" }, cEje);
  ok("propietario fuera del catálogo: 400", r.status === 400);
  r = await post("/api/expediente/" + socio + "/documento", { propietario: "solicitante", tipo: "ine", fechaVencimiento: "31/12/2030" }, cEje);
  ok("fecha mal formada: 400", r.status === 400);

  console.log("\n— 9. RASTRO EN DISCO —");
  const dir = process.env.DATA_DIR_PRUEBA || null;
  if (dir) {
    const fs = require("fs"), path = require("path");
    const ev = JSON.parse(fs.readFileSync(path.join(dir, "registro_expediente.json"), "utf8")).filter((e) => e.socio === socio);
    ok("registro_expediente.json: 1 captura + 7 documentos de la clienta, con quién/cuándo/desde dónde", ev.filter((e) => e.evento === "captura").length === 1 && ev.filter((e) => e.evento === "documento").length === 7
      && ev[0].capturadoPorId === "prueba" && ev[0].gps && ev[0].dispositivo, JSON.stringify(ev.map((e) => e.evento)));
  } else console.log("  (DATA_DIR_PRUEBA no definido: se omite la verificación en disco)");

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
