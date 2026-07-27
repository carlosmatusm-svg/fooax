// SMOKE TEST FOOAX — verifica que "lo viejo" siga funcionando, de punta a punta.
//
// Diferencias con la batería (bateria_arqueo.js):
//   - RE-EJECUTABLE: no necesita datos limpios (usa una fecha única por corrida).
//   - Corre contra CUALQUIER ambiente, incluida PRODUCCIÓN, sin tocar datos
//     reales: todo pasa por la burbuja de prueba (prueba / pruebadir).
//   - Manda las capturas COMO TEXTO, igual que la app real (el bug del 27-jul
//     pasó 78 pruebas de la batería porque esta mandaba objetos).
//
// Uso:
//   node tests/smoke.js                                     (local, puerto 3899)
//   SMOKE_URL=https://fooax-production.up.railway.app node tests/smoke.js
//   SMOKE_PASS=... para la clave de las cuentas de prueba si cambió.
const U = process.env.SMOKE_URL || "http://localhost:3899";
const PASS = process.env.SMOKE_PASS || "PruebaFOOAX2026";
let PASS_N = 0, FAIL_N = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS_N++; console.log("  ✅ " + nombre); }
  else { FAIL_N++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

// Fecha ÚNICA por corrida (día distinto cada segundo): dos corridas no se pisan
// y la misma corrida es determinista. Siempre en el pasado lejano para no
// cruzarse con la semana en curso ni con capturas reales.
const SEG = Math.floor(Date.now() / 1000);
const FECHA = (() => { const d = new Date(Date.UTC(2018, 0, 1)); d.setUTCDate(d.getUTCDate() + (SEG % 3650)); return d.toISOString().slice(0, 10); })();
const RUN = String(SEG % 100000);   // sufijo único para folios/socios de esta corrida

(async () => {
  console.log("SMOKE FOOAX · " + U + " · fecha de prueba " + FECHA + " · corrida " + RUN);

  console.log("\n— A. SERVIDOR Y SESIONES —");
  const h = await j(await fetch(U + "/api/health"));
  ok("el servidor responde /api/health", h.ok === true, JSON.stringify(h).slice(0, 60));
  ok("con almacén que persiste (postgres) o archivos en local", !!h.almacen, "almacen " + h.almacen);
  const login = async (u) => {
    const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: PASS }) });
    return r.ok ? r.headers.get("set-cookie").split(";")[0] : null;
  };
  const ce = await login("prueba"), cd = await login("pruebadir");
  ok("entra la ejecutiva de prueba", !!ce);
  ok("entra la dirección de prueba", !!cd);
  if (!ce || !cd) { console.log("\nSin las cuentas de prueba no se puede seguir. ¿La clave cambió? Usa SMOKE_PASS."); process.exit(1); }
  const H = (c) => ({ "Content-Type": "application/json", Cookie: c });
  const me = await j(await fetch(U + "/api/me", { headers: H(ce) }));
  ok("/api/me da la fecha oficial del servidor", /^\d{4}-\d{2}-\d{2}$/.test(me.hoy || ""), "hoy " + me.hoy);

  console.log("\n— B. PÁGINAS Y PIEZAS DE LA APP —");
  ok("página de login carga", (await fetch(U + "/")).ok);
  const app = await fetch(U + "/app", { headers: { Cookie: ce } });
  const appHtml = app.ok ? await app.text() : "";
  ok("la app del ejecutivo carga con sus inyecciones (sync.js)", app.ok && appHtml.includes("sync.js"), "status " + app.status);
  ok("y con la captura ágil", appHtml.includes("captura-agil.js"));
  const tab = await fetch(U + "/tablero", { headers: { Cookie: cd } });
  const tabHtml = tab.ok ? await tab.text() : "";
  ok("el tablero de dirección carga", tab.ok && tabHtml.includes("Recuperar cobranza"), "status " + tab.status);
  for (const a of ["/sync.js", "/captura-agil.js", "/sw.js", "/manifest.json"])
    ok("pieza " + a + " servida", (await fetch(U + a)).ok);

  console.log("\n— C. CANDADOS DE ACCESO —");
  ok("sin sesión NO hay datos (401)", (await fetch(U + "/api/consolidado")).status === 401);
  const rc = await fetch(U + "/api/creditos?estado=vencidas", { headers: H(cd) });
  ok("créditos y saldos SOLO Anel y Monse (dirección de prueba: 403)", rc.status === 403, "status " + rc.status);

  console.log("\n— D. CAPTURA COMO LA APP REAL (snapshot en TEXTO) —");
  const sK = "smk" + RUN;             // socios únicos de esta corrida
  const fol = (n) => "SMK-" + RUN + "-" + n;
  const cap1 = { fecha: FECHA, reg: { "C-SMK": {} }, regI: {}, movs: [
    { folio: fol("01"), concepto: "RECUPERACION", monto: 39, via: "E", socio: "70000000090", clienta: "SMOKE TEST" },
    { folio: fol("02"), concepto: "RECUPERACION", monto: 77, via: "CH", cheque: "0099", socio: "70000000091", clienta: "SMOKE CHEQUE" },
  ], arqueo: { "100": 1, "50": 1 } };
  cap1.reg["C-SMK"][sK + "a|P"] = { pago: 111, forma: "E" };
  const sync = (snapObj) => fetch(U + "/api/sync", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: FECHA, snapshot: JSON.stringify(snapObj), ts: Date.now() }) });
  const cons = async () => { const c = await j(await fetch(U + "/api/consolidado?fecha=" + FECHA, { headers: H(cd) })); return (c.ejecutivos || {}).prueba || {}; };
  let r1 = await j(await sync(cap1));
  ok("el sync en texto se acepta", r1.ok === true, JSON.stringify(r1).slice(0, 70));
  let c1 = await cons();
  ok("la cobranza se registra ($111 efectivo)", Math.abs((c1.efectivo || 0) - 111) < 0.01, "efectivo " + c1.efectivo);
  const m1 = await j(await fetch(U + "/api/movimientos?fecha=" + FECHA, { headers: H(cd) }));
  ok("el movimiento se guarda EN VIVO y entra a los totales", (m1.lista || []).some((m) => m.folio.includes(fol("01")) && !m.anulado) && m1.entradas >= 39, "movs " + (m1.lista || []).length);
  const a1 = await j(await fetch(U + "/api/arqueo?fecha=" + FECHA, { headers: H(cd) }));
  const pe = (a1.porEjec || {}).prueba || {};
  ok("el arqueo por ejecutiva CUADRA (contó $150 = 111 + 39, dif $0)", pe.contado === 150 && pe.aEntregar === 150 && pe.dif === 0, "contó " + pe.contado + " · debe " + pe.aEntregar + " · dif " + pe.dif);
  const mch = (m1.lista || []).find((m) => m.folio.includes(fol("02"))) || {};
  ok("el CHEQUE se guarda como cheque y NO se exige en billetes", mch.metodo === "cheque" && mch.cheque === "0099" && pe.aEntregar === 150, "metodo " + mch.metodo + " · #" + mch.cheque);

  console.log("\n— E. BLINDAJES DEL DÍA —");
  const rv = await j(await sync({ fecha: FECHA, reg: {}, regI: {}, movs: [] }));
  ok("una captura VACÍA no pisa la cobranza (rechazada)", rv.rechazado === "vacio_sobre_lleno", JSON.stringify(rv).slice(0, 60));
  await fetch(U + "/api/cierre", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: FECHA, confirmado: true }) });
  ok("el cierre queda marcado", !!(await cons()).cierre);
  await sync(cap1);   // volvió a entrar y su app re-mandó LO MISMO
  ok("re-mandar la MISMA captura tras cerrar NO duplica", Math.abs((await cons()).efectivo - 111) < 0.01, "efectivo " + (await cons()).efectivo);
  const cap2 = JSON.parse(JSON.stringify(cap1)); cap2.reg["C-SMK"][sK + "b|P"] = { pago: 40, forma: "E" };
  await sync(cap2);
  ok("un pago NUEVO tras cerrar SÍ se suma (111 + 40)", Math.abs((await cons()).efectivo - 151) < 0.01, "efectivo " + (await cons()).efectivo);

  console.log("\n— F. EMPEZAR DE CERO Y RESCATE —");
  const ri = await j(await fetch(U + "/api/dia/reinicio", { method: "POST", headers: H(ce), body: JSON.stringify({ fecha: FECHA }) }));
  ok("'capturar todo de nuevo' responde", ri.ok === true && ri.habia === true, JSON.stringify(ri).slice(0, 50));
  const cap3 = JSON.parse(JSON.stringify(cap1));
  await sync(cap3);
  const c3 = await cons();
  ok("tras el reinicio el día cuenta desde cero ($111)", Math.abs(c3.efectivo - 111) < 0.01 && !c3.cierre, "efectivo " + c3.efectivo + " · cierre " + c3.cierre);
  const rec = await j(await fetch(U + "/api/recuperar?fecha=" + FECHA, { headers: H(cd) }));
  const epv = ((rec.ejecutivos || {}).prueba || {}).versiones || [];
  ok("la versión anterior ($151) sigue recuperable en 'Ver versiones'", epv.some((v) => Math.abs(v.cifras.total - 151) < 0.01), "versiones " + epv.length);

  console.log("\n— G. REPORTES DE DIRECCIÓN —");
  const sem = await j(await fetch(U + "/api/semana", { headers: H(cd) }));
  ok("la tarjeta de la semana responde", typeof sem.totalSemana === "number", JSON.stringify(sem).slice(0, 50));
  const x1 = await fetch(U + "/api/semana/excel", { headers: { Cookie: cd } });
  ok("el Excel de saldos de la semana se genera", x1.ok && (x1.headers.get("content-type") || "").includes("spreadsheet"), "status " + x1.status);
  const x2 = await fetch(U + "/api/arqueo/excel?fecha=" + FECHA, { headers: { Cookie: cd } });
  ok("el Excel del arqueo del día se genera", x2.ok && (x2.headers.get("content-type") || "").includes("spreadsheet"), "status " + x2.status);
  const cl = await j(await fetch(U + "/api/clientes?q=ma", { headers: H(cd) }));
  ok("el buscador de clientas responde", Array.isArray(cl.resultados), "total " + cl.total);
  const cen = await j(await fetch(U + "/api/centros", { headers: H(cd) }));
  ok("la lista de centros responde", Array.isArray(cen.centros) && cen.centros.length > 0, "centros " + (cen.centros || []).length);

  console.log("\n══════════════════════════════════");
  console.log(FAIL_N === 0 ? "✅✅ SMOKE OK: " + PASS_N + " verificaciones (" + U + ")" : "❌ FALLARON " + FAIL_N + " de " + (PASS_N + FAIL_N) + " (" + U + ")");
  process.exit(FAIL_N === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR del smoke:", e.message); process.exit(2); });
