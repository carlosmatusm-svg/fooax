// CU-018 · VISTA 360 DEL EXPEDIENTE (solo lectura) — pruebas.
// Corre igual que riesgo_bitacora.js: servidor local (3899) con DATA_DIR
// desechable (nunca contra data/ real). No recalcula nada: cada aserción
// compara contra lo que el propio dominio de origen (riesgo, PLD, ciclos,
// garantía, expediente) ya expone por su cuenta.
//
//   D=/tmp/fooax-prueba-v360; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/vista_360.js
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
  const cAnel = await login("anel", "anel2026");
  const cAlejandra = await login("alejandra", "alejandra2026");
  const cKarina = await login("karina", "karina2026");
  const cPrueba = await login("prueba", "PruebaFOOAX2026");
  const cPruebaDir = await login("pruebadir", "PruebaFOOAX2026");
  if (!cAnel || !cAlejandra || !cKarina) { console.log("No pude entrar con las cuentas locales."); process.exit(1); }

  // Una clienta real del padrón (la primera de Karina), leída del mismo
  // archivo que carga el servidor — mismo patrón que riesgo_bitacora.js.
  const fs = require("fs"), path = require("path");
  const pad = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR_PRUEBA || path.join(__dirname, "..", "data"), "padron.json"), "utf8"));
  const creditosDeKarina = pad.filter((c) => c.ejecutivo === "Karina" && c.activa !== false && c.estatus !== "BAJA");
  const socio = String(creditosDeKarina[0].id).split("|")[0];
  const esperado = pad.filter((c) => String(c.id).split("|")[0] === socio && c.activa !== false && c.estatus !== "BAJA");
  const saldoEsperado = Math.round(esperado.reduce((acc, c) => acc + Math.max(0, Number(c.saldo) || 0), 0) * 100) / 100;
  console.log("Clienta de prueba (ya en el padrón): socio " + socio + " (" + esperado.length + " crédito(s), saldo $" + saldoEsperado + ")");

  console.log("\n— 1. CLIENTA YA EN EL PADRÓN: CONSOLIDA SIN RECALCULAR NADA —");
  let r = await get("/api/vista360/" + socio, cAlejandra);
  let d = await j(r);
  ok("Administración y Finanzas consulta la vista", r.status === 200 && d.socio === socio, JSON.stringify(d).slice(0, 200));
  ok("exposición de crédito: mismos créditos activos y mismo saldo que el padrón", d.exposicionCredito.disponible === true && d.exposicionCredito.creditosActivos === esperado.length && d.exposicionCredito.saldoInsolutoTotal === saldoEsperado, JSON.stringify(d.exposicionCredito));
  ok("performance de pago: NO se inventa (sin fórmula confirmada, CU-018 §3)", d.performancePago.disponible === false && /días de mora/i.test(d.performancePago.motivo));
  ok("garantías: disponible y trae saldoActual (mismo dato que /api/garantias/ficha)", d.garantias.disponible === true && typeof d.garantias.saldoActual === "number");
  ok("ciclos limpios: disponible con contador (mismo dato que /api/ciclos-limpios)", d.ciclosLimpios.disponible === true && typeof d.ciclosLimpios.contador === "number");
  ok("riesgo: disponible, sin cambios todavía", d.riesgo.disponible === true && d.riesgo.nivelRiesgo == null);
  ok("PLD: disponible con acumulado numérico", d.pld.disponible === true && typeof d.pld.acumulado === "number");
  ok("expediente: NO disponible (esta clienta viene del Excel, sin expediente digital CU-009)", d.expediente.disponible === false && /CU-009\/CU-010/.test(d.expediente.motivo));
  ok("trae los 3 pendientes documentados, incluido Control Operativo", d.pendientes.length === 3 && d.pendientes.some((p) => /Control Operativo/.test(p.tema)));

  console.log("\n— 2. EL RIESGO CAMBIA DESDE SU PROPIO ENDPOINT Y LA VISTA LO REFLEJA —");
  r = await post("/api/riesgo/cambiar", { socio, campo: "nivelRiesgo", valor: "Alto", motivo: "Prueba vista 360: actividad atípica" }, cAnel);
  ok("se sube el riesgo desde /api/riesgo/cambiar", r.status === 200);
  r = await get("/api/vista360/" + socio, cAlejandra);
  d = await j(r);
  ok("la vista ahora refleja el riesgo Alto, sin recalcularlo ella misma", d.riesgo.disponible === true && d.riesgo.nivelRiesgo === "Alto");

  console.log("\n— 3. CLIENTA TODAVÍA SIN CRÉDITO: solo tiene expediente (CU-009), recién capturada en campo —");
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const captura = capturaValida(RUN);
  r = await post("/api/expediente/captura", captura, cKarina);
  d = await j(r);
  ok("se captura una clienta nueva en campo", r.status === 200 && d.ok === true, JSON.stringify(d).slice(0, 200));
  const socioNuevo = d.socio;

  r = await get("/api/vista360/" + socioNuevo, cAlejandra);
  d = await j(r);
  ok("la vista SÍ existe aunque todavía no tenga crédito en el padrón (CU-018 §2: solo exige expediente armado)", r.status === 200 && d.socio === socioNuevo, JSON.stringify(d).slice(0, 300));
  ok("expediente: disponible, semáforo completo (capturaValida trae el checklist completo)", d.expediente.disponible === true && d.expediente.semaforo === "completo");
  ok("exposición de crédito: cero créditos (no hay desembolso todavía) — no es un dato inventado, es la cuenta real", d.exposicionCredito.disponible === true && d.exposicionCredito.creditosActivos === 0 && d.exposicionCredito.saldoInsolutoTotal === 0);
  ok("garantías: NO disponible (sin crédito activo no hay garantía que consultar)", d.garantias.disponible === false);
  ok("ciclos limpios: NO disponible (sin crédito activo no hay ciclos que contar)", d.ciclosLimpios.disponible === false);
  ok("riesgo: NO disponible (nunca se le ha fijado un nivel — no está en el padrón de riesgo todavía)", d.riesgo.disponible === false);
  ok("PLD: SÍ disponible con acumulado 0 (0 créditos en ventana es un hecho, no un invento)", d.pld.disponible === true && d.pld.acumulado === 0);

  console.log("\n— 4. CANDADOS DE ACCESO —");
  r = await get("/api/vista360/" + socio, cKarina);
  ok("una ejecutiva (Control Operativo) NO consulta la vista (403 — CU-018 §1 queda pendiente)", r.status === 403);
  r = await get("/api/vista360/" + socio, cPruebaDir);
  ok("la burbuja de prueba no ve a una clienta real (404, misma burbuja que /api/riesgo)", r.status === 404);
  r = await get("/api/vista360/999999999999999", cAnel);
  ok("un socio que no existe en ningún lado (ni padrón ni expediente): 404", r.status === 404);
  r = await get("/api/vista360/", cAnel);
  ok("sin número de socio: 404 de Express (ruta no matchea) o 400", r.status === 404 || r.status === 400);

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
