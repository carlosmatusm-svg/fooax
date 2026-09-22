// ===================================================================
// DOMINIO · EXPEDIENTE DE LA CLIENTA (CU-009 alta y captura en campo; CU-010
// checklist, validación y candado)
//
// Reconstruido 11-sep-2026 en el repo real (develop: padrón + registros
// append-only). Del build del fork (store_expediente.js + Postgres) se toman
// solo los catálogos ya documentados en CU-009 (PEP, checklist, topes).
//
// QUÉ ES EL EXPEDIENTE AQUÍ: un registro append-only `expediente` con EVENTOS
// por clienta (captura, documento, validacion). El expediente vigente se
// DERIVA de los eventos: la captura más reciente da los datos; el documento
// más reciente de cada propietario+tipo da el checklist; la última validación
// vale solo si es posterior al último cambio. Nunca se edita ni se borra un
// evento (CU-009 §8, Requerimiento Maestro §11).
//
// REGLAS QUE NO SE NEGOCIAN (CU-009 §6, CU-010 §6):
//   1. Dar de alta NO es autorizar: la clienta nace en estado "captura" y NO
//      se escribe al padrón de cobranza (eso pasa al dispersar, CU-013).
//   2. Responsable y aval son entidades separadas con tope propio
//      (TOPE_RESPONSABLE, TOPE_AVAL; parámetros de entorno).
//   3. PEP con catálogo cerrado de tipo y parentesco (Art. 95 Bis LGOAAC).
//   4. Las referencias son terceros: su consentimiento se captura aparte.
//   5. CURP y RFC únicos entre clientas (CU-009 §10.5) — validación de
//      aplicación, la única posible con archivos/jsonb.
//   6. Expediente incompleto o sin validar = desembolso cancelado, sin
//      excepciones; quien valida no dispersa.
//
// LO QUE NO HACE: no guarda IMÁGENES (solo metadatos del documento; el cifrado
// está pendiente, CU-009 §10.2) ni valida biométricamente la Firma 1.
// ===================================================================
"use strict";

const REGISTRO = "expediente";
const EVENTO = { CAPTURA: "captura", DOCUMENTO: "documento", VALIDACION: "validacion", ESTADO: "estado" };
const ESTADO_INICIAL = "captura";
const REFERENCIAS_REQUERIDAS = 2;
const MOTIVO_MINIMO = 5;
const INTENTOS_SOCIO = 50;
const AFIRMATIVOS = new Set(["true", "si", "sí"]);

// Catálogos cerrados. Actividad y origen son PROVISIONALES hasta que Contaduría
// confirme el catálogo oficial PLD (Art. 95 Bis LGOAAC).
const PEP_TIPOS = ["Nacional", "Extranjero", "Organismo internacional"];
const PEP_PARENTESCOS = ["La propia clienta", "Cónyuge o concubino(a)", "Padre o madre", "Hijo(a)", "Hermano(a)", "Otro pariente en línea recta"];
const ACTIVIDADES_ECONOMICAS = ["Comercio", "Servicios", "Manufactura o producción", "Agropecuario", "Otro"];
const ORIGENES_RECURSOS = ["Ingresos del negocio", "Sueldo o salario", "Remesas", "Apoyo familiar", "Pensión", "Otro"];
const ESTADOS_CIVILES = ["Soltera(o)", "Casada(o)", "Unión libre", "Divorciada(o)", "Viuda(o)", "Separada(o)"];
const GENEROS = ["Mujer", "Hombre", "Otro"];
const TIPOS_CREDITO = ["grupal", "individual"];
const IDENTIFICACIONES = ["INE", "Pasaporte", "Cédula profesional", "INAPAM"];
const RELACIONES_REFERENCIA = ["Familiar", "Vecina(o)", "Amiga(o)", "Compañera(o) de trabajo", "Otro"];
const PROPIETARIOS = ["solicitante", "responsable", "aval"];
const TIPOS_DOCUMENTO = ["ine", "comprobante_domicilio", "curp", "foto_negocio"];
// Documentos que exige el checklist (Sección 12 de la Solicitud de Crédito 2026).
const CHECKLIST = {
  solicitante: ["ine", "comprobante_domicilio", "curp", "foto_negocio"],
  responsable: ["ine", "comprobante_domicilio"],
  aval: ["ine", "comprobante_domicilio"],
};
// Campos que deben estar llenos para que el expediente sea íntegro (LFPIORPI
// por habitualidad; CU-010 §4.3).
const CAMPOS_PLD = [
  ["curp", (datos) => datos.curp], ["rfc", (datos) => datos.rfc], ["identificacion.folio", (datos) => datos.identificacion?.folio],
  ["domicilio.calle", (datos) => datos.domicilio?.calle], ["domicilio.numero", (datos) => datos.domicilio?.numero],
  ["domicilio.colonia", (datos) => datos.domicilio?.colonia], ["domicilio.cp", (datos) => datos.domicilio?.cp],
  ["domicilio.municipio", (datos) => datos.domicilio?.municipio], ["domicilio.estado", (datos) => datos.domicilio?.estado],
  ["actividadEconomica", (datos) => datos.actividadEconomica], ["origenRecursos", (datos, expediente) => expediente.pld?.origenRecursos],
];
const CAMPOS_IDENTIDAD = ["apellidoPaterno", "nombres", "curp", "rfc", "fechaNacimiento", "lugarNacimiento", "nacionalidad", "telefonoMovil"];
const CAMPOS_DOMICILIO = ["calle", "numero", "colonia", "cp", "municipio", "ciudad", "estado"];
const CAMPOS_NEGOCIO = ["giro", "antiguedadMeses", "ingresoDeclarado"];
const CAMPOS_CAPACIDAD = ["ingresoSemanal", "gastosNegocio", "gastosHogar", "mesIngresoMasBajo", "capacidadPago"];
const CAMPOS_OTROS_CREDITOS = ["institucion", "monto", "deudaActual", "pagoSemanal"];
const CAMPOS_VIVIENDA = ["tipo", "superficie", "niveles", "habitaciones", "paredes", "piso", "techo"];
const CAMPOS_FAMILIA = ["dependientes", "hijosMenores", "otroIngreso", "ingresoTotalHogar"];
const CAMPOS_PERSONA = ["nombre", "curp", "telefono", "domicilio", "ocupacion", "identificacion"];

const RE_CURP = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/;
const RE_RFC = /^[A-ZÑ&]{3,4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
const RE_SOCIO = /^\d{5,15}$/;
const RE_CP = /^\d{5}$/;

const normalizar = (texto) => String(texto ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const limpiarSocio = (socio) => String(socio ?? "").replace(/[\s\-.]/g, "").trim();
const texto = (valor) => String(valor ?? "").trim();
const textoONulo = (valor) => texto(valor) || null;
const estaVacio = (valor) => texto(valor) === "";
const esFechaISO = (fecha) => /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? ""));
const esAfirmativo = (valor) => valor === true || AFIRMATIVOS.has(String(valor).toLowerCase());
const buscarEnCatalogo = (catalogo, valor) => catalogo.find((opcion) => normalizar(opcion) === normalizar(valor)) ?? null;
const coordenadas = (gps) => (gps && Number.isFinite(Number(gps.lat)) && Number.isFinite(Number(gps.lng))
  ? { lat: Number(gps.lat), lng: Number(gps.lng) }
  : null);
const faltantesDe = (objeto, campos, prefijo) => campos.filter((campo) => estaVacio(objeto[campo])).map((campo) => `${prefijo}: falta ${campo}.`);
const rechazo = (status, error, extra = {}) => ({ status, error, ...extra });
const nombreCompleto = (datos) => (datos ? [datos.nombres, datos.apellidoPaterno, datos.apellidoMaterno].filter(Boolean).join(" ") : "");

// ---------- validaciones puras: cada una regresa { valor, errores } ----------

function normalizarDatos(datosEnviados) {
  const entrada = datosEnviados ?? {};
  const gps = coordenadas(entrada.gps);
  const datos = {
    apellidoPaterno: texto(entrada.apellidoPaterno), apellidoMaterno: texto(entrada.apellidoMaterno), nombres: texto(entrada.nombres),
    curp: normalizar(entrada.curp), rfc: normalizar(entrada.rfc), fechaNacimiento: texto(entrada.fechaNacimiento), lugarNacimiento: texto(entrada.lugarNacimiento),
    nacionalidad: texto(entrada.nacionalidad), estadoCivil: buscarEnCatalogo(ESTADOS_CIVILES, entrada.estadoCivil), genero: buscarEnCatalogo(GENEROS, entrada.genero),
    telefonoMovil: texto(entrada.telefonoMovil), telefonoFijo: textoONulo(entrada.telefonoFijo), correo: textoONulo(entrada.correo),
    identificacion: { tipo: buscarEnCatalogo(IDENTIFICACIONES, entrada.identificacion?.tipo), folio: texto(entrada.identificacion?.folio) },
    domicilio: { ...(entrada.domicilio ?? {}) },
    gps: gps ? { ...gps, precision: entrada.gps.precision == null || entrada.gps.precision === "" ? null : Number(entrada.gps.precision) } : null,
    negocio: { ...(entrada.negocio ?? {}) },
    actividadEconomica: buscarEnCatalogo(ACTIVIDADES_ECONOMICAS, entrada.actividadEconomica),
    capacidadPago: { ...(entrada.capacidadPago ?? {}) },
    creditosOtros: { tiene: false, ...(entrada.creditosOtros ?? {}) },
    vivienda: { ...(entrada.vivienda ?? {}) },
    familia: { ...(entrada.familia ?? {}) },
  };
  const errores = [
    ...CAMPOS_IDENTIDAD.filter((campo) => !datos[campo]).map((campo) => `Falta ${campo}.`),
    ...(datos.estadoCivil ? [] : [`Estado civil: elige uno del catálogo (${ESTADOS_CIVILES.join(", ")}).`]),
    ...(datos.genero ? [] : ["Género: elige uno del catálogo."]),
    ...(datos.curp && !RE_CURP.test(datos.curp) ? [`CURP inválido: ${datos.curp} (18 caracteres, formato oficial).`] : []),
    ...(datos.rfc && !RE_RFC.test(datos.rfc) ? [`RFC inválido: ${datos.rfc}.`] : []),
    ...(datos.fechaNacimiento && !esFechaISO(datos.fechaNacimiento) ? ["Fecha de nacimiento: usa AAAA-MM-DD."] : []),
    ...(datos.identificacion.tipo && datos.identificacion.folio ? [] : ["Identificación oficial: tipo (catálogo) y folio son obligatorios."]),
    ...faltantesDe(datos.domicilio, CAMPOS_DOMICILIO, "Domicilio"),
    ...(datos.domicilio.cp && !RE_CP.test(texto(datos.domicilio.cp)) ? ["Domicilio: el C.P. son 5 dígitos."] : []),
    ...(estaVacio(datos.domicilio.tiempoResidenciaMeses) ? ["Domicilio: falta el tiempo de residencia (meses)."] : []),
    ...(datos.gps ? [] : ["Falta el GPS del domicilio (lat/lng)."]),
    ...faltantesDe(datos.negocio, CAMPOS_NEGOCIO, "Negocio"),
    ...(datos.actividadEconomica ? [] : [`Actividad económica: elige una del catálogo PLD (${ACTIVIDADES_ECONOMICAS.join(", ")}).`]),
    ...faltantesDe(datos.capacidadPago, CAMPOS_CAPACIDAD, "Capacidad de pago"),
    ...(datos.creditosOtros.tiene === true ? faltantesDe(datos.creditosOtros, CAMPOS_OTROS_CREDITOS, "Créditos con otras instituciones") : []),
    ...faltantesDe(datos.vivienda, CAMPOS_VIVIENDA, "Vivienda"),
    ...faltantesDe(datos.familia, CAMPOS_FAMILIA, "Información familiar"),
  ];
  return { valor: datos, errores };
}

// PLD / PEP (CU-009 paso 6): catálogo cerrado, nunca texto libre.
function normalizarPLD(pldEnviado) {
  const entrada = pldEnviado ?? {};
  const pep = entrada.pep ?? {};
  const esPEP = esAfirmativo(pep.es);
  const pld = {
    origenRecursos: buscarEnCatalogo(ORIGENES_RECURSOS, entrada.origenRecursos),
    pep: esPEP
      ? {
        es: true, tipo: buscarEnCatalogo(PEP_TIPOS, pep.tipo), parentesco: buscarEnCatalogo(PEP_PARENTESCOS, pep.parentesco),
        cargo: textoONulo(pep.cargo), dependencia: textoONulo(pep.dependencia), periodo: textoONulo(pep.periodo),
      }
      : { es: false },
  };
  const errores = [
    ...(pld.origenRecursos ? [] : [`Origen de los recursos: elige uno del catálogo (${ORIGENES_RECURSOS.join(", ")}).`]),
    ...(typeof pep.es === "undefined" ? ["PEP: hay que responder Sí o No."] : []),
    ...(esPEP && !pld.pep.tipo ? [`PEP: el tipo es obligatorio y de catálogo (${PEP_TIPOS.join(", ")}).`] : []),
    ...(esPEP && !pld.pep.parentesco ? ["PEP: el parentesco es obligatorio y de catálogo."] : []),
  ];
  return { valor: pld, errores };
}

// Referencias (paso 4): dos terceros, cada una con su consentimiento.
function normalizarReferencias(entrada) {
  const lista = Array.isArray(entrada) ? entrada.slice(0, REFERENCIAS_REQUERIDAS) : [];
  const referencias = lista.map((referencia) => ({
    nombre: texto(referencia.nombre), relacion: buscarEnCatalogo(RELACIONES_REFERENCIA, referencia.relacion),
    curp: normalizar(referencia.curp) || null, telefono: texto(referencia.telefono), consentimiento: referencia.consentimiento === true,
  }));
  const errores = [
    ...referencias.flatMap((referencia, indice) => {
      const etiqueta = `Referencia ${indice + 1}`;
      return [
        ...(referencia.nombre && referencia.telefono ? [] : [`${etiqueta}: nombre y teléfono son obligatorios.`]),
        ...(referencia.relacion ? [] : [`${etiqueta}: relación con la solicitante, de catálogo.`]),
        ...(referencia.curp && !RE_CURP.test(referencia.curp) ? [`${etiqueta}: CURP inválido.`] : []),
        ...(referencia.consentimiento ? [] : [`${etiqueta}: falta su consentimiento (es un tercero).`]),
      ];
    }),
    ...(lista.length < REFERENCIAS_REQUERIDAS ? ["Se necesitan DOS referencias personales."] : []),
  ];
  return { valor: referencias, errores };
}

// Persona secundaria (responsable / aval): entidad propia, con consentimiento.
function normalizarPersona(entrada, rol) {
  if (!entrada || typeof entrada !== "object") return { valor: null, errores: [`Falta ${rol}.`] };
  const persona = {
    nombre: texto(entrada.nombre), curp: normalizar(entrada.curp), telefono: texto(entrada.telefono), domicilio: texto(entrada.domicilio),
    ocupacion: texto(entrada.ocupacion), identificacion: texto(entrada.identificacion), consentimiento: entrada.consentimiento === true,
  };
  const errores = [
    ...faltantesDe(persona, CAMPOS_PERSONA, rol),
    ...(persona.curp && !RE_CURP.test(persona.curp) ? [`${rol}: CURP inválido (${persona.curp}).`] : []),
    ...(persona.consentimiento ? [] : [`${rol}: falta su consentimiento para el tratamiento de datos.`]),
  ];
  return { valor: persona, errores };
}

// Firma 1 — Solicitud de crédito (paso 7): aceptación sellada.
function normalizarFirma(firmaEnviada, gpsDomicilio) {
  const entrada = firmaEnviada ?? {};
  if (entrada.aceptada !== true) {
    return { valor: null, errores: ["Falta la Firma 1 (Solicitud de crédito): la clienta debe aceptar el trámite y declarar veraz la información."] };
  }
  const firma = {
    aceptada: true, fechaHora: texto(entrada.fechaHora) || new Date().toISOString(),
    gps: coordenadas(entrada.gps) ?? gpsDomicilio ?? null,
    dispositivo: textoONulo(entrada.dispositivo), nombreFirmante: textoONulo(entrada.nombreFirmante),
  };
  return { valor: firma, errores: firma.dispositivo ? [] : ["Firma 1: falta el sello del dispositivo."] };
}

module.exports = function crearDominioExpediente({
  store, hoyMX, obtenerPadron, idsEjecutivos, usuarios, topeResponsable, topeAval, montoRequiereAval, comprobanteDomicilioMesesMax,
}) {
  const todosLosEventos = () => store.registro(REGISTRO);
  const eventosDe = (socio) => {
    const id = limpiarSocio(socio);
    return todosLosEventos().filter((evento) => String(evento.socio) === id);
  };
  const sello = (usuario) => ({ fecha: hoyMX(), fechaHora: new Date().toISOString(), capturadoPor: usuario.nombre, capturadoPorId: usuario.id });

  // ---------- expediente vigente, derivado de los eventos ----------

  const aplicarEvento = (expediente, evento) => {
    switch (evento.evento) {
      case EVENTO.CAPTURA:
        return {
          ...expediente,
          capturas: expediente.capturas + 1, creado: expediente.creado ?? evento.fechaHora, ultimaCaptura: evento.fechaHora, ultimoCambio: evento.fechaHora,
          test: Boolean(evento.test), datos: evento.datos, responsable: evento.responsable ?? null, aval: evento.aval ?? null,
          referencias: evento.referencias ?? [], pld: evento.pld ?? null, firma1: evento.firma1 ?? null,
          ejecutivo: evento.ejecutivo, centro: evento.centro, tipoCredito: evento.tipoCredito, importeSolicitado: evento.importeSolicitado,
        };
      case EVENTO.DOCUMENTO:
        return { ...expediente, documentos: { ...expediente.documentos, [`${evento.propietario}:${evento.tipo}`]: evento }, ultimoCambio: evento.fechaHora };
      case EVENTO.VALIDACION:
        return { ...expediente, validacion: { aprobado: Boolean(evento.aprobado), por: evento.por, porId: evento.porId, motivo: evento.motivo ?? null, fecha: evento.fecha, fechaHora: evento.fechaHora } };
      case EVENTO.ESTADO:
        return { ...expediente, estado: evento.estado };
      default:
        return expediente;
    }
  };

  function expedienteDe(socio) {
    const eventos = eventosDe(socio);
    if (!eventos.length) return null;
    const inicial = {
      socio: limpiarSocio(socio), estado: ESTADO_INICIAL, test: false, datos: null, responsable: null, aval: null, referencias: [],
      pld: null, firma1: null, documentos: {}, validacion: null, capturas: 0, creado: null, ultimaCaptura: null, ultimoCambio: null,
      ejecutivo: null, centro: null, historial: eventos,
    };
    return eventos.reduce(aplicarEvento, inicial);
  }

  // Última captura de cada socio en la burbuja (unicidad y topes).
  const capturasVigentes = (enPruebas) => Object.values(todosLosEventos()
    .filter((evento) => evento.evento === EVENTO.CAPTURA && Boolean(evento.test) === Boolean(enPruebas))
    .reduce((porSocio, evento) => ({ ...porSocio, [String(evento.socio)]: evento }), {}));

  function socioVisible(usuario, socio) {
    const expediente = expedienteDe(socio);
    if (!expediente) return null;
    if (Boolean(expediente.test) !== Boolean(usuario.test)) return null;
    if (usuario.rol === "ejecutivo" && normalizar(expediente.ejecutivo) !== normalizar(usuario.nombre)) return null;
    return expediente;
  }

  // ---------- CU-010 · checklist, campos PLD, validación y candado ----------

  // Vigencia por la PROPIA fecha del documento (criterio DOC-01): INE por
  // fechaVencimiento, comprobante por fechaEmision + meses máximos. null = sin
  // fecha propia, no se sabe.
  function documentoVencido(documento) {
    if (!documento) return null;
    const hoy = new Date(`${hoyMX()}T12:00`);
    if (documento.tipo === "ine") return documento.fechaVencimiento ? new Date(`${documento.fechaVencimiento}T12:00`) < hoy : null;
    if (documento.tipo === "comprobante_domicilio") {
      if (!documento.fechaEmision) return null;
      const limite = new Date(`${documento.fechaEmision}T12:00`);
      limite.setMonth(limite.getMonth() + comprobanteDomicilioMesesMax);
      return limite < hoy;
    }
    return false;
  }

  const documentosRequeridos = (expediente) => PROPIETARIOS
    .filter((propietario) => propietario === "solicitante" || expediente[propietario])
    .flatMap((propietario) => CHECKLIST[propietario].map((tipo) => `${propietario}:${tipo}`));

  const semaforoDe = (completo, validacion) => {
    if (validacion && !validacion.aprobado) return "rechazado";
    if (validacion?.aprobado && completo) return "validado";
    return completo ? "completo" : "incompleto";
  };

  // El semáforo (CU-010 §3): completo / incompleto / validado / rechazado, con
  // el detalle de qué falta. La validación solo vale si es posterior al último
  // cambio del expediente: si Control Operativo corrigió algo, Ale revalida.
  function calcularEstatus(expediente) {
    if (!expediente) return null;
    const requeridos = documentosRequeridos(expediente);
    const presentes = requeridos.filter((llave) => expediente.documentos[llave]);
    const faltantes = requeridos.filter((llave) => !expediente.documentos[llave]);
    const vencidos = presentes.filter((llave) => documentoVencido(expediente.documentos[llave]) === true);
    const sinFecha = presentes.filter((llave) => documentoVencido(expediente.documentos[llave]) === null);
    const camposFaltantes = CAMPOS_PLD.filter(([, leer]) => estaVacio(leer(expediente.datos ?? {}, expediente))).map(([campo]) => campo);
    const completo = faltantes.length === 0 && camposFaltantes.length === 0;
    const validacion = expediente.validacion && expediente.validacion.fechaHora >= (expediente.ultimoCambio ?? "") ? expediente.validacion : null;
    const aprobado = Boolean(validacion?.aprobado);
    return {
      completo, semaforo: semaforoDe(completo, validacion), requeridos, presentes: presentes.length, faltantes, vencidos, sinFecha, camposFaltantes,
      validacion, validacionObsoleta: Boolean(expediente.validacion) && !validacion,
      listoParaValidar: completo && !aprobado, bloqueaDesembolso: !(completo && aprobado),
    };
  }

  const describirFaltantes = ({ faltantes, camposFaltantes }) => [
    faltantes.length ? `documentos (${faltantes.join(", ")})` : null,
    camposFaltantes.length ? `campos PLD (${camposFaltantes.join(", ")})` : null,
  ].filter(Boolean).join(" y ");

  // Validación de Administración y Finanzas (Ale): aprobar exige el 100%;
  // rechazar exige motivo (regresa a Control Operativo).
  function registrarValidacion(socio, cuerpoEnviado, usuario) {
    const cuerpo = cuerpoEnviado ?? {};
    const expediente = socioVisible(usuario, socio);
    if (!expediente) return rechazo(404, "No existe expediente para ese socio (o no es tuyo).");
    const estatus = calcularEstatus(expediente);
    const aprobado = esAfirmativo(cuerpo.aprobado);
    const motivo = texto(cuerpo.motivo);
    if (aprobado && !estatus.completo) {
      return rechazo(400, `El expediente NO está al 100%: faltan ${describirFaltantes(estatus)}. No se puede validar — sin excepciones (CU-010 §5).`, { estatus });
    }
    if (!aprobado && motivo.length < MOTIVO_MINIMO) return rechazo(400, "Para rechazar, el motivo es obligatorio: es lo que regresa a Control Operativo para corregir.");
    if (aprobado && estatus.validacion?.aprobado) return rechazo(400, "Ese expediente ya está validado.");
    const fila = store.agregarRegistro(REGISTRO, {
      evento: EVENTO.VALIDACION, socio: expediente.socio, test: expediente.test, aprobado, motivo: motivo || null,
      checklist: { presentes: estatus.presentes, requeridos: estatus.requeridos.length, vencidos: estatus.vencidos },
      por: usuario.nombre, porId: usuario.id, fecha: hoyMX(), fechaHora: new Date().toISOString(),
    });
    const actualizado = expedienteDe(expediente.socio);
    return { ok: true, validacion: fila, expediente: actualizado, estatus: calcularEstatus(actualizado) };
  }

  // Candado del desembolso (CU-010 §6). `enPruebas` = burbuja de quien dispersa.
  function expedienteBloqueaDesembolso(socio, enPruebas) {
    const expediente = expedienteDe(socio);
    const sinBloqueo = { bloquea: false, motivo: null, validadoPorId: null, validadoPor: null };
    if (!expediente || Boolean(expediente.test) !== Boolean(enPruebas)) {
      return { ...sinBloqueo, bloquea: true, motivo: "La clienta no tiene expediente capturado (CU-009). Sin expediente no hay desembolso.", estatus: null };
    }
    const estatus = calcularEstatus(expediente);
    if (!estatus.completo) return { ...sinBloqueo, bloquea: true, motivo: `Expediente incompleto: faltan ${describirFaltantes(estatus)}.`, estatus };
    if (!estatus.validacion?.aprobado) {
      const motivo = estatus.validacion
        ? `El expediente fue RECHAZADO por ${estatus.validacion.por}: ${estatus.validacion.motivo ?? "sin motivo"}.`
        : "El expediente está completo pero Administración y Finanzas todavía no lo valida.";
      return { ...sinBloqueo, bloquea: true, motivo, estatus };
    }
    return { ...sinBloqueo, estatus, validadoPorId: estatus.validacion.porId, validadoPor: estatus.validacion.por };
  }

  // Lo que se revisa al dispersar una solicitud de sobres: candado + segregación
  // (quien validó no dispersa). `candadoActivo=false` (transición) solo avisa.
  function validarDispersion(solicitud, usuario, candadoActivo) {
    const candado = expedienteBloqueaDesembolso(solicitud.id, Boolean(usuario.test));
    if (candado.bloquea) {
      if (candadoActivo) return rechazo(400, `No se puede dispersar: ${candado.motivo}`, { expediente: candado.estatus });
      console.warn(`[dispersar ${solicitud.folio}] candado de expediente APAGADO por entorno: ${candado.motivo}`);
      return { ok: true, estatus: candado.estatus };
    }
    if (candado.validadoPorId === usuario.id) {
      return rechazo(403, `Quien VALIDÓ el expediente (${candado.validadoPor}) no puede dispersar el mismo crédito (segregación de funciones, CU-010 §6).`);
    }
    return { ok: true, estatus: candado.estatus };
  }

  // ---------- CU-009 · captura ----------

  // Número de clienta: único frente al padrón de cobranza y a otros
  // expedientes; se genera si no viene. Un expediente que YA existe se puede
  // volver a capturar (evento nuevo, nunca pisa); un socio ya en el padrón de
  // cobranza sin expediente no es alta nueva.
  function socioLibre(candidato) {
    const id = limpiarSocio(candidato);
    const enPadron = (socio) => obtenerPadron().some((credito) => String(credito.id) === socio);
    const enExpediente = (socio) => todosLosEventos().some((evento) => String(evento.socio) === socio);
    if (id) {
      if (!RE_SOCIO.test(id)) return { error: "El número de socio debe ser solo dígitos (5 a 15)." };
      if (enExpediente(id)) return { socio: id, recaptura: true };
      if (enPadron(id)) return { error: "Ese número de socio ya existe en el padrón de cobranza. Si es renovación, no es un alta: usa Re-dar crédito." };
      return { socio: id };
    }
    const generado = Array.from({ length: INTENTOS_SOCIO }, () => `5${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`)
      .find((socio) => !enPadron(socio) && !enExpediente(socio));
    return generado ? { socio: generado, generado: true } : { error: "No se pudo generar un número de socio libre; intenta de nuevo." };
  }

  // Cuántas clientas DISTINTAS ya respalda esta persona (por CURP), sin contar
  // a la que se está capturando.
  const respaldos = (curp, rol, socioActual, enPruebas) => (curp
    ? capturasVigentes(enPruebas).filter((evento) => String(evento.socio) !== String(socioActual) && normalizar(evento[rol]?.curp) === normalizar(curp)).length
    : 0);

  // Validación completa de la captura (CU-009 §3, obligatorios "Sí").
  function validarCaptura(cuerpo) {
    const datos = normalizarDatos(cuerpo.datos);
    const pld = normalizarPLD(cuerpo.pld);
    const referencias = normalizarReferencias(cuerpo.referencias);
    const tipoCredito = buscarEnCatalogo(TIPOS_CREDITO, cuerpo.tipoCredito);
    const importeSolicitado = Number(cuerpo.importeSolicitado) || 0;
    const responsable = tipoCredito === "grupal" || cuerpo.responsable ? normalizarPersona(cuerpo.responsable, "Responsable/solidaria") : { valor: null, errores: [] };
    const aval = importeSolicitado > montoRequiereAval || cuerpo.aval ? normalizarPersona(cuerpo.aval, "Aval") : { valor: null, errores: [] };
    const firma1 = normalizarFirma(cuerpo.firma1, datos.valor.gps);
    const centro = texto(cuerpo.centro);
    const errores = [
      ...datos.errores, ...pld.errores, ...referencias.errores,
      ...(tipoCredito ? [] : ["Tipo de crédito: grupal o individual."]),
      ...(importeSolicitado > 0 ? [] : ["Falta el importe solicitado."]),
      ...responsable.errores, ...aval.errores, ...firma1.errores,
      ...(centro ? [] : ["Falta el centro (C-#) de la clienta."]),
    ];
    return {
      errores,
      limpio: { datos: datos.valor, pld: pld.valor, referencias: referencias.valor, tipoCredito, importeSolicitado, responsable: responsable.valor, aval: aval.valor, firma1: firma1.valor, centro },
    };
  }

  // Reglas que dependen de lo ya guardado: unicidad de CURP/RFC (§10.5) contra
  // OTRAS clientas y topes de responsable/aval.
  function erroresContraExistentes(limpio, socioPedido, enPruebas) {
    const otras = capturasVigentes(enPruebas).filter((evento) => String(evento.socio) !== socioPedido);
    const respaldosResponsable = respaldos(limpio.responsable?.curp, "responsable", socioPedido, enPruebas);
    const respaldosAval = respaldos(limpio.aval?.curp, "aval", socioPedido, enPruebas);
    return [
      ...(limpio.datos.curp && otras.some((evento) => normalizar(evento.datos.curp) === limpio.datos.curp) ? [`Ya existe una clienta con ese CURP (${limpio.datos.curp}). No se puede dar de alta dos veces.`] : []),
      ...(limpio.datos.rfc && otras.some((evento) => normalizar(evento.datos.rfc) === limpio.datos.rfc) ? [`Ya existe una clienta con ese RFC (${limpio.datos.rfc}).`] : []),
      ...(respaldosResponsable >= topeResponsable ? [`La responsable ${limpio.responsable.nombre} ya respalda a ${respaldosResponsable} clienta(s); el tope es ${topeResponsable}.`] : []),
      ...(respaldosAval >= topeAval ? [`El aval ${limpio.aval.nombre} ya avala a ${respaldosAval} clienta(s); el tope es ${topeAval}.`] : []),
    ];
  }

  const resumirErrores = (errores) => `La captura no se puede guardar: ${errores[0]}${errores.length > 1 ? ` (y ${errores.length - 1} más)` : ""}`;

  // Registra la captura. Idempotente por folioCaptura: la app reintenta sin
  // señal y el mismo folio nunca duplica.
  function registrarCaptura(cuerpoEnviado, usuario) {
    const cuerpo = cuerpoEnviado ?? {};
    const folio = texto(cuerpo.folioCaptura);
    if (!folio) return rechazo(400, "Falta folioCaptura (lo genera la app para poder reintentar sin duplicar).");
    const repetida = todosLosEventos().find((evento) => evento.evento === EVENTO.CAPTURA && evento.folioCaptura === folio);
    if (repetida) return { ok: true, repetida: true, socio: repetida.socio, expediente: expedienteDe(repetida.socio) };

    const socioPedido = limpiarSocio(cuerpo.socio);
    if (socioPedido && expedienteDe(socioPedido) && !socioVisible(usuario, socioPedido)) return rechazo(404, "Ese expediente no es tuyo (o no es de tu burbuja).");
    const enPruebas = Boolean(usuario.test);
    const { errores: erroresDeForma, limpio } = validarCaptura(cuerpo);
    const errores = [...erroresDeForma, ...erroresContraExistentes(limpio, socioPedido, enPruebas)];
    if (errores.length) return rechazo(400, resumirErrores(errores), { errores });

    const asignacion = socioLibre(cuerpo.socio);
    if (asignacion.error) return rechazo(400, asignacion.error);
    const { socio, generado = false, recaptura = false } = asignacion;
    const fila = store.agregarRegistro(REGISTRO, {
      evento: EVENTO.CAPTURA, socio, socioGenerado: generado, recaptura, folioCaptura: folio, test: enPruebas,
      ...limpio, ejecutivo: usuario.nombre, ejecutivoId: usuario.id, ...sello(usuario),
      capturadoEn: textoONulo(cuerpo.capturadoEn),   // fecha/hora del teléfono sin señal, si la app la manda
      gps: limpio.datos.gps, dispositivo: limpio.firma1.dispositivo,
    });
    // Documentos marcados como fotografiados en la misma captura (paso 5).
    (Array.isArray(cuerpo.documentos) ? cuerpo.documentos : []).forEach((documento) => registrarDocumento(socio, documento, usuario, true));
    const actualizado = expedienteDe(socio);
    return { ok: true, socio, socioGenerado: generado, recaptura, expediente: actualizado, estatus: calcularEstatus(actualizado), folio: fila.ts };
  }

  // Documento del checklist (metadatos). `interno` = viene dentro de la
  // captura, ya validada la visibilidad.
  function registrarDocumento(socio, documentoEnviado, usuario, interno = false) {
    const documento = documentoEnviado ?? {};
    const expediente = interno ? expedienteDe(socio) : socioVisible(usuario, socio);
    if (!expediente) return rechazo(404, "No existe expediente para ese socio (o no es tuyo).");
    const propietario = PROPIETARIOS.find((opcion) => opcion === String(documento.propietario ?? "solicitante").toLowerCase());
    const tipo = TIPOS_DOCUMENTO.find((opcion) => opcion === String(documento.tipo ?? "").toLowerCase());
    if (!propietario) return rechazo(400, `Propietario del documento: ${PROPIETARIOS.join(", ")}.`);
    if (!tipo) return rechazo(400, `Tipo de documento: ${TIPOS_DOCUMENTO.join(", ")}.`);
    if (documento.fechaVencimiento && !esFechaISO(documento.fechaVencimiento)) return rechazo(400, "fechaVencimiento: usa AAAA-MM-DD.");
    if (documento.fechaEmision && !esFechaISO(documento.fechaEmision)) return rechazo(400, "fechaEmision: usa AAAA-MM-DD.");
    const fila = store.agregarRegistro(REGISTRO, {
      evento: EVENTO.DOCUMENTO, socio: expediente.socio, test: expediente.test, propietario, tipo,
      fechaVencimiento: documento.fechaVencimiento ?? null, fechaEmision: documento.fechaEmision ?? null,
      ubicacionFisica: textoONulo(documento.ubicacionFisica), nota: textoONulo(documento.nota),
      fotografiado: documento.fotografiado !== false, imagenGuardada: false,   // pendiente CU-009 §10.2 / CU-010 §10.2
      ...sello(usuario),
    });
    const actualizado = expedienteDe(expediente.socio);
    return { ok: true, documento: fila, expediente: actualizado, estatus: calcularEstatus(actualizado) };
  }

  // ---------- consultas ----------

  function ficha(usuario, socio) {
    const expediente = socioVisible(usuario, socio);
    if (!expediente) return rechazo(404, "No existe expediente para ese socio (o no es tuyo).");
    return { expediente, nombre: nombreCompleto(expediente.datos), estatus: calcularEstatus(expediente), pendientes: pendientes() };
  }

  const resumenDe = (expediente) => {
    const estatus = calcularEstatus(expediente);
    return {
      socio: expediente.socio, nombre: nombreCompleto(expediente.datos), centro: expediente.centro, ejecutivo: expediente.ejecutivo, estado: expediente.estado,
      semaforo: estatus.semaforo, completo: estatus.completo, faltantes: estatus.faltantes.length, camposFaltantes: estatus.camposFaltantes.length, vencidos: estatus.vencidos.length,
      tipoCredito: expediente.tipoCredito, importeSolicitado: expediente.importeSolicitado, creado: expediente.creado,
      documentos: Object.keys(expediente.documentos).length, pep: Boolean(expediente.pld?.pep?.es),
    };
  };

  // La ejecutiva ve los suyos; dirección/admin todos los de su burbuja.
  function listar(usuario) {
    const socios = [...new Set(capturasVigentes(usuario.test).map((evento) => String(evento.socio)))];
    return socios
      .map(expedienteDe)
      .filter((expediente) => usuario.rol !== "ejecutivo" || normalizar(expediente.ejecutivo) === normalizar(usuario.nombre))
      .map(resumenDe)
      .sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
  }

  const listado = (usuario) => ({ expedientes: listar(usuario), pendientes: pendientes() });

  const catalogos = () => ({
    pepTipos: PEP_TIPOS, pepParentescos: PEP_PARENTESCOS, actividadesEconomicas: ACTIVIDADES_ECONOMICAS, origenesRecursos: ORIGENES_RECURSOS,
    estadosCiviles: ESTADOS_CIVILES, generos: GENEROS, tiposCredito: TIPOS_CREDITO, identificaciones: IDENTIFICACIONES, relacionesReferencia: RELACIONES_REFERENCIA,
    propietarios: PROPIETARIOS, tiposDocumento: TIPOS_DOCUMENTO, checklist: CHECKLIST,
    topeResponsable, topeAval, montoRequiereAval, pendientes: pendientes(),
  });

  function pendientes() {
    return [
      { tema: "Imágenes de documentos", motivo: "Solo se guardan metadatos (tipo, fecha, vigencia). El procedimiento de cifrado y retención de las fotos no está definido (CU-009 §10.2, CU-010 §10.2).", responsable: "Sistemas" },
      { tema: "Catálogos PLD provisionales", motivo: "Actividad económica y origen de recursos son catálogos provisionales hasta que Contaduría confirme el oficial (Art. 95 Bis LGOAAC).", responsable: "Contaduría (CLIC)" },
      { tema: "Solicitud de Crédito vigente", motivo: "Sigue en validación con el Lic. César Cáceres; el modelo de datos puede ajustarse (CU-009 §10.1).", responsable: "Lic. César Cáceres" },
      { tema: "Excepción manual al candado de expediente incompleto", motivo: "Ningún documento la contempla; el candado es absoluto y solo se puede apagar por entorno (EXPEDIENTE_CANDADO_DISPERSION=0) para transición (CU-010 §10.3).", responsable: "Dirección" },
      { tema: "Qué se revalida en una renovación", motivo: "Hoy el candado revisa presencia y vigencia de todo el checklist en cada desembolso; falta definir si en renovación solo lo que pudo caducar (CU-010 §10.1, conecta con CU-007).", responsable: "Dirección" },
      { tema: "Borrado remoto de capturas sin sincronizar", motivo: "La app guarda la captura en el teléfono hasta tener señal; el borrado remoto existente (captura-agil.js) la limpia, pero el procedimiento formal no está definido (CU-009 §10.2).", responsable: "Sistemas" },
    ];
  }

  return {
    REGISTRO, CHECKLIST, PROPIETARIOS, TIPOS_DOCUMENTO, PEP_TIPOS, PEP_PARENTESCOS, RE_CURP, RE_RFC, CAMPOS_PLD,
    eventosDe, expedienteDe, socioVisible, capturasVigentes, socioLibre, validarCaptura, registrarCaptura, registrarDocumento,
    listar, listado, ficha, nombreCompleto, catalogos, pendientes,
    documentoVencido, calcularEstatus, registrarValidacion, expedienteBloqueaDesembolso, validarDispersion,
  };
};
