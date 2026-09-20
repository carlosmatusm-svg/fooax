// GARANTÍA LÍQUIDA — CANDADOS DE REESTRUCTURA Y LIBERACIÓN (19-sep-2026,
// CU-006 items 27 y 30, respuestas de Dirección al documento "Garantías
// pendientes de definición" 18-sep-2026). Mismo patrón que
// tests/garantia_liquida.js: corre contra el servidor local (3899) con
// DATA_DIR desechable.
//
//   D=/tmp/fooax-prueba-gl2; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/garantia_candados_reestructura_liberacion.js
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

async function garantiaDe(ca, socio) {
  const lista = await j(await fetch(U + "/api/creditos?q=" + encodeURIComponent(socio), { headers: H(ca) }));
  return (lista.resultados || [])[0] || null;
}

(async () => {
  const ca = await login("anel", "anel2026");
  if (!ca) { console.log("No pude entrar como anel — ¿cambiaron las claves de prueba local?"); process.exit(1); }
  const RUN = String(Math.floor(Date.now() / 1000) % 100000);
  const desembolso = "2026-09-01"; // con margen sobre el corte real de la plantilla
  const fechaMov = "2026-09-02";

  console.log("\n— 1. CANDADO item 30: NO se solicita aportación de garantía en un crédito etiquetado Reestructura —");
  const socioR = "7" + RUN.padStart(10, "0");
  const productoR = "Prueba Reestructura " + RUN;
  const rAlta = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioR, nombre: "Prueba Reestructura " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoR, saldo: 2300, cuota: 300, plazo: 8, importe: 2000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  ok("el alta (para reestructura) responde ok", rAlta.ok === true, JSON.stringify(rAlta).slice(0, 200));

  const rEtiqueta = await j(await fetch(U + "/api/creditos/etiqueta", {
    method: "POST", headers: H(ca), body: JSON.stringify({ id: socioR, producto: productoR, etiqueta: "Reestructura" }),
  }));
  ok("Dirección puede etiquetar el crédito como Reestructura", rEtiqueta.ok === true, JSON.stringify(rEtiqueta).slice(0, 200));
  const credR = await garantiaDe(ca, socioR);
  ok("el crédito ya trae la etiqueta Reestructura", credR && credR.etiqueta === "Reestructura", JSON.stringify(credR && credR.etiqueta));

  const rGarantiaBloqueada = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía líquida", concepto: "Garantía líquida", monto: 100, metodo: "efectivo",
      fecha: fechaMov, socio: socioR, producto: productoR,
    }),
  }));
  ok("SE RECHAZA la aportación manual de Garantía Líquida a un crédito en Reestructura",
    rGarantiaBloqueada.ok === undefined && !!rGarantiaBloqueada.error, JSON.stringify(rGarantiaBloqueada));
  ok("el rechazo cita el item 30 de CU-006", /item 30/.test(rGarantiaBloqueada.error || ""), rGarantiaBloqueada.error);

  const rGarantiaABloqueada = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía A", concepto: "Garantía A", monto: 100, metodo: "efectivo",
      fecha: fechaMov, socio: socioR, producto: productoR,
    }),
  }));
  ok("SE RECHAZA también la aportación de Garantía A al mismo crédito reestructurado",
    rGarantiaABloqueada.ok === undefined && !!rGarantiaABloqueada.error, JSON.stringify(rGarantiaABloqueada));

  console.log("\n— 2. El candado NO bloquea aportaciones a un crédito SIN etiqueta Reestructura —");
  const socioN = "8" + RUN.padStart(10, "0");
  const productoN = "Prueba Normal " + RUN;
  const rAltaN = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioN, nombre: "Prueba Normal " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoN, saldo: 2300, cuota: 300, plazo: 8, importe: 2000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  ok("el alta normal (sin etiqueta) responde ok", rAltaN.ok === true);
  const rGarantiaOk = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía líquida", concepto: "Garantía líquida", monto: 100, metodo: "efectivo",
      fecha: fechaMov, socio: socioN, producto: productoN,
    }),
  }));
  ok("la aportación manual SÍ se acepta en un crédito sin etiqueta Reestructura", rGarantiaOk.ok === true, JSON.stringify(rGarantiaOk).slice(0, 200));

  console.log("\n— 3. El candado de reestructura NO bloquea SALIDAS (entregar lo que ya estaba guardado) —");
  // El crédito reestructurado (socioR) ya trae $200 retenidos automáticamente
  // desde el alta (10% de 2000) — item 30 dice que no se PIDE MÁS garantía,
  // no que se congele la que ya existía.
  const rEntregaEnReestructura = await j(await fetch(U + "/api/movimiento", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      tipo: "Garantía líquida entregada", concepto: "Garantía líquida entregada", monto: 200, metodo: "efectivo",
      fecha: fechaMov, socio: socioR, producto: productoR,
    }),
  }));
  ok("SÍ se puede entregar/liberar la garantía que ya tenía guardada un crédito en Reestructura",
    rEntregaEnReestructura.ok === true, JSON.stringify(rEntregaEnReestructura).slice(0, 200));

  console.log("\n— 4. CU-006 item 27: elegibilidad de liberación — crédito vigente NO es liberable —");
  const socioL = "9" + RUN.padStart(10, "0");
  const productoL1 = "Prueba Liberacion Uno " + RUN;
  const rAltaL1 = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioL, nombre: "Prueba Liberacion " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoL1, saldo: 2300, cuota: 300, plazo: 8, importe: 2000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  ok("el alta (para liberación) responde ok", rAltaL1.ok === true);

  const fichaVigente = await j(await fetch(U + "/api/garantias/ficha?id=" + socioL + "&producto=" + encodeURIComponent(productoL1), { headers: H(ca) }));
  ok("la ficha trae elegibilidadLiberacion", !!fichaVigente.elegibilidadLiberacion, JSON.stringify(fichaVigente).slice(0, 300));
  ok("NO es liberable mientras el crédito sigue vigente", fichaVigente.elegibilidadLiberacion && fichaVigente.elegibilidadLiberacion.liberable === false,
    JSON.stringify(fichaVigente.elegibilidadLiberacion));

  console.log("\n— 5. Crédito cerrado (baja) y SIN otro crédito activo — SÍ liberable —");
  const rBaja1 = await j(await fetch(U + "/api/clientes/baja", {
    method: "POST", headers: H(ca), body: JSON.stringify({ id: socioL, producto: productoL1, motivo: "Otro" }),
  }));
  ok("la baja del único crédito responde ok", rBaja1.ok === true, JSON.stringify(rBaja1));
  const fichaCerradaSola = await j(await fetch(U + "/api/garantias/ficha?id=" + socioL + "&producto=" + encodeURIComponent(productoL1), { headers: H(ca) }));
  ok("SÍ es liberable: cerrado y sin otro crédito activo de la clienta",
    fichaCerradaSola.elegibilidadLiberacion && fichaCerradaSola.elegibilidadLiberacion.liberable === true,
    JSON.stringify(fichaCerradaSola.elegibilidadLiberacion));

  console.log("\n— 6. Crédito cerrado pero CON otro crédito activo — NO liberable, avisa a Dirección (item 26) —");
  const socioL2 = "9" + String(Number(RUN) + 1).padStart(10, "0");
  const productoL2a = "Prueba Liberacion Dos A " + RUN;
  const productoL2b = "Prueba Liberacion Dos B " + RUN;
  const rAltaL2a = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioL2, nombre: "Prueba Liberacion Dos " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoL2a, saldo: 2300, cuota: 300, plazo: 8, importe: 2000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  const rAltaL2b = await j(await fetch(U + "/api/clientes/alta", {
    method: "POST", headers: H(ca), body: JSON.stringify({
      id: socioL2, nombre: "Prueba Liberacion Dos " + RUN, centro: "C-0", ejecutivo: "Karina",
      producto: productoL2b, saldo: 1150, cuota: 150, plazo: 8, importe: 1000,
      desembolso, diaPago: "LUNES", comision: 0, seguro: 0,
    }),
  }));
  ok("los dos altas de la misma clienta (dos créditos) responden ok", rAltaL2a.ok === true && rAltaL2b.ok === true);

  const rBaja2a = await j(await fetch(U + "/api/clientes/baja", {
    method: "POST", headers: H(ca), body: JSON.stringify({ id: socioL2, producto: productoL2a, motivo: "Otro" }),
  }));
  ok("la baja de UNO de los dos créditos responde ok", rBaja2a.ok === true, JSON.stringify(rBaja2a));

  const fichaConOtroActivo = await j(await fetch(U + "/api/garantias/ficha?id=" + socioL2 + "&producto=" + encodeURIComponent(productoL2a), { headers: H(ca) }));
  ok("NO es liberable: la clienta tiene otro crédito activo",
    fichaConOtroActivo.elegibilidadLiberacion && fichaConOtroActivo.elegibilidadLiberacion.liberable === false,
    JSON.stringify(fichaConOtroActivo.elegibilidadLiberacion));
  ok("el motivo cita el item 26 (decisión manual de Dirección)",
    /item 26/.test((fichaConOtroActivo.elegibilidadLiberacion || {}).motivo || ""),
    JSON.stringify(fichaConOtroActivo.elegibilidadLiberacion));
  ok("regresa cuál es el otro crédito activo", fichaConOtroActivo.elegibilidadLiberacion
    && fichaConOtroActivo.elegibilidadLiberacion.otroCreditoActivo
    && fichaConOtroActivo.elegibilidadLiberacion.otroCreditoActivo.producto === productoL2b,
    JSON.stringify(fichaConOtroActivo.elegibilidadLiberacion));

  console.log("\n— 7. Al cerrar TAMBIÉN el segundo crédito, el primero ya queda liberable —");
  const rBaja2b = await j(await fetch(U + "/api/clientes/baja", {
    method: "POST", headers: H(ca), body: JSON.stringify({ id: socioL2, producto: productoL2b, motivo: "Otro" }),
  }));
  ok("la baja del segundo crédito responde ok", rBaja2b.ok === true, JSON.stringify(rBaja2b));
  const fichaAmbosCerrados = await j(await fetch(U + "/api/garantias/ficha?id=" + socioL2 + "&producto=" + encodeURIComponent(productoL2a), { headers: H(ca) }));
  ok("ahora SÍ es liberable: ya no hay ningún otro crédito activo",
    fichaAmbosCerrados.elegibilidadLiberacion && fichaAmbosCerrados.elegibilidadLiberacion.liberable === true,
    JSON.stringify(fichaAmbosCerrados.elegibilidadLiberacion));

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
