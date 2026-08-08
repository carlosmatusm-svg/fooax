// REINICIO Y PERSISTENCIA — dos bugs reales, encontrados al construir el
// motor de reglas, que NINGUNA otra prueba puede atrapar porque todas corren
// dentro de una sola vida de servidor:
//   1) Los documentos y la bitácora nunca se releían a memoria en init() (ni
//      en modo archivo ni en Postgres) — tras un reinicio (incluye un
//      redeploy normal en Railway) el checklist "olvidaba" documentos ya
//      subidos y podía bloquear un expediente que en realidad ya estaba
//      completo.
//   2) El contador de ids (mem._seq) nunca se recalculaba tras cargar datos
//      existentes — el primer alta de cualquier tipo después de reiniciar
//      chocaba con un id ya usado; el INSERT a Postgres fallaba en silencio
//      (fire-and-forget) y la fila "desaparecía" en el SIGUIENTE reinicio.
//
// Esta prueba arranca el servidor DOS VECES sobre el MISMO DATA_DIR (modo
// archivo — el más rápido de reproducir aquí) para comprobar que ninguno de
// los dos bugs sigue presente. Administra su propio servidor y su propio
// puerto (3898): no interfiere con el resto de las pruebas (puerto 3899).
//
//   node tests/reinicio_persistencia.js
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

let PASS_N = 0, FAIL_N = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS_N++; console.log("  ✅ " + nombre); }
  else { FAIL_N++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

const RAIZ = path.join(__dirname, "..");
const PUERTO = 3898;
const U = "http://localhost:" + PUERTO;
const D = path.join(os.tmpdir(), "fooax-reinicio-" + Date.now());
const LLAVE = crypto.randomBytes(32).toString("base64");

function levantar() {
  return spawn("node", [path.join(RAIZ, "server.js")], {
    cwd: RAIZ,
    env: { ...process.env, DATA_DIR: D, PORT: String(PUERTO), DOC_ENCRYPTION_KEY: LLAVE, DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function esperarListo(intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try { const r = await fetch(U + "/api/health"); if (r.ok) return true; } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}
function matar(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once("exit", resolve);
    proc.kill("SIGTERM");
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} resolve(); }, 3000);
  });
}
const login = async (u) => {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: "PruebaFOOAX2026" }) });
  return r.ok ? r.headers.get("set-cookie").split(";")[0] : null;
};

(async () => {
  console.log("REINICIO Y PERSISTENCIA · DATA_DIR=" + D);
  fs.mkdirSync(D, { recursive: true });
  let proc;

  try {
    console.log("\n— PRIMER ARRANQUE —");
    proc = levantar();
    ok("el servidor arranca (1er intento)", await esperarListo());

    let cEje = await login("prueba");
    let cDir = await login("pruebadir");
    ok("entra la ejecutiva de prueba (1er arranque)", !!cEje);
    if (!cEje || !cDir) throw new Error("no se pudo iniciar sesión en el primer arranque");

    const cid = "REINICIO-" + Date.now();
    const b64 = Buffer.from("contenido de prueba de reinicio").toString("base64");
    const rDoc = await j(await fetch(U + "/api/expediente/" + cid + "/documento", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cEje }, body: JSON.stringify({ tipo: "ine", propietario: "solicitante", contenido_base64: b64 }) }));
    ok("se sube un documento antes de reiniciar", rDoc.ok === true, JSON.stringify(rDoc).slice(0, 120));

    const rReglaAntes = await j(await fetch(U + "/api/reglas", { headers: { Cookie: cDir } }));
    const topeAntes = (rReglaAntes.reglas || []).find((r) => r.clave === "tope_responsable");
    ok("hay una regla vigente de tope_responsable antes de reiniciar", !!topeAntes, JSON.stringify(rReglaAntes).slice(0, 150));

    const rBitAntes = await j(await fetch(U + "/api/bitacora?limite=500", { headers: { Cookie: cDir } }));
    const eventosAntes = (rBitAntes.eventos || []).length;
    ok("la bitácora tiene al menos un evento antes de reiniciar", eventosAntes > 0, "eventos " + eventosAntes);

    console.log("\n— SE REINICIA EL SERVIDOR (mismo DATA_DIR) —");
    await matar(proc);
    proc = levantar();
    ok("el servidor arranca de nuevo (2° intento, mismo DATA_DIR)", await esperarListo());

    cEje = await login("prueba");
    cDir = await login("pruebadir");
    ok("entra la ejecutiva de prueba (2° arranque)", !!cEje);

    console.log("\n— BUG 1: el documento subido ANTES de reiniciar sigue en el checklist —");
    const rDetalle = await j(await fetch(U + "/api/expediente/" + cid, { headers: { Cookie: cEje } }));
    ok("el documento subido antes del reinicio SIGUE apareciendo (antes desaparecía)",
      Array.isArray(rDetalle.documentos) && rDetalle.documentos.some((d) => d.tipo === "ine" && d.propietario === "solicitante"),
      JSON.stringify(rDetalle.documentos));

    console.log("\n— BUG 1b: la bitácora de antes del reinicio sigue completa —");
    const rBitDespues = await j(await fetch(U + "/api/bitacora?limite=500", { headers: { Cookie: cDir } }));
    ok("la bitácora tiene AL MENOS los mismos eventos que antes de reiniciar (antes se perdían todos)",
      (rBitDespues.eventos || []).length >= eventosAntes, "antes " + eventosAntes + " · después " + (rBitDespues.eventos || []).length);

    console.log("\n— BUG 2: el primer alta tras reiniciar no choca con un id ya usado —");
    const rDoc2 = await j(await fetch(U + "/api/expediente/" + cid + "/documento", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cEje }, body: JSON.stringify({ tipo: "curp", propietario: "solicitante", contenido_base64: b64 }) }));
    ok("se puede subir un documento NUEVO justo después de reiniciar", rDoc2.ok === true, JSON.stringify(rDoc2).slice(0, 120));
    const rDetalle2 = await j(await fetch(U + "/api/expediente/" + cid, { headers: { Cookie: cEje } }));
    ok("el documento nuevo aparece junto con el de antes del reinicio (no se perdió por un choque de id)",
      Array.isArray(rDetalle2.documentos) && rDetalle2.documentos.length === 2, JSON.stringify(rDetalle2.documentos));

    console.log("\n— BUG 2b: las reglas del motor sobreviven el reinicio, sin duplicarse ni re-sembrarse —");
    const rReglaDespues = await j(await fetch(U + "/api/reglas", { headers: { Cookie: cDir } }));
    const topeDespues = (rReglaDespues.reglas || []).find((r) => r.clave === "tope_responsable");
    ok("sigue habiendo EXACTAMENTE una regla vigente de tope_responsable, la MISMA (mismo id y versión)",
      !!topeDespues && topeDespues.version === topeAntes.version && topeDespues.id === topeAntes.id,
      JSON.stringify({ antes: topeAntes, despues: topeDespues }));
  } catch (e) {
    console.error("Error durante la prueba de reinicio:", e.message);
    FAIL_N++;
  } finally {
    await matar(proc);
    try { fs.rmSync(D, { recursive: true, force: true }); } catch {}
  }

  console.log("\n— RESULTADO —");
  console.log(`  ${PASS_N} pruebas OK, ${FAIL_N} fallidas.`);
  process.exit(FAIL_N > 0 ? 1 : 0);
})();
