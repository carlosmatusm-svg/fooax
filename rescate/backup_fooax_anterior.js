/*  RESCATE DE DATOS · Sistema FOOAX anterior (fooaxserver-production.up.railway.app)
 *  --------------------------------------------------------------------------------
 *  Baja TODO lo que el sistema anterior permite exportar, usando la cuenta ADMIN
 *  de FOOAX (acceso legítimo: son datos de FOOAX). No hackea nada: entra por el
 *  mismo login que usa la página.
 *
 *  USO (lo corre KARINA, con permiso de FOOAX):
 *    cd /Users/karinamatus/fooax-cobranza/rescate
 *    node backup_fooax_anterior.js
 *  Te pedirá el usuario y la contraseña admin en la terminal (la contraseña no se
 *  ve ni se guarda en el historial). También acepta variables de entorno
 *  FOOAX_USER / FOOAX_PASS si prefieres.
 *
 *  Crea una carpeta backup-AAAA-MM-DD-HHMM con:
 *    - respaldo_total.xlsx  (el export completo, la joya)
 *    - reportes/*.xlsx       (cada reporte)
 *    - datos/*.json          (cada tabla)
 *
 *  Si el login falla, ajusta LOGIN_PATH y los campos en credenciales() (abajo):
 *  algunos sistemas usan "email"/"password" y otros "correo"/"contraseña".
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Pregunta en la terminal. Con oculto=true no muestra lo tecleado y no queda en
// el historial. Requiere terminal real (TTY); si no, cae a readline normal.
function preguntar(texto, oculto = false) {
  return new Promise((resolve) => {
    if (oculto && process.stdin.isTTY) {
      process.stdout.write(texto);
      const stdin = process.stdin;
      stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
      let val = "";
      const onData = (ch) => {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) {                    // Enter
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData);
          process.stdout.write("\n"); resolve(val);
        } else if (code === 3) {                             // Ctrl+C
          process.stdout.write("\n"); process.exit(1);
        } else if (code === 127 || code === 8) {             // Backspace
          val = val.slice(0, -1);
        } else {
          val += ch;
        }
      };
      stdin.on("data", onData);
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(texto, (ans) => { rl.close(); resolve(ans.trim()); });
    }
  });
}

const BASE = "https://fooaxserver-production.up.railway.app/api";
const LOGIN_PATH = "/login";

// El login manda estos campos. Si no entra, prueba las variantes comentadas.
function credenciales(user, pass) {
  return { correo: user, contraseña: pass };
  // return { email: user, password: pass };
  // return { usuario: user, contraseña: pass };
}

// --- Reportes que devuelven Excel/archivo (lo más valioso) ---
const ARCHIVOS = [
  ["respaldo_total.xlsx", "/reports/excel/full"],
  ["reportes/cobranza_detallada.xlsx", "/reports/collection/detailed"],
  ["reportes/cobranza_por_centro.xlsx", "/reports/collection/center"],
  ["reportes/cobranza_por_usuario.xlsx", "/reports/collection/user"],
  ["reportes/mora.xlsx", "/reports/delinquency"],
  ["reportes/cartera_resumen.xlsx", "/reports/portfolio-summary"],
  ["reportes/estado_capital.xlsx", "/reports/capital-status"],
  ["reportes/financiero_semanal.xlsx", "/reports/financial-weekly"],
  ["reportes/proyeccion.xlsx", "/reports/projection"],
  ["reportes/proyeccion_centros.xlsx", "/reports/projection-centers"],
  ["reportes/proyeccion_prestamos.xlsx", "/reports/projection-loans"],
  ["reportes/hoja_cobranza.xlsx", "/reports/hoja-cobranza"],
  ["reportes/ahorros_semanal.xlsx", "/reports/savings-weekly"],
  ["reportes/ahorros_diario_centros.xlsx", "/reports/savings-daily-excel"],
  ["reportes/ahorros_retiros.xlsx", "/reports/savings-withdrawals-excel"],
  ["reportes/estado_cuenta_general.xlsx", "/reports/client-account-statement-general"],
  ["reportes/actividad_usuarios.xlsx", "/reports/user-activity"],
  ["reportes/desempeno_usuarios.xlsx", "/reports/user-performance"],
];

// --- Tablas que devuelven JSON ---
const TABLAS = [
  ["usuarios", "/usuarios"],
  ["centros", "/centers"],
  ["grupos", "/grupos"],
  ["ahorros", "/ahorros"],
  ["ahorros_resumen_centro", "/ahorros/resumen-por-centro"],
  ["movimientos_ahorros", "/movimientos_ahorros"],
  ["lineas_credito", "/lineas-credito"],
  ["config_prestamos", "/config-prestamos"],
  ["mora_resumen", "/mora/resumen"],
  ["mora_potencial", "/mora/potencial"],
  ["mora_estadisticas", "/mora/estadisticas-temporales"],
  ["mora_config", "/mora-config"],
  ["notificaciones_estadisticas", "/cartera/notificaciones/estadisticas"],
  ["dashboard", "/dashboard"],
];

// -------------------- motor --------------------
let cookie = "";

async function req(pathRel, opts = {}) {
  const res = await fetch(BASE + pathRel, {
    ...opts,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) },
    redirect: "manual",
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return res;
}

async function login(user, pass) {
  const res = await req(LOGIN_PATH, { method: "POST", body: JSON.stringify(credenciales(user, pass)) });
  if (res.status >= 200 && res.status < 300) return true;
  try {
    const j = await res.json();
    const tok = j.token || j.accessToken || (j.data && j.data.token);
    if (tok) { global.__BEARER = tok; return true; }
  } catch {}
  console.error("  x login status " + res.status + " — revisa LOGIN_PATH y los campos de credenciales().");
  return false;
}

async function getGuardar(nombre, pathRel, dir, binario) {
  try {
    const headers = global.__BEARER ? { Authorization: "Bearer " + global.__BEARER } : {};
    const res = await req(pathRel, { headers });
    if (res.status !== 200) { console.log(`  . ${nombre}: HTTP ${res.status} (omitido)`); return false; }
    const destino = path.join(dir, nombre);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    if (binario) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destino, buf);
      console.log(`  ok ${nombre} (${(buf.length / 1024).toFixed(0)} KB)`);
    } else {
      const txt = await res.text();
      fs.writeFileSync(destino, txt);
      console.log(`  ok ${nombre} (${(txt.length / 1024).toFixed(0)} KB)`);
    }
    return true;
  } catch (e) {
    console.log(`  x ${nombre}: ${e.message}`);
    return false;
  }
}

async function main() {
  let user = process.env.FOOAX_USER, pass = process.env.FOOAX_PASS;
  if (!user) user = await preguntar("Usuario admin de FOOAX: ");
  if (!pass) pass = await preguntar("Contraseña (no se mostrará): ", true);
  if (!user || !pass) { console.error("Falta usuario o contraseña."); process.exit(1); }

  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const dir = path.join(__dirname, "backup-" + stamp);
  fs.mkdirSync(path.join(dir, "datos"), { recursive: true });
  fs.mkdirSync(path.join(dir, "reportes"), { recursive: true });

  console.log("\n-> Entrando como " + user + " ...");
  if (!(await login(user, pass))) process.exit(2);
  console.log("ok Sesion abierta\n");

  console.log("-> Bajando reportes/Excel (lo mas importante):");
  let ok = 0, tot = 0;
  for (const [nombre, ruta] of ARCHIVOS) { tot++; if (await getGuardar(nombre, ruta, dir, true)) ok++; }

  console.log("\n-> Bajando tablas (JSON):");
  for (const [nombre, ruta] of TABLAS) { tot++; if (await getGuardar("datos/" + nombre + ".json", ruta, dir, false)) ok++; }

  fs.writeFileSync(path.join(dir, "_LEEME.txt"),
    `Respaldo del sistema FOOAX anterior\nFecha: ${d.toISOString()}\nOrigen: ${BASE}\nDescargados: ${ok}/${tot}\n\n` +
    `La joya es respaldo_total.xlsx. Los .json son las tablas crudas por si se necesita migrar.\n`);
  console.log(`\nListo: ${ok}/${tot} archivos en\n  ${dir}`);
  if (ok < tot) console.log("  (algunos endpoints pueden tener otro nombre o requerir otro rol; los omitidos no frenan el respaldo)");
}

main().catch((e) => { console.error("Error fatal:", e); process.exit(3); });
