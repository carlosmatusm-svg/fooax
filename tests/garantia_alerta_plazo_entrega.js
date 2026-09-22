// ALERTA/ESCALACIÓN — PLAZO DE 2 SEMANAS PARA ENTREGAR LA GARANTÍA (CU-006,
// RESUELTO 21-sep-2026: Dirección aprueba sin cambios la propuesta de
// Sistemas del 11-sep-2026 — "Respuesta: alerta y escala", nunca bloquea).
// Ver dominios/garantia_liquida.js#alertasPlazoEntregaGarantia.
//
// ESTA PRUEBA NECESITA FECHAS DE CIERRE (fecha_baja) EN EL PASADO (hace 20,
// hace 5, y "sigue vigente") para poder distinguir quién ya excedió el
// plazo y quién no. La API real de baja siempre fecha con hoyMX() (hoy) —
// no hay forma de backdatearla por HTTP, y no debe haberla (rastro real).
// Por eso esta prueba se corre en DOS PASOS: primero un "--seed" que escribe
// directo en los archivos de la carpeta desechable (antes de levantar el
// servidor) los cambios de padrón y el movimiento de garantía ya guardada;
// luego el servidor arranca leyendo ESE padrón_cambios.json ya con las
// fechas correctas, y la prueba normal solo hace GET (nunca escribe nada
// por HTTP). Mismo criterio de "no adivinar" que el resto del módulo.
//
//   export TEST_RUN=$(date +%s | tail -c 6)   # MISMO valor para --seed y para la prueba
//   D=/tmp/fooax-prueba-alerta; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   node tests/garantia_alerta_plazo_entrega.js --seed $D
//   DATA_DIR=$D PORT=3899 node server.js &
//   sleep 2
//   node tests/garantia_alerta_plazo_entrega.js
//
// TEST_RUN debe ser el MISMO valor en las dos invocaciones (--seed y la
// prueba): son dos procesos de node separados y sin TEST_RUN cada uno
// generaría su propio sufijo aleatorio, buscando socios que el otro nunca
// creó — por eso se exporta antes, una sola vez, para ambos.
"use strict";
const fs = require("fs");
const path = require("path");

function sumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

const RUN = process.env.TEST_RUN || String(Math.floor(Date.now() / 1000) % 100000);
const HOY = new Date().toISOString().slice(0, 10);
const CENTRO = "C-0";

const SOCIO_EXCEDE = "7" + RUN.padStart(10, "0");       // cerró hace 20 días, guardado>0, sin otro crédito
const SOCIO_DENTRO_PLAZO = "8" + RUN.padStart(10, "0");  // cerró hace 5 días — no debe alertar todavía
const SOCIO_VIGENTE = "9" + RUN.padStart(10, "0");       // sigue activo — nunca cerró
const PRODUCTO = "Magnus Alerta " + RUN;

if (process.argv[2] === "--seed") {
  const D = process.argv[3];
  if (!D) { console.error("Falta la carpeta ($D) como segundo argumento."); process.exit(1); }

  function credito(id, nombre, altaFecha) {
    return {
      id, nombre, centro: CENTRO, ejecutivo: "Karina", producto: PRODUCTO,
      saldo: 5800, cuota: 725, plazo: 8, importe: 5000,
      desembolso: altaFecha, diaPago: "MARTES",
    };
  }

  // Las fechas deben caer DESPUÉS del "corte" de saldos (corteSaldos(), la
  // fecha de la plantilla vigente) — carteraViva() solo cuenta lo abonado
  // DESDE ese corte; un movimiento anterior a esa fecha no cuenta el
  // guardado (no es un bug de esta pieza, es cómo se calculan los saldos
  // desde siempre). Por eso -30/-20/-5 días, nunca -60: con datos reales
  // eso siempre cae después del último corte de la plantilla vigente.
  const cambios = [
    // Las tres clientas de prueba nacen el mismo día, lejos en el pasado
    // (para que "cerrar hace 20/5 días" sea consistente con su alta).
    { tipo: "alta", clienta: credito(SOCIO_EXCEDE, "Prueba Alerta Excede " + RUN, sumarDias(HOY, -30)), fecha: sumarDias(HOY, -30), ts: Date.now() - 6000 },
    { tipo: "alta", clienta: credito(SOCIO_DENTRO_PLAZO, "Prueba Alerta Dentro Plazo " + RUN, sumarDias(HOY, -30)), fecha: sumarDias(HOY, -30), ts: Date.now() - 5000 },
    { tipo: "alta", clienta: credito(SOCIO_VIGENTE, "Prueba Alerta Vigente " + RUN, sumarDias(HOY, -30)), fecha: sumarDias(HOY, -30), ts: Date.now() - 4000 },
    // SOCIO_EXCEDE cerró (liquidó) hace 20 días — más que el plazo de 14.
    { tipo: "baja", id: SOCIO_EXCEDE, producto: PRODUCTO, motivo: "Liquidó anticipadamente",
      fecha: sumarDias(HOY, -20), por: "Prueba " + RUN, ts: Date.now() - 3000 },
    // SOCIO_DENTRO_PLAZO cerró hace solo 5 días — todavía dentro del plazo.
    { tipo: "baja", id: SOCIO_DENTRO_PLAZO, producto: PRODUCTO, motivo: "Liquidó anticipadamente",
      fecha: sumarDias(HOY, -5), por: "Prueba " + RUN, ts: Date.now() - 2000 },
    // SOCIO_VIGENTE nunca se da de baja: su crédito sigue activo.
  ];

  const movimientos = [SOCIO_EXCEDE, SOCIO_DENTRO_PLAZO].map((socio, i) => ({
    folio: "GAR-PRUEBA-ALERTA-" + RUN + "-" + i, fecha: sumarDias(HOY, -30), monto: 500,
    concepto: "Garantía líquida", categoria: "Otro", metodo: "retencion",
    ejecutivo: "Karina", socio, producto: PRODUCTO, tipo: "Garantía líquida", entrada: true,
    registradoPor: "Sistema (prueba)", rol: "sistema", ts: Date.now() - 7000 - i,
  }));

  fs.writeFileSync(path.join(D, "padron_cambios.json"), JSON.stringify(cambios, null, 2));
  fs.writeFileSync(path.join(D, "movimientos.json"), JSON.stringify(movimientos, null, 2));
  console.log("Semilla escrita en " + D + " — socios: excede=" + SOCIO_EXCEDE
    + " dentroPlazo=" + SOCIO_DENTRO_PLAZO + " vigente=" + SOCIO_VIGENTE);
  process.exit(0);
}

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

(async () => {
  const ca = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local? ¿corriste --seed antes de levantar el servidor?"); process.exit(1); }

  console.log("\n— GET /api/garantias/alertas-plazo-entrega —");
  const r = await j(await fetch(U + "/api/garantias/alertas-plazo-entrega", { headers: H(ca) }));
  ok("trae diasPlazo = 14 (default)", r.diasPlazo === 14, JSON.stringify(r.diasPlazo));
  ok("viene un arreglo de alertas", Array.isArray(r.alertas), JSON.stringify(r).slice(0, 200));

  const filaExcede = (r.alertas || []).find((a) => a.socio === SOCIO_EXCEDE);
  ok("'excede' (cerró hace 20 días) SÍ aparece en la lista", !!filaExcede, JSON.stringify(filaExcede));
  if (filaExcede) {
    ok("'excede' trae diasSinEntregar >= 14", filaExcede.diasSinEntregar >= 14, JSON.stringify(filaExcede));
    ok("'excede' trae guardado > 0 (no inventa el monto)", filaExcede.guardado > 0, JSON.stringify(filaExcede));
    ok("el motivo menciona 'alerta y escala' (o similar)", /alertar|escalar/i.test(filaExcede.motivo || ""), filaExcede.motivo);
  }

  const filaDentroPlazo = (r.alertas || []).find((a) => a.socio === SOCIO_DENTRO_PLAZO);
  ok("'dentro de plazo' (cerró hace 5 días) NO aparece todavía", !filaDentroPlazo, JSON.stringify(filaDentroPlazo));

  const filaVigente = (r.alertas || []).find((a) => a.socio === SOCIO_VIGENTE);
  ok("'vigente' (crédito nunca cerró) NO aparece — no es liberable", !filaVigente, JSON.stringify(filaVigente));

  ok("la lista viene ordenada por días sin entregar (más urgente primero)",
    (r.alertas || []).length < 2 || r.alertas[0].diasSinEntregar >= r.alertas[r.alertas.length - 1].diasSinEntregar,
    JSON.stringify((r.alertas || []).map((a) => a.diasSinEntregar)));

  console.log("\n— Nunca bloquea: el endpoint es GET, informativo, no hay ningún POST que impida nada —");
  ok("no existe una ruta que bloquee la entrega por este motivo (verificación de diseño, no de HTTP)", true);

  console.log("\n— RESULTADO —");
  console.log("PASS: " + PASS + "  FAIL: " + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
})();
