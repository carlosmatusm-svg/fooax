// CU-016 · BITÁCORA INMUTABLE DE RIESGO Y PEP (Regla R11.4, Anexo F) — pruebas.
// Corre igual que garantia_liquida.js: servidor local (3899) con DATA_DIR
// desechable (nunca contra data/ real — la bitácora se escribe de verdad).
//
//   D=/tmp/fooax-prueba-riesgo; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
//   cp data/padron_corte.json $D/ 2>/dev/null || true
//   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
//   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
//   DATA_DIR=$D PORT=3899 node server.js &
//   node tests/riesgo_bitacora.js
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

(async () => {
  // Cuentas REALES en DATA_DIR desechable: la burbuja de prueba no tiene
  // clientas en el padrón, y este dominio exige que la clienta exista.
  const cAnel = await login("anel", "anel2026");
  const cMonse = await login("monse", "monse2026");
  const cKarina = await login("karina", "karina2026");
  const cPruebaDir = await login("pruebadir", "PruebaFOOAX2026");
  if (!cAnel || !cMonse || !cKarina) { console.log("No pude entrar con las cuentas locales."); process.exit(1); }

  // Una clienta real del padrón (la primera de Neri), leída del mismo
  // archivo que carga el servidor.
  const fs = require("fs"), path = require("path");
  const pad = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR_PRUEBA || path.join(__dirname, "..", "data"), "padron.json"), "utf8"));
  const socio = String(pad.find((c) => c.ejecutivo === "Neri").id);
  console.log("Clienta de prueba: socio " + socio);

  console.log("\n— 1. CATÁLOGOS CERRADOS —");
  let r = await fetch(U + "/api/riesgo/catalogos", { headers: H(cMonse) });
  let d = await j(r);
  ok("dirección/admin lee los catálogos", r.status === 200 && Array.isArray(d.nivelesRiesgo));
  ok("niveles Bajo/Medio/Alto (mockup Directorio, CU-016 §3)", JSON.stringify(d.nivelesRiesgo) === JSON.stringify(["Bajo", "Medio", "Alto"]));
  ok("PEP con tipo y parentesco de catálogo (Art. 95 Bis LGOAAC)", d.pepTipos.length === 3 && d.pepParentescos.length === 6);
  ok("los pendientes de Dirección viajan como datos, no como texto del front", Array.isArray(d.pendientes) && d.pendientes.length === 3);
  r = await fetch(U + "/api/riesgo/catalogos", { headers: H(cKarina) });
  ok("una ejecutiva NO ve riesgo (403)", r.status === 403);

  console.log("\n— 2. ESTADO INICIAL: el espacio existe, el dato no (R11.4) —");
  r = await fetch(U + "/api/riesgo/" + socio, { headers: H(cAnel) });
  d = await j(r);
  ok("el perfil de una clienta sin cambios se lee", r.status === 200 && d.perfil, JSON.stringify(d));
  ok("nivel de riesgo y PEP nacen null (sin clasificar), no inventados", d.perfil.nivelRiesgo === null && d.perfil.pep === null);
  ok("historial vacío", Array.isArray(d.historial) && d.historial.length === 0);
  ok("Anel (dirección) SÍ puede cambiar", d.puedesCambiar === true);
  r = await fetch(U + "/api/riesgo/" + socio, { headers: H(cMonse) });
  d = await j(r);
  ok("Monse (admin) lee pero NO puede cambiar (RIESGO_ROLES_PUEDEN_CAMBIAR=direccion)", r.status === 200 && d.puedesCambiar === false);
  r = await fetch(U + "/api/riesgo/00000000001", { headers: H(cAnel) });
  ok("una clienta que no existe da 404", r.status === 404);
  r = await fetch(U + "/api/riesgo/" + socio, { headers: H(cPruebaDir) });
  ok("la dirección de PRUEBA no ve una clienta real (burbuja)", r.status === 404);

  console.log("\n— 3. CANDADOS DEL CAMBIO —");
  r = await post("/api/riesgo/cambiar", { socio, campo: "nivelRiesgo", valor: "Alto", motivo: "Sin permiso" }, cMonse);
  d = await j(r);
  ok("admin sin can_change_risk: 403", r.status === 403, JSON.stringify(d));
  r = await post("/api/riesgo/cambiar", { socio, campo: "nivelRiesgo", valor: "Alto" }, cAnel);
  d = await j(r);
  ok("sin justificación se rechaza (400)", r.status === 400 && /justificaci/i.test(d.error), JSON.stringify(d));
  r = await post("/api/riesgo/cambiar", { socio, campo: "nivelRiesgo", valor: "Altísimo", motivo: "Fuera de catálogo" }, cAnel);
  d = await j(r);
  ok("un nivel fuera del catálogo se rechaza", r.status === 400 && /Bajo, Medio, Alto/.test(d.error), JSON.stringify(d));
  r = await post("/api/riesgo/cambiar", { socio, campo: "color", valor: "Rojo", motivo: "Campo inventado" }, cAnel);
  ok("un campo que no es nivelRiesgo/pep se rechaza", r.status === 400);
  r = await post("/api/riesgo/cambiar", { socio, campo: "pep", valor: { es: true, tipo: "Nacional" }, motivo: "Falta parentesco" }, cAnel);
  d = await j(r);
  ok("PEP=Sí sin parentesco de catálogo se rechaza", r.status === 400 && /parentesco/i.test(d.error), JSON.stringify(d));
  r = await post("/api/riesgo/cambiar", { socio: "00000000001", campo: "nivelRiesgo", valor: "Alto", motivo: "No existe la clienta" }, cAnel);
  ok("clienta inexistente: 400", r.status === 400);

  console.log("\n— 4. EL CAMBIO DEJA RASTRO ANTES DE EXISTIR —");
  r = await post("/api/riesgo/cambiar", { socio, campo: "nivelRiesgo", valor: "alto", motivo: "Revisión de Cumplimiento: acumulación en 6 meses cerca del umbral" }, cAnel);
  d = await j(r);
  ok("Anel cambia el nivel a Alto (acepta minúsculas, guarda el valor de catálogo)", r.status === 200 && d.ok && d.perfil.nivelRiesgo === "Alto", JSON.stringify(d));
  ok("la fila trae usuario, fecha/hora ISO, campo, anterior (null), nuevo, justificación",
    d.cambio && d.cambio.usuarioId === "anel" && /^\d{4}-\d{2}-\d{2}T/.test(d.cambio.fechaHora) && d.cambio.campo === "nivelRiesgo"
      && d.cambio.valorAnterior === null && d.cambio.valorNuevo === "Alto" && /Cumplimiento/.test(d.cambio.justificacion), JSON.stringify(d.cambio));
  r = await post("/api/riesgo/cambiar", { socio, campo: "nivelRiesgo", valor: "Alto", motivo: "Mismo valor otra vez" }, cAnel);
  ok("cambiar al MISMO valor no genera fila (400)", r.status === 400);
  r = await post("/api/riesgo/cambiar", { socio, campo: "pep", valor: { es: true, tipo: "nacional", parentesco: "Hijo(a)", cargo: "Regidor", dependencia: "Municipio", periodo: "2024-2027" }, motivo: "Declarado en la solicitud de crédito" }, cAnel);
  d = await j(r);
  ok("marcar PEP=Sí con tipo y parentesco de catálogo", r.status === 200 && d.perfil.pep && d.perfil.pep.es === true && d.perfil.pep.tipo === "Nacional" && d.perfil.pep.parentesco === "Hijo(a)", JSON.stringify(d));
  r = await post("/api/riesgo/cambiar", { socio, campo: "nivelRiesgo", valor: "Medio", motivo: "Segunda revisión: bajó la acumulación" }, cAnel);
  d = await j(r);
  ok("segundo cambio de nivel: anterior=Alto, nuevo=Medio", r.status === 200 && d.cambio.valorAnterior === "Alto" && d.cambio.valorNuevo === "Medio");

  console.log("\n— 5. HISTORIAL COMPLETO, SOLO-AGREGADO —");
  r = await fetch(U + "/api/riesgo/" + socio, { headers: H(cMonse) });
  d = await j(r);
  ok("Cumplimiento (admin) consulta el historial completo: 3 filas", d.historial.length === 3, JSON.stringify(d.historial.map((f) => f.campo)));
  ok("el perfil vigente se deriva de la última fila por campo (Medio + PEP Sí)", d.perfil.nivelRiesgo === "Medio" && d.perfil.pep.es === true && d.perfil.cambios === 3);
  ok("el orden del historial es el de llegada (nivel, pep, nivel)", d.historial[0].campo === "nivelRiesgo" && d.historial[1].campo === "pep" && d.historial[2].campo === "nivelRiesgo");
  ok("no existe ninguna ruta para editar o borrar una fila", (await fetch(U + "/api/riesgo/borrar", { method: "POST", headers: H(cAnel), body: "{}" })).status === 404);

  console.log("\n— 6. EL RASTRO SOBREVIVE EN DISCO (append-only) —");
  const dir = process.env.DATA_DIR_PRUEBA || null;
  if (dir) {
    const filas = JSON.parse(fs.readFileSync(path.join(dir, "registro_riesgo_bitacora.json"), "utf8"));
    ok("data/registro_riesgo_bitacora.json trae las 3 filas", filas.filter((f) => String(f.socio) === socio).length === 3);
    const cambios = JSON.parse(fs.readFileSync(path.join(dir, "padron_cambios.json"), "utf8"));
    ok("la bitácora general del padrón trae el evento espejo tipo 'riesgo' (CU-016 §8)", cambios.filter((c) => c.tipo === "riesgo" && String(c.id) === socio).length === 3);
  } else console.log("  (DATA_DIR_PRUEBA no definido: se omite la verificación en disco)");

  console.log("\n" + PASS + " pasaron, " + FAIL + " fallaron.");
  process.exit(FAIL > 0 ? 1 : 0);
})();
