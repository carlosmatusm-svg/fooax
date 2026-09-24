// ===================================================================
// DOMINIO · CONTADOR DE CICLOS LIMPIOS (CU-019, parcial — R5.2 Anexo E/F, TASA-01)
//
// R5.2: el contador vive en el PERFIL DE LA CLIENTA; +1 al liquidar un crédito
// sin un solo día de mora; reinicio inmediato (hard reset) al primer día de
// mora en CUALQUIER crédito activo. Umbral: TRES ciclos (TASA-01, Dirección
// General, 02-sep-2026).
//
// QUÉ ES "PARCIAL": construye el contador y dice si aplica la tasa
// preferencial; NO propone tasa (monto de la baja pendiente de Chamuel Lopez;
// el catálogo no trae tasa_min/tasa_max).
//
// CÓMO SE DERIVA: el contador vigente es el `contadorDespues` de la última fila
// del registro append-only `ciclos_limpios`. Las filas nacen por evaluación
// PEREZOSA e IDEMPOTENTE (`sincronizar`): al consultar o al originar se revisan
// (1) los ciclos terminados aún sin veredicto — cada uno suma o reinicia UNA
// sola vez — y (2) la mora viva en créditos activos. Como todo desembolso
// pasa por aquí, la clienta nunca recibe el beneficio con un atraso vivo.
//
// "SIN UN SOLO DÍA DE MORA" en un ciclo terminado:
//   a) con `planPagos` (sincronización al desembolsar): por amortización, lo
//      pagado acumulado en o antes de cada fecha programada cubre lo exigible.
//   b) sin plan (plantilla): lo que el sistema sabe — mora capturada, ajustes
//      de Dirección con mora/vencido, estatus. Aproximación conservadora hacia
//      la clienta, marcada `evaluacion:"aproximada"`.
// Una BAJA que no fue "liquidó y renovó" (castigo, cancelación) reinicia.
// ===================================================================
"use strict";

const REGISTRO = "ciclos_limpios";
const TOLERANCIA_PESOS = 0.5;
const SALDO_CERO = 0.009;

const normalizar = (texto) => String(texto ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const limpiarSocio = (socio) => String(socio ?? "").replace(/[\s\-.]/g, "").trim();
const redondear = (numero) => Math.round((Number(numero) || 0) * 100) / 100;
const esFechaISO = (fecha) => /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? ""));
const estaDeBaja = (credito) => credito.estatus === "BAJA" || credito.activa === false;
const fechaNacimiento = (credito) => String(credito.alta_fecha ?? credito.desembolso ?? "");
const sumarHasta = (montosPorFecha, fechaLimite) => Object.entries(montosPorFecha)
  .filter(([fecha]) => fecha <= fechaLimite)
  .reduce((total, [, monto]) => total + (Number(monto) || 0), 0);
const rechazo = (status, error) => ({ status, error });

// Identidad de un ciclo: socio + producto + número de ciclo interno (el
// recrédito lo pone; el primero no lo trae) + fecha en que nació. Así un mismo
// producto renovado 3 veces son 3 ciclos, aun registrados el mismo día.
const llaveCiclo = (credito) => `${normalizar(credito.id)}|${normalizar(credito.producto)}|c${Number(credito.ciclo) || 1}|${fechaNacimiento(credito) || "base"}`;

module.exports = function crearDominioCiclosLimpios({
  store, hoyMX, obtenerPadron, idsEjecutivos, usuarios, claveCredito, infoCredito, carteraViva,
  pagosPorFecha, esVencido, atrasoEnPagos, vencidaPorPlazo, umbralCiclos,
}) {
  const filasDe = (socio) => {
    const id = limpiarSocio(socio);
    return store.registro(REGISTRO).filter((fila) => String(fila.socio) === id);
  };
  const contadorDe = (socio) => Number(filasDe(socio).at(-1)?.contadorDespues) || 0;

  function clientaVisible(usuario, socio) {
    const id = limpiarSocio(socio);
    const mias = new Set(idsEjecutivos(usuario).map((clave) => normalizar(usuarios[clave].nombre)));
    return obtenerPadron().some((credito) => String(credito.id) === id && mias.has(normalizar(credito.ejecutivo)));
  }

  // ¿Dirección le registró mora o estatus vencido durante este ciclo?
  function ajustesConMora(credito) {
    const desde = fechaNacimiento(credito);
    return store.cambiosPadron().some((cambio) => cambio.tipo === "ajuste"
      && String(cambio.id) === String(credito.id)
      && normalizar(cambio.producto) === normalizar(credito.producto)
      && (!desde || String(cambio.fecha ?? "") >= desde)
      && (Number(cambio.campos?.mora) > 0 || /vencid/i.test(String(cambio.campos?.estatus ?? ""))));
  }

  // Pagos por fecha que pertenecen a ESTE ciclo. La llave socio+producto la
  // comparten todos los ciclos del producto, así que hay que partirla: si el
  // ciclo tiene SUCESOR, éste guardó al nacer el desglose exacto por día de lo
  // que abonó el viejo (`previo.dias` / `previo.diasLiq`); si es el vigente,
  // son los pagos de la llave menos lo que su propio `previo` atribuyó atrás.
  function pagosDelCiclo(credito, creditos, pagosPorLlave, info) {
    const sucesor = creditos.find((otro) => otro !== credito
      && normalizar(otro.producto) === normalizar(credito.producto)
      && String(otro.alta_fecha ?? "") >= String(credito.alta_fecha ?? "")
      && otro.previo
      && (String(otro.desembolso ?? "") > String(credito.desembolso ?? "") || (otro.ciclo ?? 0) > (credito.ciclo ?? 0)));
    if (sucesor) return { pagos: sucesor.previo.dias ?? {}, liq: sucesor.previo.diasLiq ?? {} };

    const base = pagosPorLlave[claveCredito(credito.id, credito.producto)] ?? {};
    const atribuidosAtras = credito.previo?.dias ?? {};
    const pagos = Object.fromEntries(Object.entries(base)
      .map(([fecha, nodo]) => [fecha, redondear((Number(nodo.p) || 0) - (Number(atribuidosAtras[fecha]) || 0))])
      .filter(([, monto]) => monto > 0));
    const liquidado = Number(info?.liquidado) || 0;
    const primerDiaLiq = info?.fechasLiq?.length ? [...info.fechasLiq].sort()[0] : null;
    const liq = liquidado > 0 && primerDiaLiq ? { [primerDiaLiq]: liquidado } : {};
    return { pagos, liq };
  }

  // Veredicto exacto por amortización (R5.2). null si el crédito no trae plan.
  function evaluarPorPlan(credito, movimientos) {
    const plan = (credito.planPagos ?? [])
      .filter((pago) => esFechaISO(pago.fecha_programada))
      .sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada));
    if (!plan.length) return null;
    const tarde = plan.reduce((estado, pago) => {
      if (estado.tarde) return estado;
      const exigible = estado.exigible + (Number(pago.monto) || 0);
      const pagado = sumarHasta(movimientos.pagos, pago.fecha_programada) + sumarHasta(movimientos.liq, pago.fecha_programada);
      return pagado + TOLERANCIA_PESOS < exigible ? { exigible, tarde: { pago, exigible, pagado } } : { exigible, tarde: null };
    }, { exigible: 0, tarde: null }).tarde;
    if (tarde) {
      return { limpio: false, motivo: `Amortización ${tarde.pago.numero} (${tarde.pago.fecha_programada}) se cubrió tarde: exigible $${redondear(tarde.exigible)}, pagado a esa fecha $${redondear(tarde.pagado)}.` };
    }
    return { limpio: true, motivo: `Las ${plan.length} amortizaciones se cubrieron en o antes de su fecha.` };
  }

  // Veredicto de un crédito TERMINADO (saldo cero o baja).
  function evaluarCicloTerminado(credito, info, movimientos) {
    const cerradoLiquidado = /renov|recr[eé]dito/i.test(String(credito.motivo_baja ?? "")) || (info?.saldoActual ?? 0) <= SALDO_CERO;
    if (credito.estatus === "BAJA" && !cerradoLiquidado) {
      return { limpio: false, evaluacion: "exacta", motivo: `Baja sin liquidar (${credito.motivo_baja ?? "sin motivo"}).` };
    }
    if (Number(credito.mora) > 0) return { limpio: false, evaluacion: "exacta", motivo: `Cerró con mora capturada ($${redondear(credito.mora)}).` };
    if (esVencido(credito)) return { limpio: false, evaluacion: "exacta", motivo: "Cerró con estatus vencido." };
    if (ajustesConMora(credito)) return { limpio: false, evaluacion: "exacta", motivo: "Dirección le registró mora o estatus vencido durante el ciclo." };
    const porPlan = evaluarPorPlan(credito, movimientos);
    if (porPlan) return { evaluacion: "exacta", ...porPlan };
    return { limpio: true, evaluacion: "aproximada", motivo: "Sin plan de pagos con fechas (crédito de plantilla): no hay rastro de mora en todo el ciclo." };
  }

  // Motivo de mora viva HOY en un crédito activo, o null (hard reset, R5.2).
  function moraViva(credito, info) {
    if (Number(credito.mora) > 0) return `mora capturada $${redondear(credito.mora)}`;
    if (esVencido(credito)) return "estatus vencido";
    const atraso = atrasoEnPagos(credito, info);
    if (atraso != null && atraso > 0) return `${atraso} pago(s) de atraso`;
    if (vencidaPorPlazo(credito, info)) return "plazo terminado con saldo";
    return null;
  }

  const escribir = (socio, evento, contadorAntes, contadorDespues, detalle, usuario) => store.agregarRegistro(REGISTRO, {
    socio: String(socio), evento, contadorAntes, contadorDespues,
    fecha: hoyMX(), fechaHora: new Date().toISOString(),
    usuario: usuario?.nombre ?? "Sistema", usuarioId: usuario?.id ?? null,
    ...detalle,
  });

  // (1) Ciclos terminados todavía sin veredicto, en orden de nacimiento.
  function registrarCiclosTerminados(id, creditos, cartera, pagosPorLlave, contadorInicial, usuario) {
    const yaEvaluados = new Set(filasDe(id).map((fila) => fila.ciclo).filter(Boolean));
    return creditos.reduce((estado, credito) => {
      const llave = llaveCiclo(credito);
      if (yaEvaluados.has(llave)) return estado;
      const info = infoCredito(cartera, credito);
      const terminado = estaDeBaja(credito) || (info.saldoActual ?? 0) <= SALDO_CERO;
      if (!terminado) return estado;
      const veredicto = evaluarCicloTerminado(credito, info, pagosDelCiclo(credito, creditos, pagosPorLlave, info));
      const contador = veredicto.limpio ? estado.contador + 1 : 0;
      escribir(id, veredicto.limpio ? "suma" : "reinicio", estado.contador, contador, {
        ciclo: llave, producto: credito.producto, cicloNumero: credito.ciclo ?? null, desembolso: credito.desembolso ?? null,
        limpio: veredicto.limpio, evaluacion: veredicto.evaluacion, motivo: veredicto.motivo,
      }, usuario);
      return { contador, nuevas: estado.nuevas + 1 };
    }, { contador: contadorInicial, nuevas: 0 });
  }

  // (2) Hard reset: un solo reinicio aunque haya varios créditos en mora (§5).
  function registrarMoraViva(id, creditos, cartera, contador, usuario) {
    if (contador <= 0) return { contador, nuevas: 0 };
    const enMora = creditos
      .filter((credito) => !estaDeBaja(credito))
      .map((credito) => ({ credito, info: infoCredito(cartera, credito) }))
      .filter(({ info }) => (info.saldoActual ?? 0) > SALDO_CERO)
      .map(({ credito, info }) => ({ credito, motivo: moraViva(credito, info) }))
      .find(({ motivo }) => motivo);
    if (!enMora) return { contador, nuevas: 0 };
    escribir(id, "reinicio", contador, 0, {
      producto: enMora.credito.producto, desembolso: enMora.credito.desembolso ?? null, limpio: false, evaluacion: "exacta",
      motivo: `Mora viva en crédito activo: ${enMora.motivo} (reinicio inmediato, R5.2).`,
    }, usuario);
    return { contador: 0, nuevas: 1 };
  }

  // Evaluación perezosa e idempotente. Regresa el estado vigente.
  function sincronizar(socio, usuario) {
    const id = limpiarSocio(socio);
    const cartera = carteraViva(usuario);
    const pagosPorLlave = pagosPorFecha(usuario);
    const creditos = obtenerPadron()
      .filter((credito) => String(credito.id) === id)
      .sort((a, b) => fechaNacimiento(a).localeCompare(fechaNacimiento(b)));
    const trasCiclos = registrarCiclosTerminados(id, creditos, cartera, pagosPorLlave, contadorDe(id), usuario);
    const trasMora = registrarMoraViva(id, creditos, cartera, trasCiclos.contador, usuario);
    return estado(id, trasCiclos.nuevas + trasMora.nuevas);
  }

  function estado(socio, filasNuevas = 0) {
    const id = limpiarSocio(socio);
    const historial = filasDe(id);
    const contador = contadorDe(id);
    return {
      socio: id, contador, umbralCiclos,
      aplicaTasaPreferencial: contador >= umbralCiclos,
      faltanParaTasaPreferencial: Math.max(0, umbralCiclos - contador),
      tasaPreferencial: null,   // sin catálogo con rango ni monto de la baja, no se propone
      ultimoEvento: historial.at(-1) ?? null,
      historial, filasNuevas,
      pendientes: pendientes(),
    };
  }

  // Ficha para Dirección/Cumplimiento, con validación de acceso.
  function consultar(usuario, socio) {
    const id = limpiarSocio(socio);
    if (!clientaVisible(usuario, id)) return rechazo(404, "Esa clienta no está en el padrón (o no es de tu burbuja).");
    return sincronizar(id, usuario);
  }

  // Lo que se cuelga del crédito nuevo al originar. El contador jamás debe
  // tumbar un alta: si algo falla, se anota y el alta sigue.
  function marcaParaCredito(socio, usuario) {
    try {
      const { contador, umbralCiclos: umbral, aplicaTasaPreferencial } = sincronizar(socio, usuario);
      return { contador, umbral, aplicaTasaPreferencial, tasaPreferencial: null };
    } catch (error) {
      console.error(`[ciclos limpios] ${socio}: ${error.message}`);
      return null;
    }
  }

  function pendientes() {
    return [
      { tema: "Monto de la baja de tasa preferencial", motivo: "El umbral (3 ciclos) ya está definido (TASA-01); de cuánto es la baja sigue abierto. Mientras, el sistema solo marca `aplicaTasaPreferencial`.", responsable: "Chamuel Lopez" },
      { tema: "tasa_min / tasa_max por producto", motivo: "El catálogo (data/reglas-productos.json) trae una tasaMensual única por producto; sin rango no hay tasa que proponer (PENDIENTES §1).", responsable: "Dirección / Carlos" },
      { tema: "Reinicio individual vs. global con varios créditos activos", motivo: "Se implementó GLOBAL por clienta (UC-EXP-06 y R5.2: 'en el perfil de la clienta'); ningún anexo lo confirma de forma independiente (CU-019 §10.3).", responsable: "Dirección" },
      { tema: "Créditos de plantilla sin plan de pagos", motivo: "Sin fechas por amortización, el veredicto es aproximado (sin rastro de mora = limpio) y así queda marcado en cada fila.", responsable: "Administración (Monse)" },
    ];
  }

  return {
    REGISTRO, llaveCiclo, filasDe, contadorDe, clientaVisible, pagosDelCiclo, evaluarCicloTerminado, evaluarPorPlan, moraViva,
    sincronizar, estado, consultar, marcaParaCredito, pendientes,
  };
};
