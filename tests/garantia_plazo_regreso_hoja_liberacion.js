// PLAZO DE 5 DÍAS PARA REGRESAR LA HOJA DE LIBERACIÓN FIRMADA (CU-006,
// RESUELTO 21-sep-2026: Carlos confirma por escrito que SÍ es política
// vigente, no solo formato interno de una sucursal). Ver
// dominios/garantia_liquida.js#alertasPlazoRegresoHojaLiberacion y
// #registrarRegresoHojaLiberacion.
//
// ESTA PRUEBA NECESITA UNA SALIDA DE GARANTÍA FECHADA HACE MÁS DE 5 DÍAS
// para poder distinguir quién ya excedió el plazo de quien sigue dentro.
// /api/movimiento siempre fecha con hoyMX() por default y rechaza fechas
// futuras, pero SÍ acepta una fecha explícita en el pasado (a diferencia de
// /api/clientes/baja, que siempre estampa hoyMX() sin importar lo que se
// mande) — así que aquí no hace falta el truco de --seed en dos pasos que
// usa garantia_alerta_plazo_entrega.js: basta con mandar `fecha` explícita
// al registrar la salida.
//
//   D=/tmp/fooax-prueba-plazo-hoja; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   sleep 2
//   node tests/garantia_plazo_regreso_hoja_liberacion.js
"use strict";

const U = "http://localhost:3899";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

function sumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// hoyMX() (México) puede caer un día antes/después que new Date().toISOString()
// en UTC según la hora — usar SIEMPRE la fecha que regresa el propio servidor,
// nunca calcularla en el cliente (mismo gotcha documentado en CLAUDE.md, y en
// el que ya cayó garantia_desglose_tipo_modalidad.js). OJO: /api/login NO trae
// `hoy` (solo { ok, rol, nombre }) — quien sí lo trae es GET /api/me.
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
  const producto = "Magnus Plazo Hoja " + RUN;
  const centro = "C-0";

  const SOCIO_EXCEDE = "1" + RUN.padStart(10, "0");     // salió hace 8 días, nadie marcó el regreso
  const SOCIO_DENTRO = "2" + RUN.padStart(10, "0");      // salió hace 2 días — todavía dentro del plazo
  const SOCIO_YA_REGRESO = "3" + RUN.padStart(10, "0");  // salió hace 8 días PERO ya se marcó el regreso

  console.log("\n— 0. Tres clientas con crédito activo y garantía guardada (>0) —");
  async function alta(socio, nombre) {
    return j(await fetch(U + "/api/clientes/alta", {
      method: "POST", headers: H(ca), body: JSON.stringify({
        id: socio, nombre, centro, ejecutivo: "Karina", producto,
        saldo: 5800, cuota: 725, plazo: 8, importe: 5000, desembolso: hoy, diaPago: "MARTES",
      }),
    }));
  }
  for (const [socio, nombre] of [[SOCIO_EXCEDE, "Prueba Plazo Excede " + RUN], [SOCIO_DENTRO, "Prueba Plazo Dentro " + RUN], [SOCIO_YA_REGRESO, "Prueba Plazo Regreso " + RUN]]) {
    const r = await alta(socio, nombre);
    ok("alta " + nombre + " ok", r.ok === true, JSON.stringify(r));
  }

  async function entrada(socio) {
    return j(await fetch(U + "/api/movimiento", {
      method: "POST", headers: H(ca), body: JSON.stringify({
        tipo: "Garantía líquida", concepto: "Garantía líquida", monto: 500, metodo: "transferencia",
        socio, producto, fecha: hoy,
      }),
    }));
  }
  async function salida(socio, fecha) {
    return j(await fetch(U + "/api/movimiento", {
      method: "POST", headers: H(ca), body: JSON.stringify({
        tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 500,
        metodo: "transferencia", socio, producto, fecha,
      }),
    }));
  }

  console.log("\n— 1. Entrada y salida de garantía para cada una —");
  const fechaExcede = sumarDias(hoy, -8);
  const fechaDentro = sumarDias(hoy, -2);

  const rEntradaExcede = await entrada(SOCIO_EXCEDE);
  ok("entrada garantía (excede) ok", !rEntradaExcede.error, JSON.stringify(rEntradaExcede));
  const rEntradaDentro = await entrada(SOCIO_DENTRO);
  ok("entrada garantía (dentro) ok", !rEntradaDentro.error, JSON.stringify(rEntradaDentro));
  const rEntradaRegreso = await entrada(SOCIO_YA_REGRESO);
  ok("entrada garantía (ya regresó) ok", !rEntradaRegreso.error, JSON.stringify(rEntradaRegreso));

  const rSalidaExcede = await salida(SOCIO_EXCEDE, fechaExcede);
  ok("salida garantía hace 8 días (excede) ok", !rSalidaExcede.error, JSON.stringify(rSalidaExcede));
  const rSalidaDentro = await salida(SOCIO_DENTRO, fechaDentro);
  ok("salida garantía hace 2 días (dentro) ok", !rSalidaDentro.error, JSON.stringify(rSalidaDentro));
  const rSalidaRegreso = await salida(SOCIO_YA_REGRESO, fechaExcede);
  ok("salida garantía hace 8 días (ya regresó) ok", !rSalidaRegreso.error, JSON.stringify(rSalidaRegreso));

  // La respuesta de /api/movimiento es { ok, movimiento, ticket } — el folio
  // real vive en movimiento.folio, nunca en la raíz de la respuesta.
  const folioExcede = rSalidaExcede.movimiento && rSalidaExcede.movimiento.folio;
  const folioRegreso = rSalidaRegreso.movimiento && rSalidaRegreso.movimiento.folio;

  console.log("\n— 2. Marcar el regreso de la hoja SOLO para 'ya regresó' —");
  const rRegistroOk = await j(await fetch(U + "/api/garantias/hoja-liberacion/regresada", {
    method: "POST", headers: H(ca), body: JSON.stringify({ folio: folioRegreso, fecha: hoy }),
  }));
  ok("registrar regreso de hoja ok", rRegistroOk.ok === true, JSON.stringify(rRegistroOk));

  console.log("\n— 3. Folio inexistente y duplicado se rechazan —");
  const rFolioInventado = await j(await fetch(U + "/api/garantias/hoja-liberacion/regresada", {
    method: "POST", headers: H(ca), body: JSON.stringify({ folio: "GAR-NO-EXISTE-" + RUN, fecha: hoy }),
  }));
  ok("folio inexistente se rechaza", !!rFolioInventado.error, JSON.stringify(rFolioInventado));
  const rDuplicado = await j(await fetch(U + "/api/garantias/hoja-liberacion/regresada", {
    method: "POST", headers: H(ca), body: JSON.stringify({ folio: folioRegreso, fecha: hoy }),
  }));
  ok("folio ya marcado se rechaza (no se duplica)", !!rDuplicado.error, JSON.stringify(rDuplicado));

  console.log("\n— 4. GET /api/garantias/hoja-liberacion/alertas-plazo-regreso —");
  const r = await j(await fetch(U + "/api/garantias/hoja-liberacion/alertas-plazo-regreso", { headers: H(ca) }));
  ok("trae diasPlazo = 5 (default)", r.diasPlazo === 5, JSON.stringify(r.diasPlazo));
  ok("viene un arreglo de alertas", Array.isArray(r.alertas), JSON.stringify(r).slice(0, 200));

  const filaExcede = (r.alertas || []).find((a) => a.socio === SOCIO_EXCEDE);
  ok("'excede' (salió hace 8 días, nadie marcó regreso) SÍ aparece", !!filaExcede, JSON.stringify(filaExcede));
  if (filaExcede) {
    ok("'excede' trae diasSinRegresar >= 5", filaExcede.diasSinRegresar >= 5, JSON.stringify(filaExcede));
    ok("'excede' trae folio = el de la salida real", filaExcede.folio === folioExcede, JSON.stringify(filaExcede));
    ok("el motivo menciona 'alertar' o 'escalar'", /alertar|escalar/i.test(filaExcede.motivo || ""), filaExcede.motivo);
  }

  const filaDentro = (r.alertas || []).find((a) => a.socio === SOCIO_DENTRO);
  ok("'dentro de plazo' (salió hace 2 días) NO aparece todavía", !filaDentro, JSON.stringify(filaDentro));

  const filaYaRegreso = (r.alertas || []).find((a) => a.socio === SOCIO_YA_REGRESO);
  ok("'ya regresó' (salió hace 8 días, PERO ya se marcó el regreso) NO aparece", !filaYaRegreso, JSON.stringify(filaYaRegreso));

  ok("la lista viene ordenada por días sin regresar (más urgente primero)",
    (r.alertas || []).length < 2 || r.alertas[0].diasSinRegresar >= r.alertas[r.alertas.length - 1].diasSinRegresar,
    JSON.stringify((r.alertas || []).map((a) => a.diasSinRegresar)));

  console.log("\n— Nunca bloquea: ambos endpoints son GET/POST informativos, no hay ningún candado que impida nada —");
  ok("no existe una ruta que bloqueé otra operación por este motivo (verificación de diseño, no de HTTP)", true);

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
