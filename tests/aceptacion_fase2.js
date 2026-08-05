// PRUEBA DE ACEPTACIÓN DE LA FASE 2 — ensayo interno contra DATOS REALES.
//
// Corre las mismas comprobaciones que va a hacer Monse, pero antes y en privado,
// para que nada truene enfrente de ella. NO modifica nada: solo lee.
//
// Las credenciales las pones TÚ por variable de entorno; no se guardan en ningún
// lado ni viajan a ningún archivo:
//
//   FOOAX_USER=tu_usuario FOOAX_PASS='tu_clave' node tests/aceptacion_fase2.js
//   FOOAX_URL=https://fooax-production.up.railway.app FOOAX_USER=... node tests/aceptacion_fase2.js
//
// Por omisión pega contra producción.
const U = process.env.FOOAX_URL || "https://fooax-production.up.railway.app";
const USER = process.env.FOOAX_USER, PASS = process.env.FOOAX_PASS;
if (!USER || !PASS) {
  console.error("\nFalta la sesión. Corre así:\n  FOOAX_USER=tu_usuario FOOAX_PASS='tu_clave' node tests/aceptacion_fase2.js\n");
  process.exit(2);
}
let PASA = 0, FALLA = 0, AVISO = 0;
const ok = (t, cond, det) => {
  if (cond) { PASA++; console.log("  ✅ " + t); }
  else { FALLA++; console.log("  ❌ " + t + (det ? "\n       → " + det : "")); }
};
const nota = (t) => { AVISO++; console.log("  ⚠️  " + t); };
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const mx = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cerca = (a, b, tol) => Math.abs(Number(a || 0) - Number(b || 0)) <= (tol == null ? 0.02 : tol);

(async () => {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: USER, password: PASS }) });
  const ck = (r.headers.get("set-cookie") || "").split(";")[0];
  if (!ck) { console.error("\nNo entró: revisa usuario y contraseña.\n"); process.exit(2); }
  const H = { Cookie: ck };
  const yo = await j(await fetch(U + "/api/me", { headers: H }));
  console.log("\n═══ PRUEBA DE ACEPTACIÓN · FASE 2 ═══");
  console.log("Servidor: " + U);
  console.log("Sesión:   " + (yo.nombre || USER) + " · " + (yo.rol || "?") + " · hoy " + (yo.hoy || "?"));
  if (yo.test) nota("Estás en la BURBUJA DE PRUEBA: los números no son los reales. Entra con una cuenta real para el ensayo de verdad.");

  const c = await j(await fetch(U + "/api/cartera", { headers: H }));
  if (!c || c.cartera == null) { console.error("\nNo se pudo leer la cartera (¿tu usuario tiene permiso de dirección?).\n"); process.exit(2); }

  // ── 1. Lo que la Fase 2 se comprometió a entregar ──────────────────────────
  console.log("\n— 1. ENTREGABLES DEL CONTRATO —");
  ok("Cartera total", c.cartera > 0, "cartera " + mx(c.cartera));
  ok("Saldo promedio por crédito", c.saldoPromedio > 0, "promedio " + mx(c.saldoPromedio));
  ok("% de mora sobre cartera", c.moraPorcentaje != null, "mora " + mx(c.moraMonto) + " = " + c.moraPorcentaje + "%");
  ok("Mora de la semana vs recuperación", c.moraSemana != null && c.recuperacionSemana != null,
    "mora " + mx(c.moraSemana) + " · recuperación " + mx(c.recuperacionSemana));
  ok("Semáforo con sus cinco estados", c.semaforo && ["alCorriente", "parcial", "pendiente", "vencida", "liquidada"].every((k) => k in c.semaforo),
    JSON.stringify(c.semaforo));
  ok("Desglose por ejecutiva", Array.isArray(c.porEjec) && c.porEjec.length > 0, (c.porEjec || []).length + " ejecutivas");
  const t = await j(await fetch(U + "/api/tendencias", { headers: H }));
  ok("Tablero de tendencias con su serie semanal", Array.isArray(t.serie) && t.serie.length > 0,
    (t.serie || []).length + " semanas");

  // ── 2. Que los números CUADREN entre sí ────────────────────────────────────
  console.log("\n— 2. LOS NÚMEROS CUADRAN ENTRE SÍ —");
  const S = c.semaforo || {};
  const sumaSem = Object.values(S).reduce((a, b) => a + b, 0);
  ok("El semáforo suma exactamente los créditos activos",
    sumaSem === c.creditosActivos, "semáforo " + sumaSem + " vs activos " + c.creditosActivos);
  ok("Saldo promedio = cartera ÷ créditos con saldo",
    cerca(c.saldoPromedio, c.cartera / (c.conSaldo || 1), 1),
    mx(c.saldoPromedio) + " vs " + mx(c.cartera / (c.conSaldo || 1)));
  if (c.esperadoALaFecha != null) {
    ok("Lo esperado a la fecha no pasa de lo esperado de la semana",
      c.esperadoALaFecha <= c.esperadoSemana + 0.02,
      mx(c.esperadoALaFecha) + " vs " + mx(c.esperadoSemana));
    ok("La mora real no pasa de lo esperado a la fecha",
      (c.moraSemana || 0) <= c.esperadoALaFecha + 0.02,
      "mora " + mx(c.moraSemana) + " vs esperado a la fecha " + mx(c.esperadoALaFecha));
    ok("Mora + cobrado no pasan de lo esperado a la fecha",
      (c.moraSemana || 0) + (c.cobradoSemana || 0) <= c.esperadoALaFecha + 0.02,
      mx((c.moraSemana || 0) + (c.cobradoSemana || 0)) + " vs " + mx(c.esperadoALaFecha));
  }
  const sumaEjec = (c.porEjec || []).reduce((a, e) => a + (e.cartera || 0), 0);
  ok("La cartera por ejecutiva suma la cartera total",
    cerca(sumaEjec, c.cartera, 1), mx(sumaEjec) + " vs " + mx(c.cartera));
  const cobEjec = (c.porEjec || []).reduce((a, e) => a + (e.cobrado || 0), 0);
  ok("La cobranza por ejecutiva suma la cobranza total",
    cerca(cobEjec, c.cobradoSemana, 1), mx(cobEjec) + " vs " + mx(c.cobradoSemana));

  // ── 3. El tablero contra el arqueo del día ─────────────────────────────────
  console.log("\n— 3. EL TABLERO CONTRA EL ARQUEO —");
  const a = await j(await fetch(U + "/api/arqueo", { headers: H }));
  ok("El arqueo del día responde", a && a.efectivo != null, "efectivo " + mx(a.efectivo));
  if (a && a.efectivo != null) {
    const aEntregar = a.efectivoAEntregar != null ? a.efectivoAEntregar : (a.efectivo - (a.egresosEfectivo || 0));
    ok("Efectivo a entregar = cobranza − salidas de caja",
      cerca(aEntregar, a.efectivo - (a.egresosEfectivo || 0)),
      mx(aEntregar) + " = " + mx(a.efectivo) + " − " + mx(a.egresosEfectivo));
    const dif = Object.values(a.porEjec || {}).reduce((s, e) => s + Math.abs(e.dif || 0), 0);
    if (dif > 0.02) nota("Hay " + mx(dif) + " de diferencia de caja hoy. Revísalo ANTES de la prueba: Monse lo va a ver.");
    else ok("Ninguna ejecutiva trae diferencia de caja hoy", true);
  }

  // ── 4. Los reportes se generan ─────────────────────────────────────────────
  console.log("\n— 4. LOS REPORTES SE BAJAN —");
  for (const [nom, url] of [["Excel de saldos", "/api/semana/excel"], ["Excel de arqueo", "/api/arqueo/excel"]]) {
    const x = await fetch(U + url, { headers: H });
    ok(nom + " se genera", x.status === 200 && /spreadsheet/.test(x.headers.get("content-type") || ""),
      x.status + " " + x.headers.get("content-type"));
  }

  // ── 5. Lo que Monse va a preguntar ─────────────────────────────────────────
  console.log("\n— 5. LO QUE MONSE VA A PREGUNTAR —");
  const inc = (c.inconsistentes || []).length;
  if (inc) nota(inc + " créditos con el plazo mal capturado: a esos el nº de pago sale vacío. Si cae uno en la muestra, la prueba se cae por falta de dato.");
  else ok("Ningún crédito con el plazo mal capturado", true);
  const pv = (c.plazoVencido || []).length;
  if (pv) nota(pv + " créditos con el plazo YA VENCIDO y saldo pendiente (" + mx((c.plazoVencido || []).reduce((s, x) => s + x.saldo, 0)) + "). Es cartera que se pasó de su fecha: Monse va a preguntar por ellos.");
  else ok("Ningún crédito se pasó de su plazo con saldo pendiente", true);
  const sc = (c.liquidacionesSinClienta || []).length;
  if (sc) nota(sc + " liquidaciones sin clienta (" + mx((c.liquidacionesSinClienta || []).reduce((s, x) => s + x.monto, 0)) + "): ese dinero no le bajó el saldo a nadie.");
  else ok("Ninguna liquidación quedó sin clienta", true);
  if (c.definicionMoraPendiente) nota("El tablero sigue marcando la definición de mora como PROVISIONAL. Si ya llegó el dictado, hay que quitar esa marca antes de la prueba.");

  // ── 6. La muestra de 10 clientas ───────────────────────────────────────────
  console.log("\n— 6. MUESTRA PARA REVISAR A MANO —");
  console.log("  Estas son 10 clientas al azar CON SALDO. Compara cada una contra el papel:");
  console.log("  su cuota, si pagó esta semana y cuánto debe.\n");
  const cl = await j(await fetch(U + "/api/creditos?q=", { headers: H }));
  let muestra = (cl.resultados || []).filter((x) => (x.saldoActual || 0) > 0);
  if (!muestra.length) {
    nota("No se pudo traer la lista de créditos con este usuario (la muestra la saca Anel o Monse).");
  } else {
    muestra = muestra.sort(() => 0.5 - Math.random()).slice(0, 10);
    console.log("   " + "CLIENTA".padEnd(32) + "PRODUCTO".padEnd(20) + "CUOTA".padStart(10) + "DEBE".padStart(12) + "  Nº PAGO");
    console.log("   " + "-".repeat(84));
    for (const x of muestra) {
      const np = x.pago != null && x.plazo ? (x.pago + " de " + x.plazo) : "—";
      console.log("   " + String(x.nombre).slice(0, 30).padEnd(32) + String(x.producto).slice(0, 18).padEnd(20)
        + mx(x.cuota).padStart(10) + mx(x.saldoActual).padStart(12) + "  " + np);
    }
  }

  console.log("\n══════════════════════════════════");
  console.log((FALLA === 0 ? "✅ LISTA PARA LA PRUEBA: " : "❌ NO ESTÁ LISTA — ") + PASA + " comprobaciones bien"
    + (FALLA ? ", " + FALLA + " mal" : "") + (AVISO ? ", " + AVISO + " que revisar" : ""));
  if (AVISO) console.log("   Los ⚠️ no tumban la prueba, pero Monse los va a ver. Mejor resolverlos antes.");
  console.log("");
  process.exit(FALLA === 0 ? 0 : 1);
})().catch((e) => { console.error("\nERROR: " + e.message + "\n"); process.exit(2); });
