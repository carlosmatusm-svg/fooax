// ===================================================================
// MOTOR DE REGLAS — el cálculo de intereses vive AFUERA del código.
//
// Idea del tío de Karina (12-ago-2026), y es la correcta para este caso.
// Lo vivido lo comprueba: la tasa de MAGNUS estuvo en duda (2.95% vs 3.04%),
// los topes de FOXI+ se contradicen entre dos documentos firmados ($50K vs
// $150K), y sigue sin decidirse qué tasa se imprime en el dictamen. Con las
// reglas escritas en el código, cada uno de esos cambios habría sido un
// programador, un despliegue y una espera.
//
// Aquí NO hay ni una tasa, ni un plazo, ni un tope: todo sale de
// `data/reglas-productos.json`, que edita Dirección. Este archivo solo sabe
// hacer las tres cuentas que validó la contadora.
//
// DOS REGLAS QUE NO SE NEGOCIAN:
//   1. Si falta un dato, NO SE INVENTA. El motor se niega y dice qué falta.
//      Un interés inventado se le cobra de verdad a una señora.
//   2. Se calcula con TODOS los decimales y se redondea AL FINAL. Los ejemplos
//      de la contadora solo cuadran así; redondeando paso por paso el total
//      sale un centavo arriba (la misma familia del bug de los $300 del pago
//      mixto y los $0.50 del 25-jul).
// ===================================================================
"use strict";
const fs = require("fs");
const path = require("path");

const ARCHIVO = path.join(__dirname, "data", "reglas-productos.json");

let REGLAS = null, cargadoEn = 0;
function reglas(forzar) {
  // Se relee cada 30s: cambiar una tasa en el archivo surte efecto sin
  // reiniciar el servidor. Es lo que hace que esto sea un motor de reglas y
  // no un archivo de configuración más.
  const ahora = Date.now();
  if (!forzar && REGLAS && ahora - cargadoEn < 30000) return REGLAS;
  try {
    REGLAS = JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
    cargadoEn = ahora;
  } catch (e) {
    if (!REGLAS) throw new Error("No se pudo leer el motor de reglas (" + ARCHIVO + "): " + e.message);
  }
  return REGLAS;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s || "").toUpperCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");

// Encuentra el producto en el catálogo. Acepta el nombre como venga escrito en
// el padrón ("Grupal-Basico 2", "Foxi Plus - 1"): compara sin acentos, sin
// guiones y sin espacios, que es como difieren entre plantillas.
function buscarProducto(nombre) {
  const R = reglas();
  const n = norm(nombre);
  if (!n) return null;
  const lista = R.productos || [];
  let p = lista.find((x) => norm(x.clave) === n || norm(x.nombre) === n);
  if (p) return p;
  // Sin número al final: "Grupal-Basico 2" cae en "Grupal Básico".
  const sinNum = n.replace(/\d+$/, "");
  p = lista.find((x) => norm(x.clave) === sinNum || norm(x.nombre) === sinNum);
  if (p) return p;
  // El más específico que sea prefijo (para "FOXIPLUS1" → "FOXIPLUS").
  const cands = lista.filter((x) => n.startsWith(norm(x.clave)) || n.startsWith(norm(x.nombre)));
  return cands.sort((a, b) => norm(b.clave).length - norm(a.clave).length)[0] || null;
}

// ¿Se puede calcular este producto? Si no, POR QUÉ no.
function estadoDe(nombre) {
  const p = buscarProducto(nombre);
  if (!p) return { ok: false, motivo: "Ese producto no está en el motor de reglas.", producto: null };
  if (p.pendiente || p.tasaMensual == null)
    return { ok: false, motivo: p.faltaPara || "Le falta la tasa en el motor de reglas.", producto: p };
  return { ok: true, producto: p };
}

// ---------- MÉTODO A · interés fijo sobre el monto original (cuota pareja) ----
// El divisor sale de la periodicidad: semanal = tasa mensual ÷ 4.
function metodoA(p, monto, nPagos, iva) {
  const porPeriodo = p.periodicidad === "mensual" ? 1 : 4;
  const capital = monto / nPagos;
  const interes = monto * (p.tasaMensual / porPeriodo);
  const ivaMonto = interes * iva;
  const cuota = capital + interes + ivaMonto;
  return { capital, interes, iva: ivaMonto, cuota };
}

// ---------- MÉTODO A-DÍAS · Pago Único por días reales ----------
function metodoADias(p, monto, dias, iva) {
  const interesDiario = (monto * p.tasaMensual) / 30;
  const interes = interesDiario * dias;
  const ivaMonto = interes * iva;
  return { capital: monto, interes, iva: ivaMonto, total: monto + interes + ivaMonto, interesDiario, dias };
}

// ---------- La tabla completa, que es lo que se cobra ----------
// `desde` y `diasPorPeriodo` solo importan en MAGNUS (método B), donde el
// interés depende de los días REALES entre cortes y el primer periodo casi
// nunca son 30.
function tablaAmortizacion(opciones) {
  const R = reglas();
  const { producto, monto, plazo } = opciones;
  const est = estadoDe(producto);
  if (!est.ok) return { ok: false, motivo: est.motivo, producto: est.producto };
  const p = est.producto;
  const iva = R.iva;
  const m = Number(monto) || 0;
  const n = Number(plazo) || 0;
  if (m <= 0) return { ok: false, motivo: "El monto debe ser mayor a 0." };

  // Topes del catálogo: si están puestos, se respetan.
  if (p.montoMin != null && m < p.montoMin)
    return { ok: false, motivo: "El monto está por debajo del mínimo de " + p.nombre + " ($" + p.montoMin.toLocaleString("es-MX") + ")." };
  if (p.montoMax != null && m > p.montoMax)
    return { ok: false, motivo: "El monto pasa el máximo de " + p.nombre + " ($" + p.montoMax.toLocaleString("es-MX") + ")." };

  // ---- Pago Único: un solo vencimiento, por días reales ----
  if (p.metodo === "A_DIAS") {
    const dias = Number(opciones.dias) || 0;
    if (dias <= 0) return { ok: false, motivo: "Pago Único necesita los días entre otorgamiento y vencimiento." };
    const c = metodoADias(p, m, dias, iva);
    return {
      ok: true, metodo: "A_DIAS", producto: p.nombre, monto: m, dias,
      pagos: [{ n: 1, dias, capital: r2(c.capital), interes: r2(c.interes), iva: r2(c.iva), cuota: r2(c.total), saldo: 0 }],
      totales: { capital: r2(m), interes: r2(c.interes), iva: r2(c.iva), aPagar: r2(c.total) },
    };
  }

  if (n <= 0) return { ok: false, motivo: "Falta el plazo (número de pagos)." };
  if (Array.isArray(p.plazos) && p.plazos.length && !p.plazos.includes(n))
    return { ok: false, motivo: p.nombre + " solo tiene plazos de " + p.plazos.join(", ") + " — llegó " + n + "." };

  const pagos = [];
  let saldo = m;

  if (p.metodo === "B") {
    // ---- MAGNUS · saldos insolutos, con prorrateo por DÍAS REALES ----
    const dias = opciones.diasPorPeriodo;
    const capital = m / n;
    for (let i = 1; i <= n; i++) {
      const d = Array.isArray(dias) && dias[i - 1] != null ? Number(dias[i - 1]) : 30;
      const interes = (saldo * p.tasaMensual / 30) * d;
      const ivaMonto = interes * iva;
      pagos.push({ n: i, dias: d, capital, interes, iva: ivaMonto, cuota: capital + interes + ivaMonto, saldo: saldo - capital });
      saldo -= capital;
    }
  } else {
    // ---- Método A · cuota pareja ----
    const c = metodoA(p, m, n, iva);
    for (let i = 1; i <= n; i++) {
      pagos.push({ n: i, capital: c.capital, interes: c.interes, iva: c.iva, cuota: c.cuota, saldo: saldo - c.capital });
      saldo -= c.capital;
    }
  }

  // ---- Redondeo AL FINAL y ajuste de centavos ----
  // El capital sin redondear casi nunca cierra ($10,000 ÷ 12 deja 4 centavos).
  // La última cuota absorbe la diferencia para terminar en $0.00 exacto.
  const capitalExacto = m;
  let capitalAcum = 0;
  const salida = pagos.map((x, i) => {
    const esUltimo = i === pagos.length - 1;
    let cap = r2(x.capital);
    if (esUltimo && (R.redondeo || {}).ajusteDeCentavos !== "reparte") cap = r2(capitalExacto - capitalAcum);
    capitalAcum = r2(capitalAcum + cap);
    const interes = r2(x.interes), ivaM = r2(x.iva);
    return { n: x.n, dias: x.dias, capital: cap, interes, iva: ivaM,
      cuota: r2(cap + interes + ivaM), saldo: r2(capitalExacto - capitalAcum) };
  });

  const sum = (f) => r2(salida.reduce((t, x) => t + f(x), 0));
  return {
    ok: true, metodo: p.metodo, producto: p.nombre, tasaMensual: p.tasaMensual,
    monto: m, plazo: n, periodicidad: p.periodicidad,
    pagos: salida,
    cuota: salida.length ? salida[0].cuota : 0,
    totales: { capital: sum((x) => x.capital), interes: sum((x) => x.interes),
      iva: sum((x) => x.iva), aPagar: sum((x) => x.cuota) },
  };
}

// ---------- INTERÉS MORATORIO ----------
// Pago por pago: cuota × tasa moratoria mensual ÷ 30 × días de atraso, + IVA.
function moratorio(atrasos) {
  const R = reglas();
  const cfg = R.moratorio || {};
  if (cfg.pendiente || cfg.tasaMoratoriaMensual == null)
    return { ok: false, motivo: cfg.faltaPara || "Falta la tasa moratoria en el motor de reglas." };
  const iva = R.iva;
  const filas = (atrasos || []).map((a) => {
    const interes = (Number(a.cuota) || 0) * cfg.tasaMoratoriaMensual / 30 * (Number(a.diasAtraso) || 0);
    const ivaM = interes * iva;
    return { pago: a.pago, cuota: r2(a.cuota), diasAtraso: a.diasAtraso, interes: r2(interes), iva: r2(ivaM), total: r2(interes + ivaM) };
  });
  return { ok: true, filas, total: r2(filas.reduce((t, x) => t + x.total, 0)) };
}

// ---------- AUTOPRUEBA contra los ejemplos que validó la contadora ----------
// Corre al arrancar. Si el motor deja de reproducirlos, se grita en el log:
// vale más un servidor que avisa que uno que cobra mal en silencio.
function autoprueba() {
  const casos = [];
  const c1 = tablaAmortizacion({ producto: "COMADRE", monto: 10000, plazo: 12 });
  casos.push({ caso: "COMADRE $10,000 / 12 sem / 20%", espera: 1413.33,
    obtuvo: c1.ok ? c1.cuota : null, ok: c1.ok && Math.abs(c1.cuota - 1413.33) < 0.01 });
  const c2 = tablaAmortizacion({ producto: "PAGO_UNICO", monto: 50000, dias: 37 });
  casos.push({ caso: "Pago Único $50,000 / 37 días / 10%", espera: 57153.33,
    obtuvo: c2.ok ? c2.totales.aPagar : null, ok: c2.ok && Math.abs(c2.totales.aPagar - 57153.33) < 0.01 });
  // MAGNUS: el primer corte a 45 días debe dar $4,560 de interés, no $3,040.
  const c3 = tablaAmortizacion({ producto: "MAGNUS", monto: 100000, plazo: 24,
    diasPorPeriodo: [45].concat(Array(23).fill(30)) });
  casos.push({ caso: "MAGNUS $100,000 · primer corte a 45 días", espera: 4560,
    obtuvo: c3.ok ? c3.pagos[0].interes : null, ok: c3.ok && Math.abs(c3.pagos[0].interes - 4560) < 0.01 });
  // Y que el capital cierre EXACTO en cero.
  casos.push({ caso: "COMADRE cierra en $0.00 exacto", espera: 0,
    obtuvo: c1.ok ? c1.pagos[c1.pagos.length - 1].saldo : null,
    ok: c1.ok && c1.pagos[c1.pagos.length - 1].saldo === 0 && c1.totales.capital === 10000 });
  return { ok: casos.every((x) => x.ok), casos };
}

module.exports = { reglas, buscarProducto, estadoDe, tablaAmortizacion, moratorio, autoprueba, ARCHIVO };
