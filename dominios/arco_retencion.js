// ===================================================================
// DOMINIO · DERECHOS ARCO Y RETENCIÓN PLD (CU-015)
//
// LFPDPPP 2025 (derechos ARCO) y LFPIORPI (retención por habitualidad).
// Reconstruido 11-sep-2026 en el repo real sobre el modelo de datos de develop
// (padrón + bitácoras + movimientos + registros); el build del fork no se porta.
//
// TRES REGLAS QUE NO SE NEGOCIAN (CU-015 §6):
//   1. "Cancelación" SIEMPRE es anonimización, NUNCA un DELETE: el renglón
//      sigue existiendo (con su número de socio) para que saldos, historial,
//      movimientos y bitácora no pierdan integridad.
//   2. El plazo de retención es parámetro (RETENCION_PLD_ANIOS).
//   3. El reporte de retención es de SOLO LECTURA: señala candidatas, JAMÁS
//      anonimiza ni borra por sí solo.
//
// QUÉ SE ANONIMIZA: el nombre en TODOS los ciclos de la clienta en el padrón
// vigente (vía ajuste en padron_cambios). Las filas históricas de la bitácora
// (el alta original) y los movimientos de tesorería NO se reescriben: son el
// rastro que la LFPIORPI exige conservar — Legal decide si además se
// enmascaran al leer (ver `pendientes`).
// ===================================================================
"use strict";

const REGISTRO = "solicitudes_arco";
const MARCADOR = "[ANONIMIZADO]";
const ENTIDADES = ["clienta"];   // responsable/aval/referencias llegan con CU-009
const MOTIVO_MINIMO = 5;
const SEMANA_DIAS = 7;

const normalizar = (texto) => String(texto ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const limpiarSocio = (socio) => String(socio ?? "").replace(/[\s\-.]/g, "").trim();
const esFechaISO = (fecha) => /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? ""));
const sumarDias = (fechaISO, dias) => {
  const fecha = new Date(`${fechaISO}T12:00:00`);
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
};
const sumarAnios = (fechaISO, anios) => {
  const fecha = new Date(`${fechaISO}T12:00:00`);
  fecha.setFullYear(fecha.getFullYear() + anios);
  return fecha.toISOString().slice(0, 10);
};
const maximo = (fechas) => fechas.filter(esFechaISO).reduce((mayor, fecha) => (fecha > mayor ? fecha : mayor), "");
const estaVivo = (credito) => credito.activa !== false && credito.estatus !== "BAJA";
const socioDeLlave = (llave) => String(llave).split("|")[0];
const productoDeLlave = (llave) => String(llave).split("|")[1] ?? "";
const rechazo = (status, error) => ({ status, error });

const resumenMovimiento = ({ folio, fecha, tipo, concepto, monto, entrada, anulado, producto, registradoPor }) => ({
  folio, fecha, tipo: tipo ?? concepto, monto, entrada, anulado: Boolean(anulado), producto: producto ?? null, registradoPor: registradoPor ?? null,
});

module.exports = function crearDominioARCO({ store, hoyMX, obtenerPadron, idsEjecutivos, usuarios, pagosPorFecha, retencionAnios, rolesAnonimizar }) {
  const puedeAnonimizar = (usuario) => Boolean(usuario) && rolesAnonimizar.includes(usuario.rol);
  const nombresEjecutivas = (usuario) => new Set(idsEjecutivos(usuario).map((clave) => normalizar(usuarios[clave].nombre)));

  function creditosDe(usuario, socio) {
    const id = limpiarSocio(socio);
    const mias = nombresEjecutivas(usuario);
    return obtenerPadron().filter((credito) => String(credito.id) === id && mias.has(normalizar(credito.ejecutivo)));
  }

  const registrar = (fila) => store.agregarRegistro(REGISTRO, { fecha: hoyMX(), fechaHora: new Date().toISOString(), ...fila });

  const historial = (socio) => {
    const id = limpiarSocio(socio);
    return store.registro(REGISTRO).filter((fila) => String(fila.id) === id);
  };

  const validarEntidad = (entidad) => (ENTIDADES.includes(entidad)
    ? null
    : rechazo(400, `Entidad desconocida. Hoy el sistema modela: ${ENTIDADES.join(", ")}. Responsable, aval y referencias llegan con el expediente (CU-009).`));

  // Todo registro append-only donde aparezca la persona (riesgo, PLD, ciclos,
  // expediente…): genérico, para que lo que se agregue después salga solo.
  function registrosDe(id) {
    return Object.fromEntries(store.nombresRegistros()
      .filter((nombre) => nombre !== REGISTRO)
      .map((nombre) => [nombre, store.registro(nombre).filter((fila) => String(fila.socio ?? fila.id ?? "") === id)])
      .filter(([, filas]) => filas.length));
  }

  function datosDeLaPersona(usuario, id, creditos) {
    const gestion = store.gestionRenovaciones();
    const pagos = pagosPorFecha(usuario);
    return {
      creditos,
      cambiosPadron: store.cambiosPadron().filter((cambio) => String(cambio.id) === id || (cambio.socios ?? []).map(String).includes(id)),
      movimientos: store.todosMovimientos().filter((mov) => limpiarSocio(mov.socio) === id).map(resumenMovimiento),
      solicitudesCredito: store.solicitudes().filter((solicitud) => String(solicitud.id) === id && Boolean(solicitud.test) === Boolean(usuario.test)),
      gestionRenovaciones: Object.keys(gestion).filter((llave) => socioDeLlave(llave) === id).map((llave) => gestion[llave]),
      pagosPorDia: Object.fromEntries(Object.entries(pagos).filter(([llave]) => socioDeLlave(llave) === normalizar(id))),
      registros: registrosDe(id),
    };
  }

  // ACCESO (A de ARCO): todo lo que el sistema guarda de esa persona.
  function exportar(usuario, entidad, socio, solicitante) {
    const errorEntidad = validarEntidad(entidad);
    if (errorEntidad) return errorEntidad;
    const id = limpiarSocio(socio);
    const creditos = creditosDe(usuario, id);
    if (!creditos.length) return rechazo(404, "Esa clienta no está en el padrón (o no es de tu burbuja).");
    const datos = datosDeLaPersona(usuario, id, creditos);
    const solicitud = registrar({
      tipo: "exportacion", entidad, id, solicitante: String(solicitante ?? "").trim() || null,
      atendio: usuario.nombre, atendioId: usuario.id, resultado: "ok",
      resumen: { creditos: creditos.length, cambios: datos.cambiosPadron.length, movimientos: datos.movimientos.length, registros: Object.keys(datos.registros) },
    });
    store.agregarCambioPadron({ tipo: "arco", subtipo: "exportacion", id, por: usuario.nombre, fecha: solicitud.fecha, ts: solicitud.ts });
    return {
      ok: true, entidad, id, generado: solicitud.fechaHora, atendio: usuario.nombre, folioSolicitud: solicitud.ts,
      datos, historialSolicitudes: historial(id), pendientes: pendientes(),
    };
  }

  // CANCELACIÓN (R/C de ARCO): anonimizar. Nunca borra.
  function anonimizar(usuario, entidad, socio, motivo) {
    if (!puedeAnonimizar(usuario)) {
      return rechazo(403, `Solo Dirección General (${rolesAnonimizar.join("/")}) puede anonimizar. Administración puede exportar, no cancelar.`);
    }
    const errorEntidad = validarEntidad(entidad);
    if (errorEntidad) return errorEntidad;
    const id = limpiarSocio(socio);
    const razon = String(motivo ?? "").trim();
    if (razon.length < MOTIVO_MINIMO) {
      return rechazo(400, `El motivo es obligatorio (mínimo ${MOTIVO_MINIMO} caracteres): toda anonimización debe quedar explicada, no solo registrada.`);
    }
    const creditos = creditosDe(usuario, id);
    if (!creditos.length) return rechazo(404, "Esa clienta no está en el padrón (o no es de tu burbuja).");
    const pendientesDeAnonimizar = creditos.filter((credito) => !credito.anonimizada);
    if (!pendientesDeAnonimizar.length) return rechazo(400, "Esa clienta ya está anonimizada.");
    const base = Date.now();
    pendientesDeAnonimizar.forEach((credito, indice) => store.agregarCambioPadron({
      tipo: "ajuste", id, producto: credito.producto,
      campos: { nombre: MARCADOR, anonimizada: true },
      motivo: `ARCO · anonimización: ${razon}`, fecha: hoyMX(), por: usuario.nombre, ts: base + indice,
    }));
    const solicitud = registrar({
      tipo: "anonimizacion", entidad, id, motivo: razon, atendio: usuario.nombre, atendioId: usuario.id,
      resultado: "ok", creditosAnonimizados: pendientesDeAnonimizar.length,
    });
    store.agregarCambioPadron({ tipo: "arco", subtipo: "anonimizacion", id, motivo: razon, por: usuario.nombre, fecha: solicitud.fecha, ts: solicitud.ts });
    return {
      ok: true, entidad, id, creditosAnonimizados: pendientesDeAnonimizar.length, marcador: MARCADOR, folioSolicitud: solicitud.ts,
      historialSolicitudes: historial(id), pendientes: pendientes(),
    };
  }

  // Ficha: estado y solicitudes de la persona.
  function ficha(usuario, entidad, socio) {
    const creditos = creditosDe(usuario, socio);
    if (!creditos.length) return rechazo(404, "Esa clienta no está en el padrón (o no es de tu burbuja).");
    const [primero] = creditos;
    return {
      entidad, id: String(primero.id), nombre: primero.nombre,
      anonimizada: creditos.some((credito) => credito.anonimizada),
      historialSolicitudes: historial(primero.id), puedesAnonimizar: puedeAnonimizar(usuario), pendientes: pendientes(),
    };
  }

  // Última actividad conocida de una clienta sin créditos vivos: baja, alta,
  // desembolso, fin de plazo o último pago capturado.
  function ultimaActividad(id, creditos, pagos) {
    const llavesDeLaSocia = Object.keys(pagos).filter((llave) => socioDeLlave(llave) === normalizar(id));
    const fechasDePago = llavesDeLaSocia.flatMap((llave) => Object.keys(pagos[llave]));
    const fechasDeCreditos = creditos.flatMap((credito) => [
      credito.fecha_baja, credito.alta_fecha, credito.desembolso,
      esFechaISO(credito.desembolso) && Number(credito.plazo) > 0 ? sumarDias(credito.desembolso, Number(credito.plazo) * SEMANA_DIAS) : null,
    ]);
    return maximo([...fechasDeCreditos, ...fechasDePago]);
  }

  // RETENCIÓN PLD — solo lectura. `hoyRef` permite simular una fecha futura.
  function reporteRetencion(usuario, hoyRef) {
    const hoy = esFechaISO(hoyRef) ? hoyRef : hoyMX();
    const limite = sumarAnios(hoy, -retencionAnios);
    const mias = nombresEjecutivas(usuario);
    const porSocio = obtenerPadron()
      .filter((credito) => mias.has(normalizar(credito.ejecutivo)))
      .reduce((grupos, credito) => ({ ...grupos, [String(credito.id)]: [...(grupos[String(credito.id)] ?? []), credito] }), {});
    const pagos = pagosPorFecha(usuario);
    const sinCreditoVivo = Object.entries(porSocio).filter(([, creditos]) => !creditos.some(estaVivo));
    const candidatas = sinCreditoVivo
      .map(([id, creditos]) => ({ id, creditos, ultima: ultimaActividad(id, creditos, pagos) }))
      .filter(({ ultima }) => ultima && ultima <= limite)   // sin fecha conocida no se puede afirmar nada
      .map(({ id, creditos, ultima }) => ({
        id, nombre: creditos[0].nombre, anonimizada: creditos.some((credito) => credito.anonimizada),
        ultimaActividad: ultima, creditos: creditos.length, cumpleDesde: sumarAnios(ultima, retencionAnios),
      }));
    return {
      soloLectura: true, hoy, retencionAnios, limite, candidatas,
      clientasConCreditoVivo: Object.keys(porSocio).length - sinCreditoVivo.length,
      nota: "Este reporte NO anonimiza ni borra nada. Cada candidata se decide una por una con POST /api/arco/clienta/:id/anonimizar (Dirección General, con motivo).",
      pendientes: pendientes(),
    };
  }

  function pendientes() {
    return [
      { tema: "Verificación de identidad de quien solicita", motivo: "El sistema no valida que quien pide sea el titular o su representante; es proceso operativo fuera del código (CU-015 §10.1).", responsable: "Administración" },
      { tema: "Plazos de retención distintos por tipo de dato", motivo: "Hoy RETENCION_PLD_ANIOS es un solo plazo para todo (CU-015 §10.2).", responsable: "Legal / Oficial de Cumplimiento" },
      { tema: "Catálogo cerrado de motivos", motivo: "El motivo de anonimización es texto libre (CU-015 §10.3).", responsable: "Dirección" },
      { tema: "Nombre en bitácora histórica y movimientos de tesorería", motivo: "La anonimización cambia el nombre en el padrón vigente (todos sus ciclos). El alta original en padron_cambios y los movimientos de caja conservan el nombre como rastro contable/regulatorio (LFPIORPI); falta que Legal defina si además se enmascaran al leer.", responsable: "Legal (Lic. César Cáceres)" },
      { tema: "Responsable, aval y referencias", motivo: "Llegan con el expediente (CU-009); se exportan/anonimizan por la misma puerta cuando se fusione.", responsable: "Desarrollo" },
    ];
  }

  return { REGISTRO, MARCADOR, ENTIDADES, puedeAnonimizar, creditosDe, exportar, anonimizar, ficha, historial, reporteRetencion, pendientes };
};
