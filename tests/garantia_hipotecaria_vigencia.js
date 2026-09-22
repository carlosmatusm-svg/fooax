// VIGENCIA DE LA GARANTÍA HIPOTECARIA (21-sep-2026, audio de Karina: "el
// sistema tiene que decir con tres días antes que ya está por expirar" +
// pedido explícito de Carlos: "avisar 3 días antes de vencer la vigencia
// del documento hipotecario"). Resuelve la ambigüedad que había quedado
// abierta en PENDIENTES_POR_CONFIRMAR.md (2 semanas de entrega de garantía
// líquida vs. vigencia del documento hipotecario): esto es sobre la
// VIGENCIA DEL DOCUMENTO.
//
// Mismo patrón que el resto de pruebas del módulo: servidor local con
// DATA_DIR desechable. NOTA: usa hoyMX() real (fechas relativas a HOY), no
// fechas fijas — la fecha de vencimiento se calcula a partir del día que
// corre la prueba, para no quedar obsoleta.
//
//   D=/tmp/fooax-prueba-hipo; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantia_hipotecaria_vigencia.js
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

function sumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + "T12:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const ca = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const hoy = new Date().toISOString().slice(0, 10);
  const desembolso = sumarDias(hoy, -30);
  const centro = "C-0";

  console.log("\n— 0. Tres clientas de prueba (lejos, por vencer, ya vencida) —");
  const socioLejos = "3" + RUN.padStart(10, "0");
  const socioPorVencer = "4" + RUN.padStart(10, "0");
  const socioVencida = "5" + RUN.padStart(10, "0");
  const socioSinCaptura = "6" + RUN.padStart(10, "0");
  const productoLejos = "Hipo Lejos " + RUN;
  const productoPorVencer = "Hipo Por Vencer " + RUN;
  const productoVencida = "Hipo Vencida " + RUN;
  const productoSinCaptura = "Hipo Sin Captura " + RUN;

  async function alta(id, nombre, producto) {
    return j(await fetch(U + "/api/clientes/alta", {
      method: "POST", headers: H(ca), body: JSON.stringify({
        id, nombre, centro, ejecutivo: "Karina", producto, saldo: 5800, cuota: 725,
        plazo: 8, importe: 5000, desembolso, diaPago: "MARTES",
      }),
    }));
  }
  ok("alta clienta 'lejos' ok", (await alta(socioLejos, "Prueba Hipo Lejos " + RUN, productoLejos)).ok === true);
  ok("alta clienta 'por vencer' ok", (await alta(socioPorVencer, "Prueba Hipo Por Vencer " + RUN, productoPorVencer)).ok === true);
  ok("alta clienta 'vencida' ok", (await alta(socioVencida, "Prueba Hipo Vencida " + RUN, productoVencida)).ok === true);
  ok("alta clienta 'sin captura' ok", (await alta(socioSinCaptura, "Prueba Hipo Sin Captura " + RUN, productoSinCaptura)).ok === true);

  console.log("\n— 1. Sin motivo, la captura se rechaza (queda rastro en bitácora) —");
  const rSinMotivo = await j(await fetch(U + "/api/creditos/garantia-hipotecaria", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioLejos, producto: productoLejos, fechaVencimiento: sumarDias(hoy, 90),
    }),
  }));
  ok("regresa error claro sin motivo", /motivo/i.test(rSinMotivo.error || ""), JSON.stringify(rSinMotivo));

  console.log("\n— 2. Capturar la fecha de vencimiento en cada clienta —");
  async function capturar(id, producto, fechaVencimiento) {
    return j(await fetch(U + "/api/creditos/garantia-hipotecaria", {
      method: "POST", headers: H(ca), body: JSON.stringify({
        id, producto, fechaVencimiento, motivo: "Captura de prueba " + RUN,
      }),
    }));
  }
  const rLejos = await capturar(socioLejos, productoLejos, sumarDias(hoy, 90));
  ok("captura 'lejos' responde ok", rLejos.ok === true, JSON.stringify(rLejos).slice(0, 200));
  const rPorVencer = await capturar(socioPorVencer, productoPorVencer, sumarDias(hoy, 2));
  ok("captura 'por vencer' responde ok", rPorVencer.ok === true, JSON.stringify(rPorVencer).slice(0, 200));
  const rVencida = await capturar(socioVencida, productoVencida, sumarDias(hoy, -1));
  ok("captura 'vencida' responde ok", rVencida.ok === true, JSON.stringify(rVencida).slice(0, 200));

  console.log("\n— 3. GET individual trae la alerta correcta para cada caso —");
  const gLejos = await j(await fetch(U + "/api/creditos/garantia-hipotecaria?id=" + socioLejos + "&producto=" + encodeURIComponent(productoLejos), { headers: H(ca) }));
  ok("'lejos' (90 días) NO está por vencer ni vencida", gLejos.alerta && gLejos.alerta.porVencer === false && gLejos.alerta.vencida === false, JSON.stringify(gLejos));

  const gPorVencer = await j(await fetch(U + "/api/creditos/garantia-hipotecaria?id=" + socioPorVencer + "&producto=" + encodeURIComponent(productoPorVencer), { headers: H(ca) }));
  ok("'por vencer' (2 días) SÍ dispara la alerta de 3 días", gPorVencer.alerta && gPorVencer.alerta.porVencer === true && gPorVencer.alerta.vencida === false, JSON.stringify(gPorVencer));

  const gVencida = await j(await fetch(U + "/api/creditos/garantia-hipotecaria?id=" + socioVencida + "&producto=" + encodeURIComponent(productoVencida), { headers: H(ca) }));
  ok("'vencida' (ayer) queda marcada vencida, no solo 'por vencer'", gVencida.alerta && gVencida.alerta.vencida === true, JSON.stringify(gVencida));

  const gSinCaptura = await j(await fetch(U + "/api/creditos/garantia-hipotecaria?id=" + socioSinCaptura + "&producto=" + encodeURIComponent(productoSinCaptura), { headers: H(ca) }));
  ok("sin fecha capturada, la alerta es null (no se adivina)", gSinCaptura.alerta === null, JSON.stringify(gSinCaptura));

  console.log("\n— 4. GET /api/garantias/hipotecaria/alertas solo lista a quien necesita aviso —");
  const alertas = await j(await fetch(U + "/api/garantias/hipotecaria/alertas", { headers: H(ca) }));
  ok("trae diasAlerta = 3 (default)", alertas.diasAlerta === 3, JSON.stringify(alertas.diasAlerta));
  const filaPorVencer = (alertas.alertas || []).find((a) => a.socio === socioPorVencer);
  ok("'por vencer' SÍ aparece en la lista de alertas", !!filaPorVencer, JSON.stringify(filaPorVencer));
  const filaVencida = (alertas.alertas || []).find((a) => a.socio === socioVencida);
  ok("'vencida' SÍ aparece en la lista de alertas", !!filaVencida, JSON.stringify(filaVencida));
  const filaLejos = (alertas.alertas || []).find((a) => a.socio === socioLejos);
  ok("'lejos' (90 días) NO aparece en la lista — no le toca todavía", !filaLejos, JSON.stringify(filaLejos));
  const filaSinCaptura = (alertas.alertas || []).find((a) => a.socio === socioSinCaptura);
  ok("'sin captura' NO aparece en la lista", !filaSinCaptura, JSON.stringify(filaSinCaptura));
  ok("la lista viene ordenada por días restantes (la vencida antes que la por vencer)",
    (alertas.alertas || []).indexOf(filaVencida) < (alertas.alertas || []).indexOf(filaPorVencer),
    JSON.stringify((alertas.alertas || []).map((a) => a.socio)));

  console.log("\n— 5. Fecha inválida se rechaza sin adivinar —");
  const rMalaFecha = await j(await fetch(U + "/api/creditos/garantia-hipotecaria", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioLejos, producto: productoLejos, fechaVencimiento: "no-es-fecha", motivo: "prueba",
    }),
  }));
  ok("regresa error claro con fecha inválida", /fecha/i.test(rMalaFecha.error || ""), JSON.stringify(rMalaFecha));

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
