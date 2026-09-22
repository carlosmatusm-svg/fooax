// DESGLOSE DE REPORTES DE GARANTÍAS POR TIPO Y MODALIDAD DE PAGO (CU-008,
// RESUELTO 21-sep-2026: Dirección, vía Excel "LUNES PRIMERA PARTE
// 2109.xlsx" — "tienen que ser por modalidad y tipo de garantía"). Ver
// dominios/garantia_liquida.js#reporteSemanalGarantias y
// #reporteSalidaGarantiasPorClienta.
//
//   D=/tmp/fooax-prueba-desglose; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   sleep 2
//   node tests/garantia_desglose_tipo_modalidad.js
const U = "http://localhost:3899";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

// hoyMX() (México) puede caer un día antes que new Date().toISOString() en
// UTC (o al revés según la hora) — usar SIEMPRE la fecha que regresa el
// propio servidor (login trae `hoy: hoyMX()`), nunca calcularla en el
// cliente (mismo gotcha documentado en CLAUDE.md).
async function login(u, p) {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: p }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const cuerpo = await j(r);
  return { cookie, hoy: cuerpo.hoy };
}
const H = (c) => ({ "Content-Type": "application/json", Cookie: c });

(async () => {
  const { cookie: ca, hoy } = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }

  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const socio = "6" + RUN.padStart(10, "0");
  const producto = "Magnus Desglose " + RUN;
  const centro = "C-0";

  console.log("\n— 0. Clienta de prueba con crédito activo —");
  const rAlta = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio, nombre: "Prueba Desglose " + RUN, centro, ejecutivo: "Karina", producto,
      saldo: 5800, cuota: 725, plazo: 8, importe: 5000, desembolso: hoy, diaPago: "MARTES",
    }),
  }));
  ok("alta ok", rAlta.ok === true, JSON.stringify(rAlta));

  console.log("\n— 1. Entradas: Garantía Líquida por transferencia, Garantía A por efectivo —");
  async function mov(tipo, monto, metodo) {
    return j(await fetch(U + "/api/movimiento", {
      method: "POST", headers: H(ca), body: JSON.stringify({
        tipo, concepto: tipo, monto, metodo, socio, producto, fecha: hoy,
      }),
    }));
  }
  const rEntradaLiq = await mov("Garantía líquida", 1000, "transferencia");
  ok("entrada Garantía líquida (transferencia) ok", !rEntradaLiq.error, JSON.stringify(rEntradaLiq));
  const rEntradaA = await mov("Garantía A", 300, "efectivo");
  ok("entrada Garantía A (efectivo) ok", !rEntradaA.error, JSON.stringify(rEntradaA));

  console.log("\n— 2. Salidas: Garantía líquida entregada por transferencia, Garantía A entregada por cheque —");
  const rSalidaLiq = await mov("Garantía líquida entregada", 400, "transferencia");
  ok("salida Garantía líquida entregada (transferencia) ok", !rSalidaLiq.error, JSON.stringify(rSalidaLiq));
  const rSalidaA = await mov("Garantía A entregada", 100, "cheque");
  ok("salida Garantía A entregada (cheque) ok", !rSalidaA.error, JSON.stringify(rSalidaA));

  console.log("\n— 3. GET /api/garantias/reporte-semanal trae porTipoGarantia —");
  const semanal = await j(await fetch(U + "/api/garantias/reporte-semanal", { headers: H(ca) }));
  ok("trae porTipoGarantia", Array.isArray(semanal.porTipoGarantia), JSON.stringify(semanal).slice(0, 200));
  const filaLiq = (semanal.porTipoGarantia || []).find((f) => f.tipo === "Garantía Líquida");
  const filaA = (semanal.porTipoGarantia || []).find((f) => f.tipo === "Garantía A");
  ok("Garantía Líquida: entradas >= 1000 y salidas >= 400 (suma con lo que ya hubiera esta semana)",
    filaLiq && filaLiq.entradas >= 1000 && filaLiq.salidas >= 400, JSON.stringify(filaLiq));
  ok("Garantía A: entradas >= 300 y salidas >= 100", filaA && filaA.entradas >= 300 && filaA.salidas >= 100, JSON.stringify(filaA));
  ok("porFormaPago sigue trayendo la modalidad de pago (no se rompió)",
    Array.isArray(semanal.porFormaPago) && semanal.porFormaPago.some((f) => f.forma === "transferencia"),
    JSON.stringify(semanal.porFormaPago));

  console.log("\n— 4. GET /api/garantias/reporte-salidas trae tipoGarantia + modalidad por fila y sus rollups —");
  const salidas = await j(await fetch(U + "/api/garantias/reporte-salidas", { headers: H(ca) }));
  const filaSalidaLiq = (salidas.salidas || []).find((s) => s.socio === socio && s.tipoGarantia === "Garantía Líquida");
  const filaSalidaA = (salidas.salidas || []).find((s) => s.socio === socio && s.tipoGarantia === "Garantía A");
  ok("la salida de Garantía Líquida trae modalidad = transferencia", filaSalidaLiq && filaSalidaLiq.modalidad === "transferencia", JSON.stringify(filaSalidaLiq));
  ok("la salida de Garantía A trae modalidad = cheque", filaSalidaA && filaSalidaA.modalidad === "cheque", JSON.stringify(filaSalidaA));
  ok("rollupPorTipoGarantia incluye Garantía Líquida y Garantía A",
    Array.isArray(salidas.rollupPorTipoGarantia)
      && salidas.rollupPorTipoGarantia.some((r) => r.tipo === "Garantía Líquida")
      && salidas.rollupPorTipoGarantia.some((r) => r.tipo === "Garantía A"),
    JSON.stringify(salidas.rollupPorTipoGarantia));
  ok("rollupPorModalidad incluye transferencia y cheque",
    Array.isArray(salidas.rollupPorModalidad)
      && salidas.rollupPorModalidad.some((r) => r.modalidad === "transferencia")
      && salidas.rollupPorModalidad.some((r) => r.modalidad === "cheque"),
    JSON.stringify(salidas.rollupPorModalidad));
  ok("rollupPorCentro sigue funcionando (no se rompió)",
    Array.isArray(salidas.rollupPorCentro) && salidas.rollupPorCentro.some((r) => r.centro === centro),
    JSON.stringify(salidas.rollupPorCentro));

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
