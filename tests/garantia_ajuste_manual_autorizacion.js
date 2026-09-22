// BOTÓN "AJUSTE MANUAL" DE GARANTÍA, CON AUTORIZACIÓN (CU-006, RESUELTO
// 21-sep-2026): audio de Karina confirma quién autoriza — Lic. Alejandra
// (Ing. Alejandra González Arango) o Lic. Monse, cualquiera de las dos; y
// Carlos confirma por escrito el mismo día que aplica IGUAL a Garantía
// Líquida y Garantía A. Ver dominios/garantia_liquida.js#registrarAjusteManualGarantia.
//
//   D=/tmp/fooax-prueba-ajuste; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   sleep 2
//   node tests/garantia_ajuste_manual_autorizacion.js
"use strict";

const U = "http://localhost:3899";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

// hoyMX() puede caer un día antes/después que new Date() en UTC — usar
// SIEMPRE lo que regresa el servidor. /api/login NO trae `hoy`; GET /api/me sí.
async function login(u, p) {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: p }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  if (!cookie) return { cookie: null, hoy: null };
  const me = await j(await fetch(U + "/api/me", { headers: { Cookie: cookie } }));
  return { cookie, hoy: me.hoy };
}
const H = (c) => ({ "Content-Type": "application/json", Cookie: c });

(async () => {
  const { cookie: ca, hoy } = await login("anel", "anel2026");
  const { cookie: cAlejandra } = await login("alejandra", "alejandra2026");
  const { cookie: cMonse } = await login("monse", "monse2026");
  const { cookie: cKarina } = await login("karina", "karina2026");
  ok("anel (Dirección) entra ok", !!ca);
  ok("alejandra entra ok", !!cAlejandra);
  ok("monse entra ok", !!cMonse);
  ok("karina (ejecutivo) entra ok", !!cKarina);

  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const producto = "Magnus Ajuste Manual " + RUN;
  const centro = "C-0";
  const socio = "5" + RUN.padStart(10, "0");

  console.log("\n— 0. Clienta de prueba con crédito activo —");
  const rAlta = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socio, nombre: "Prueba Ajuste Manual " + RUN, centro, ejecutivo: "Karina", producto,
      saldo: 5800, cuota: 725, plazo: 8, importe: 5000, desembolso: hoy, diaPago: "MARTES",
    }),
  }));
  ok("alta ok", rAlta.ok === true, JSON.stringify(rAlta));

  const cuerpoAjusteEntrada = {
    socio, producto, tipoGarantia: "Garantía Líquida", direccion: "entrada",
    monto: 250, motivo: "Corrección: se capturó de menos por error de tecleo (prueba).",
  };

  console.log("\n— 1. anel (Dirección) NO puede autorizar — solo Alejandra o Monse —");
  const rAnel = await j(await fetch(U + "/api/garantias/ajuste-manual", { method: "POST", headers: H(ca), body: JSON.stringify(cuerpoAjusteEntrada) }));
  ok("anel se rechaza (403 lógico, error explícito)", !!rAnel.error, JSON.stringify(rAnel));
  ok("el error menciona a Alejandra o Monse", /Alejandra|Monse/i.test(rAnel.error || ""), rAnel.error);

  console.log("\n— 2. karina (ejecutivo) ni siquiera pasa el candado de rol —");
  const rKarina = await fetch(U + "/api/garantias/ajuste-manual", { method: "POST", headers: H(cKarina), body: JSON.stringify(cuerpoAjusteEntrada) });
  ok("karina (ejecutivo) recibe 403 del candado de rol", rKarina.status === 403, String(rKarina.status));

  console.log("\n— 3. Monse SÍ puede autorizar una ENTRADA de ajuste (Garantía Líquida) —");
  const rMonse = await j(await fetch(U + "/api/garantias/ajuste-manual", { method: "POST", headers: H(cMonse), body: JSON.stringify(cuerpoAjusteEntrada) }));
  ok("Monse autoriza la entrada ok", rMonse.ok === true, JSON.stringify(rMonse));
  ok("el movimiento queda marcado ajusteManual:true", rMonse.movimiento && rMonse.movimiento.ajusteManual === true, JSON.stringify(rMonse.movimiento));
  ok("el movimiento trae autorizadoPor = Monserrat", rMonse.movimiento && /monserrat/i.test(rMonse.movimiento.autorizadoPor || ""), JSON.stringify(rMonse.movimiento));

  console.log("\n— 4. Sin motivo (o motivo muy corto) se rechaza —");
  const rSinMotivo = await j(await fetch(U + "/api/garantias/ajuste-manual", {
    method: "POST", headers: H(cAlejandra), body: JSON.stringify({ ...cuerpoAjusteEntrada, monto: 50, motivo: "x" }),
  }));
  ok("motivo muy corto se rechaza", !!rSinMotivo.error, JSON.stringify(rSinMotivo));

  console.log("\n— 5. Alejandra SÍ puede autorizar una entrada de Garantía A también (aplica a ambos tipos) —");
  const rAlejandraA = await j(await fetch(U + "/api/garantias/ajuste-manual", {
    method: "POST", headers: H(cAlejandra), body: JSON.stringify({
      socio, producto, tipoGarantia: "Garantía A", direccion: "entrada", monto: 80,
      motivo: "Corrección: aportación de Garantía A capturada de menos (prueba).",
    }),
  }));
  ok("Alejandra autoriza entrada de Garantía A ok", rAlejandraA.ok === true, JSON.stringify(rAlejandraA));

  console.log("\n— 6. Una SALIDA de ajuste no puede exceder lo guardado —");
  const rSalidaExcesiva = await j(await fetch(U + "/api/garantias/ajuste-manual", {
    method: "POST", headers: H(cMonse), body: JSON.stringify({
      socio, producto, tipoGarantia: "Garantía Líquida", direccion: "salida", monto: 999999,
      motivo: "Prueba de tope: no debe dejar sacar más de lo guardado.",
    }),
  }));
  ok("salida excesiva se rechaza", !!rSalidaExcesiva.error, JSON.stringify(rSalidaExcesiva));

  console.log("\n— 7. Una SALIDA de ajuste dentro de lo guardado sí procede —");
  const rSalidaOk = await j(await fetch(U + "/api/garantias/ajuste-manual", {
    method: "POST", headers: H(cAlejandra), body: JSON.stringify({
      socio, producto, tipoGarantia: "Garantía Líquida", direccion: "salida", monto: 100,
      motivo: "Corrección: se había capturado de más por error (prueba).",
    }),
  }));
  ok("salida dentro de lo guardado procede", rSalidaOk.ok === true, JSON.stringify(rSalidaOk));

  console.log("\n— 8. Tipo de garantía inválido se rechaza (nunca se inventa un tercer tipo) —");
  const rTipoInvalido = await j(await fetch(U + "/api/garantias/ajuste-manual", {
    method: "POST", headers: H(cMonse), body: JSON.stringify({
      socio, producto, tipoGarantia: "Garantía Hipotecaria", direccion: "entrada", monto: 10,
      motivo: "No debería aceptar este tipo (prueba).",
    }),
  }));
  ok("tipo de garantía inválido se rechaza", !!rTipoInvalido.error, JSON.stringify(rTipoInvalido));

  console.log("\n— 9. El ajuste queda visible en la ficha de garantía (misma cifra que ya usa el resto del módulo) —");
  const ficha = await j(await fetch(U + "/api/garantias/ficha?id=" + socio + "&producto=" + encodeURIComponent(producto), { headers: H(ca) }));
  ok("saldoActual de Garantía Líquida refleja los ajustes (250 - 100 = +150 sobre lo que hubiera sin ajustes)",
    typeof ficha.saldoActual === "number" && ficha.saldoActual >= 150, JSON.stringify({ saldoActual: ficha.saldoActual }));
  ok("saldoActualGarantiaA refleja el ajuste de entrada (+80)",
    typeof ficha.saldoActualGarantiaA === "number" && ficha.saldoActualGarantiaA >= 80, JSON.stringify({ saldoActualGarantiaA: ficha.saldoActualGarantiaA }));

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
