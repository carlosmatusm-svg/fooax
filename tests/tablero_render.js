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

// PARIDAD ENTRE LAS APPS (Karina, 7-ago: «hay que volver a checar bien que
// tenga las mismas configuraciones que los demás — no puede volver a suceder
// eso»). Van dos veces que la app de Julio se queda atrás de las otras y solo
// se descubre porque él lo reporta. Esto lo caza aquí.
//
// Se compara el CÓDIGO, no los datos: se quitan el padrón embebido, el nombre
// de la ejecutiva y su meta, que sí son distintos a propósito. Lo que quede
// distinto es una app que se quedó atrás.
{
  const APPS = ["NERI_GERENTE", "KARINA", "CHRISTOPHER", "JULIO"];
  const soloCodigo = (nom) => fs.readFileSync(path.join(__dirname, "..", "apps", "App_Cobranza_" + nom + ".html"), "utf8")
    .replace(/let CENTROS=\{[\s\S]*?\};/, "CENTROS")
    .replace(/let INDIVIDUALES=\[[\s\S]*?\];/, "INDIVIDUALES")
    .replace(/const (EJECUTIVO\w*|ES_GERENTE|META)\s*=[^\n]*/g, "$1")
    .replace(/FOOAX · Cobranza [^<]*/g, "TITULO")
    .replace(/<h1>[^<]*<\/h1>/g, "<h1>NOMBRE</h1>")
    .replace(/Meta: \d+ centros · \d+ integrantes/g, "META");
  // Cada función que existe en las demás tiene que existir en todas.
  const fnsDe = (nom) => new Set((soloCodigo(nom).match(/function\s+(\w+)\s*\(/g) || [])
    .map((x) => x.replace(/function\s+/, "").replace(/\s*\($/, "")));
  const porApp = {}; APPS.forEach((a) => { porApp[a] = fnsDe(a); });
  // La base se saca de LAS OTRAS, nunca de la que se está revisando: si se
  // incluyera, quitarle una función también la quitaría de la base y la falta
  // se volvería invisible. (Probado: sin esto, renombrar una función en Julio
  // pasaba como si nada.)
  // Neri tiene además su pestaña de gerente: sus extras no cuentan como falta.
  for (const a of APPS) {
    const otras = APPS.filter((x) => x !== a && x !== "NERI_GERENTE").map((x) => porApp[x]);
    const base = new Set([...otras[0]].filter((f) => otras.every((s2) => s2.has(f))));
    const faltan = [...base].filter((f) => !porApp[a].has(f));
    ok(a + ": no le falta ninguna función que tengan las demás", faltan.length === 0, faltan.join(", "));
  }
  // Y la versión del padrón: si una se queda atrás, su teléfono no toma los
  // montos nuevos. Todas tienen que ir en la MISMA.
  const vers = {};
  for (const a of APPS) {
    const m = /PADRON_VERSION\s*=\s*(\d+)/.exec(soloCodigo(a));
    vers[a] = m ? m[1] : "(sin versión)";
  }
  const distintas = [...new Set(Object.values(vers))];
  ok("todas las apps van en la misma PADRON_VERSION", distintas.length === 1, JSON.stringify(vers));
  // Los arreglos que tienen que estar en TODAS, no solo en la que se reportó.
  const OBLIGATORIOS = [
    ["preguntarPostCierre", /function preguntarPostCierre\(/],
    ["el guardia de re-entrada", /_hay=\(_d\.reg/],
    ["gasto sin centro ni clienta", /movQuienBox/],
    ["plazo en meses o semanas", /function unidadDe\(/],
    ["nunca dice 'ahorro'", /^(?!.*ahorro).*$/is],
  ];
  for (const a of APPS) {
    const src = fs.readFileSync(path.join(__dirname, "..", "apps", "App_Cobranza_" + a + ".html"), "utf8");
    for (const [que, re] of OBLIGATORIOS)
      ok(a + ": tiene " + que, re.test(src), "le falta");
  }
}

// EL CIERRE TIENE QUE VERSE SIEMPRE (Karina, 7-ago: «lo de Julio no queda, no
// nos dice cuándo cerró»). El chip colgaba el texto del cierre de que hubiera
// sincronización registrada: una ejecutiva que cerraba y no tenía última sync
// aparecía como "sin sincronizar", sin una palabra de que ya había cerrado. Y
// la tarjeta de cada ejecutiva no decía nada del cierre, ni una vez.
{
  const t = fs.readFileSync(path.join(__dirname, "..", "vistas", "tablero.html"), "utf8");
  ok("la tarjeta de cada ejecutiva dice si cerró", /cerroPill/.test(t), "no aparece el dato del cierre");
  ok("y dice 'sin cerrar' cuando no ha cerrado", /sin cerrar/.test(t), "no avisa cuando falta");
  // El texto del cierre no puede volver a depender de la sincronización.
  ok("el cierre ya no se esconde si no hay sincronización",
    !/\(ok \? " · " \+ hora \+ cerro :/.test(t), "el cierre sigue colgando de `ok`");
  ok("Dirección puede corregir la captura desde la tarjeta",
    /abrirCorreccion\(/.test(t) && /\/api\/captura/.test(t), "falta el botón de corregir");
  for (const f of ["corregirMonto", "anularCaptura", "corregirArqueo"])
    ok("existe " + f + "()", new RegExp("function " + f + "\\(").test(t), "no está");
  // Corregir sin motivo no debe ser posible ni por descuido en la pantalla.
  ok("la pantalla exige motivo en cada corrección",
    (t.match(/¿Por qué/g) || []).length >= 3, "alguna corrección no lo pide");
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
  // El vigilante del día: una PWA abierta al pasar medianoche fechaba las
  // capturas en el día viejo (los pagos de GUIE XHUUBA, 12-ago). Si esto
  // desaparece, el hueco regresa en silencio.
  ok("vivos.js vigila que el día en pantalla siga siendo hoy",
    /__vigilaDia/.test(v) && /inpFecha/.test(v) && /reload\(\)/.test(v), "se quitó el vigilante");
  ok("y respeta el bloqueo del día anterior (sin ciclo de recargas)",
    /fooax_fecha_ok/.test(v), "no revisa la fecha sancionada");
  // El repintado que le borraba la pantalla a Christopher (12-ago): si estos
  // tres candados se caen, el "se me reinicia cada minuto" regresa.
  ok("vivos.js NO repinta mientras la ejecutiva está escribiendo",
    /estaEscribiendo/.test(v) && /activeElement/.test(v), "se quitó el candado del foco");
  ok("y conserva el centro elegido al repintar",
    /centroElegido/.test(v) && /selCentro/.test(v), "ya no repone el selector");
  ok("y una corrección de Dirección se aplica UNA sola vez",
    /fooax_corr_/.test(v), "se quitó la firma de correcciones");
  // El vigilante compara SOLO contra la fecha del SERVIDOR. Contra el reloj
  // del teléfono recargaba cada minuto cuando ese reloj andaba mal — el
  // "se me reinicia a cada rato" de Christopher (12-ago).
  ok("el vigilante usa la fecha del SERVIDOR, no el reloj del teléfono",
    /__hoyServidor/.test(v) && !/hoyMXcliente/.test(v), "volvió el reloj del teléfono");
  ok("y recarga UNA sola vez por fecha (sin ciclo)",
    /fooax_vigilo_/.test(v), "se quitó el candado de una-sola-recarga");
}

// LA TARJETA DE RENOVACIONES PINTA DE VERDAD (Karina, 14-ago). No basta con
// que el JavaScript compile: esta tarjeta arma HTML con comillas dentro de
// comillas, que es justo donde se rompe y deja la tarjeta en "Cargando…".
// Aquí se le da una respuesta de mentiras y se revisa lo que escribió.
console.log("\n═══ LA TARJETA DE RENOVACIONES PINTA ═══\n");
{
  // Se corre SOLO la función que pinta esta tarjeta, con sus dos ayudantes.
  // Correr el tablero entero aquí es imposible (necesitaría un navegador de
  // verdad) y tampoco es lo que interesa: lo que se rompe es el HTML que arma.
  // Se recorta contando llaves hasta cerrar la función (sirve igual para las
  // de un solo renglón, como hesc, que para las largas).
  const trozo = (nombre) => {
    let i = js.indexOf("function " + nombre + "(");
    if (i < 0) return "";
    // Si es `async function`, el async va incluido: sin él, el await de adentro
    // no compila y la prueba culpa a la tarjeta de un error que no tiene.
    if (js.slice(Math.max(0, i - 6), i) === "async ") i -= 6;
    let prof = 0, visto = false;
    for (let k = i; k < js.length; k++) {
      if (js[k] === "{") { prof++; visto = true; }
      else if (js[k] === "}") { prof--; if (visto && prof === 0) return js.slice(i, k + 1); }
    }
    return "";
  };
  const dineroSrc = (js.match(/const dinero = [^\n]+/) || [""])[0];
  const src = [dineroSrc, trozo("hesc"), trozo("semanasRenUI"), trozo("cargarRenovaciones"),
    "globalThis.__pintar = cargarRenovaciones;"].join("\n");
  const caja = { innerHTML: "", textContent: "" };
  const elems = { renResumen: caja, renSemanas: { value: "3" } };
  const respuesta = {
    hoy: "2026-08-14", semanasAviso: 3,
    sinRenovar: [{ ejecutivo: "Julio", centro: "PEÑITAS", clienta: "ROSA PRUEBA", socio: "1",
      producto: "Grupal-Basico", monto: 6000, fechaFin: "2026-07-01", dias: 44, eraVencido: false }],
    porTerminar: [{ ejecutivo: "Neri", centro: "ADNACHIEL", clienta: "MARIA PRUEBA", socio: "2",
      producto: "Grupal-Basico", saldoActual: 1000, cuota: 500, semanas: 2, diaPago: "MARTES" }],
    porEjecutivo: [{ ejecutivo: "Julio", renovaron: 3, montoRenovado: 18000, terminaronEnElMes: 1,
      tasa: 75, sinRenovar: 1, montoSinRenovar: 6000, porTerminar: 1, montoPorTerminar: 4000 }],
    totales: { sinRenovar: 1, montoSinRenovar: 6000, porTerminar: 1, montoPorTerminar: 4000 },
    mes: "2026-08",
    delMes: { mes: "2026-08", renovaron: 3, montoRenovado: 18000, terminaronSinRenovar: 1,
      montoTerminaronSinRenovar: 6000, cerraronCiclo: 4, tasa: 75, terminanEnElMes: 2,
      montoTerminanEnElMes: 1000, antesDelCorte: false, corte: "2026-08-05", sinMovimiento: false },
    fuera: { vencidos: 3, cuotaVariable: 1, sinCuota: 0 },
  };
  const ctx = {
    document: { getElementById: (id) => elems[id] || null },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(respuesta) }),
    console: { log() {}, error() {} },
  };
  ctx.globalThis = ctx;
  let corrio = true, motivo = "";
  try { vm.createContext(ctx); new vm.Script(src).runInContext(ctx); }
  catch (e) { corrio = false; motivo = e.message; }
  ok("la tarjeta de renovaciones y sus ayudantes compilan solos", corrio, motivo);
  if (corrio && typeof ctx.__pintar === "function") {
    ctx.__pintar().then(() => {
      const h = caja.innerHTML;
      // El corte del MES es lo que se reporta: si esto se cae, la tarjeta
      // pierde justo el número que Karina pidió el 14-ago.
      ok("abre con el corte del MES: cuántas renovaron y la tasa",
        /2026-08/.test(h) && /renovaron/.test(h) && /75%/.test(h) && /\$18,000/.test(h), h.slice(0, 260));
      ok("cada conteo trae su dinero: colocado, enfriado y por cobrar",
        /\$18,000/.test(h) && /se enfriaron/.test(h) && /les falta \$1,000 por pagar/.test(h), h.slice(0, 700));
      ok("y desglosa el mes por ejecutivo",
        /Julio/.test(h) && /renov[oó] 3/.test(h), h.slice(0, 400));
      ok("dice quién NO renovó, con sus días y su dinero",
        /ROSA PRUEBA/.test(h) && /44 d/.test(h) && /\$6,000/.test(h), h.slice(0, 220));
      ok("dice quién está POR TERMINAR y cuántas cuotas le faltan",
        /MARIA PRUEBA/.test(h) && /2 cuotas/.test(h), h.slice(0, 220));
      ok("y no se calla lo que dejó fuera (vencidos y cuota variable)",
        /3 vencidos/.test(h) && /cuota variable/.test(h), h.slice(-180));
      // Comillas rotas: es EL error de armar HTML dentro de una cadena. El
      // síntoma es una barra invertida suelta o una etiqueta sin cerrar.
      ok("el HTML que arma no trae comillas ni etiquetas rotas",
        !/\\"/.test(h) && (h.match(/<b[\s>]/g) || []).length === (h.match(/<\/b>/g) || []).length
          && (h.match(/<span[\s>]/g) || []).length === (h.match(/<\/span>/g) || []).length,
        h.slice(0, 220));
      cerrar();
    }).catch((e) => { ok("la tarjeta de renovaciones se pinta sin error", false, e.message); cerrar(); });
  } else {
    ok("la tarjeta de renovaciones existe y es una función", false, "no se pudo aislar");
    cerrar();
  }
}

function cerrar() {
console.log("\n══════════════════════════════════");
console.log(FALLA === 0 ? "✅✅ TODO PASÓ: " + PASA + " verificaciones" : "❌ FALLARON " + FALLA + " de " + (PASA + FALLA));
process.exit(FALLA === 0 ? 0 : 1);
}
