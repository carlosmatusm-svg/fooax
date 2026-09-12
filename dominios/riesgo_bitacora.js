// ===================================================================
// DOMINIO · BITÁCORA INMUTABLE DE RIESGO (CU-016, Regla R11.4 del Anexo F)
//
// "Dejar previsto en el modelo de la clienta un campo de PEP y un campo de
// nivel de riesgo... sin lógica todavía: solo el espacio y la bitácora de
// quién los modifica" (ANEXO F, REGLA 11.4, confirmada textual).
//
// POR QUÉ NO HAY UN "UPDATE": el nivel de riesgo y el marcador PEP viven
// únicamente como filas append-only del registro `riesgo_bitacora`; el valor
// vigente se deriva de la última fila de cada campo. La fila ES el cambio —
// es imposible cambiar el valor sin dejar rastro, y nadie puede editar ni
// borrar una fila (el store no tiene esa operación).
//
// No dispara ninguna acción automática al cambiar de nivel (CU-016 §10.3,
// sin definición de Dirección).
// ===================================================================
"use strict";

// Bajo/Medio/Alto: lo que ya usa el mockup del Directorio (CU-016 §3), punto de
// partida documentado, no catálogo oficial (§10.1). PEP: catálogo de CU-009
// (Art. 95 Bis LGOAAC: estructurado, nunca texto libre).
const NIVELES_RIESGO = ["Bajo", "Medio", "Alto"];
const PEP_TIPOS = ["Nacional", "Extranjero", "Organismo internacional"];
const PEP_PARENTESCOS = [
  "La propia clienta", "Cónyuge o concubino(a)", "Padre o madre", "Hijo(a)",
  "Hermano(a)", "Otro pariente en línea recta",
];
const CAMPOS = ["nivelRiesgo", "pep"];
const REGISTRO = "riesgo_bitacora";
const JUSTIFICACION_MINIMA = 5;
const AFIRMATIVOS = new Set(["true", "si", "sí"]);

const normalizar = (texto) => String(texto ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const limpiarSocio = (socio) => String(socio ?? "").replace(/[\s\-.]/g, "").trim();
const buscarEnCatalogo = (catalogo, valor) => catalogo.find((opcion) => normalizar(opcion) === normalizar(valor)) ?? null;
const esAfirmativo = (valor) => valor === true || AFIRMATIVOS.has(String(valor).toLowerCase());
const textoONulo = (valor) => String(valor ?? "").trim() || null;
const rechazo = (status, error) => ({ status, error });

module.exports = function crearDominioRiesgoBitacora({ store, hoyMX, obtenerPadron, idsEjecutivos, usuarios, rolesPuedenCambiar }) {
  // `can_change_risk` (CU-016 §1): R11.4 no fija el titular; el CU sugiere el
  // mismo nivel que aprueba cambios al motor de reglas (Dirección). Llega como
  // parámetro para que confirmarlo (§10.2) no requiera deploy.
  const puedeCambiarRiesgo = (usuario) => Boolean(usuario) && rolesPuedenCambiar.includes(usuario.rol);

  const nombresEjecutivas = (usuario) => new Set(idsEjecutivos(usuario).map((clave) => normalizar(usuarios[clave].nombre)));

  // La clienta debe existir en el padrón y en la burbuja del usuario (una
  // cuenta de prueba solo ve clientas de ejecutivas de prueba, y al revés).
  function clientaVisible(usuario, socio) {
    const id = limpiarSocio(socio);
    if (!id) return null;
    const mias = nombresEjecutivas(usuario);
    const [masReciente] = obtenerPadron()
      .filter((credito) => String(credito.id) === id && mias.has(normalizar(credito.ejecutivo)))
      .sort((a, b) => String(b.alta_fecha ?? "").localeCompare(String(a.alta_fecha ?? "")));
    if (!masReciente) return null;
    const { nombre, centro, ejecutivo } = masReciente;
    return { id, nombre, centro, ejecutivo };
  }

  const historialRiesgo = (socio) => {
    const id = limpiarSocio(socio);
    return store.registro(REGISTRO).filter((fila) => String(fila.socio) === id);
  };

  // Estado vigente = última fila por campo. Sin filas: "sin clasificar" (null):
  // el espacio existe, el dato todavía no (R11.4).
  function perfilRiesgo(socio) {
    const historial = historialRiesgo(socio);
    const inicial = { socio: limpiarSocio(socio), nivelRiesgo: null, pep: null, ultimoCambio: null, cambios: historial.length };
    return historial.reduce((perfil, fila) => ({
      ...perfil,
      [fila.campo]: fila.valorNuevo,
      ultimoCambio: { fecha: fila.fecha, usuario: fila.usuario, campo: fila.campo },
    }), inicial);
  }

  function normalizarPEP(valor) {
    if (!valor || typeof valor !== "object") return { error: "El marcador PEP debe ser un objeto { es, tipo, parentesco, cargo, dependencia, periodo }." };
    if (!esAfirmativo(valor.es)) return { valor: { es: false } };
    const tipo = buscarEnCatalogo(PEP_TIPOS, valor.tipo);
    const parentesco = buscarEnCatalogo(PEP_PARENTESCOS, valor.parentesco);
    if (!tipo) return { error: `Si es PEP, el tipo es obligatorio y de catálogo: ${PEP_TIPOS.join(", ")}.` };
    if (!parentesco) return { error: `Si es PEP, el parentesco es obligatorio y de catálogo: ${PEP_PARENTESCOS.join(", ")}.` };
    return { valor: { es: true, tipo, parentesco, cargo: textoONulo(valor.cargo), dependencia: textoONulo(valor.dependencia), periodo: textoONulo(valor.periodo) } };
  }

  // Devuelve el valor de catálogo o { error }.
  function normalizarValor(campo, valor) {
    if (campo === "nivelRiesgo") {
      const nivel = buscarEnCatalogo(NIVELES_RIESGO, valor);
      return nivel ? { valor: nivel } : { error: `El nivel de riesgo debe ser uno de: ${NIVELES_RIESGO.join(", ")}.` };
    }
    if (campo === "pep") return normalizarPEP(valor);
    return { error: `Campo desconocido. Solo se puede cambiar: ${CAMPOS.join(", ")}.` };
  }

  // Primero la fila de bitácora (CU-016 §4.3); como el valor vigente se deriva
  // de esa misma fila, "aplicar" es consecuencia inmediata: no hay un segundo
  // paso que pueda fallar a medias o saltarse el registro.
  function registrarCambioRiesgo({ socio, campo, valor, motivo }, usuario) {
    if (!puedeCambiarRiesgo(usuario)) {
      return rechazo(403, `Solo ${rolesPuedenCambiar.join("/")} puede cambiar el nivel de riesgo o el marcador PEP de una clienta.`);
    }
    const clienta = clientaVisible(usuario, socio);
    if (!clienta) return rechazo(400, "Esa clienta no está en el padrón (o no es de tu burbuja).");
    if (!CAMPOS.includes(campo)) return rechazo(400, `Campo desconocido. Solo se puede cambiar: ${CAMPOS.join(", ")}.`);
    const justificacion = String(motivo ?? "").trim();
    if (justificacion.length < JUSTIFICACION_MINIMA) {
      return rechazo(400, `La justificación es obligatoria (mínimo ${JUSTIFICACION_MINIMA} caracteres): un cambio de clasificación de riesgo sin explicación es indefendible ante una autoridad.`);
    }
    const { valor: valorNuevo, error } = normalizarValor(campo, valor);
    if (error) return rechazo(400, error);
    const valorAnterior = perfilRiesgo(clienta.id)[campo];
    if (JSON.stringify(valorAnterior) === JSON.stringify(valorNuevo)) {
      return rechazo(400, "El valor nuevo es igual al actual; no hay cambio que registrar.");
    }
    const fila = store.agregarRegistro(REGISTRO, {
      socio: clienta.id, nombre: clienta.nombre, centro: clienta.centro,
      campo, valorAnterior, valorNuevo, justificacion,
      usuario: usuario.nombre, usuarioId: usuario.id,
      fecha: hoyMX(), fechaHora: new Date().toISOString(),
    });
    // Evento espejo en la bitácora general del padrón (CU-016 §8). El replay
    // del padrón ignora el tipo "riesgo" (como "corte"/"centro").
    store.agregarCambioPadron({
      tipo: "riesgo", id: clienta.id, campo, valorAnterior, valorNuevo,
      motivo: justificacion, fecha: fila.fecha, por: usuario.nombre, ts: fila.ts,
    });
    return { ok: true, cambio: fila, perfil: perfilRiesgo(clienta.id) };
  }

  // Lo que ve Cumplimiento/Dirección de una clienta: perfil + historial.
  function fichaRiesgo(usuario, socio) {
    const clienta = clientaVisible(usuario, socio);
    if (!clienta) return rechazo(404, "Esa clienta no está en el padrón (o no es de tu burbuja).");
    return {
      clienta,
      perfil: perfilRiesgo(clienta.id),
      historial: historialRiesgo(clienta.id),
      puedesCambiar: puedeCambiarRiesgo(usuario),
    };
  }

  const pendientes = () => [
    { tema: "Catálogo oficial de niveles de riesgo", motivo: "Bajo/Medio/Alto viene del mockup del Directorio de clientas; no está confirmado como catálogo oficial (CU-016 §10.1).", responsable: "Dirección" },
    { tema: "Quién tiene el permiso can_change_risk", motivo: `R11.4 no lo fija. Hoy: roles ${rolesPuedenCambiar.join("/")} (parámetro RIESGO_ROLES_PUEDEN_CAMBIAR). CU-016 §10.2.`, responsable: "Carlos / Dirección" },
    { tema: "Acción automática al cambiar de nivel", motivo: "R11.4 solo exige el espacio y la bitácora; no se construye ninguna acción (bloquear créditos, avisar) sin definición (CU-016 §10.3).", responsable: "Dirección" },
  ];

  const catalogos = () => ({
    nivelesRiesgo: NIVELES_RIESGO, pepTipos: PEP_TIPOS, pepParentescos: PEP_PARENTESCOS, campos: CAMPOS,
    rolesPuedenCambiar, pendientes: pendientes(),
  });

  return {
    NIVELES_RIESGO, PEP_TIPOS, PEP_PARENTESCOS, CAMPOS, REGISTRO,
    puedeCambiarRiesgo, clientaVisible, historialRiesgo, perfilRiesgo, normalizarValor,
    registrarCambioRiesgo, fichaRiesgo, catalogos, pendientes,
  };
};
