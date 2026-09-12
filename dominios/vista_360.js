// CU-018 · Vista 360 del expediente — solo lectura.
//
// Quien decide sobre una clienta (Administración y Finanzas, Dirección) ve en
// una sola consulta lo que hoy vive repartido en cinco pantallas distintas:
// exposición de crédito, garantías en custodia (CU-006/008), riesgo y PLD
// (CU-016/017), ciclos limpios (CU-019) y el semáforo del expediente
// (CU-009/010). No inventa NINGÚN cálculo nuevo — cada bloque llama al mismo
// dominio que ya lo calcula para su propia pantalla (mismo criterio que ya
// aplican garantía, riesgo, PLD y ciclos: "la vista consolida, nunca
// recalcula con su propia lógica", CU-018 §6).
//
// Si una pieza no se puede calcular todavía (falta un caso de uso, o el
// propio caso de uso ya avisa que algo no está definido), el bloque
// correspondiente regresa `disponible: false` con el motivo — nunca un cero o
// un "Bajo" que parezca un dato real (CU-018 §5).
//
// Dependencias: recibe ya construidos los dominios de riesgo, PLD, ciclos
// limpios y expediente, más la función de garantías (todos ya existen en
// server.js antes de este punto) — este archivo solo los compone, no
// reimplementa ninguno.
module.exports = function crearDominioVista360({
  obtenerPadron, riesgo, pld, ciclosLimpios, expediente, estadoDeCuentaGarantia,
}) {
  const limpiarSocio = (valor) => String(valor ?? "").replace(/[\s\-.]/g, "").trim();
  const redondear = (numero) => Math.round((Number(numero) || 0) * 100) / 100;
  const saldoPositivo = (credito) => Math.max(0, Number(credito.saldo) || 0);

  const creditosActivosDe = (socio) => obtenerPadron().filter(
    (credito) => String(credito.id).split("|")[0] === socio
      && credito.activa !== false
      && credito.estatus !== "BAJA",
  );

  // Bloque 1: exposición de crédito — estatus de créditos activos y saldo
  // insoluto total (CU-018 §3, fila 1). Suma el `saldo` de cada crédito activo
  // de la clienta, el mismo campo que ya usa el arqueo y garantia_liquida
  // (`Math.max(0, c.saldo || 0)`) — ninguna fórmula nueva.
  function bloqueExposicionCredito(socio) {
    const activos = creditosActivosDe(socio);
    return {
      disponible: true,
      creditosActivos: activos.length,
      saldoInsolutoTotal: redondear(activos.reduce((acumulado, credito) => acumulado + saldoPositivo(credito), 0)),
      productos: activos.map((credito) => ({
        producto: credito.producto, centro: credito.centro,
        saldo: redondear(saldoPositivo(credito)), estatus: credito.estatus || "VIGENTE",
      })),
    };
  }

  // Bloque 2: performance de pago — historial de recuperaciones y días de
  // mora promedio (CU-018 §3, fila 2). El propio CU-018 marca esta fila como
  // "Parcial: existe el historial de pagos; no el promedio de días de mora ya
  // calculado" — no hay Anexo ni CU que defina esa fórmula todavía, así que
  // NO se inventa un cálculo aquí. Se distingue "sin calcular todavía" de
  // "calculado y da cero" (CU-018 §5).
  const bloquePerformancePago = () => ({
    disponible: false,
    motivo: "El promedio de días de mora y el historial de recuperaciones consolidado todavía no están construidos (CU-018 §3, fila 2) — no hay fórmula confirmada.",
    responsable: "Carlos / Dirección",
  });

  // Bloque 3: ciclos limpios (CU-019) — reusa ciclosLimpios.consultar tal cual.
  function bloqueCiclosLimpios(usuario, socio) {
    const resultado = ciclosLimpios.consultar(usuario, socio);
    if (resultado.error) return { disponible: false, motivo: resultado.error };
    const { contador, aplicaTasaPreferencial, faltanParaTasaPreferencial, moraViva } = resultado;
    return { disponible: true, contador, aplicaTasaPreferencial, faltanParaTasaPreferencial, moraViva: moraViva ?? null };
  }

  // Bloque 4: garantías en custodia (CU-006/008) — reusa estadoDeCuentaGarantia
  // tal cual. Si la clienta no tiene crédito activo (regla propia de ese
  // dominio), se marca no disponible en vez de fallar toda la vista.
  function bloqueGarantias(usuario, socio) {
    const resultado = estadoDeCuentaGarantia(usuario, socio);
    if (resultado.error) return { disponible: false, motivo: resultado.error };
    const { saldoActual, creditosVivos, historial } = resultado;
    return { disponible: true, saldoActual, creditosVivos, historial };
  }

  // Bloque 5: nivel de riesgo y marcador PEP (CU-016) — reusa
  // riesgo.fichaRiesgo tal cual.
  function bloqueRiesgo(usuario, socio) {
    const ficha = riesgo.fichaRiesgo(usuario, socio);
    if (ficha.error) return { disponible: false, motivo: ficha.error };
    return {
      disponible: true,
      nivelRiesgo: ficha.perfil?.nivelRiesgo ?? null,
      pep: ficha.perfil?.pep ?? null,
      historial: ficha.historial,
    };
  }

  // Bloque 6: acumulación PLD y alertas previas (CU-017). `consultarAcumulacion`
  // sin monto es una consulta pura (no registra nada — solo `evaluarAlDesembolsar`
  // escribe); se filtran las alertas ya registradas de esta clienta.
  function bloquePLD(usuario, socio) {
    const acumulacion = pld.consultarAcumulacion({ id: socio });
    if (acumulacion.error) return { disponible: false, motivo: acumulacion.error };
    const alertasPrevias = pld.alertasPLD(usuario).filter((fila) => String(fila.socio) === socio);
    const { acumulado, umbralPesos, supera, faltaUMA } = acumulacion;
    return { disponible: true, acumulado, umbralPesos, supera, faltaUMA, alertas: alertasPrevias };
  }

  // Bloque 7: semáforo del expediente (CU-009/CU-010) — permite navegar de la
  // vista al expediente detallado (CU-018 §4, paso 4). Recibe la ficha que
  // `resolverClienta` ya consultó (evita pedirla dos veces: una para el
  // candado de entrada de una clienta que TODAVÍA no tiene crédito, otra para
  // este bloque).
  function bloqueExpediente(fichaExpediente) {
    if (fichaExpediente.error) return { disponible: false, motivo: "Todavía no tiene expediente capturado (CU-009/CU-010)." };
    const { estatus, expediente: datosExpediente } = fichaExpediente;
    return {
      disponible: true,
      semaforo: estatus.semaforo,
      completo: estatus.completo,
      validado: estatus.semaforo === "validado",
      pep: Boolean(datosExpediente.pld?.pep?.es),
    };
  }

  function pendientes() {
    return [
      { tema: "Auditoría de accesos a la Vista 360", motivo: "Si hay que registrar QUIÉN consultó el expediente de una clienta y cuándo (no solo quién lo modificó) — ni el Requerimiento Maestro ni UC-EXP-02 lo piden explícitamente (CU-018 §10.1).", responsable: "Dirección" },
      { tema: "Historial de recuperaciones y días de mora promedio", motivo: "Existe el historial de pagos; el cálculo del promedio de días de mora todavía no está construido ni definido en ningún Anexo (CU-018 §3, fila 2).", responsable: "Carlos / Dirección" },
      { tema: "Control Operativo (ejecutivo) como participante de la vista", motivo: "CU-018 §1 lo lista junto con Administración y Finanzas y Dirección, pero hoy riesgo/PLD/garantías/ciclos solo son visibles para Dirección y Administración y Finanzas (mismo criterio que sus pantallas propias, CU-016/017/006/019). Falta que Dirección confirme si Control Operativo debe ver estos datos consolidados.", responsable: "Dirección" },
    ];
  }

  // Candado de visibilidad de entrada. NO exige que la clienta ya tenga un
  // crédito en el padrón: CU-018 §2 solo exige que "el expediente de la
  // clienta exista y esté al menos parcialmente armado (CU-009/CU-010)" — una
  // clienta recién capturada en campo, todavía sin desembolso, debe poder
  // verse (es justo el momento en que se decide si dispersarle o no). Por eso
  // prueba DOS fuentes, en este orden:
  //   1) riesgo.clientaVisible — ya tiene un crédito en el padrón (mismo
  //      candado que ya usa /api/riesgo/:socio, respeta burbuja real/prueba).
  //   2) expediente.ficha — todavía no tiene crédito, pero sí expediente.
  // Regresa `null` si ninguna de las dos la encuentra — la vista entera debe
  // responder 404, nunca bloques vacíos sueltos que insinúen que sí existe.
  function resolverClienta(usuario, socio) {
    const clienta = riesgo.clientaVisible(usuario, socio);
    const fichaExpediente = expediente.ficha(usuario, socio);
    if (!clienta && fichaExpediente.error) return null;

    const { nombre, centro, ejecutivo } = clienta ?? {
      nombre: fichaExpediente.nombre,
      centro: fichaExpediente.expediente.centro,
      ejecutivo: fichaExpediente.expediente.ejecutivo,
    };
    return { nombre, centro, ejecutivo, fichaExpediente };
  }

  // Punto de entrada único: valida el socio, resuelve el candado de
  // visibilidad y arma la respuesta llamando a cada bloque — ninguno de los
  // bloques valida nada por su cuenta, todos confían en este candado.
  function consolidar(usuario, socioSolicitado) {
    const socio = limpiarSocio(socioSolicitado);
    if (!socio) return { error: "Falta el número de socio.", status: 400 };

    const base = resolverClienta(usuario, socio);
    if (!base) return { error: "Esa clienta no está en el padrón ni tiene expediente capturado (o no es de tu burbuja).", status: 404 };

    const { nombre, centro, ejecutivo, fichaExpediente } = base;
    return {
      socio,
      nombre,
      centro,
      ejecutivo,
      exposicionCredito: bloqueExposicionCredito(socio),
      performancePago: bloquePerformancePago(),
      ciclosLimpios: bloqueCiclosLimpios(usuario, socio),
      garantias: bloqueGarantias(usuario, socio),
      riesgo: bloqueRiesgo(usuario, socio),
      pld: bloquePLD(usuario, socio),
      expediente: bloqueExpediente(fichaExpediente),
      pendientes: pendientes(),
    };
  }

  return { consolidar, pendientes };
};
