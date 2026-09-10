// SOBRES / SEGREGACIÓN DE FUNCIONES (CU-011/012/013, Regla K.2, CU-021) — pruebas.
// Reconstrucción en el repo real 09-sep-2026 (ver PENDIENTES §28). Corre igual
// que sincronizacion_desembolso.js: servidor local (3899) con DATA_DIR
// desechable.
//
//   D=/tmp/fooax-prueba-sobres; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/sobres_segregacion.js
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
  const cKarina = await login("karina", "karina2026");
  const cNeri = await login("neri", "neri2026");
  const cChristopher = await login("christopher", "chris2026");
  const cAnel = await login("anel", "anel2026");
  const cMonse = await login("monse", "monse2026");
  const cPrueba = await login("prueba", "PruebaFOOAX2026");
  const cPruebaDir = await login("pruebadir", "PruebaFOOAX2026");
  if (!cKarina || !cAnel || !cMonse) { console.log("No pude entrar con las cuentas de prueba locales."); process.exit(1); }

  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const socio = "8" + RUN.padStart(10, "0");
  const producto = "Prueba Sobres " + RUN;

  console.log("\n— 1. SOLICITAR (paso 1) —");
  let r = await fetch(U + "/api/solicitudes", { method: "POST", headers: H(cKarina), body: JSON.stringify({
    id: socio, nombre: "Prueba Sobres " + RUN, centro: "C-0", ejecutivo: "Karina",
    producto, importe: 5000, plazo: 8, cuota: 700, desembolso: "2026-09-10", diaPago: "MIERCOLES",
  }) });
  let d = await j(r);
  ok("la solicitud se crea", r.status === 200 && d.ok, JSON.stringify(d));
  const folio = d.solicitud && d.solicitud.folio;
  ok("nace en estado 'solicitada'", d.solicitud && d.solicitud.estado === "solicitada");

  console.log("\n— 2. AUTORIZAR (paso 2, escalera vacía = dirección/admin) —");
  r = await fetch(U + "/api/solicitudes/" + folio + "/autorizar", { method: "POST", headers: H(cKarina) });
  d = await j(r);
  ok("un ejecutivo (fuera de la escalera vacía) NO puede autorizar", r.status === 403, JSON.stringify(d));

  r = await fetch(U + "/api/solicitudes/" + folio + "/autorizar", { method: "POST", headers: H(cAnel) });
  d = await j(r);
  ok("dirección SÍ puede autorizar (escalera vacía)", r.status === 200 && d.solicitud.estado === "autorizada", JSON.stringify(d));
  ok("queda registrado quién autorizó", d.solicitud.autorizadaPorId === "anel");

  console.log("\n— 3. DISPERSAR (paso 3, Regla K.2: quien autoriza no dispersa) —");
  r = await fetch(U + "/api/solicitudes/" + folio + "/dispersar", { method: "POST", headers: H(cAnel) });
  d = await j(r);
  ok("quien autorizó NO puede dispersar el mismo crédito", r.status === 403, JSON.stringify(d));

  r = await fetch(U + "/api/solicitudes/" + folio + "/dispersar", { method: "POST", headers: H(cMonse) });
  d = await j(r);
  ok("otro usuario (admin) SÍ puede dispersar", r.status === 200 && d.solicitud.estado === "dispersada", JSON.stringify(d));
  ok("dispersar generó el pagaré (sincronización automática)", d.clienta && d.clienta.pagare, JSON.stringify(d.clienta));
  ok("dispersar generó el plan de pagos (8 cuotas)", d.solicitud.planPagos && d.solicitud.planPagos.length === 8);
  ok("dispersar generó el sobre de dispersión", !!d.solicitud.sobreDispersion);

  console.log("\n— 4. EL CRÉDITO YA QUEDÓ EN EL PADRÓN REAL (a diferencia del fork) —");
  r = await fetch(U + "/api/creditos/plan-pagos?id=" + socio + "&producto=" + encodeURIComponent(producto), { headers: H(cMonse) });
  d = await j(r);
  ok("el crédito dispersado SÍ está en el padrón real (no se quedó pendiente)", r.status === 200 && String(d.id) === socio, JSON.stringify(d));

  console.log("\n— 5. ENTREGAR (paso 4, Regla K.2: quien dispersa no entrega) —");
  r = await fetch(U + "/api/solicitudes/" + folio + "/entregar", { method: "POST", headers: H(cMonse) });
  d = await j(r);
  ok("quien dispersó NO puede entregar el mismo sobre", r.status === 403, JSON.stringify(d));

  r = await fetch(U + "/api/solicitudes/" + folio + "/entregar", { method: "POST", headers: H(cKarina) });
  d = await j(r);
  ok("otro usuario SÍ puede entregar", r.status === 200 && d.solicitud.estado === "entregada", JSON.stringify(d));

  console.log("\n— 6. CUSTODIA DEL PAGARÉ (paso 5, Regla K.2: quien entrega no custodia) —");
  r = await fetch(U + "/api/solicitudes/" + folio + "/custodiar", { method: "POST", headers: H(cKarina) });
  d = await j(r);
  ok("quien entregó NO puede custodiar el mismo pagaré", r.status === 403, JSON.stringify(d));

  r = await fetch(U + "/api/solicitudes/" + folio + "/custodiar", { method: "POST", headers: H(cChristopher) });
  d = await j(r);
  ok("otro usuario SÍ puede custodiar — cierra el ciclo", r.status === 200 && d.solicitud.estado === "en_custodia", JSON.stringify(d));

  console.log("\n— 7. RECHAZAR (antes de dispersar) —");
  const socio2 = "8" + String(Number(RUN) + 1).padStart(10, "0");
  r = await fetch(U + "/api/solicitudes", { method: "POST", headers: H(cKarina), body: JSON.stringify({
    id: socio2, nombre: "Prueba Rechazo " + RUN, centro: "C-0", ejecutivo: "Karina", producto: "Prueba Rechazo " + RUN, importe: 3000,
  }) });
  d = await j(r);
  const folio2 = d.solicitud.folio;
  r = await fetch(U + "/api/solicitudes/" + folio2 + "/rechazar", { method: "POST", headers: H(cAnel), body: JSON.stringify({ motivo: "no cumple perfil" }) });
  d = await j(r);
  ok("se puede rechazar antes de autorizar", r.status === 200 && d.solicitud.estado === "rechazada", JSON.stringify(d));
  r = await fetch(U + "/api/solicitudes/" + folio2 + "/autorizar", { method: "POST", headers: H(cAnel) });
  ok("una solicitud rechazada ya no se puede autorizar", r.status === 400);

  console.log("\n— 8. ESCALERA DE AUTORIZACIÓN CONFIGURABLE (Dirección) —");
  r = await fetch(U + "/api/configuracion/escalera-autorizacion", { method: "PUT", headers: H(cAnel), body: JSON.stringify({ escaleraAutorizacion: ["neri"] }) });
  d = await j(r);
  ok("dirección puede configurar la escalera", r.status === 200 && Array.isArray(d.escaleraAutorizacion), JSON.stringify(d));

  const socio3 = "8" + String(Number(RUN) + 2).padStart(10, "0");
  r = await fetch(U + "/api/solicitudes", { method: "POST", headers: H(cKarina), body: JSON.stringify({
    id: socio3, nombre: "Prueba Escalera " + RUN, centro: "C-0", ejecutivo: "Karina", producto: "Prueba Escalera " + RUN, importe: 2000,
  }) });
  d = await j(r);
  const folio3 = d.solicitud.folio;

  r = await fetch(U + "/api/solicitudes/" + folio3 + "/autorizar", { method: "POST", headers: H(cAnel) });
  d = await j(r);
  ok("con escalera llena, dirección YA NO puede autorizar si no está en la lista", r.status === 403, JSON.stringify(d));

  r = await fetch(U + "/api/solicitudes/" + folio3 + "/autorizar", { method: "POST", headers: H(cNeri) });
  d = await j(r);
  ok("el usuario de la escalera (neri, ejecutivo) SÍ puede autorizar", r.status === 200 && d.solicitud.estado === "autorizada", JSON.stringify(d));

  // limpia la escalera para no afectar otras corridas/pruebas.
  await fetch(U + "/api/configuracion/escalera-autorizacion", { method: "PUT", headers: H(cAnel), body: JSON.stringify({ escaleraAutorizacion: [] }) });

  console.log("\n— 9. LA CUENTA DE PRUEBA NO PUEDE DISPERSAR EN EL PADRÓN REAL —");
  const socioP = "8" + String(Number(RUN) + 3).padStart(10, "0");
  r = await fetch(U + "/api/solicitudes", { method: "POST", headers: H(cPrueba), body: JSON.stringify({
    id: socioP, nombre: "Prueba Cuenta " + RUN, centro: "C-0", ejecutivo: "Prueba", producto: "Prueba Cuenta " + RUN, importe: 1000,
  }) });
  d = await j(r);
  const folioP = d.solicitud.folio;
  ok("la cuenta de prueba SÍ puede solicitar", r.status === 200 && d.ok);
  r = await fetch(U + "/api/solicitudes/" + folioP + "/autorizar", { method: "POST", headers: H(cPruebaDir) });
  d = await j(r);
  ok("dirección de prueba puede autorizar (es su propia burbuja)", r.status === 200 && d.solicitud.estado === "autorizada", JSON.stringify(d));
  r = await fetch(U + "/api/solicitudes/" + folioP + "/dispersar", { method: "POST", headers: H(cPruebaDir) });
  d = await j(r);
  ok("ni siquiera dirección de prueba puede dispersar (nunca toca el padrón real)", r.status === 400, JSON.stringify(d));

  console.log("\n═".repeat(18));
  if (FAIL === 0) { console.log(`✅✅ SOBRES/SEGREGACIÓN OK: ${PASS} verificaciones`); process.exit(0); }
  else { console.log(`❌ ${FAIL} fallaron, ${PASS} pasaron`); process.exit(1); }
})();
