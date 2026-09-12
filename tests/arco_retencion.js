// CU-015 · DERECHOS ARCO Y RETENCIÓN PLD — pruebas.
// Servidor local (3899) con DATA_DIR desechable, nunca contra data/ real: la
// anonimización escribe al padrón de verdad.
//
//   D=/tmp/fooax-prueba-arco; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/arco_retencion.js
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

(async () => {
  const cAnel = await login("anel", "anel2026");
  const cMonse = await login("monse", "monse2026");
  const cKarina = await login("karina", "karina2026");
  const cPruebaDir = await login("pruebadir", "PruebaFOOAX2026");
  if (!cAnel || !cMonse || !cKarina) { console.log("No pude entrar con las cuentas locales."); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const X = "3" + RUN.padStart(10, "0"), NOMBRE = "PRUEBA ARCO " + RUN;
  const pA = "Prueba ARCO A " + RUN, pB = "Prueba ARCO B " + RUN;

  console.log("\n— 0. Preparar: una clienta con dos créditos y un pago —");
  let r = await post("/api/clientes/alta", { id: X, nombre: NOMBRE, centro: "C-0", ejecutivo: "Karina", producto: pA, importe: 4000, saldo: 4000, cuota: 1000, plazo: 4, desembolso: "2026-08-09", diaPago: "MARTES" }, cAnel);
  let d = await j(r); ok("crédito A", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 160));
  r = await post("/api/clientes/alta", { id: X, nombre: NOMBRE, centro: "C-0", ejecutivo: "Karina", producto: pB, importe: 3000, saldo: 3000, cuota: 1000, plazo: 3, desembolso: "2026-08-09", diaPago: "MARTES" }, cAnel);
  d = await j(r); ok("crédito B", r.status === 200 && d.ok);
  const snap = { fecha: "2026-08-11", reg: { ["C-AR" + RUN]: { [X + "|" + pA]: { pago: 1000, forma: "E" } } }, regI: {}, movs: [], arqueo: {} };
  d = await j(await post("/api/sync", { fecha: "2026-08-11", snapshot: JSON.stringify(snap), ts: Date.now() }, cKarina));
  ok("Karina le captura un pago de $1,000 el 11-ago", d.ok === true, JSON.stringify(d).slice(0, 120));

  console.log("\n— 1. ACCESO: exportar todo lo guardado de la persona —");
  r = await get("/api/arco/clienta/" + X + "/exportar?solicitante=La titular, con INE", cMonse);
  d = await j(r);
  ok("Administración (Monse) SÍ puede exportar", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 200));
  ok("trae los 2 créditos con nombre legible", d.datos.creditos.length === 2 && d.datos.creditos.every((c) => c.nombre === NOMBRE));
  ok("trae las altas de la bitácora del padrón", d.datos.cambiosPadron.filter((c) => c.tipo === "alta").length === 2);
  ok("trae el pago por día capturado en campo", Object.values(d.datos.pagosPorDia).some((m) => m["2026-08-11"] && m["2026-08-11"].p === 1000), JSON.stringify(d.datos.pagosPorDia));
  ok("la exportación queda registrada (quién atendió, quién solicitó)", d.historialSolicitudes.length === 1 && d.historialSolicitudes[0].tipo === "exportacion" && d.historialSolicitudes[0].atendioId === "monse" && /INE/.test(d.historialSolicitudes[0].solicitante));
  r = await get("/api/arco/clienta/" + X + "/exportar", cKarina);
  ok("una ejecutiva NO exporta (403)", r.status === 403);
  r = await get("/api/arco/clienta/00000000001/exportar", cAnel);
  ok("clienta inexistente: 404", r.status === 404);
  r = await get("/api/arco/aval/" + X + "/exportar", cAnel);
  d = await j(r);
  ok("entidad 'aval' todavía no existe en este repo: 400 y dice que llega con CU-009", r.status === 400 && /CU-009/.test(d.error), JSON.stringify(d));
  r = await get("/api/arco/clienta/" + X + "/exportar", cPruebaDir);
  ok("la dirección de PRUEBA no ve una clienta real (burbuja)", r.status === 404);

  console.log("\n— 2. CANCELACIÓN = ANONIMIZAR, con candados —");
  r = await post("/api/arco/clienta/" + X + "/anonimizar", { motivo: "Lo pide la titular" }, cMonse);
  d = await j(r);
  ok("Administración NO puede anonimizar (403), aunque sí exporte", r.status === 403 && /Direcci/.test(d.error), JSON.stringify(d));
  r = await post("/api/arco/clienta/" + X + "/anonimizar", {}, cAnel);
  d = await j(r);
  ok("sin motivo: 400", r.status === 400 && /motivo/i.test(d.error));
  r = await get("/api/arco/clienta/" + X, cAnel);
  d = await j(r);
  ok("el historial dice que Anel SÍ puede anonimizar y que aún no está anonimizada", d.puedesAnonimizar === true && d.anonimizada === false && d.nombre === NOMBRE);

  r = await post("/api/arco/clienta/" + X + "/anonimizar", { motivo: "Solicitud ARCO de la titular, identificada con INE el 11-sep-2026" }, cAnel);
  d = await j(r);
  ok("Dirección General anonimiza", r.status === 200 && d.ok && d.creditosAnonimizados === 2 && d.marcador === "[ANONIMIZADO]", JSON.stringify(d).slice(0, 200));
  r = await get("/api/arco/clienta/" + X + "/exportar", cAnel);
  d = await j(r);
  ok("el RENGLÓN sigue existiendo: los 2 créditos siguen ahí, con el marcador en vez del nombre",
    d.datos.creditos.length === 2 && d.datos.creditos.every((c) => c.nombre === "[ANONIMIZADO]" && c.anonimizada === true), JSON.stringify(d.datos.creditos.map((c) => c.nombre)));
  ok("los saldos NO se tocaron (integridad de cartera)", d.datos.creditos.every((c) => c.saldo === 4000 || c.saldo === 3000));
  ok("el nombre anterior NO se guarda en el crédito (eso anularía la anonimización)", d.datos.creditos.every((c) => !c.nombre_anterior));
  ok("la anonimización quedó en el historial con su motivo", d.historialSolicitudes.some((s) => s.tipo === "anonimizacion" && /INE/.test(s.motivo) && s.atendioId === "anel"));
  ok("y como evento tipo 'arco' en la bitácora general del padrón", d.datos.cambiosPadron.filter((c) => c.tipo === "arco").length >= 2);
  r = await post("/api/arco/clienta/" + X + "/anonimizar", { motivo: "Otra vez" }, cAnel);
  ok("anonimizar dos veces: 400 (ya está)", r.status === 400);
  // La cartera del tablero también la ve anonimizada.
  const cred = await j(await get("/api/creditos?q=" + X, cAnel));
  const enCartera = (cred.resultados || []).filter((c) => String(c.id) === X);
  ok("la cartera de Créditos y saldos la muestra como [ANONIMIZADO] y con su saldo vivo", enCartera.length === 2 && enCartera.every((c) => c.nombre === "[ANONIMIZADO]") && enCartera.some((c) => c.saldoActual === 3000), JSON.stringify(enCartera.map((c) => [c.nombre, c.saldoActual])));

  console.log("\n— 3. RETENCIÓN PLD: reporte de SOLO LECTURA —");
  r = await get("/api/retencion/pld", cMonse);
  d = await j(r);
  ok("Administración lee el reporte; plazo 10 años (parámetro)", r.status === 200 && d.soloLectura === true && d.retencionAnios === 10, JSON.stringify(d).slice(0, 160));
  ok("hoy (2026) ninguna clienta cumple 10 años sin actividad", Array.isArray(d.candidatas) && d.candidatas.length === 0, JSON.stringify(d.candidatas).slice(0, 200));
  ok("y dice explícitamente que no anonimiza nada por sí solo", /NO anonimiza/.test(d.nota));
  r = await get("/api/retencion/pld?hoy=2037-09-01", cAnel);
  d = await j(r);
  ok("simulando 2037 sí aparecen candidatas (clientas de baja de la plantilla), X no (tiene crédito vivo)", d.candidatas.length > 0 && !d.candidatas.some((c) => c.id === X), "candidatas " + d.candidatas.length);
  const cand = d.candidatas[0];
  ok("cada candidata dice desde cuándo cumple el plazo", cand && /^\d{4}-\d{2}-\d{2}$/.test(cand.cumpleDesde) && cand.cumpleDesde <= "2037-09-01");
  r = await get("/api/arco/clienta/" + cand.id, cAnel);
  d = await j(r);
  ok("y el reporte NO la anonimizó: su nombre sigue legible", r.status === 200 && d.anonimizada === false && d.nombre !== "[ANONIMIZADO]", JSON.stringify(d).slice(0, 120));

  console.log("\n— 4. RASTRO EN DISCO —");
  const dir = process.env.DATA_DIR_PRUEBA || null;
  if (dir) {
    const fs = require("fs"), path = require("path");
    const filas = JSON.parse(fs.readFileSync(path.join(dir, "registro_solicitudes_arco.json"), "utf8")).filter((f) => f.id === X);
    ok("registro_solicitudes_arco.json: 2 exportaciones (las que sí procedieron) + 1 anonimización de X", filas.filter((f) => f.tipo === "exportacion").length === 2 && filas.filter((f) => f.tipo === "anonimizacion").length === 1, JSON.stringify(filas.map((f) => f.tipo)));
    const cambios = JSON.parse(fs.readFileSync(path.join(dir, "padron_cambios.json"), "utf8")).filter((c) => String(c.id) === X);
    ok("padron_cambios.json conserva el alta ORIGINAL (rastro regulatorio) y los 2 ajustes de anonimización", cambios.filter((c) => c.tipo === "alta" && c.clienta.nombre === NOMBRE).length === 2 && cambios.filter((c) => c.tipo === "ajuste" && c.campos.anonimizada).length === 2);
  } else console.log("  (DATA_DIR_PRUEBA no definido: se omite la verificación en disco)");

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
