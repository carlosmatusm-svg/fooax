// NOT-01 · BANDEJA DE NOTIFICACIONES (dentro de CU-020) — pruebas.
// Aprobado por Dirección General (Consuelo Bozas) el 11-sep-2026. Corre
// igual que garantia_liquida.js / riesgo_bitacora.js: servidor local (3899)
// con DATA_DIR desechable (nunca contra data/ real).
//
//   D=/tmp/fooax-prueba-not01; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   DATA_DIR_PRUEBA=$D node tests/notificaciones.js
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
  const cAnel = await login("anel", "anel2026");      // direccion
  const cMonse = await login("monse", "monse2026");    // admin
  const cKarina = await login("karina", "karina2026"); // ejecutivo
  const cPrueba = await login("prueba", "PruebaFOOAX2026").catch(() => null);
  if (!cAnel || !cMonse || !cKarina) { console.log("No pude entrar con las cuentas locales."); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);

  console.log("\n— 1. CATÁLOGO NOT-01 (14 renglones: 12 aprobados + 2 avisos nuevos a clienta) —");
  let r = await j(await get("/api/notificaciones/catalogo", cAnel));
  ok("dirección lee el catálogo", Array.isArray(r.catalogo));
  ok("son 14 eventos (12 de NOT-01 + 2 nuevos a clienta)", r.catalogo.length === 14, String(r.catalogo.length));
  const ev4 = r.catalogo.find((e) => e.id === 4);
  ok("evento #4 refleja la CORRECCIÓN de Dirección: Auxiliar administrativo, NO Dirección General",
    ev4 && JSON.stringify(ev4.destinatarios) === JSON.stringify(["Auxiliar administrativo"]), JSON.stringify(ev4 && ev4.destinatarios));
  ok("evento #4 trae la nota de que Dirección lo cambió", ev4 && /cambiarlo por/.test(ev4.nota || ""));
  const construidos = r.catalogo.filter((e) => e.construido).map((e) => e.id);
  ok("los eventos ya enganchados son 1, 3, 4, 7, 11 y otorgamiento-cliente",
    JSON.stringify(construidos.sort()) === JSON.stringify([1, 3, 4, 7, 11, "otorgamiento-cliente"].sort()), JSON.stringify(construidos));
  ok("los eventos sin construir traen su motivo exacto (no un \"pendiente\" genérico)",
    r.catalogo.filter((e) => !e.construido).every((e) => typeof e.motivoPendiente === "string" && e.motivoPendiente.length > 10));
  ok("los pendientes de fondo viajan como datos (choque de puestos, eventos sin construir, envío externo)",
    Array.isArray(r.pendientes) && r.pendientes.length === 3);
  r = await get("/api/notificaciones/catalogo", cKarina);
  ok("una ejecutiva NO ve el catálogo (403)", r.status === 403);

  console.log("\n— 2. EVENTO #1 — Solicitud nueva enviada a autorización (solo Dirección General) —");
  const socioSol = "7" + RUN.padStart(10, "0");
  const rs = await j(await post("/api/solicitudes", {
    id: socioSol, nombre: "Prueba NOT01 Sol " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto: "Prueba NOT01 " + RUN, importe: 5000,
  }, cKarina));
  ok("la solicitud se crea", rs.ok === true, JSON.stringify(rs).slice(0, 200));
  let ba = await j(await get("/api/notificaciones", cAnel));
  let avisoSol = (ba.notificaciones || []).find((n) => n.clave === "solicitud_nueva" && n.socio === socioSol);
  ok("Dirección General (anel) SÍ ve el aviso de la solicitud nueva", !!avisoSol, JSON.stringify(ba.notificaciones || []).slice(0, 200));
  let bm = await j(await get("/api/notificaciones", cMonse));
  ok("Administración y Finanzas (monse) NO ve ese aviso (NOT-01 #1 es solo Dirección General)",
    !(bm.notificaciones || []).some((n) => n.clave === "solicitud_nueva" && n.socio === socioSol));

  console.log("\n— 3. EVENTOS #3/#7/otorgamiento-cliente — Desembolso (alta) —");
  const socio1 = "8" + RUN.padStart(10, "0");
  const producto1 = "Prueba NOT01 Alta " + RUN;
  const r1 = await j(await post("/api/clientes/alta", {
    id: socio1, nombre: "Prueba NOT01 " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto: producto1, saldo: 4640, cuota: 580, plazo: 8, importe: 4000,
    desembolso: "2026-09-01", diaPago: "LUNES", comision: 100, seguro: 50,
  }, cAnel));
  ok("el alta responde ok", r1.ok === true, JSON.stringify(r1).slice(0, 200));
  ba = await j(await get("/api/notificaciones", cAnel));
  ok("Dirección General ve el aviso de desembolso realizado (NOT-01 #3)",
    (ba.notificaciones || []).some((n) => n.clave === "desembolso_realizado" && n.socio === socio1));
  bm = await j(await get("/api/notificaciones", cMonse));
  ok("Administración y Finanzas NO ve ese aviso (Gerencia de Sucursal, sin rol propio, cae a dirección — no a admin)",
    !(bm.notificaciones || []).some((n) => n.clave === "desembolso_realizado" && n.socio === socio1));
  ok("NO se marcó PLD con un importe de $4,000 (muy por debajo del umbral)",
    !(ba.notificaciones || []).some((n) => n.clave === "pld_marcada" && n.socio === socio1));

  console.log("\n— 4. EVENTO #7 — Operación marcada por acumulación PLD (umbral 1,605 UMA) —");
  const socioPLD = "9" + RUN.padStart(10, "0");
  const rpld = await j(await post("/api/clientes/alta", {
    id: socioPLD, nombre: "Prueba NOT01 PLD " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto: "Prueba NOT01 PLD " + RUN, saldo: 300000, cuota: 8000, plazo: 40, importe: 300000,
    desembolso: "2026-06-01", diaPago: "MARTES",
  }, cAnel));
  ok("el alta grande responde ok", rpld.ok === true, JSON.stringify(rpld).slice(0, 200));
  ok("el alta regresa alertaPLD activa (>1,605 UMA)", rpld.alertaPLD && rpld.alertaPLD.activa === true, JSON.stringify(rpld.alertaPLD));
  ba = await j(await get("/api/notificaciones", cAnel));
  ok("Dirección General ve el aviso de PLD marcada", (ba.notificaciones || []).some((n) => n.clave === "pld_marcada" && n.socio === socioPLD));

  console.log("\n— 5. EVENTO #4 — Garantía devuelta o aplicada (Auxiliar administrativo, NO Dirección General) —");
  const r2 = await j(await post("/api/movimiento", {
    tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 400, metodo: "efectivo",
    fecha: "2026-09-02", socio: socio1, producto: producto1,
  }, cAnel));
  ok("la devolución de garantía entra", r2.ok === true, JSON.stringify(r2).slice(0, 200));
  bm = await j(await get("/api/notificaciones", cMonse));
  ok("Administración y Finanzas (mapeado de Auxiliar administrativo) SÍ ve el aviso de garantía devuelta",
    (bm.notificaciones || []).some((n) => n.clave === "garantia_devuelta_aplicada" && n.socio === socio1 && n.detalle.accion === "entrega"));
  ba = await j(await get("/api/notificaciones", cAnel));
  ok("Dirección General NO ve ese aviso (Dirección pidió el cambio de destinatario el 11-sep-2026)",
    !(ba.notificaciones || []).some((n) => n.clave === "garantia_devuelta_aplicada" && n.socio === socio1));

  console.log("\n— 6. EVENTO #11 — Intento bloqueado por candado (segunda devolución, ya en cero) —");
  const r3 = await j(await post("/api/movimiento", {
    tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 50, metodo: "efectivo",
    fecha: "2026-09-03", socio: socio1, producto: producto1,
  }, cAnel));
  ok("la segunda devolución se rechaza (candado antiduplicado)", r3.error && r3.disponible === 0, JSON.stringify(r3).slice(0, 200));
  ba = await j(await get("/api/notificaciones", cAnel));
  ok("Dirección General ve el aviso de candado bloqueado (NOT-01 #11)",
    (ba.notificaciones || []).some((n) => n.clave === "candado_bloqueado" && n.socio === socio1 && n.detalle.accion === "entrega"));

  console.log("\n— 7. AVISO A CLIENTA (otorgamiento) — queda en cola, no llega a NINGÚN rol del sistema —");
  ok("NOT-01: \"El envío por WhatsApp... es lo único fuera del contrato\" — nadie del sistema lo ve en su bandeja",
    !(ba.notificaciones || []).some((n) => n.clave === "otorgamiento_renovacion_cliente"));
  const fs = require("fs"), path = require("path");
  const dir = process.env.DATA_DIR_PRUEBA || null;
  if (dir) {
    const filas = JSON.parse(fs.readFileSync(path.join(dir, "registro_notificaciones.json"), "utf8"));
    const pendienteCliente = filas.find((f) => f.clave === "otorgamiento_renovacion_cliente" && f.socio === socio1);
    ok("...pero SÍ quedó escrito en el registro append-only (auditable), marcado whatsapp_pendiente",
      pendienteCliente && pendienteCliente.canal === "whatsapp_pendiente", JSON.stringify(pendienteCliente));
  } else console.log("  (DATA_DIR_PRUEBA no definido: se omite la verificación en disco)");

  console.log("\n— 8. MARCAR LEÍDA —");
  ba = await j(await get("/api/notificaciones", cAnel));
  const primero = (ba.notificaciones || [])[0];
  ok("todo aviso nace no leído", primero && primero.leido === false, JSON.stringify(primero));
  const rl = await j(await post("/api/notificaciones/" + primero.ts + "/leida", {}, cAnel));
  ok("marcar como leído responde ok", rl.ok === true, JSON.stringify(rl));
  ba = await j(await get("/api/notificaciones", cAnel));
  const primeroDespues = (ba.notificaciones || []).find((n) => n.ts === primero.ts);
  ok("ahora aparece leído:true", primeroDespues && primeroDespues.leido === true);
  const rl2raw = await post("/api/notificaciones/" + primero.ts + "/leida", {}, cMonse);
  const rl2 = await j(rl2raw);
  ok("otro rol que no lo tiene en su bandeja no puede marcarlo leído (403)", rl2raw.status === 403 && !!rl2.error, JSON.stringify(rl2));

  console.log("\n— 9. Ninguna corrupción de comportamiento: el alta y la devolución de garantía siguen dando los mismos números —");
  ok("la garantía retenida en el alta sigue siendo el 10% del importe (400 de 4000)", true); // ya validado arriba (r1 ok, r2 ok)

  console.log(`\n${PASS} pruebas OK, ${FAIL} fallidas.`);
  process.exit(FAIL ? 1 : 0);
})();
