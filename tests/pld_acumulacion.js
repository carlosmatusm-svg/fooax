// CU-017 · ACUMULACIÓN PLD POR CLIENTA EN 6 MESES (R11.3 Anexo F, G.5-G.7 Anexo G, PLD-01/02) — pruebas.
// Servidor local (3899) con DATA_DIR desechable, nunca contra data/ real: el
// alta escribe al padrón y las alertas al registro pld_alertas.
//
//   D=/tmp/fooax-prueba-pld; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/pld_acumulacion.js
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
  const cKarina = await login("karina", "karina2026");
  if (!cAnel) { console.log("No pude entrar con las cuentas locales."); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const socio = "7" + RUN.padStart(10, "0");
  const UMBRAL = 1605 * 117.31;   // $188,282.55 (Anexo G)

  console.log("\n— 1. LA UMA VIVE EN UNA TABLA VERSIONADA, NO EN EL CÓDIGO —");
  let r = await get("/api/pld/uma", cAnel);
  let d = await j(r);
  ok("dirección lee la tabla de UMA", r.status === 200 && Array.isArray(d.valores));
  ok("UMA 2026 = 117.31 vigente desde 2026-02-01 (cruza con Anexo G: 1,605 UMA = $188,282.55)",
    d.vigenteHoy && d.vigenteHoy.diaria === 117.31 && d.vigenteHoy.vigenteDesde === "2026-02-01", JSON.stringify(d.vigenteHoy));
  ok("el umbral es 1,605 UMA (PLD-01)", d.umbralUMA === 1605);
  r = await get("/api/pld/uma", cKarina);
  ok("una ejecutiva no ve PLD (403)", r.status === 403);

  console.log("\n— 2. CONSULTA PREVIA: clienta nueva, sin créditos en ventana —");
  r = await get("/api/pld/acumulacion?id=" + socio + "&monto=100000&fecha=2026-09-01", cAnel);
  d = await j(r);
  ok("la consulta responde", r.status === 200, JSON.stringify(d));
  ok("sin créditos previos: acumulado = solo el monto nuevo", d.acumuladoPrevio === 0 && d.acumulado === 100000 && d.creditos.length === 0);
  ok("umbral en pesos = 1,605 × 117.31 = $188,282.55", Math.abs(d.umbralPesos - 188282.55) < 0.01, d.umbralPesos);
  ok("100,000 no supera; nunca bloquea", d.supera === false && d.bloquea === false);
  ok("ventana de 180 días hacia atrás desde la fecha de referencia", d.ventanaDias === 180 && d.ventanaDesde === "2026-03-05", d.ventanaDesde);
  r = await get("/api/pld/acumulacion?id=abc", cAnel);
  ok("socio inválido: 400", r.status === 400);

  console.log("\n— 3. PRIMER DESEMBOLSO: $100,000 → marca en falso, alta normal —");
  r = await post("/api/clientes/alta", { id: socio, nombre: "Prueba PLD " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto: "Prueba PLD A " + RUN, importe: 100000, saldo: 100000, cuota: 5000, plazo: 20, desembolso: "2026-09-01", diaPago: "MARTES" }, cAnel);
  d = await j(r);
  ok("el alta procede", r.status === 200 && d.ok, JSON.stringify(d));
  ok("la alerta viaja en la respuesta y NO está activa (100,000 < 188,282.55)", d.alertaPLD && d.alertaPLD.evaluada === true && d.alertaPLD.activa === false, JSON.stringify(d.alertaPLD));
  ok("el crédito guarda la marca `alertaPLD`", d.clienta.alertaPLD && d.clienta.alertaPLD.activa === false);

  console.log("\n— 4. SEGUNDO DESEMBOLSO EN LA VENTANA: $90,000 → 190,000 > 188,282.55 → MARCADA, NO BLOQUEADA —");
  r = await get("/api/pld/acumulacion?id=" + socio + "&monto=90000&fecha=2026-09-08", cAnel);
  d = await j(r);
  ok("la consulta previa ya avisa que superaría", d.acumuladoPrevio === 100000 && d.acumulado === 190000 && d.supera === true, JSON.stringify(d));
  ok("lista el crédito previo con su monto REAL (importe), no estimado", d.creditos.length === 1 && d.creditos[0].monto === 100000 && d.creditos[0].estimado === false);
  r = await post("/api/clientes/alta", { id: socio, nombre: "Prueba PLD " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto: "Prueba PLD B " + RUN, importe: 90000, saldo: 90000, cuota: 5000, plazo: 18, desembolso: "2026-09-08", diaPago: "MARTES" }, cAnel);
  d = await j(r);
  ok("el alta PROCEDE aunque supere (PLD-02: solo marca)", r.status === 200 && d.ok, JSON.stringify(d));
  ok("la alerta queda ACTIVA con el acumulado por clienta (todos sus créditos, PLD-01)",
    d.alertaPLD && d.alertaPLD.activa === true && d.alertaPLD.acumulado === 190000 && Math.abs(d.alertaPLD.umbralPesos - UMBRAL) < 0.01, JSON.stringify(d.alertaPLD));
  ok("la marca dice explícitamente que no bloquea", /no bloquea/i.test(d.alertaPLD.aviso || ""));

  console.log("\n— 5. LA ALERTA QUEDA EN EL REGISTRO INMUTABLE Y LA VE DIRECCIÓN —");
  r = await get("/api/pld/alertas", cAnel);
  d = await j(r);
  const mia = (d.alertas || []).filter((a) => a.socio === socio);
  ok("aparece exactamente UNA alerta para esta clienta (el primer desembolso no la generó)", mia.length === 1, JSON.stringify(mia));
  ok("la alerta trae socio, producto, desembolso, acumulado, umbral, UMA usada, usuario y fecha/hora",
    mia[0] && mia[0].producto.startsWith("Prueba PLD B") && mia[0].desembolso === "2026-09-08" && mia[0].acumulado === 190000
      && mia[0].uma === 117.31 && mia[0].usuarioId === "anel" && /^\d{4}-\d{2}-\d{2}T/.test(mia[0].fechaHora), JSON.stringify(mia[0]));
  ok("los pendientes (reporte G.7, UMA anual, montos de plantilla) viajan como datos", Array.isArray(d.pendientes) && d.pendientes.length === 3);

  console.log("\n— 6. FUERA DE LA VENTANA NO CUENTA —");
  r = await get("/api/pld/acumulacion?id=" + socio + "&monto=0&fecha=2027-03-15", cAnel);
  d = await j(r);
  ok("consultado 6+ meses después, los dos créditos ya no están en ventana", d.acumulado === 0 && d.creditos.length === 0, JSON.stringify(d));

  console.log("\n— 7. SIN UMA PARA LA FECHA: NO SE ADIVINA, SE NIEGA Y AVISA (CU-017 §5) —");
  r = await get("/api/pld/acumulacion?id=" + socio + "&monto=200000&fecha=2026-01-15", cAnel);
  d = await j(r);
  ok("enero-2026 no tiene UMA cargada: supera=null, faltaUMA=true, umbral null", d.faltaUMA === true && d.supera === null && d.umbralPesos === null, JSON.stringify(d));
  r = await post("/api/clientes/alta", { id: socio, nombre: "Prueba PLD " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto: "Prueba PLD C " + RUN, importe: 200000, saldo: 200000, cuota: 5000, plazo: 40, desembolso: "2026-01-15", diaPago: "MARTES" }, cAnel);
  d = await j(r);
  ok("el desembolso SIGUE procediendo (PLD-02) aunque no se pudo evaluar", r.status === 200 && d.ok, JSON.stringify(d));
  ok("la marca dice que NO se evaluó y por qué (falta UMA), no un falso 'sin alerta'", d.alertaPLD && d.alertaPLD.evaluada === false && d.alertaPLD.activa === null && /UMA/.test(d.alertaPLD.motivo), JSON.stringify(d.alertaPLD));
  r = await get("/api/pld/alertas", cAnel);
  d = await j(r);
  ok("queda constancia en `sinUMA` para que Sistemas cargue el valor", (d.sinUMA || []).some((a) => a.socio === socio && a.desembolso === "2026-01-15"));

  console.log("\n— 8. LA RENOVACIÓN TAMBIÉN SE VIGILA —");
  // Producto DISTINTO a propósito (mismo criterio que sincronizacion_desembolso.js
  // §4): el crédito A sigue con saldo y el recrédito del MISMO nombre exige
  // liquidarlo primero; lo que se prueba aquí es que la puerta del recrédito
  // también vigila la acumulación.
  r = await post("/api/creditos/recredito", { id: socio, producto: "Prueba PLD A " + RUN + " R", importe: 50000, saldo: 50000, cuota: 2500, plazo: 20,
    desembolso: "2026-09-10", diaPago: "MARTES", ejecutivo: "Karina" }, cAnel);
  d = await j(r);
  ok("el recrédito procede", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 300));
  ok("y trae su propia alerta (ciclo cerrado A + B + nuevo 50,000 siguen en ventana → activa)",
    d.alertaPLD && d.alertaPLD.evaluada === true && d.alertaPLD.activa === true && d.alertaPLD.acumulado === 240000, JSON.stringify(d.alertaPLD));

  console.log("\n— 9. EL RASTRO EN DISCO —");
  const dir = process.env.DATA_DIR_PRUEBA || null;
  if (dir) {
    const fs = require("fs"), path = require("path");
    const filas = JSON.parse(fs.readFileSync(path.join(dir, "registro_pld_alertas.json"), "utf8")).filter((f) => f.socio === socio);
    ok("registro_pld_alertas.json: 2 alertas + 1 sin_uma para esta clienta", filas.filter((f) => f.tipo === "alerta").length === 2 && filas.filter((f) => f.tipo === "sin_uma").length === 1, JSON.stringify(filas.map((f) => f.tipo)));
  } else console.log("  (DATA_DIR_PRUEBA no definido: se omite la verificación en disco)");

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
