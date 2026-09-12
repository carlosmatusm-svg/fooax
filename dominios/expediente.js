// ===================================================================
// DOMINIO · EXPEDIENTE DE LA CLIENTA — alta y captura en campo (CU-009)
//
// Reconstruido 11-sep-2026 en el repo real (develop: padrón + registros
// append-only). Del build del fork (store_expediente.js + Postgres) se toman
// solo los catálogos ya documentados en CU-009 (PEP, checklist, topes).
//
// QUÉ ES EL EXPEDIENTE AQUÍ: un registro append-only `expediente` con EVENTOS
// por clienta (captura, documento; CU-010 agrega la validación). El expediente
// vigente se DERIVA de los eventos: la captura más reciente da los datos; el
// documento más reciente de cada propietario+tipo da el checklist. Nunca se
// edita ni se borra un evento (CU-009 §8, Requerimiento Maestro §11).
//
// REGLAS QUE NO SE NEGOCIAN (CU-009 §6):
//   1. Dar de alta NO es autorizar: la clienta nace en estado "captura" y NO
//      se escribe al padrón de cobranza (eso pasa al dispersar, CU-013).
//   2. Responsable y aval son entidades separadas con tope propio
//      (TOPE_RESPONSABLE, TOPE_AVAL; parámetros de entorno).
//   3. PEP con catálogo cerrado de tipo y parentesco (Art. 95 Bis LGOAAC).
//   4. Las referencias son terceros: su consentimiento se captura aparte.
//   5. CURP y RFC únicos entre clientas (CU-009 §10.5) — validación de
//      aplicación, la única posible con archivos/jsonb.
//
// LO QUE NO HACE: no guarda IMÁGENES (solo metadatos del documento; el cifrado
// está pendiente, CU-009 §10.2) ni valida biométricamente la Firma 1.
// ===================================================================
"use strict";

const REGISTRO = "expediente";
const EVENTO = { CAPTURA: "captura", DOCUMENTO: "documento", ESTADO: "estado" };
const ESTADO_INICIAL = "captura";
const REFERENCIAS_REQUERIDAS = 2;
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
  store, hoyMX, obtenerPadron, idsEjecutivos, usuarios, topeResponsable, topeAval, montoRequiereAval,
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
      pld: null, firma1: null, documentos: {}, capturas: 0, creado: null, ultimaCaptura: null, ultimoCambio: null,
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
    return { ok: true, socio, socioGenerado: generado, recaptura, expediente: actualizado, folio: fila.ts };
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
      fotografiado: documento.fotografiado !== false, imagenGuardada: false,   // pendiente CU-009 §10.2
      ...sello(usuario),
    });
    const actualizado = expedienteDe(expediente.socio);
    return { ok: true, documento: fila, expediente: actualizado };
  }

  // ---------- consultas ----------

  function ficha(usuario, socio) {
    const expediente = socioVisible(usuario, socio);
    if (!expediente) return rechazo(404, "No existe expediente para ese socio (o no es tuyo).");
    return { expediente, nombre: nombreCompleto(expediente.datos), pendientes: pendientes() };
  }

  const resumenDe = (expediente) => ({
    socio: expediente.socio, nombre: nombreCompleto(expediente.datos), centro: expediente.centro, ejecutivo: expediente.ejecutivo, estado: expediente.estado,
    tipoCredito: expediente.tipoCredito, importeSolicitado: expediente.importeSolicitado, creado: expediente.creado,
    documentos: Object.keys(expediente.documentos).length, pep: Boolean(expediente.pld?.pep?.es),
  });

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
      { tema: "Imágenes de documentos", motivo: "Solo se guardan metadatos (tipo, fecha, vigencia). El procedimiento de cifrado y retención de las fotos no está definido (CU-009 §10.2).", responsable: "Sistemas" },
      { tema: "Catálogos PLD provisionales", motivo: "Actividad económica y origen de recursos son catálogos provisionales hasta que Contaduría confirme el oficial (Art. 95 Bis LGOAAC).", responsable: "Contaduría (CLIC)" },
      { tema: "Solicitud de Crédito vigente", motivo: "Sigue en validación con el Lic. César Cáceres; el modelo de datos puede ajustarse (CU-009 §10.1).", responsable: "Lic. César Cáceres" },
      { tema: "Borrado remoto de capturas sin sincronizar", motivo: "La app guarda la captura en el teléfono hasta tener señal; el borrado remoto existente (captura-agil.js) la limpia, pero el procedimiento formal no está definido (CU-009 §10.2).", responsable: "Sistemas" },
    ];
  }

  return {
    REGISTRO, CHECKLIST, PROPIETARIOS, TIPOS_DOCUMENTO, PEP_TIPOS, PEP_PARENTESCOS, RE_CURP, RE_RFC,
    eventosDe, expedienteDe, socioVisible, capturasVigentes, socioLibre, validarCaptura, registrarCaptura, registrarDocumento,
    listar, listado, ficha, nombreCompleto, catalogos, pendientes,
  };
};
