// DOMINIO: VIGENCIA DE DOCUMENTOS DE RENOVACIÓN (CU-007, DOC-01 — carta
// "Definiciones de Dirección aprobadas", Dirección General, 02-sep-2026).
//
// Extraído de server.js el 10-sep-2026 como CUARTO caso del patrón
// "strangler fig" documentado en CLAUDE.md ("Reducir dependencia del
// monolito server.js"). Este código venía del PR "[Borrador] CU-007:
// documentos de renovación + estado de ciclo (#1)" mergeado hoy a develop.
//
// A diferencia de las otras extracciones, aquí solo hay UNA función de
// negocio pura que separar: el resto del PR (los endpoints
// /api/creditos/documentos-renovacion y /api/creditos/renovacion, y el
// carry-forward de documentosRenovacion en /api/creditos/recredito) es
// validación de request y una asignación de campo, no lógica de cálculo —
// se queda en server.js como pegamento, igual que con sobres_segregacion.js.
//
// Refactor puro: misma función, mismo comportamiento — verificado con la
// sección 103 de tests/bateria_arqueo.js (los casos DOC-01), smoke.js y la
// batería completa sin cambio de número.
module.exports = function crearDominioRenovacionDocumentos({ hoyMX, comprobanteDomicilioMesesMax }) {
  // DOC-01: vigencia de los documentos de renovación por su PROPIA fecha (no
  // la de captura, que es lo único que existía hasta ahora). SOLO informa —
  // no decide si un documento vencido bloquea la renovación (CU-007 §10.6,
  // todavía sin definir). null = no se capturó la fecha propia del documento,
  // así que no se puede saber si venció (no es lo mismo que "vigente").
  function vigenciaDocumentosRenovacion(c) {
    const dr = c && c.documentosRenovacion;
    if (!dr) return null;
    const hoy = new Date(hoyMX() + "T12:00");
    let ine = null;
    if (dr.ineFechaVencimiento) ine = new Date(dr.ineFechaVencimiento + "T12:00") < hoy;
    let comprobanteDomicilio = null;
    if (dr.comprobanteFechaEmision) {
      const limite = new Date(dr.comprobanteFechaEmision + "T12:00");
      limite.setMonth(limite.getMonth() + comprobanteDomicilioMesesMax);
      comprobanteDomicilio = limite < hoy;
    }
    return { ine, comprobanteDomicilio };
  }

  return { vigenciaDocumentosRenovacion };
};
