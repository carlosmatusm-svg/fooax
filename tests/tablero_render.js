// EL TABLERO DE VERDAD ABRE Y NO SE QUEDA EN "Cargando…".
// La batería prueba las rutas del servidor, no la pantalla. El 6-ago el cierre
// de caja se quedó cargando para siempre porque una variable de un script de
// edición se coló dentro del JavaScript ("flecha is not defined"): el servidor
// respondía perfecto y la tarjeta nunca se pintaba. Ninguna prueba lo vio.
//
// Esto revisa lo mínimo que ninguna prueba de API puede ver:
//   1. que el JavaScript del tablero compile,
//   2. que no haya quedado suelta una variable de los scripts de edición,
//   3. que cada función que pinta una tarjeta exista de verdad.
//
//   node tests/tablero_render.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const RUTA = path.join(__dirname, "..", "vistas", "tablero.html");
let PASA = 0, FALLA = 0;
const ok = (t, c, d) => { if (c) { PASA++; console.log("  ✅ " + t); }
  else { FALLA++; console.log("  ❌ " + t + (d ? "\n       → " + d : "")); } };

const html = fs.readFileSync(RUTA, "utf8");
const js = (html.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((s) => s.replace(/^<script>/, "").replace(/<\/script>$/, "")).join("\n");

console.log("\n═══ EL TABLERO ABRE ═══\n");
let compila = true, err = "";
try { new vm.Script(js); } catch (e) { compila = false; err = e.message; }
ok("el JavaScript del tablero compila", compila, err);

// Variables USADAS pero nunca DECLARADAS: así se cuela un nombre de los scripts
// con que edito el archivo, y la tarjeta que lo usa truena en silencio al abrir.
// Se ignoran las globales del navegador y las que el propio tablero declara.
const globales = new Set(["window","document","location","localStorage","navigator","fetch",
  "console","JSON","Math","Date","Number","String","Object","Array","Boolean","Set","Map",
  "setTimeout","setInterval","clearTimeout","clearInterval","alert","confirm","prompt",
  "encodeURIComponent","decodeURIComponent","isNaN","parseInt","parseFloat","Intl","Promise",
  "Error","RegExp","URL","Blob","FormData","Event","undefined","NaN","Infinity","this","arguments"]);
const declaradas = new Set([
  // `let a = "", b = 0, c = []` declara TRES: hay que leer toda la lista.
  ...[...js.matchAll(/(?:const|let|var)\s+([^;\n]+)/g)].flatMap((m) =>
      m[1].split(",").map((x) => x.trim().split(/[=\s([{]/)[0]).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x))),
  ...[...js.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  // Parámetros: de funciones con nombre, anónimas y de flecha.
  ...[...js.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)].flatMap((m) =>
      m[1].split(",").map((x) => x.trim().split(/[=\s]/)[0]).filter(Boolean)),
  ...[...js.matchAll(/\(([^()]*)\)\s*=>/g)].flatMap((m) =>
      m[1].split(",").map((x) => x.trim().split(/[=\s]/)[0]).filter(Boolean)),
  ...[...js.matchAll(/([\w$]+)\s*=>/g)].map((m) => m[1]),
  ...[...js.matchAll(/(?:for\s*\(\s*(?:const|let|var)\s+([\w$]+)|catch\s*\(\s*([\w$]+))/g)]
      .flatMap((m) => [m[1], m[2]]).filter(Boolean),
  ...[...js.matchAll(/\{\s*([\w$,\s:]+?)\s*\}\s*=/g)].flatMap((m) =>
      m[1].split(",").map((x) => x.split(":").pop().trim()).filter(Boolean)),
]);
// Solo se miran las concatenaciones de HTML, que es donde se cuelan.
const usadas = [...new Set([...js.matchAll(/\+\s*([a-z][\w$]*)\s*(?:\+|;)/g)].map((m) => m[1]))];
const sueltas = usadas.filter((v) => !globales.has(v) && !declaradas.has(v));
ok("no quedó ninguna variable sin declarar", !sueltas.length, sueltas.join(", "));

// Cada tarjeta que se pinta necesita su función. Si el nombre no existe, la
// tarjeta se queda con su "Cargando…" para siempre.
const llamadas = [...js.matchAll(/\b(cargar[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
const definidas = new Set([...js.matchAll(/function\s+(cargar[A-Z]\w*)\s*\(/g)].map((m) => m[1]));
const faltan = [...new Set(llamadas)].filter((f) => !definidas.has(f));
ok("todas las funciones que pintan tarjetas existen", !faltan.length, faltan.join(", "));

// Ninguna tarjeta debe quedarse con el texto de espera puesto a mano y sin
// función que lo reemplace.
const cargando = [...html.matchAll(/id="(\w+)"[^>]*>\s*<div class="rechint">Cargando…/g)].map((m) => m[1]);
const sinPintor = cargando.filter((id) => !new RegExp('\\$\\("' + id + '"\\)').test(js));
ok("cada 'Cargando…' tiene quien lo reemplace", !sinPintor.length, sinPintor.join(", "));

// LAS APPS DE CAMPO: que su JavaScript compile y que la pregunta de después de
// cerrar no dependa de un registro VACÍO. El 7-ago Julio cerró, volvió a entrar
// y no le salía la opción de agregar: varias funciones re-crean el registro del
// día vacío al abrir, y con eso la pregunta se callaba para siempre.
console.log("\n═══ LAS APPS DE CAMPO ═══\n");
const apps = fs.readdirSync(path.join(__dirname, "..", "apps"))
  .filter((f) => /^App_Cobranza_.*\.html$/.test(f) && !f.includes(".bak"));
ok("se encontraron las apps", apps.length >= 4, apps.length + " archivos");
for (const a of apps) {
  const h = fs.readFileSync(path.join(__dirname, "..", "apps", a), "utf8");
  const jsa = (h.match(/<script>([\s\S]*?)<\/script>/g) || [])
    .map((x) => x.replace(/^<script>/, "").replace(/<\/script>$/, "")).join("\n");
  let c = true, e2 = "";
  try { new vm.Script(jsa); } catch (er) { c = false; e2 = er.message; }
  const nom = a.replace("App_Cobranza_", "").replace(".html", "");
  ok(nom + ": su JavaScript compila", c, e2);
  if (/function preguntarPostCierre\(\)/.test(jsa)) {
    ok(nom + ": la pregunta de después de cerrar no se calla por un registro vacío",
      !/if\(localStorage\.getItem\(STORE_KEY\)\)return;/.test(jsa),
      "vuelve a depender de que el registro no exista");
  }
  // Un gasto de ruta no es de ninguna clienta (Ing. Monse, 6-ago).
  if (/function toggleGasto\(\)/.test(jsa)) {
    ok(nom + ": en un gasto se esconden centro y clienta",
      /movQuienBox/.test(jsa), "no esconde el bloque");
  }
  ok(nom + ": no dice 'ahorro' en ningún lado", !/ahorro/i.test(h), "aparece la palabra");
}

// LOS SCRIPTS QUE SE LE INYECTAN A LA APP. Viven fuera del HTML, así que las
// pruebas de las apps no los tocaban: un error de sintaxis aquí deja el
// teléfono con los montos viejos y nadie se entera (el servidor contesta 200).
console.log("\n═══ LO QUE SE LE INYECTA A LA APP ═══\n");
for (const f of ["sync.js", "captura-agil.js", "vivos.js"]) {
  const ruta = path.join(__dirname, "..", "public", f);
  if (!fs.existsSync(ruta)) { ok(f + ": existe", false, "no está en public/"); continue; }
  const src = fs.readFileSync(ruta, "utf8");
  let compila = true, err = "";
  try { new Function(src); } catch (e) { compila = false; err = e.message; }
  ok(f + ": compila", compila, err);
}
// vivos.js es el que mantiene el teléfono al día: si deja de pedir /api/vivos
// o de aplicar el primer paquete, todo vuelve a quedarse congelado.
{
  const v = fs.readFileSync(path.join(__dirname, "..", "public", "vivos.js"), "utf8");
  ok("vivos.js sigue pidiendo /api/vivos", /\/api\/vivos/.test(v), "ya no lo pide");
  ok("vivos.js aplica el primer paquete del HTML", /__VIVOS0/.test(v), "ya no lee __VIVOS0");
  ok("vivos.js vuelve a preguntar solo (setInterval)", /setInterval\(/.test(v), "sin sondeo");
  ok("vivos.js no pisa el plazo que capturó la ejecutiva",
    /!d\.plazo/.test(v), "podría estar sobrescribiéndolo");
}

console.log("\n══════════════════════════════════");
console.log(FALLA === 0 ? "✅✅ TODO PASÓ: " + PASA + " verificaciones" : "❌ FALLARON " + FALLA + " de " + (PASA + FALLA));
process.exit(FALLA === 0 ? 0 : 1);
