// DOMINIO: SINCRONIZACIÓN AL DESEMBOLSO (CU-013/CU-014) — el sobre de
// dispersión, el pagaré (registro) y el plan de pagos, generados juntos en el
// mismo acto de alta o recrédito.
//
// Extraído de server.js el 10-sep-2026 como SEGUNDO caso del patrón
// "strangler fig" documentado en CLAUDE.md ("Reducir dependencia del
// monolito server.js") — mismo criterio que dominios/garantia_liquida.js:
// refactor puro, mismas funciones, mismo comportamiento, solo cambia dónde
// viven. Este código venía del PR "CU-013/CU-014: sincronización automática
// al desembolsar" mergeado hoy a develop.
//
// Fábrica (factory), no funciones sueltas, por la misma razón que
// garantia_liquida.js: depende de utilidades que ya existen en server.js
// (nprod, hoyMX, idxDia, diaSiguiente) y del módulo motor-reglas.js
// (tabla de amortización real); server.js las inyecta una sola vez.
module.exports = function crearDominioSincronizacionDesembolso({
  nprod,
  hoyMX,
  idxDia,
  diaSiguiente,
  motor,
  porcentajeGarantiaLiquida,
}) {
  // EL SOBRE DE DISPERSIÓN. `comision` y `seguro` son datos manuales
  // opcionales (0 si no se capturan) — igual que la cuota, no hay catálogo de
  // comisiones ni de seguros todavía (CU-014 §10.1). La garantía SÍ tiene
  // regla validada (Anexo F): 10% del importe prestado, redondeado a
  // centavos. Regla 3.1 del Anexo F: el IVA nunca aplica sobre la garantía ni
  // sobre capital — por eso este sobre no calcula IVA.
  function generarSobreDispersion(importe, comisionCapturada, seguroCapturado) {
    const monto = Number(importe) ?? 0;
    const comision = Math.max(0, Number(comisionCapturada ?? 0));
    const seguro = Math.max(0, Number(seguroCapturado ?? 0));
    const garantia = Math.round(monto * (porcentajeGarantiaLiquida / 100) * 100) / 100;
    const neto = Math.round((monto - comision - seguro - garantia) * 100) / 100;
    return { monto, comision, seguro, garantia, porcentajeGarantia: porcentajeGarantiaLiquida, neto };
  }

  // EL PAGARÉ — registro simple (folio + datos), NO el documento legal. Emitir
  // el PDF real depende del catálogo de productos formal y de la validación
  // legal del Lic. César Cáceres (CU-014 §2/§10, sigue pendiente); aquí solo
  // se genera el registro para que exista UN lugar ligado al crédito, sin
  // recapturar nada en otro módulo.
  function generarPagare(id, producto, importe, plazo, fechaISO) {
    const fecha = fechaISO ?? hoyMX();
    const claveProducto = nprod(producto).slice(0, 12);
    const sufijoFecha = String(fecha).replace(/-/g, "");
    return {
      folio: `PAG-${id}-${claveProducto}-${sufijoFecha}`,
      monto: Number(importe) ?? 0,
      plazo: Number(plazo) ?? 0,
      producto,
      fecha,
    };
  }

  // EL PLAN DE PAGOS — una fecha programada por cuota, ligada al día de
  // cobranza del crédito. Las FECHAS siempre salen del mismo método que
  // vencimientosEntre (misma cuenta que ya es confiable para la mora) — eso no
  // cambia nunca. Lo que sí cambia es de dónde sale el MONTO/desglose de cada
  // fecha:
  //
  // CORRECCIÓN 09-sep-2026: la primera versión de esta función (09-sep-2026,
  // misma tarde) asumía que no existía ningún motor de amortización en el
  // sistema — así lo documentaba CU-014 §10 en ese momento — y por eso solo
  // repetía la cuota manual en cada fecha, sin desglose. Resulta que
  // motor-reglas.js (mergeado a develop ANTES de hoy, commits 196611b..0978c25,
  // nadie lo había conectado aquí) sí calcula una tabla de amortización real
  // —capital, interés e IVA por pago, contra el catálogo de
  // data/reglas-productos.json— y ya se usa para "ver el desglose de un
  // crédito vivo" (desgloseDeCredito, en server.js). Ahora el plan de pagos
  // intenta ESA tabla real primero, con el mismo criterio de "no se inventa,
  // se dice qué falta" que ya sigue el motor: si el producto no resuelve
  // contra el catálogo (motor.resolverCredito o motor.tablaAmortizacion se
  // niegan — falta equivalencia, falta plazo, monto fuera de rango, etc.), cae
  // al respaldo de siempre: la cuota manual repetida en cada fecha, sin
  // desglose. Cada pago del plan trae `fuente: "motor"` o `fuente: "manual"`
  // para que nunca se confunda un desglose real con uno de respaldo.
  function generarPlanPagos(credito, desembolsoISO, diaPagoStr, cuotaManual) {
    const diaIdx = idxDia(diaPagoStr);
    const des = String(desembolsoISO ?? "").slice(0, 10);
    const n = Number(credito?.plazo) || 0;
    if (!diaIdx || !/^\d{4}-\d{2}-\d{2}$/.test(des) || n <= 0) return [];

    const fechas = [];
    {
      let cursor = diaSiguiente(des), numero = 0, guardas = 0;   // tope: ~10 años
      while (numero < n && guardas < 3660) {
        const d = new Date(`${cursor}T12:00:00`);
        const g = d.getDay();
        if ((g === 0 ? 7 : g) === diaIdx) { numero++; fechas.push(cursor); }
        cursor = diaSiguiente(cursor);
        guardas++;
      }
    }

    // Intento 1 — motor de reglas real, si el producto resuelve contra el
    // catálogo. Se usa el IMPORTE (el capital prestado), no el saldo con
    // interés ya cargado, para elegir variante y calcular la tabla — mismo
    // criterio que desgloseDeCredito.
    const monto = Number(credito?.importe) || 0;
    if (monto > 0) {
      try {
        const r = motor.resolverCredito({ ...credito, saldo: monto });
        if (r?.ok) {
          const t = motor.tablaAmortizacion({ producto: r.clave, monto, plazo: n, ciclo: r.ciclo });
          if (t?.ok && t.pagos.length === fechas.length) {
            return t.pagos.map((p, i) => ({
              numero: p.n, fecha_programada: fechas[i], monto: p.cuota,
              capital: p.capital, interes: p.interes, iva: p.iva, saldo: p.saldo,
              fuente: "motor", producto: r.clave,
            }));
          }
        }
      } catch (error) {
        // El motor no debe tumbar el alta/recrédito: si falla, cae al
        // respaldo de cuota manual — se documenta el porqué, no se oculta.
        console.error(`[generarPlanPagos] motor.resolverCredito/tablaAmortizacion falló, usando respaldo manual: ${error.message}`);
      }
    }

    // Intento 2 (respaldo) — cuota manual repetida, sin desglose. La cuota es
    // la que ya capturó quien dio de alta; no se recalcula ni se inventa.
    return fechas.map((fecha, i) => ({
      numero: i + 1, fecha_programada: fecha, monto: Number(cuotaManual) ?? 0,
      fuente: "manual",
    }));
  }

  // Junta las tres piezas y las cuelga en el crédito, en el mismo acto de alta
  // o recrédito. Si falta desembolso, día de pago o plazo, el plan de pagos
  // sale vacío (igual que calendarioDelCredito ya devuelve null cuando "no hay
  // calendario confiable") — no bloquea el alta, solo no se puede generar
  // todavía.
  function sincronizarAlDesembolsar(clienta, comisionCapturada, seguroCapturado) {
    const { id, producto, importe, plazo, desembolso, diaPago, cuota } = clienta;
    const pagare = generarPagare(id, producto, importe, plazo, desembolso);
    const planPagos = generarPlanPagos(clienta, desembolso, diaPago, cuota);
    const sobreDispersion = generarSobreDispersion(importe, comisionCapturada, seguroCapturado);
    // Inmutable: regresa una clienta nueva en vez de mutar el argumento — quien
    // llama debe reasignar su variable con el resultado.
    return { ...clienta, pagare, planPagos, sobreDispersion };
  }

  return {
    generarSobreDispersion,
    generarPagare,
    generarPlanPagos,
    sincronizarAlDesembolsar,
  };
};
