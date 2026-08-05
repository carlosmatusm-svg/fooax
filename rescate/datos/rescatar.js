/*  RESCATE DE DATOS · Sistema ESHLIDER (MySQL en Railway)
 *  ------------------------------------------------------
 *  Baja TODA la base de datos del sistema anterior y arma los dos entregables
 *  que pidió la Gerencia de Administración y Finanzas de FOOAX (carta del
 *  23-jul-2026):
 *     1. Reporte de GARANTÍAS (ahorros) de abril y mayo.
 *     2. Respaldo de las ENTREVISTAS DE CRÉDITO (expediente socioeconómico).
 *
 *  USO:
 *    1) Llena  ~/fooax-cobranza/rescate/.env.railway  con los datos de Railway.
 *    2) cd ~/fooax-cobranza/rescate/datos && node rescatar.js
 *
 *  No borra ni modifica nada en el origen: solo lee (SELECT).
 */

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const ENV = path.join(RAIZ, ".env.railway");

// Rango del reporte de garantías. Cámbialo aquí si piden otros meses.
const DESDE = process.env.DESDE || "2026-04-01";
const HASTA = process.env.HASTA || "2026-05-31";

// Tablas que forman la "entrevista de crédito" (expediente socioeconómico).
const EXPEDIENTE = [
  "clientes", "vivendas", "muebles", "ingresos",
  "familiares", "references", "avales", "beneficiarios",
];

// ---------- utilidades ----------

function leerEnv() {
  if (!fs.existsSync(ENV)) {
    console.error(`\nFalta el archivo de credenciales:\n  ${ENV}\n`);
    console.error("Créalo con los datos de Railway y vuelve a correr esto.\n");
    process.exit(1);
  }
  const cfg = {};
  for (const linea of fs.readFileSync(ENV, "utf8").split("\n")) {
    const l = linea.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i === -1) continue;
    cfg[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return cfg;
}

// Railway da una URL tipo mysql://usuario:clave@host:puerto/base
function conexionDesde(cfg) {
  const url = cfg.MYSQL_PUBLIC_URL || cfg.MYSQL_URL || cfg.DATABASE_URL;
  if (url && url.includes("://")) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
    };
  }
  return {
    host: cfg.MYSQLHOST || cfg.MYSQL_HOST,
    port: Number(cfg.MYSQLPORT || cfg.MYSQL_PORT || 3306),
    user: cfg.MYSQLUSER || cfg.MYSQL_USER,
    password: cfg.MYSQLPASSWORD || cfg.MYSQL_PASSWORD,
    database: cfg.MYSQLDATABASE || cfg.MYSQL_DATABASE,
  };
}

// CSV con BOM para que Excel respete los acentos de los nombres.
function aCSV(filas) {
  if (!filas.length) return "﻿(sin registros)\n";
  const cols = Object.keys(filas[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    let s = v instanceof Date ? v.toISOString().slice(0, 19).replace("T", " ") : String(v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return "﻿" + [cols.join(","), ...filas.map((f) => cols.map((c) => esc(f[c])).join(","))].join("\n") + "\n";
}

function guardar(destino, contenido) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
}

// ---------- programa ----------

async function main() {
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    console.error("\nFalta el driver. Corre primero:\n  cd ~/fooax-cobranza/rescate/datos && npm install mysql2\n");
    process.exit(1);
  }

  const cfg = leerEnv();
  const conn = conexionDesde(cfg);
  if (!conn.host || !conn.user || !conn.database) {
    console.error("\nFaltan datos en .env.railway (host, usuario o base).\n");
    process.exit(1);
  }
  if (/railway\.internal$/.test(conn.host)) {
    console.error(`\nEl host "${conn.host}" es interno de Railway y NO funciona desde tu Mac.`);
    console.error("En Railway usa la variable MYSQL_PUBLIC_URL (o el host público del proxy).\n");
    process.exit(1);
  }

  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const sello = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const dir = path.join(RAIZ, "respaldo-eshlider-" + sello);

  console.log(`\n-> Conectando a ${conn.host}:${conn.port}/${conn.database} como ${conn.user} ...`);
  const db = await mysql.createConnection({ ...conn, dateStrings: true, connectTimeout: 20000 });
  console.log("ok Conexion abierta\n");

  // --- 1. Respaldo completo, tabla por tabla ---
  const [tablas] = await db.query(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
    [conn.database]
  );

  console.log(`-> Respaldo completo (${tablas.length} tablas):`);
  const conteo = {};
  for (const { t } of tablas) {
    try {
      const [filas] = await db.query(`SELECT * FROM \`${t}\``);
      conteo[t] = filas.length;
      guardar(path.join(dir, "respaldo-completo", t + ".json"), JSON.stringify(filas, null, 1));
      guardar(path.join(dir, "respaldo-completo", t + ".csv"), aCSV(filas));
      console.log(`   ok ${t.padEnd(32)} ${String(filas.length).padStart(7)} registros`);
    } catch (e) {
      conteo[t] = "ERROR";
      console.log(`   x  ${t.padEnd(32)} ${e.message}`);
    }
  }

  // --- 2. ENTREGABLE 1: garantias de abril y mayo ---
  console.log(`\n-> Entregable 1: garantias del ${DESDE} al ${HASTA}`);
  const sqlGarantias = `
    SELECT  m.id_movimiento, m.fecha_movimiento, m.tipo_movimiento, m.monto,
            m.metodo_movimiento, m.estado, m.referencia, m.fecha_confirmacion,
            a.id_ahorro, a.monto_actual AS saldo_garantia_actual, a.estatus AS estatus_garantia,
            c.id_cliente,
            TRIM(CONCAT_WS(' ', c.nombre1, c.nombre2, c.apellido_paterno, c.apellido_materno)) AS cliente,
            c.curp, ce.id_centro,
            TRIM(CONCAT_WS(' ', u.nombre1, u.apellido_paterno)) AS registro_usuario
      FROM movimientos_ahorros m
      JOIN ahorros  a  ON a.id_ahorro  = m.id_ahorro
      JOIN clientes c  ON c.id_cliente = a.id_cliente
      LEFT JOIN centros  ce ON ce.id_centro = c.id_centro
      LEFT JOIN usuarios u  ON u.id_usuario = m.id_usuario_registro
     WHERE DATE(m.fecha_movimiento) BETWEEN ? AND ?
     ORDER BY m.fecha_movimiento, m.id_movimiento`;
  try {
    const [g] = await db.query(sqlGarantias, [DESDE, HASTA]);
    guardar(path.join(dir, "ENTREGA", `garantias-${DESDE}_a_${HASTA}.csv`), aCSV(g));

    // Resumen por mes y tipo, para la caratula del reporte.
    const resumen = {};
    for (const r of g) {
      const mes = String(r.fecha_movimiento).slice(0, 7);
      const k = mes + " | " + r.tipo_movimiento;
      resumen[k] = resumen[k] || { mes, tipo: r.tipo_movimiento, movimientos: 0, monto_total: 0 };
      resumen[k].movimientos++;
      resumen[k].monto_total += Number(r.monto || 0);
    }
    const filasResumen = Object.values(resumen).map((r) => ({ ...r, monto_total: r.monto_total.toFixed(2) }));
    guardar(path.join(dir, "ENTREGA", "garantias-resumen-por-mes.csv"), aCSV(filasResumen));
    console.log(`   ok ${g.length} movimientos de garantia`);
    for (const r of filasResumen) console.log(`      ${r.mes}  ${String(r.tipo).padEnd(18)} ${String(r.movimientos).padStart(6)} mov.  $${r.monto_total}`);
  } catch (e) {
    console.log(`   x  garantias: ${e.message}`);
  }

  // --- 3. ENTREGABLE 2: entrevistas de credito (expediente) ---
  console.log("\n-> Entregable 2: entrevistas de credito (expediente socioeconomico)");
  for (const t of EXPEDIENTE) {
    try {
      const [cols] = await db.query(
        "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ?",
        [conn.database, t]
      );
      if (!cols.length) { console.log(`   .  ${t.padEnd(16)} (no existe)`); continue; }
      const tieneCliente = cols.some((x) => x.c === "id_cliente");
      const sql = tieneCliente && t !== "clientes"
        ? `SELECT TRIM(CONCAT_WS(' ', c.nombre1, c.nombre2, c.apellido_paterno, c.apellido_materno)) AS cliente,
                  c.curp, x.*
             FROM \`${t}\` x JOIN clientes c ON c.id_cliente = x.id_cliente`
        : `SELECT * FROM \`${t}\``;
      const [filas] = await db.query(sql);
      guardar(path.join(dir, "ENTREGA", "entrevistas-credito", t + ".csv"), aCSV(filas));
      console.log(`   ok ${t.padEnd(16)} ${String(filas.length).padStart(7)} registros`);
    } catch (e) {
      console.log(`   x  ${t.padEnd(16)} ${e.message}`);
    }
  }

  // --- 4. Constancia del respaldo ---
  const lineas = Object.entries(conteo).map(([t, n]) => `  ${t.padEnd(34)} ${String(n).padStart(8)}`).join("\n");
  guardar(path.join(dir, "_LEEME.txt"),
    `RESPALDO DEL SISTEMA ESHLIDER\n` +
    `Fecha del respaldo : ${d.toISOString()}\n` +
    `Origen             : ${conn.host}:${conn.port}/${conn.database}\n` +
    `Tablas respaldadas : ${tablas.length}\n\n` +
    `ENTREGA/  contiene lo que pidio la Gerencia de Administracion y Finanzas:\n` +
    `  - garantias-${DESDE}_a_${HASTA}.csv   (movimientos de garantia del periodo)\n` +
    `  - garantias-resumen-por-mes.csv        (totales por mes y tipo)\n` +
    `  - entrevistas-credito/                 (expediente socioeconomico completo)\n\n` +
    `respaldo-completo/  es la base entera, tabla por tabla, en JSON y CSV.\n\n` +
    `REGISTROS POR TABLA\n${lineas}\n`);

  await db.end();
  console.log(`\nListo. Todo quedo en:\n  ${dir}\n`);
  console.log("Guarda DOS copias (una fuera de esta Mac) antes de que cierren el acceso.\n");
}

main().catch((e) => { console.error("\nError:", e.message, "\n"); process.exit(2); });
