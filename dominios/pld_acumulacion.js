// ===================================================================
// DOMINIO · ACUMULACIÓN PLD POR CLIENTA (CU-017)
//
// R11.3 (ANEXO F, confirmada textual): sumar el monto otorgado a una misma
// clienta en ventanas móviles de seis meses. Umbral: 1,605 UMA (Anexo G,
// G.5-G.7; PLD-01, 02-sep-2026). Acumulación POR CLIENTA, todos sus créditos
// en la ventana (PLD-01). El sistema SOLO MARCA, NUNCA BLOQUEA (PLD-02).
//
// TRES REGLAS QUE NO SE NEGOCIAN:
//   1. La UMA vive versionada por fecha en data/uma.json — nunca un número
//      fijo. Si no hay UMA para la fecha, NO SE ADIVINA: el cálculo se niega y
//      deja constancia (CU-017 §5); la operación sigue.
//   2. Umbral (PLD_UMBRAL_UMA) y ventana (PLD_VENTANA_DIAS) son parámetros de
//      entorno — patrón PORCENTAJE_GARANTIA_LIQUIDA.
//   3. Nunca bloquea: devuelve la marca y el desembolso procede igual.
//
// POR QUÉ "estimado": los créditos que vienen de la PLANTILLA no traen
// `importe`, solo su saldo al corte — cota INFERIOR de lo otorgado. Se cuentan
// marcados `estimado:true`: la alerta es conservadora, nunca se infla.
// ===================================================================
"use strict";

const fs = require("fs");

const REGISTRO_ALERTAS = "pld_alertas";
const TIPO_ALERTA = "alerta";
const TIPO_SIN_UMA = "sin_uma";

const normalizar = (texto) => String(texto ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const limpiarSocio = (socio) => String(socio ?? "").replace(/[\s\-.]/g, "").trim();
const redondear = (numero) => Math.round((Number(numero) || 0) * 100) / 100;
const esFechaISO = (fecha) => /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? ""));
const restarDias = (fechaISO, dias) => {
  const fecha = new Date(`${fechaISO}T12:00:00`);
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString().slice(0, 10);
};
const estaVivo = (credito) => credito.activa !== false && credito.estatus !== "BAJA";
const rechazo = (status, error) => ({ status, error });

module.exports = function crearDominioPLD({ store, hoyMX, obtenerPadron, idsEjecutivos, usuarios, umbralUMA, ventanaDias, archivoUMA }) {
  // Se relee en cada consulta (archivo chico): cargar la UMA del año nuevo
  // surte efecto sin reiniciar, igual que el motor de reglas.
  function tablaUMA() {
    try {
      const { valores = [] } = JSON.parse(fs.readFileSync(archivoUMA, "utf8"));
      return valores
        .filter((valor) => esFechaISO(valor.vigenteDesde) && Number(valor.diaria) > 0)
        .sort((a, b) => a.vigenteDesde.localeCompare(b.vigenteDesde));
    } catch {
      return [];
    }
  }

  // La última UMA cuya vigencia empezó en o antes de la fecha; null si no hay.
  function umaVigente(fechaISO) {
    const fecha = esFechaISO(fechaISO) ? fechaISO : hoyMX();
    const vigente = tablaUMA().filter((valor) => valor.vigenteDesde <= fecha).at(-1);
    return vigente ? { diaria: Number(vigente.diaria), vigenteDesde: vigente.vigenteDesde, fuente: vigente.fuente ?? null } : null;
  }

  // Vivos y de baja: R11.3 dice "activos o liquidados".
  const creditosDeLaClienta = (socio) => {
    const id = limpiarSocio(socio);
    return obtenerPadron().filter((credito) => String(credito.id) === id && esFechaISO(credito.desembolso));
  };

  function montoOtorgado(credito) {
    const importe = Number(credito.importe) || 0;
    if (importe > 0) return { monto: importe, estimado: false };
    return { monto: Number(credito.saldoDelAlta) || Number(credito.saldo) || 0, estimado: true };
  }

  const resumenCredito = (credito) => {
    const { monto, estimado } = montoOtorgado(credito);
    return { producto: credito.producto, desembolso: credito.desembolso, monto: redondear(monto), estimado, activo: estaVivo(credito) };
  };

  // Suma en ventana móvil. Se llama ANTES de escribir el crédito nuevo al
  // padrón, así el nuevo no se cuenta dos veces.
  function acumulacion(socio, fechaRef, montoNuevo) {
    const fecha = esFechaISO(fechaRef) ? fechaRef : hoyMX();
    const desde = restarDias(fecha, ventanaDias);
    const creditos = creditosDeLaClienta(socio)
      .filter((credito) => credito.desembolso >= desde && credito.desembolso <= fecha)
      .map(resumenCredito);
    const acumuladoPrevio = redondear(creditos.reduce((suma, credito) => suma + credito.monto, 0));
    const estimados = creditos.filter((credito) => credito.estimado).length;
    const nuevo = redondear(Number(montoNuevo) || 0);
    const acumulado = redondear(acumuladoPrevio + nuevo);
    const uma = umaVigente(fecha);
    const umbralPesos = uma ? redondear(uma.diaria * umbralUMA) : null;
    return {
      socio: limpiarSocio(socio), fechaRef: fecha, ventanaDias, ventanaDesde: desde,
      creditos, acumuladoPrevio, montoNuevo: nuevo, acumulado, estimados,
      uma, umbralUMA, umbralPesos,
      supera: uma ? acumulado > umbralPesos : null,   // null = no se pudo evaluar
      faltaUMA: !uma,
      bloquea: false,   // PLD-02
    };
  }

  // Consulta previa a un desembolso, con validación del socio.
  function consultarAcumulacion({ id, fecha, monto }) {
    const socio = limpiarSocio(id);
    if (!/^\d{5,15}$/.test(socio)) return rechazo(400, "Número de socio inválido (solo dígitos).");
    return { ...acumulacion(socio, fecha, Number(monto) || 0), pendientes: pendientes() };
  }

  function filaBase(clienta, calculo, usuario) {
    return {
      socio: String(clienta.id), nombre: clienta.nombre, centro: clienta.centro, producto: clienta.producto,
      desembolso: clienta.desembolso, montoNuevo: calculo.montoNuevo, acumulado: calculo.acumulado, acumuladoPrevio: calculo.acumuladoPrevio,
      creditosEnVentana: calculo.creditos.length, estimados: calculo.estimados,
      umbralUMA, umbralPesos: calculo.umbralPesos, uma: calculo.uma?.diaria ?? null,
      fecha: hoyMX(), fechaHora: new Date().toISOString(),
      usuario: usuario?.nombre ?? null, usuarioId: usuario?.id ?? null,
    };
  }

  // Al desembolsar (alta, renovación, dispersar). Si supera, deja la alerta en
  // el registro append-only y regresa la marca para colgarla del crédito. Si
  // falta UMA, deja constancia y regresa `activa: null` — la operación no se
  // detiene por eso (PLD-02), pero queda visible que no se pudo vigilar.
  function evaluarAlDesembolsar(clienta, usuario) {
    if (!clienta || !esFechaISO(clienta.desembolso)) return null;
    const calculo = acumulacion(clienta.id, clienta.desembolso, Number(clienta.importe) || Number(clienta.saldo) || 0);
    const base = filaBase(clienta, calculo, usuario);
    if (calculo.faltaUMA) {
      const motivo = `No hay valor de UMA cargado para ${clienta.desembolso} en data/uma.json; no se puede evaluar el umbral. Cargarlo y reevaluar.`;
      const fila = store.agregarRegistro(REGISTRO_ALERTAS, { tipo: TIPO_SIN_UMA, motivo, ...base });
      return { activa: null, evaluada: false, motivo, fecha: fila.fecha };
    }
    const { acumulado, umbralPesos } = calculo;
    if (!calculo.supera) return { activa: false, evaluada: true, acumulado, umbralPesos, fecha: base.fecha };
    const fila = store.agregarRegistro(REGISTRO_ALERTAS, { tipo: TIPO_ALERTA, ...base });
    return {
      activa: true, evaluada: true, acumulado, umbralPesos, fecha: fila.fecha, ts: fila.ts,
      aviso: `Supera ${umbralUMA} UMA en 6 meses: marcada para aviso PLD (no bloquea).`,
    };
  }

  // Alertas y desembolsos sin evaluar, en la burbuja del usuario.
  function alertasPLD(usuario) {
    const mias = new Set(idsEjecutivos(usuario).map((clave) => normalizar(usuarios[clave].nombre)));
    const ejecutivoPorSocio = Object.fromEntries(obtenerPadron().map((credito) => [String(credito.id), credito.ejecutivo]));
    return store.registro(REGISTRO_ALERTAS).filter((fila) => mias.has(normalizar(ejecutivoPorSocio[fila.socio])));
  }

  function resumenAlertas(usuario) {
    const todas = alertasPLD(usuario);
    return {
      alertas: todas.filter((fila) => fila.tipo === TIPO_ALERTA),
      sinUMA: todas.filter((fila) => fila.tipo === TIPO_SIN_UMA),
      umbralUMA, ventanaDias, umaHoy: umaVigente(hoyMX()), pendientes: pendientes(),
    };
  }

  const resumenUMA = () => ({ valores: tablaUMA(), vigenteHoy: umaVigente(hoyMX()), umbralUMA });

  function pendientes() {
    return [
      { tema: "Reporte de aviso dedicado (Regla G.7)", motivo: "CLIC todavía no manda la lista de campos; aquí solo queda la marca y el acumulado.", responsable: "CLIC / Contadora Consuelo" },
      { tema: "Valores históricos de UMA", motivo: "data/uma.json trae solo la UMA 2026 (confirmada por Anexo G: 1,605 UMA = $188,282.55). Cada 1 de febrero hay que cargar el valor nuevo (INEGI); sin él, el cálculo se niega.", responsable: "Sistemas" },
      { tema: "Monto otorgado de créditos de plantilla", motivo: "Los créditos que vienen del Excel no traen importe; se cuenta su saldo al corte (cota inferior, marcado 'estimado'). La alerta es conservadora hasta que el padrón traiga el monto original.", responsable: "Administración (Monse)" },
    ];
  }

  return {
    REGISTRO_ALERTAS, tablaUMA, umaVigente, creditosDeLaClienta, montoOtorgado, acumulacion, consultarAcumulacion,
    evaluarAlDesembolsar, alertasPLD, resumenAlertas, resumenUMA, pendientes,
  };
};
