// LA PANTALLA DE EXPEDIENTE ABRE Y NO SE QUEDA COLGADA — mismo espíritu que
// tablero_render.js: revisa lo que ninguna prueba de API puede ver, antes de
// levantar un servidor. No necesita servidor ni red.
//
//   node tests/expediente_render.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
let PASA = 0, FALLA = 0;
const ok = (t, c, d) => { if (c) { PASA++; console.log("  ✅ " + t); }
  else { FALLA++; console.log("  ❌ " + t + (d ? "\n       → " + d : "")); } };

console.log("\n═══ LA PANTALLA DE EXPEDIENTE ABRE ═══\n");

const RUTA = path.join(__dirname, "..", "apps", "App_Expediente_Originacion.html");
ok("el archivo existe", fs.existsSync(RUTA), RUTA);
if (!fs.existsSync(RUTA)) { console.log("\n❌ No se puede seguir sin el archivo."); process.exit(1); }
const html = fs.readFileSync(RUTA, "utf8");

const js = (html.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((s) => s.replace(/^<script>/, "").replace(/<\/script>$/, "")).join("\n");
ok("se encontró JavaScript embebido", js.length > 200, "largo " + js.length);

let compila = true, err = "";
try { new vm.Script(js); } catch (e) { compila = false; err = e.message; }
ok("el JavaScript de la pantalla compila", compila, err);

// No debe ser type="module": si alguien lo cambia, un navegador viejo sin
// soporte de módulos deja de cargar la pantalla entera en vez de degradar.
ok("el script sigue siendo clásico (no type=module)", !/<script\s+type=["']module["']/.test(html), "se volvió type=module");

// Preact/htm por CDN, sin build — igual que se decidió para módulos nuevos
// (ver Informe_Tecnico_Codigo_FOOAX y Estrategia_Desarrollo_Seguro_FOOAX):
// no tocar las apps de cobranza que ya funcionan, pero sí usar componentes
// para pantallas nuevas y complejas como esta.
ok("usa Preact", /esm\.sh\/preact/.test(js), "no importa preact");
ok("usa htm (sin JSX, sin bundler)", /esm\.sh\/htm/.test(js), "no importa htm");

// Los endpoints que la pantalla necesita para funcionar (deben coincidir
// exactamente con rutas_expediente.js del branch de backend).
const ENDPOINTS = [
  "/api/expediente/${id}",
  "/api/expediente/${id}/candado",
  "/api/expediente/${clientaId}/responsable",
  "/api/expediente/${clientaId}/aval",
  "/api/expediente/${clientaId}/referencia",
  "/api/expediente/${clientaId}/documento",
  "/api/expediente/${clientaId}/firma",
  "/api/expediente/${clientaId}/validar",
];
for (const ep of ENDPOINTS) {
  const patron = ep.replace(/\$\{[^}]+\}/g, "\\$\\{[^}]+\\}");
  ok("llama a " + ep, new RegExp(patron).test(js), "no se encontró la llamada");
}

// El checklist de documentos exigido por el Requerimiento Maestro / Solicitud
// de Crédito FOOAX 2026 — si alguno se cae de la lista, la ejecutiva nunca
// verá dónde subirlo y el expediente se queda "incompleto" para siempre.
const CHECKLIST = ["solicitante_ine", "solicitante_comprobante_domicilio", "solicitante_curp",
  "solicitante_foto_negocio", "responsable_ine", "responsable_comprobante_domicilio",
  "aval_ine", "aval_comprobante_domicilio"];
for (const clave of CHECKLIST) ok("conoce el documento " + clave, js.includes(clave), "falta en TIPOS_DOC");

// Las tres firmas SEPARADAS (LFPDPPP + Art. 28 LRSIC) — nunca deben fusionarse
// en un solo botón "aceptar todo".
for (const tipo of ["solicitud", "buro", "datos_sensibles"])
  ok("tiene botón de firma separado para " + tipo, new RegExp(`firmar\\("${tipo}"\\)`).test(js), "no está");

// La referencia no debe poder guardarse sin marcar su consentimiento.
ok("la referencia exige su propio consentimiento antes de guardar",
  /if \(!refConsent\)/.test(js), "no valida refConsent antes de guardar");

// El candado de desembolso se muestra siempre que se carga un expediente.
ok("consulta el candado de desembolso al cargar", /\/candado`\)/.test(js), "no llama a /candado");

// Terminología FOOAX: nunca "ahorro" (es SOFOM E.N.R., no capta depósitos).
ok("no dice 'ahorro' en ningún lado", !/ahorro/i.test(html), "aparece la palabra");

// La ruta en el servidor que sirve esta pantalla, protegida con sesión —
// igual que /app y /tablero, nunca servida suelta por express.static.
const serverPath = path.join(__dirname, "..", "server.js");
const serverSrc = fs.readFileSync(serverPath, "utf8");
ok("server.js tiene una ruta /expediente protegida con sesión",
  /app\.get\("\/expediente",\s*paginaRequiere\(/.test(serverSrc), "no se encontró la ruta o no usa paginaRequiere");
ok("App_Expediente_Originacion.html NO vive donde express.static la serviría suelta",
  !/express\.static\(path\.join\(__dirname,\s*"apps"/.test(serverSrc), "apps/ se volvió estático");

console.log("\n══════════════════════════════════");
console.log(FALLA === 0 ? "✅✅ TODO PASÓ: " + PASA + " verificaciones" : "❌ FALLARON " + FALLA + " de " + (PASA + FALLA));
process.exit(FALLA === 0 ? 0 : 1);
