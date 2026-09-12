// Captura de expediente COMPLETA y válida (CU-009 §3) para pruebas — la usan
// tests/expediente_captura.js, tests/expediente_validacion.js y
// tests/sobres_segregacion.js (el candado de CU-010 exige expediente antes de
// dispersar). `extra` sobreescribe cualquier campo de primer nivel.
"use strict";
// Una captura completa y válida (CU-009 §3), parametrizable.
function capturaValida(RUN, extra) {
  // CURP con formato oficial válido; la homoclave (2 últimos) varía por RUN.
  // + un salto por proceso: dos pruebas que corren en la misma corrida (mismo
  // RUN) no deben chocar por unicidad de CURP/RFC en el mismo servidor.
  const n = (Number(RUN) || 0) + (process.pid % 1000) * 7;
  const curp = "GARL900101MOCRPR" + "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[n % 34] + String(n % 10);
  const base = {
    folioCaptura: "CAP-TEST-" + RUN + "-" + Math.random().toString(36).slice(2, 6),
    centro: "C-0", tipoCredito: "grupal", importeSolicitado: 6000,
    datos: {
      apellidoPaterno: "García", apellidoMaterno: "López", nombres: "Prueba " + RUN, curp, rfc: "GALP900101" + "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[n % 34] + "B" + String(n % 10),
      fechaNacimiento: "1990-01-01", lugarNacimiento: "Oaxaca", nacionalidad: "Mexicana", estadoCivil: "Casada(o)", genero: "Mujer",
      telefonoMovil: "9511234567", identificacion: { tipo: "INE", folio: "IDMEX" + RUN },
      domicilio: { calle: "Calle Falsa", numero: "123", colonia: "Centro", cp: "68000", municipio: "Oaxaca de Juárez", ciudad: "Oaxaca", estado: "Oaxaca", tiempoResidenciaMeses: 36 },
      gps: { lat: 17.0654, lng: -96.7237, precision: 8 },
      negocio: { giro: "Abarrotes", antiguedadMeses: 24, ingresoDeclarado: 4500 }, actividadEconomica: "Comercio",
      capacidadPago: { ingresoSemanal: 4500, gastosNegocio: 2000, gastosHogar: 1500, mesIngresoMasBajo: "Enero", capacidadPago: 900 },
      creditosOtros: { tiene: false },
      vivienda: { tipo: "propia", superficie: 80, niveles: 1, habitaciones: 3, paredes: "block", piso: "cemento", techo: "lámina" },
      familia: { dependientes: 2, hijosMenores: 1, otroIngreso: "esposo", ingresoTotalHogar: 7000 },
    },
    pld: { origenRecursos: "Ingresos del negocio", pep: { es: false } },
    referencias: [
      { nombre: "Ref Uno", relacion: "Vecina(o)", telefono: "9510000001", consentimiento: true },
      { nombre: "Ref Dos", relacion: "Familiar", telefono: "9510000002", consentimiento: true },
    ],
    responsable: { nombre: "Responsable " + RUN, curp: "RESP900101MOCXXX0" + String(n % 10), telefono: "9519999999", domicilio: "Calle 2", ocupacion: "Comerciante", identificacion: "INE 999", consentimiento: true },
    firma1: { aceptada: true, fechaHora: new Date().toISOString(), gps: { lat: 17.0654, lng: -96.7237 }, dispositivo: "Prueba/1.0 (node)", nombreFirmante: "Prueba " + RUN },
    documentos: [
      { propietario: "solicitante", tipo: "ine", fechaVencimiento: "2029-12-31" },
      { propietario: "solicitante", tipo: "comprobante_domicilio", fechaEmision: "2026-08-15" },
      { propietario: "solicitante", tipo: "curp" }, { propietario: "solicitante", tipo: "foto_negocio" },
      { propietario: "responsable", tipo: "ine" }, { propietario: "responsable", tipo: "comprobante_domicilio" },
    ],
  };
  return Object.assign(base, extra || {});
}
module.exports = { capturaValida };
