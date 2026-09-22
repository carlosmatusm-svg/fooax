// MOTIVO OBLIGATORIO + ALERTA EN EL HISTORIAL AL SACAR LA GARANTÍA ANTES DE
// TIEMPO (CU-006, RESUELTO 21-sep-2026, audio de Karina: "si se saca antes
// tiene que poner ese motivo, y también hay que poner una alerta en el
// historial de la clienta"). Ver
// dominios/garantia_liquida.js#validarSalidaAnticipadaGarantiaLiquida.
//
//   D=/tmp/fooax-prueba-motivo; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   sleep 2
//   node tests/garantia_motivo_salida_anticipada.js
"use strict";

const U = "http://localhost:3899";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

// hoyMX() puede diferir de new Date() en UTC — usar SIEMPRE lo que regresa
// el servidor. /api/login NO trae `hoy`; GET /api/me sí.
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
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }

  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const producto = "Magnus Motivo Salida " + RUN;
  const centro = "C-0";

  const SOCIO_VIGENTE = "4" + RUN.padStart(10, "0");    // crédito sigue activo — NO liberable
  const SOCIO_CERRADA = "6" + RUN.padStart(10, "0");    // crédito de baja, sin otro activo — SÍ liberable

  console.log("\n— 0. Dos clientas con garantía guardada: una vigente, otra dada de baja —");
  async function alta(socio, nombre) {
    return j(await fetch(U + "/api/clientes/alta", {
      method: "POST", headers: H(ca), body: JSON.stringify({
        id: socio, nombre, centro, ejecutivo: "Karina", producto,
        saldo: 5800, cuota: 725, plazo: 8, importe: 5000, desembolso: hoy, diaPago: "MARTES",
      }),
    }));
  }
  ok("alta vigente ok", (await alta(SOCIO_VIGENTE, "Prueba Motivo Vigente " + RUN)).ok === true);
  ok("alta cerrada ok", (await alta(SOCIO_CERRADA, "Prueba Motivo Cerrada " + RUN)).ok === true);

  async function mov(cookie, tipo, monto, socio, extra) {
    return j(await fetch(U + "/api/movimiento", {
      method: "POST", headers: H(cookie), body: JSON.stringify({
        tipo, concepto: tipo, monto, metodo: "transferencia", socio, producto, fecha: hoy, ...extra,
      }),
    }));
  }
  ok("entrada garantía (vigente) ok", !(await mov(ca, "Garantía líquida", 500, SOCIO_VIGENTE)).error);
  ok("entrada garantía (cerrada) ok", !(await mov(ca, "Garantía líquida", 500, SOCIO_CERRADA)).error);

  console.log("\n— 1. Dar de baja a la clienta 'cerrada' (para que su garantía sea liberable) —");
  const rBaja = await j(await fetch(U + "/api/clientes/baja", {
    method: "POST", headers: H(ca), body: JSON.stringify({ id: SOCIO_CERRADA, producto, motivo: "Otro" }),
  }));
  ok("baja ok", rBaja.ok === true, JSON.stringify(rBaja));

  console.log("\n— 2. Salida SIN motivo, crédito VIGENTE (no liberable) → se rechaza —");
  const rSinMotivoVigente = await mov(ca, "Garantía líquida entregada", 100, SOCIO_VIGENTE);
  ok("se rechaza por falta de motivo", !!rSinMotivoVigente.error, JSON.stringify(rSinMotivoVigente));
  ok("el error trae la elegibilidad (liberable:false)", rSinMotivoVigente.elegibilidad && rSinMotivoVigente.elegibilidad.liberable === false, JSON.stringify(rSinMotivoVigente.elegibilidad));

  console.log("\n— 3. Salida con motivo MUY CORTO, crédito VIGENTE → se rechaza —");
  const rMotivoCorto = await mov(ca, "Garantía líquida entregada", 100, SOCIO_VIGENTE, { motivoSalidaAnticipada: "x" });
  ok("se rechaza por motivo muy corto", !!rMotivoCorto.error, JSON.stringify(rMotivoCorto));

  console.log("\n— 4. Salida CON motivo, crédito VIGENTE → procede y queda marcada —");
  const rConMotivo = await mov(ca, "Garantía líquida entregada", 100, SOCIO_VIGENTE, {
    motivoSalidaAnticipada: "La clienta necesita el dinero por una emergencia médica (prueba).",
  });
  ok("procede con motivo", rConMotivo.ok === true, JSON.stringify(rConMotivo));
  ok("el movimiento queda marcado salidaAnticipada:true", rConMotivo.movimiento && rConMotivo.movimiento.salidaAnticipada === true, JSON.stringify(rConMotivo.movimiento));
  ok("el movimiento trae el motivo capturado", rConMotivo.movimiento && /emergencia médica/i.test(rConMotivo.movimiento.motivoSalidaAnticipada || ""), JSON.stringify(rConMotivo.movimiento));

  console.log("\n— 5. Salida SIN motivo, crédito CERRADO y liberable → NO hace falta motivo, procede normal —");
  const rCerradaOk = await mov(ca, "Garantía líquida entregada", 200, SOCIO_CERRADA);
  ok("procede sin motivo (sí es liberable)", rCerradaOk.ok === true, JSON.stringify(rCerradaOk));
  ok("el movimiento NO queda marcado como salida anticipada", rCerradaOk.movimiento && rCerradaOk.movimiento.salidaAnticipada === false, JSON.stringify(rCerradaOk.movimiento));

  console.log("\n— 6. El historial de la ficha muestra la alerta de la salida anticipada —");
  const ficha = await j(await fetch(U + "/api/garantias/ficha?id=" + SOCIO_VIGENTE + "&producto=" + encodeURIComponent(producto), { headers: H(ca) }));
  const filaAnticipada = (ficha.historial || []).find((f) => f.folio === rConMotivo.movimiento.folio);
  ok("la fila del historial trae salidaAnticipada:true", filaAnticipada && filaAnticipada.salidaAnticipada === true, JSON.stringify(filaAnticipada));
  ok("la fila del historial trae el motivo", filaAnticipada && /emergencia médica/i.test(filaAnticipada.motivoSalidaAnticipada || ""), JSON.stringify(filaAnticipada));

  const fichaCerrada = await j(await fetch(U + "/api/garantias/ficha?id=" + SOCIO_CERRADA + "&producto=" + encodeURIComponent(producto), { headers: H(ca) }));
  const filaNormal = (fichaCerrada.historial || []).find((f) => f.folio === rCerradaOk.movimiento.folio);
  ok("la salida normal (liberable) NO trae la alerta", filaNormal && filaNormal.salidaAnticipada === false, JSON.stringify(filaNormal));

  console.log("\n— 7. Nunca bloquea de más: sigue respetando el candado antiduplicado ya existente —");
  const rExcede = await mov(ca, "Garantía líquida entregada", 999999, SOCIO_VIGENTE, {
    motivoSalidaAnticipada: "Motivo válido pero el monto excede lo guardado (prueba).",
  });
  ok("el candado antiduplicado sigue vivo (rechaza por monto, no por motivo)", !!rExcede.error && /guardado/i.test(rExcede.error), rExcede.error);

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
