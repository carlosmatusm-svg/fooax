// ===================================================================
// DOMINIO · BANDEJA DE NOTIFICACIONES (NOT-01, dentro de CU-020)
//
// "FOOAX - Definición NOT-01 Avisos del sistema" (04-sep-2026, Karina Matus),
// REVISADO Y APROBADO por Dirección General (Consuelo Bozas) el 11-sep-2026:
// 12 eventos con destinatario por defecto, más dos avisos nuevos a clienta
// por WhatsApp (liquidación de crédito; otorgamiento/renovación de crédito).
// Ver CU-020 historial 2026-09-12 y Matriz Trazabilidad fila NOT-01.
//
// LA REGLA DE FONDO (NOT-01, textual): "El sistema avisa a quien decide o
// concilia, nunca a quien ejecuta su propia acción" (Anexo K aplicado a los
// avisos). "Todo aviso llega primero a la bandeja dentro del sistema...
// El envío por WhatsApp o correo es lo único fuera del contrato" — por eso
// esta primera construcción es SOLO bandeja interna (fase 1 de CU-020 §9.2);
// el envío real por WhatsApp/correo requiere contratar un proveedor externo
// y queda fuera de este alcance (los dos avisos a clienta se dejan en la
// bandeja como "pendiente de envío", nunca se manda nada de verdad).
//
// CORRECCIÓN DE DIRECCIÓN (11-sep-2026): el renglón #4 de NOT-01 llegó
// marcado NO con "Dirección General" y "cambiar por: Auxiliar
// administrativo" — es el ÚNICO renglón que Dirección pidió cambiar, no
// aprobó tal cual. El catálogo de abajo ya refleja ese cambio.
//
// CHOQUE DE NOMBRES SIN RESOLVER (CU-020 §9.1, todavía sin cerrar): el
// sistema solo tiene tres roles (ejecutivo/direccion/admin) — no existen como
// cuentas distintas los puestos "Auxiliar administrativo", "Gerencia de
// Sucursal", "Gerencia de Campo", "Oficial de Cumplimiento", "Renovaciones y
// Retención" ni "la persona afectada" que NOT-01 nombra como destinatarios.
// Mientras Dirección no resuelva ese pendiente, cada uno de esos puestos se
// mapea al rol más cercano que sí existe (ver PUESTOS_A_ROLES) y la fila
// guardada conserva el nombre exacto del puesto que pedía NOT-01, marcado
// `puestoSinRolPropio: true`, para que quede visible que es un mapeo
// provisional, no una confirmación de que ya existe ese puesto en el sistema.
//
// QUÉ SÍ DISPARA ESTA PRIMERA CONSTRUCCIÓN (ver CATALOGO_EVENTOS,
// `construido: true`) — los puntos donde el evento YA ocurre de verdad en el
// código, sin inventar ningún gancho nuevo de negocio:
//   1  Solicitud nueva enviada a autorización  → POST /api/solicitudes
//   3  Desembolso realizado                    → procesarAltaPadron (alta y dispersar)
//   4  Garantía devuelta o aplicada             → /api/movimiento (entrega) y
//                                                 /api/garantia-liquida/aplicar
//   7  Operación marcada por acumulación PLD    → evaluarAlDesembolsar (CU-017)
//   11 Intento bloqueado por un candado         → candado antiduplicado de
//                                                 Garantía Líquida (entrega y aplicación)
//   otorgamiento-cliente / renovacion-cliente   → alta y recredito (queda en
//                                                 bandeja como "pendiente de
//                                                 envío por WhatsApp")
//
// QUÉ NO DISPARA TODAVÍA (`construido: false`, con el motivo exacto en cada
// entrada del catálogo) — no se inventa el gancho porque la funcionalidad de
// origen no existe en el código hoy:
//   2  Dictamen de crédito (análisis de 7 pasos) — no construido
//   5  Arqueo del día enviado — el cierre de caja existe pero no dispara aviso
//   6  Ejecutiva sin sincronizar/cerrar a la hora de corte — es supervisión
//      pull (/api/resumen), no un evento discreto todavía
//   8  Documento por vencer — el expediente no calcula vencimientos aún
//   9  Baja de clienta solicitada desde campo — hoy la baja la da directo
//      Dirección/admin (POST /api/clientes/baja), no hay un paso previo de
//      "solicitud desde campo" que autorizar
//   10 Cambio de acceso o de permisos — el panel de permisos de CU-020 (la
//      matriz puesto × funcionalidad) sigue sin construirse
//   12 Pago aplicado a la socia (comprobante) — el envío es externo
//      (WhatsApp) y depende de un proveedor no contratado
//   liquidacion-cliente — no existe hoy un evento de "liquidación
//      anticipada" distinto de una baja genérica (MOTIVOS_BAJA); falta que
//      Karina/Dirección confirmen qué acción exacta del código cuenta como
//      "se liquidó el crédito" antes de colgar un aviso de ahí
// ===================================================================
"use strict";

const REGISTRO = "notificaciones";

// Puesto tal como lo nombra NOT-01 → rol(es) del sistema que hoy pueden verlo
// en su bandeja. `pendienteRol:true` marca un mapeo provisional (el puesto no
// existe como cuenta propia — CU-020 §9.1).
const PUESTOS_A_ROLES = {
  "Dirección General": { roles: ["direccion"], pendienteRol: false },
  "Administración y Finanzas": { roles: ["admin"], pendienteRol: false },
  "Auxiliar administrativo": { roles: ["admin"], pendienteRol: true },
  "Gerencia de Sucursal": { roles: ["direccion"], pendienteRol: true },
  "Gerencia de Campo": { roles: ["direccion"], pendienteRol: true },
  "Oficial de Cumplimiento": { roles: ["direccion"], pendienteRol: true },
  "Renovaciones y Retención": { roles: ["direccion"], pendienteRol: true },
  "Sucursal": { roles: ["direccion"], pendienteRol: true },
  "la persona afectada": { roles: [], pendienteRol: true },
  "La socia": { roles: [], pendienteRol: true, externo: true },
};

// El catálogo completo de NOT-01 (12 renglones aprobados + 2 avisos nuevos a
// clienta), tal como lo firmó Dirección General el 11-sep-2026. `construido`
// dice si esta construcción ya dispara el aviso desde un punto real del
// código (ver cabecera de este archivo); los que no, quedan documentados con
// su motivo exacto para no inventar un gancho que no existe todavía.
const CATALOGO_EVENTOS = [
  { id: 1, clave: "solicitud_nueva", etiqueta: "Solicitud nueva enviada a autorización",
    destinatarios: ["Dirección General"], porQue: "Es quien decide (3A).", canal: "bandeja", construido: true },
  { id: 2, clave: "dictamen_listo", etiqueta: "Dictamen de crédito listo (análisis de 7 pasos)",
    destinatarios: ["Dirección General"], porQue: "Es quien decide.", canal: "bandeja", construido: false,
    motivoPendiente: "El análisis de 7 pasos (dictamen) no está construido en el código todavía." },
  { id: 3, clave: "desembolso_realizado", etiqueta: "Desembolso realizado",
    destinatarios: ["Dirección General", "Gerencia de Sucursal"],
    porQue: "Quien autorizó ve que se ejecutó; quien lo ejecutó no se avisa a sí mismo.", canal: "bandeja", construido: true },
  { id: 4, clave: "garantia_devuelta_aplicada", etiqueta: "Garantía devuelta o aplicada",
    destinatarios: ["Auxiliar administrativo"],
    porQue: "Concilia el pasivo de garantías.", canal: "bandeja", construido: true,
    nota: "Dirección marcó NO a \"Dirección General\" en este renglón y pidió cambiarlo por \"Auxiliar administrativo\" (11-sep-2026) — es el único renglón que no aprobó tal cual." },
  { id: 5, clave: "arqueo_enviado", etiqueta: "Arqueo del día enviado",
    destinatarios: ["Administración y Finanzas", "Dirección General"],
    porQue: "Quien recibe el efectivo no lo valida (CU-07).", canal: "bandeja", construido: false,
    motivoPendiente: "El cierre de caja existe (cierreDeCaja/cajaDelDia) pero hoy no dispara ningún aviso al enviarse; falta enganchar este evento a ese flujo." },
  { id: 6, clave: "ejecutiva_sin_cerrar", etiqueta: "Ejecutiva sin sincronizar o sin cerrar a la hora de corte",
    destinatarios: ["Gerencia de Campo", "Dirección General"],
    porQue: "Supervisión del día, como hoy en el tablero.", canal: "bandeja", construido: false,
    motivoPendiente: "Hoy es información que Dirección jala al abrir el tablero (/api/resumen); construir esto como aviso empujado requiere un job/cron que hoy no existe." },
  { id: 7, clave: "pld_marcada", etiqueta: "Operación marcada por acumulación PLD (umbral 1,605 UMA en 6 meses)",
    destinatarios: ["Dirección General", "Oficial de Cumplimiento"],
    porQue: "PLD-02: el sistema marca para aviso, no bloquea.", canal: "bandeja", construido: true },
  { id: 8, clave: "documento_por_vencer", etiqueta: "Documento por vencer: INE, comprobante de domicilio, póliza de un bien",
    destinatarios: ["Renovaciones y Retención", "Sucursal"],
    porQue: "Son quienes reabren y actualizan el expediente.", canal: "bandeja", construido: false,
    motivoPendiente: "El expediente (CU-009/010) no calcula vencimientos de documentos todavía." },
  { id: 9, clave: "baja_solicitada_campo", etiqueta: "Baja de clienta solicitada desde campo",
    destinatarios: ["Gerencia de Sucursal", "Dirección General"],
    porQue: "La autorizan ellas (CU-06); mientras, la clienta sigue activa.", canal: "bandeja", construido: false,
    motivoPendiente: "Hoy POST /api/clientes/baja la ejecuta directo Dirección/admin; no existe un paso previo de \"solicitud desde campo\" que autorizar." },
  { id: 10, clave: "cambio_acceso", etiqueta: "Cambio de acceso o de permisos; suplencia activada o terminada",
    destinatarios: ["Dirección General", "la persona afectada"],
    porQue: "CU-01 y CU-12. Nadie se entera después.", canal: "bandeja", construido: false,
    motivoPendiente: "La matriz de permisos por puesto (CU-020, pieza 1) no está construida todavía — no hay de dónde disparar este evento." },
  { id: 11, clave: "candado_bloqueado", etiqueta: "Intento bloqueado por un candado: segregación, devolución duplicada, tasa fuera de rango",
    destinatarios: ["Dirección General"],
    porQue: "Siempre con nombre, fecha y qué se intentó.", canal: "bandeja", construido: true,
    nota: "Por ahora solo cubre el candado antiduplicado de Garantía Líquida (CU-006/CU-022); los demás candados del sistema (segregación, tasa fuera de rango) quedan para una siguiente pieza." },
  { id: 12, clave: "pago_aplicado_socia", etiqueta: "Pago aplicado a la socia (comprobante)",
    destinatarios: ["La socia"], porQue: "Único aviso hacia afuera. Depende del proveedor y de que la socia tenga WhatsApp.",
    canal: "whatsapp_pendiente", construido: false,
    motivoPendiente: "Envío externo (WhatsApp) fuera de contrato — requiere proveedor de mensajería no contratado." },
  { id: "otorgamiento-cliente", clave: "otorgamiento_renovacion_cliente", etiqueta: "Otorgamiento de crédito y/o renovación — aviso a la clienta",
    destinatarios: ["La socia"], porQue: "Aviso nuevo pedido por Dirección/Karina, fuera de los 12 originales (11-sep-2026).",
    canal: "whatsapp_pendiente", construido: true },
  { id: "liquidacion-cliente", clave: "liquidacion_cliente", etiqueta: "Liquidación de crédito — aviso a la clienta",
    destinatarios: ["La socia"], porQue: "Aviso nuevo pedido por Dirección/Karina, fuera de los 12 originales (11-sep-2026).",
    canal: "whatsapp_pendiente", construido: false,
    motivoPendiente: "No existe hoy un evento de \"liquidación anticipada\" distinto de una baja genérica (MOTIVOS_BAJA) — falta que Karina/Dirección confirmen qué acción exacta cuenta como \"se liquidó el crédito\"." },
];

const CATALOGO_POR_CLAVE = Object.fromEntries(CATALOGO_EVENTOS.map((e) => [e.clave, e]));

const limpiarSocio = (socio) => String(socio ?? "").replace(/[\s\-.]/g, "").trim();

module.exports = function crearDominioNotificaciones({ store, hoyMX }) {
  // Roles (del sistema, ya existentes) a los que le toca ver un aviso, dado
  // el/los puesto(s) destinatario(s) que NOT-01 define para ese evento.
  function rolesVisibles(destinatarios) {
    const mapeos = destinatarios.map((puesto) => PUESTOS_A_ROLES[puesto]);
    const algunoPendiente = mapeos.some((mapeo) => !mapeo || mapeo.pendienteRol);
    const roles = [...new Set(mapeos.filter(Boolean).flatMap((mapeo) => mapeo.roles))];
    return { roles, algunoPendiente };
  }

  // Dispara un aviso real. Solo para eventos `construido:true` — disparar uno
  // que no lo es sería inventar un gancho de negocio sin CU/Anexo detrás.
  function crearAviso({ clave, socio, detalle, usuario, test }) {
    const evento = CATALOGO_POR_CLAVE[clave];
    if (!evento) throw new Error(`Evento de notificación desconocido: "${clave}". Revisa el catálogo NOT-01 en dominios/notificaciones.js.`);
    if (!evento.construido) throw new Error(`El evento "${clave}" (NOT-01 #${evento.id}) todavía no está construido: ${evento.motivoPendiente || "sin motivo registrado"}.`);
    const { roles, algunoPendiente } = rolesVisibles(evento.destinatarios);
    const fila = store.agregarRegistro(REGISTRO, {
      eventoId: evento.id, clave: evento.clave, etiqueta: evento.etiqueta,
      destinatarios: evento.destinatarios, rolesVisibles: roles, puestoSinRolPropio: algunoPendiente,
      canal: evento.canal, socio: socio ? limpiarSocio(socio) : null,
      detalle: detalle ?? null,
      test: !!test,
      generadoPor: usuario?.nombre ?? "sistema", generadoPorId: usuario?.id ?? null,
      fecha: hoyMX(), fechaHora: new Date().toISOString(),
      leidoPor: [],
    });
    return fila;
  }

  // Bandeja del usuario que consulta: solo los avisos cuyo rol visible lo
  // incluye a él, y solo de su burbuja (prueba ve prueba, real ve real) —
  // mismo criterio que el resto del sistema (riesgo, PLD, ciclos).
  function bandeja(usuario) {
    if (!usuario) return [];
    return store.registro(REGISTRO)
      .filter((fila) => !!fila.test === !!usuario.test)
      .filter((fila) => (fila.rolesVisibles || []).includes(usuario.rol))
      .sort((a, b) => b.ts - a.ts);
  }

  function marcarLeida(id, usuario) {
    const filas = store.registro(REGISTRO);
    const fila = filas.find((f) => f.ts === id);
    if (!fila) return { status: 404, error: "No encuentro ese aviso." };
    if (!(fila.rolesVisibles || []).includes(usuario.rol)) return { status: 403, error: "Ese aviso no es de tu bandeja." };
    // No se edita la fila original (append-only real): se agrega una fila
    // nueva de "lectura", igual que cualquier otro registro de este proyecto.
    store.agregarRegistro(REGISTRO + "_leidas", {
      avisoTs: id, usuario: usuario.nombre, usuarioId: usuario.id, fecha: hoyMX(), fechaHora: new Date().toISOString(),
    });
    return { ok: true };
  }

  function leidasDe(usuario) {
    return new Set(store.registro(REGISTRO + "_leidas")
      .filter((f) => f.usuarioId === usuario.id)
      .map((f) => f.avisoTs));
  }

  function bandejaConLeido(usuario) {
    const leidas = leidasDe(usuario);
    return bandeja(usuario).map((fila) => ({ ...fila, leido: leidas.has(fila.ts) }));
  }

  const catalogo = () => CATALOGO_EVENTOS.map((e) => ({
    ...e,
    rolesVisibles: rolesVisibles(e.destinatarios).roles,
  }));

  const pendientes = () => [
    { tema: "Choque de nombres: puestos de NOT-01 vs. roles del sistema", motivo: "Auxiliar administrativo, Gerencia de Sucursal, Gerencia de Campo, Oficial de Cumplimiento, Renovaciones y Retención y \"la persona afectada\" no existen como cuentas propias (solo ejecutivo/direccion/admin) — se mapean al rol más cercano, marcado puestoSinRolPropio (CU-020 §9.1).", responsable: "Dirección / Carlos" },
    { tema: "Eventos NOT-01 sin construir", motivo: "2, 5, 6, 8, 9, 10, 12 y \"liquidación a clienta\" no disparan aviso todavía — cada uno tiene su motivo exacto en el catálogo (dominios/notificaciones.js).", responsable: "Desarrollo, conforme se construya cada pieza" },
    { tema: "Envío real por WhatsApp/correo", motivo: "NOT-01: \"fuera del contrato... requiere proveedor externo\". Los avisos a clienta quedan en la bandeja marcados whatsapp_pendiente, nunca se envía nada de verdad.", responsable: "Dirección (decidir proveedor)" },
  ];

  return { REGISTRO, CATALOGO_EVENTOS, PUESTOS_A_ROLES, crearAviso, bandeja: bandejaConLeido, marcarLeida, catalogo, pendientes };
};
