// CU-019 (parcial) · CONTADOR DE CICLOS LIMPIOS (R5.2 Anexo E/F, TASA-01) — pruebas.
// Servidor local (3899) con DATA_DIR desechable, nunca contra data/ real: se dan
// de alta créditos, se sincronizan pagos como la app real (snapshot en TEXTO,
// ver CLAUDE.md) y se renuevan.
//
//   D=/tmp/fooax-prueba-ciclos; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/ciclos_limpios.js
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
  if (!cAnel || !cKarina) { console.log("No pude entrar con las cuentas locales."); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  // Karina paga como la app real: un snapshot por día, en TEXTO. Cada corrida
  // usa su propio centro para no chocar con capturas de otras pruebas.
  const CENTRO = "C-CL" + RUN;
  // OJO: el servidor guarda UN snapshot por ejecutiva y fecha (upsert), así
  // que cada envío debe traer TODO lo capturado ese día — se acumula aquí.
  const capturas = {};   // fecha → { "socio|producto": pago acumulado }
  const pagar = async (socio, producto, fecha, monto) => {
    const dia = capturas[fecha] || (capturas[fecha] = {});
    dia[socio + "|" + producto] = (dia[socio + "|" + producto] || 0) + monto;
    const reg = {}; reg[CENTRO] = {};
    for (const k in dia) reg[CENTRO][k] = { pago: dia[k], forma: "E" };
    const snap = { fecha, reg, regI: {}, movs: [], arqueo: {} };
    const r = await post("/api/sync", { fecha, snapshot: JSON.stringify(snap), ts: Date.now() }, cKarina);
    const d = await j(r);
    if (!d.ok) console.log("   (sync " + fecha + " → " + JSON.stringify(d).slice(0, 120) + ")");
    return d;
  };
  const alta = (socio, producto, importe, cuota, plazo, desembolso) => post("/api/clientes/alta", { id: socio, nombre: "Prueba Ciclos " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto, importe, saldo: importe, cuota, plazo, desembolso, diaPago: "MARTES" }, cAnel);
  const renovar = (socio, producto, importe, cuota, plazo, desembolso) => post("/api/creditos/recredito", { id: socio, producto, importe, saldo: importe, cuota, plazo, desembolso, diaPago: "MARTES", ejecutivo: "Karina" }, cAnel);
  const estado = async (socio) => j(await get("/api/ciclos-limpios/" + socio, cAnel));

  console.log("\n— 1. CANDADOS —");
  let r = await get("/api/ciclos-limpios/00000000001", cAnel);
  ok("clienta inexistente: 404", r.status === 404);
  r = await get("/api/ciclos-limpios/11113028250", cKarina);
  ok("una ejecutiva no consulta el contador (403)", r.status === 403);

  // ---------------------------------------------------------------
  console.log("\n— 2. CICLO LIMPIO EXACTO: 4 amortizaciones, todas en su fecha → +1 —");
  const A = "6" + RUN.padStart(10, "0"), pA = "Prueba Ciclos A " + RUN;
  r = await alta(A, pA, 4000, 1000, 4, "2026-08-09");   // domingo → pagos martes 11, 18, 25 ago y 1 sep
  let d = await j(r);
  ok("el alta procede y trae la marca ciclosLimpios en cero", r.status === 200 && d.ciclosLimpios && d.ciclosLimpios.contador === 0 && d.ciclosLimpios.aplicaTasaPreferencial === false, JSON.stringify(d.ciclosLimpios));
  const plan = (d.clienta.planPagos || []).map((p) => p.fecha_programada);
  ok("el plan de pagos nació con 4 fechas (martes)", plan.length === 4 && plan[0] === "2026-08-11" && plan[3] === "2026-09-01", JSON.stringify(plan));
  for (const f of plan) await pagar(A, pA, f, 1000);
  let e = await estado(A);
  ok("al quedar en cero, el contador sube a 1", e.contador === 1, JSON.stringify(e.ultimoEvento));
  ok("la fila dice 'suma', evaluación EXACTA por amortización, con motivo legible", e.ultimoEvento && e.ultimoEvento.evento === "suma" && e.ultimoEvento.evaluacion === "exacta" && /4 amortizaciones/.test(e.ultimoEvento.motivo), JSON.stringify(e.ultimoEvento));
  ok("todavía no aplica tasa preferencial (umbral 3, TASA-01); faltan 2", e.aplicaTasaPreferencial === false && e.umbralCiclos === 3 && e.faltanParaTasaPreferencial === 2);
  ok("no se propone ninguna tasa (parcial: monto de la baja pendiente de Chamuel)", e.tasaPreferencial === null && e.pendientes.some((p) => /Chamuel/.test(p.responsable)));
  const e2 = await estado(A);
  ok("consultar otra vez NO vuelve a sumar (idempotente)", e2.contador === 1 && e2.historial.length === 1 && e2.filasNuevas === 0);

  console.log("\n— 3. RENOVAR: el ciclo ya contado no se cuenta dos veces; el nuevo nace marcado —");
  r = await renovar(A, pA, 4000, 1000, 4, "2026-09-06");
  d = await j(r);
  ok("el recrédito procede", r.status === 200 && d.ok, JSON.stringify(d).slice(0, 200));
  ok("la respuesta y el crédito nuevo traen contador 1 (sin doble conteo)", d.ciclosLimpios && d.ciclosLimpios.contador === 1 && d.clienta.ciclosLimpios.contador === 1, JSON.stringify(d.ciclosLimpios));
  e = await estado(A);
  ok("sigue en 1 con una sola fila", e.contador === 1 && e.historial.length === 1);

  console.log("\n— 4. HARD RESET: mora viva en el crédito activo → 0 de inmediato (R5.2) —");
  r = await post("/api/creditos/mora", { id: A, producto: pA, mora: 250, motivo: "Prueba: se atrasó esta semana" }, cAnel);
  d = await j(r);
  ok("Dirección marca mora en el crédito activo", r.status === 200 && d.ok !== false, JSON.stringify(d).slice(0, 160));
  e = await estado(A);
  ok("el contador cae a 0 sin esperar a que el crédito se liquide", e.contador === 0, JSON.stringify(e.ultimoEvento));
  ok("la fila dice 'reinicio' con el motivo de la mora viva", e.ultimoEvento.evento === "reinicio" && /Mora viva/.test(e.ultimoEvento.motivo) && e.ultimoEvento.contadorAntes === 1);
  const e3 = await estado(A);
  ok("no se escribe un segundo reinicio mientras siga en 0", e3.historial.length === 2);

  // ---------------------------------------------------------------
  console.log("\n— 5. TRES CICLOS LIMPIOS SEGUIDOS → aplica tasa preferencial (TASA-01) —");
  // El ciclo nuevo solo cuenta pagos hechos DESDE su alta (alta_fecha = hoy,
  // regla del recrédito). Para encadenar tres ciclos en una sola corrida cada
  // uno se desembolsa "ayer", vence HOY (día de pago = hoy) y se paga HOY.
  const me = await j(await get("/api/me", cKarina));
  const HOY = me.hoy;
  const ayer = (() => { const d = new Date(HOY + "T12:00:00"); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  const DIAS = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
  const diaHoy = DIAS[new Date(HOY + "T12:00:00").getDay()];
  if (diaHoy === "DOMINGO") console.log("   (hoy es domingo: la app no cobra en domingo; esta sección puede no aplicar)");
  const B = "5" + RUN.padStart(10, "0"), pB = "Prueba Ciclos B " + RUN;
  const altaHoy = (socio, producto) => post("/api/clientes/alta", { id: socio, nombre: "Prueba Ciclos " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto, importe: 2000, saldo: 2000, cuota: 2000, plazo: 1, desembolso: ayer, diaPago: diaHoy }, cAnel);
  const renovarHoy = (socio, producto) => post("/api/creditos/recredito", { id: socio, producto, importe: 2000, saldo: 2000, cuota: 2000, plazo: 1, desembolso: ayer, diaPago: diaHoy, ejecutivo: "Karina" }, cAnel);
  r = await altaHoy(B, pB); d = await j(r);
  ok("ciclo 1 nace (vence hoy)", r.status === 200 && d.ok && d.clienta.planPagos[0].fecha_programada === HOY, JSON.stringify(d).slice(0, 160));
  await pagar(B, pB, HOY, 2000);
  r = await renovarHoy(B, pB); d = await j(r);
  ok("ciclo 2 nace con contador 1", r.status === 200 && d.ciclosLimpios && d.ciclosLimpios.contador === 1, JSON.stringify(d.ciclosLimpios || d).slice(0, 200));
  await pagar(B, pB, HOY, 2000);
  r = await renovarHoy(B, pB); d = await j(r);
  ok("ciclo 3 nace con contador 2", r.status === 200 && d.ciclosLimpios && d.ciclosLimpios.contador === 2, JSON.stringify(d.ciclosLimpios || d).slice(0, 200));
  await pagar(B, pB, HOY, 2000);
  e = await estado(B);
  ok("tres ciclos limpios: contador 3", e.contador === 3, JSON.stringify(e.historial.map((f) => f.evento + ":" + f.contadorDespues)));
  ok("APLICA tasa preferencial (>= 3, TASA-01) — pero sin tasa propuesta", e.aplicaTasaPreferencial === true && e.faltanParaTasaPreferencial === 0 && e.tasaPreferencial === null);
  r = await renovarHoy(B, pB); d = await j(r);
  ok("el 4º ciclo nace con la marca aplicaTasaPreferencial=true en el crédito", d.clienta && d.clienta.ciclosLimpios && d.clienta.ciclosLimpios.aplicaTasaPreferencial === true, JSON.stringify(d.ciclosLimpios));

  // ---------------------------------------------------------------
  console.log("\n— 6. UN SOLO PAGO TARDE → el ciclo NO es limpio aunque termine liquidado —");
  const C = "4" + RUN.padStart(10, "0"), pC = "Prueba Ciclos C " + RUN;
  r = await alta(C, pC, 2000, 1000, 2, "2026-08-09"); d = await j(r);   // vence 11 y 18 de agosto
  ok("ciclo nace", r.status === 200 && d.ok);
  await pagar(C, pC, "2026-08-18", 2000);   // nada el 11; todo el 18
  e = await estado(C);
  ok("liquidó, pero la amortización 1 se cubrió tarde → contador 0, evento 'reinicio'", e.contador === 0 && e.ultimoEvento && e.ultimoEvento.evento === "reinicio" && /Amortización 1/.test(e.ultimoEvento.motivo), JSON.stringify(e.ultimoEvento));
  ok("la fila conserva el veredicto (limpio:false, exacta)", e.ultimoEvento.limpio === false && e.ultimoEvento.evaluacion === "exacta");

  console.log("\n— 7. EL RASTRO EN DISCO (append-only) —");
  const dir = process.env.DATA_DIR_PRUEBA || null;
  if (dir) {
    const fs = require("fs"), path = require("path");
    const filas = JSON.parse(fs.readFileSync(path.join(dir, "registro_ciclos_limpios.json"), "utf8"));
    ok("registro_ciclos_limpios.json trae las filas de A (2), B (3) y C (1)",
      filas.filter((f) => f.socio === A).length === 2 && filas.filter((f) => f.socio === B).length === 3 && filas.filter((f) => f.socio === C).length === 1,
      JSON.stringify(filas.map((f) => f.socio.slice(0, 1) + ":" + f.evento)));
  } else console.log("  (DATA_DIR_PRUEBA no definido: se omite la verificación en disco)");

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
