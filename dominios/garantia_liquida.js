// DOMINIO: GARANTÍA LÍQUIDA (CU-006, Anexo F §7-8; CU-022 candado + ticket H.14).
//
// Extraído de server.js el 10-sep-2026 como PRIMER caso del patrón
// "strangler fig" descrito en CLAUDE.md ("Reducir dependencia del monolito
// server.js"): refactor puro, mismas funciones, mismo comportamiento — solo
// cambia dónde viven. server.js sigue siendo el único que conoce HTTP
// (req/res); este módulo no importa nada de eso.
//
// Se expone como fábrica (factory) en vez de exportar funciones sueltas
// porque estas funciones dependen de utilidades que YA existen en server.js
// (norm, nprod, claveCredito, tipoDeMov, socioDeMov, productoDeMov,
// infoCredito, carteraViva) y de PADRON, que es mutable (se reasigna al
// cargar datos). En vez de duplicar esas utilidades aquí —lo que arriesgaría
// que un día diverjan— server.js se las inyecta una sola vez al arrancar.
// `obtenerPadron` es un getter (no el arreglo directo) para que este módulo
// siempre vea el PADRON vigente, nunca una copia congelada del momento del
// require.
module.exports = function crearDominioGarantiaLiquida({
  store,
  norm,
  nprod,
  claveCredito,
  tipoDeMov,
  socioDeMov,
  productoDeMov,
  infoCredito,
  carteraViva,
  obtenerPadron,
  porcentajeGarantiaLiquida,
  numeroDePago,
  hoyMX,
  garantiaHipotecariaDiasAlerta,
  usuariosAutorizanAjusteManual,
  usuariosApruebanSolicitudes,
}) {
  // GARANTÍA LÍQUIDA: CONEXIÓN AUTOMÁTICA AL DESEMBOLSO (10-sep-2026, CU-006,
  // Anexo F §7-8). generarSobreDispersion ya calculaba el 10% retenido desde
  // CU-013/CU-014, pero nunca se registraba en ningún lado: el guardado por
  // clienta (que ya usan infoCredito/pagosDeLaSemana y que Dirección alimentaba
  // a mano desde el 24-ago con el concepto "Garantía líquida" del catálogo
  // CONCEPTOS_DIR) se quedaba sin la parte más grande —la retención automática—
  // y solo veía lo que alguien capturaba suelto.
  //
  // Con esto, cada desembolso (alta o recrédito) genera SOLO, sin que nadie
  // capture nada, el mismo movimiento "Garantía líquida" que ya espera
  // pagosDeLaSemana()/infoCredito() para netear el guardado.
  //
  // metodo: "retencion" (no está en METODOS a propósito). No es efectivo que
  // entra a la caja ni una transferencia real — es dinero que NUNCA llegó a
  // desembolsarse, retenido del propio préstamo. Con "retencion" el movimiento
  // es INVISIBLE para calcularArqueo/cierreDeCaja/netoMovsPorMetodo (todos
  // filtran por metodo === "efectivo"/"transferencia"/"cheque"/"mixto"), así que
  // no infla ningún renglón de caja ni de banco — solo alimenta el guardado de
  // garantía, que es justo lo que necesita.
  //
  // Folio determinístico (mismo crédito + misma fecha de desembolso = mismo
  // folio): agregarMovimiento es idempotente por folio (store.js), así que una
  // segunda llamada con los mismos datos —reintento, doble clic— no duplica la
  // garantía retenida.
  function registrarGarantiaLiquidaAlDesembolsar(clienta, usuario) {
    const monto = Math.round(((clienta && clienta.sobreDispersion && clienta.sobreDispersion.garantia) || 0) * 100) / 100;
    if (!(monto > 0)) return null;
    const fecha = String((clienta && clienta.desembolso) || "").slice(0, 10);
    // Sin fecha de desembolso confiable no se puede fechar el movimiento: se
    // registrará cuando el desembolso se confirme con fecha (no bloquea el alta).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
    const socio = String(clienta.id).split("|")[0];
    const folio = "GAR-AUTO-" + norm(socio) + "-" + nprod(clienta.producto) + "-" + fecha.replace(/-/g, "");
    const mov = {
      folio, fecha, monto, concepto: "Garantía líquida", categoria: "Otro",
      metodo: "retencion",
      ejecutivo: null, socio, producto: clienta.producto,
      tipo: "Garantía líquida", entrada: true,
      automatico: true,
      nota: "Retención automática del " + porcentajeGarantiaLiquida + "% al desembolsar (Anexo F §7-8, sobre de dispersión).",
      registradoPor: "Sistema (retención automática)", rol: "sistema",
      usuario: (usuario && usuario.id) || null, ts: Date.now(),
    };
    return store.agregarMovimiento(mov);
  }

  // CANDADO ANTIDUPLICADO (CU-022 sección 5: "el candado antiduplicado rechaza la
  // segunda devolución y muestra el ticket con el que salió").
  //
  // Cuánto tiene GUARDADO ahora mismo una clienta en un crédito, usando el mismo
  // neteo (recepciones − entregas/aplicaciones desde el corte) que ya usa el
  // desglose del crédito. Sin usuario válido (o sin encontrar el crédito) regresa
  // 0: nunca se asume garantía disponible que no se pudo comprobar.
  // Crédito de la socia contra el que se cuadra su garantía (líquida o A):
  // extraído el 20-sep-2026 de garantiaLiquidaDisponible para que
  // garantiaADisponible use exactamente la misma búsqueda — refactor puro,
  // mismo comportamiento, ver checklist de extracción en CLAUDE.md.
  //
  // LA GARANTÍA SE DEVUELVE AUNQUE EL CRÉDITO YA TERMINÓ (Monse 8-sep, caso
  // ALBA): el guardado no se esfuma cuando la clienta liquida o se da de
  // baja — es justo entonces cuando se le entrega. Mismo criterio que el
  // linkeo del tablero: su crédito más reciente aunque esté de baja. Sin
  // esto, el candado del CU-006 les regresaba "$0.00 guardado" a las
  // clientas de baja y nadie podía liberarles su garantía.
  function buscarCreditoDeSocia(socio, producto) {
    const padron = obtenerPadron();
    let cred = padron.find((c) => String(c.id).split("|")[0] === String(socio)
      && norm(c.producto) === norm(producto) && c.activa !== false && c.estatus !== "BAJA");
    if (!cred) {
      cred = padron.filter((c) => String(c.id).split("|")[0] === String(socio)
          && norm(c.producto) === norm(producto))
        .sort((c1, c2) => String(c2.alta_fecha || "").localeCompare(String(c1.alta_fecha || "")))[0] || null;
    }
    return cred;
  }

  function garantiaLiquidaDisponible(usuario, socio, producto) {
    const cred = buscarCreditoDeSocia(socio, producto);
    if (!cred) return { disponible: 0, credito: null };
    const cv = carteraViva(usuario);
    const clave = claveCredito(cred.id, cred.producto);
    let guardado;
    if (cv.porCredito.has(clave)) {
      guardado = infoCredito(cv, cred).garantia || 0;
    } else {
      // El crédito ya no está en la cartera viva (liquidó ciclos atrás o es
      // de BAJA): mismo neteo del motor, con sus acumulados por clave.
      guardado = Math.max(0, ((cv.garantias || {})[clave] || 0)
        + ((cv.cobrosGarMov || {})[clave] || 0) - ((cv.entregasGar || {})[clave] || 0));
    }
    return { disponible: Math.max(0, Math.round(guardado * 100) / 100), credito: cred };
  }

  // GARANTÍA A DISPONIBLE (20-sep-2026, hallazgo de validación del módulo de
  // Garantías: la Garantía A es un concepto DISTINTO a la Garantía Líquida
  // -RESUELTO 10-sep-2026, Karina Matus- con su propio acumulado en
  // carteraVivaCalcular (cobrosGarA/entregasGarA), pero hasta hoy ese saldo
  // solo se veía en el desglose de un crédito individual, nunca en la
  // pantalla de Garantías. Mismo patrón exacto que garantiaLiquidaDisponible,
  // leyendo el campo `garantiaA` de infoCredito() en vez de `garantia`.
  function garantiaADisponible(usuario, socio, producto) {
    const cred = buscarCreditoDeSocia(socio, producto);
    if (!cred) return { disponible: 0, credito: null };
    const cv = carteraViva(usuario);
    const clave = claveCredito(cred.id, cred.producto);
    let guardado;
    if (cv.porCredito.has(clave)) {
      guardado = infoCredito(cv, cred).garantiaA || 0;
    } else {
      guardado = Math.max(0, ((cv.cobrosGarA || {})[clave] || 0) - ((cv.entregasGarA || {})[clave] || 0));
    }
    return { disponible: Math.max(0, Math.round(guardado * 100) / 100), credito: cred };
  }

  // El folio de la última SALIDA (entregada o aplicada) de Garantía Líquida de
  // ese crédito, para citarlo en el candado ("ya salió con el ticket X") — CU-022
  // sección 5.
  //
  // Búsqueda genérica reutilizada por ultimaSalidaGarantiaLiquida y
  // ultimaSalidaGarantiaA (24-sep-2026, ver esta última más abajo): mismo
  // recorrido, solo cambia el patrón que identifica el TIPO de salida.
  function ultimaSalidaGarantiaComo(socio, producto, patronTipo) {
    const clave = claveCredito(socio, producto);
    let ultimo = null;
    for (const m of store.todosMovimientos()) {
      if (m.anulado || m.entrada) continue;
      const t = tipoDeMov(m) || "";
      if (!patronTipo.test(t.trim())) continue;
      if (socioDeMov(m) !== String(socio)) continue;
      const p = productoDeMov(m) || producto;
      if (claveCredito(socioDeMov(m), p) !== clave) continue;
      if (!ultimo || (m.ts || 0) > (ultimo.ts || 0)) ultimo = m;
    }
    return ultimo;
  }
  function ultimaSalidaGarantiaLiquida(socio, producto) {
    return ultimaSalidaGarantiaComo(socio, producto, /^garant[íi]a l[íi]quida (entregada|aplicada)$/i);
  }

  // MISMA BÚSQUEDA PARA GARANTÍA A (24-sep-2026, hallazgo de Karina: probó
  // sacar $550 de Garantía A a una socia con solo $467 guardados y el sistema
  // lo dejó pasar — "Garantía A entregada" nunca tuvo el candado antiduplicado
  // que sí tiene "Garantía líquida entregada" desde el 10-sep-2026. El
  // comentario original decía que esto quedaba fuera "a propósito" hasta que
  // Dirección lo resolviera para Garantía A; con dinero real ya entregado de
  // más, el riesgo deja de ser hipotético — se agrega el mismo candado, mismo
  // criterio, para no repetir la salida). Garantía A no tiene variante
  // "aplicada" en el catálogo (CONCEPTOS_DIR) — solo "entregada".
  function ultimaSalidaGarantiaA(socio, producto) {
    return ultimaSalidaGarantiaComo(socio, producto, /^garant[íi]a a entregada$/i);
  }

  // EL TICKET H.14 (Anexo H.14, CU-022 Regla H.14: "ticket en los tres
  // movimientos de garantía: recepción, aplicación, devolución"). No imprime
  // nada — regresa los datos exigidos para que el tablero (o quien lo consuma)
  // lo imprima o lo muestre; el folio del propio movimiento ES el folio del
  // ticket, así que no hay que inventar una numeración aparte.
  function ticketGarantiaLiquidaH14(mov, disponibleAntes, disponibleDespues) {
    return {
      folio: mov.folio, tipoMovimiento: mov.tipo, fecha: mov.fecha, monto: mov.monto,
      socio: mov.socio, producto: mov.producto,
      forma: mov.metodo === "retencion" ? "Retención automática (sin efectivo)" : (mov.metodo || null),
      disponibleAntes: Math.round((disponibleAntes || 0) * 100) / 100,
      disponibleDespues: Math.round((disponibleDespues || 0) * 100) / 100,
      registradoPor: mov.registradoPor || null, nota: mov.nota || null,
    };
  }

  // PANTALLA MÍNIMA DE GARANTÍAS (MVP, 10-sep-2026). Refactor puro sobre las
  // funciones que ya vivían sueltas dentro de las rutas de server.js el mismo
  // día: se movieron aquí porque son cálculo, no pegamento HTTP — el server
  // solo debe llamar a estas dos y traducir el resultado a res.json(...).
  // Lo que el mockup pide y AÚN no se puede calcular (bienes en garantía
  // hipotecaria, corte histórico, conciliación bancaria) se declara como
  // datos, no como código — así el propio backend cita, palabra por palabra,
  // la misma fila de PENDIENTES_POR_CONFIRMAR.md que le mostraría a Dirección.
  const PENDIENTES_RESUMEN_GARANTIAS = [
    { tema: "Bienes en garantía (hipotecaria)", motivo: "AVANCE 21-sep-2026 (audio Karina + pedido de Carlos): ya se puede capturar la fecha de vencimiento de la vigencia del documento hipotecario y el sistema avisa 3 días antes (ver alertaVencimientoGarantiaHipotecaria/alertasGarantiaHipotecariaPorVencer). Lo que SIGUE pendiente de Dirección es el resto del control documental (Regla 8.1): qué tipo de bien, ubicación física, custodia del documento físico — eso no se inventa aquí.", responsable: "Dirección" },
    { tema: "Filtro 'solo por vencer' (2 semanas para entregar)", motivo: "Falta definir la consecuencia de exceder el plazo — PENDIENTES sección 3.", responsable: "Dirección" },
    // "Ajuste de garantía por salida de una integrante del grupo" YA NO está
    // pendiente (21-sep-2026, Carlos confirma por escrito): cuando una
    // integrante sale del grupo es porque ya liquidó o porque dejó de pagar
    // (mora) — nunca hay reparto ni transferencia de su garantía hacia las
    // demás. No hace falta una regla de reparto porque el caso que la
    // necesitaría no existe (ver PENDIENTES_POR_CONFIRMAR.md sección 3).
  ];
  const PENDIENTES_FICHA_GARANTIA = [
    // "Exportar/imprimir el ticket" YA NO está pendiente (21-sep-2026, hallazgo
    // de validación sobre el audio de Karina): ticketLiberacionGarantia() arma
    // el JSON completo y ticket-liberacion-garantia.js lo renderiza como vista
    // HTML imprimible (GET /api/garantias/liberacion/ticket) — la clienta firma
    // sobre el papel impreso o el PDF que genera el diálogo de impresión del
    // teléfono/tablet del ejecutivo.
    { tema: "Botón 'Ajuste manual' con autorización de Dirección", motivo: "No existe un tipo de movimiento ni candado dedicado a esto.", responsable: "Dirección" },
  ];

  // Reduce genérico centro→pasivo, usado para Garantía Líquida y Garantía A
  // por igual (mismo cálculo, dos campos de origen distintos).
  function pasivoPorCentroDe(creditosConGarantia, leerMonto) {
    const acumulado = creditosConGarantia.reduce((acc, item) => {
      const centro = item.credito.centro || "—";
      const previo = acc[centro] ?? 0;
      return { ...acc, [centro]: Math.round((previo + leerMonto(item)) * 100) / 100 };
    }, {});
    return Object.keys(acumulado).sort().map((centro) => ({ centro, monto: acumulado[centro] }));
  }

  // RESUMEN (página 7 del lienzo, "GA · Garantías"): pasivo total y
  // desglose por centro. Reutiliza el mismo cálculo por crédito que ya usa
  // /api/creditos (infoCredito) — no inventa una fórmula nueva de garantía.
  //
  // GARANTÍA A (20-sep-2026, hallazgo de validación): hasta hoy este resumen
  // solo mostraba Garantía Líquida — Garantía A se captura y se calcula desde
  // el 10-sep-2026 (concepto propio en CONCEPTOS_DIR) pero no tenía dónde
  // verse. Se agrega como bloque PARALELO, nunca sumado al de Líquida — son
  // dos pasivos distintos (RESUELTO 10-sep-2026, Karina Matus) y mezclarlos
  // en un solo total sería inventar una cifra que Dirección no pidió.
  function resumenGarantias(usuario) {
    const carteraDelUsuario = carteraViva(usuario);
    const creditosVivos = obtenerPadron().filter(
      (credito) => credito.activa !== false && credito.estatus !== "BAJA",
    );

    const creditosConGarantia = creditosVivos
      .map((credito) => ({
        credito,
        garantia: Math.round((infoCredito(carteraDelUsuario, credito).garantia ?? 0) * 100) / 100,
      }))
      .filter(({ garantia }) => garantia > 0.009);

    const creditosConGarantiaA = creditosVivos
      .map((credito) => ({
        credito,
        garantiaA: Math.round((infoCredito(carteraDelUsuario, credito).garantiaA ?? 0) * 100) / 100,
      }))
      .filter(({ garantiaA }) => garantiaA > 0.009);

    const pasivoTotal = Math.round(
      creditosConGarantia.reduce((acumulado, { garantia }) => acumulado + garantia, 0) * 100,
    ) / 100;
    const pasivoTotalGarantiaA = Math.round(
      creditosConGarantiaA.reduce((acumulado, { garantiaA }) => acumulado + garantiaA, 0) * 100,
    ) / 100;

    return {
      pasivoTotal,
      sociasConGarantia: creditosConGarantia.length,
      porCentro: pasivoPorCentroDe(creditosConGarantia, (i) => i.garantia),
      socias: [...creditosConGarantia]
        .sort((a, b) => b.garantia - a.garantia)
        .slice(0, 200)
        .map(({ credito, garantia }) => ({
          id: credito.id, nombre: credito.nombre, centro: credito.centro, producto: credito.producto, garantia,
        })),
      pasivoTotalGarantiaA,
      sociasConGarantiaA: creditosConGarantiaA.length,
      porCentroGarantiaA: pasivoPorCentroDe(creditosConGarantiaA, (i) => i.garantiaA),
      sociasGarantiaA: [...creditosConGarantiaA]
        .sort((a, b) => b.garantiaA - a.garantiaA)
        .slice(0, 200)
        .map(({ credito, garantiaA }) => ({
          id: credito.id, nombre: credito.nombre, centro: credito.centro, producto: credito.producto, garantiaA,
        })),
      pendientes: PENDIENTES_RESUMEN_GARANTIAS,
    };
  }

  // FICHA POR CLIENTA (página 8, "GA · Ficha"): el estado de cuenta
  // movimiento a movimiento con saldo corrido, usando los mismos movimientos
  // y el mismo ticket H.14 que ya arma registrarGarantiaLiquidaAlDesembolsar/
  // la aplicación — aquí solo se listan en orden, no se recalcula nada
  // distinto. Regresa { error, status } en vez de lanzar: quien llama
  // (server.js) decide cómo traducirlo a la respuesta HTTP.
  // Historial movimiento a movimiento de un crédito filtrado por un patrón de
  // tipo (líquida o A) — extraído el 20-sep-2026 para que estadoDeCuentaGarantia
  // arme las dos fichas (Líquida y A) con la misma lógica de saldo corrido.
  function historialGarantiaDelCredito(socio, claveDelCredito, productoDelCredito, patronTipo) {
    const movimientosDelCredito = store.todosMovimientos()
      .filter((mov) => !mov.anulado && patronTipo.test((tipoDeMov(mov) ?? "").trim()))
      .filter((mov) => socioDeMov(mov) === socio
        && claveCredito(socioDeMov(mov), productoDeMov(mov) ?? productoDelCredito) === claveDelCredito)
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

    return movimientosDelCredito.reduce((filas, mov) => {
      const saldoAnterior = filas.at(-1)?.saldoDespues ?? 0;
      const saldoDespues = Math.round((saldoAnterior + (mov.entrada ? mov.monto : -mov.monto)) * 100) / 100;
      return [...filas, {
        fecha: mov.fecha, folio: mov.folio, tipo: mov.tipo ?? mov.concepto, monto: mov.monto,
        entrada: !!mov.entrada, saldoDespues,
        capturadoPor: mov.registradoPor ?? null, nota: mov.nota ?? null,
        // ALERTA EN EL HISTORIAL — SALIDA ANTICIPADA (CU-006, RESUELTO
        // 21-sep-2026, audio de Karina): si esta salida se registró cuando la
        // garantía todavía NO era liberable (ver
        // validarSalidaAnticipadaGarantiaLiquida más abajo), el movimiento
        // queda marcado con el motivo que se anotó en su momento — así el
        // historial de la clienta muestra la alerta sin tener que adivinar.
        salidaAnticipada: !!mov.salidaAnticipada,
        motivoSalidaAnticipada: mov.motivoSalidaAnticipada ?? null,
      }];
    }, []);
  }

  // GARANTÍA A EN LA FICHA (20-sep-2026, hallazgo de validación): mismo
  // criterio que en resumenGarantias — se agrega como bloque paralelo
  // (historialGarantiaA/saldoActualGarantiaA), sin tocar los campos
  // existentes de Garantía Líquida (historial/saldoActual) para no romper a
  // quien ya los consume.
  //
  // TODOS sus créditos, activos o de BAJA (CU-006 item 27, fusión con PR#27
  // 19-sep-2026): LA FICHA SE CONSULTA AUNQUE EL CRÉDITO YA TERMINÓ (mismo
  // criterio que garantiaLiquidaDisponible y el candado de /api/movimiento —
  // Monse, 8-sep: «la clienta liquidó y no renovó, y no me deja liberar su
  // garantía»). Imprescindible para CU-006 item 27: sin esto, Dirección
  // nunca podría ver si la garantía de un crédito YA CERRADO (aunque la
  // clienta tenga otro crédito activo con otro producto) quedó lista para
  // liberarse.
  function estadoDeCuentaGarantia(usuario, socioSolicitado, productoSolicitado) {
    const socio = String(socioSolicitado ?? "").replace(/[\s\-.]/g, "").trim();
    if (!socio) return { error: "Falta el número de socio.", status: 400 };

    const creditosDeLaSocia = obtenerPadron().filter(
      (credito) => String(credito.id).split("|")[0] === socio
        && credito.activa !== false && credito.estatus !== "BAJA",
    );
    const todosSusCreditos = obtenerPadron().filter((credito) => String(credito.id).split("|")[0] === socio)
      .sort((c1, c2) => String(c2.alta_fecha || "").localeCompare(String(c1.alta_fecha || "")));
    if (todosSusCreditos.length === 0) {
      return { error: "No encuentro una clienta con ese número de socio.", status: 400 };
    }

    const productoBuscado = productoSolicitado?.trim();
    // Con producto explícito se busca en TODOS sus créditos (para poder
    // pedir la ficha de uno ya cerrado); sin producto, se prioriza uno
    // activo (comportamiento de siempre) y solo se cae a uno de BAJA si no
    // le queda ningún crédito activo.
    const creditoExacto = productoBuscado
      ? todosSusCreditos.find((credito) => norm(credito.producto) === norm(productoBuscado))
      : null;
    if (productoBuscado && !creditoExacto) {
      return { error: `Esa clienta no tiene un crédito "${productoBuscado}".`, status: 400 };
    }
    const credito = creditoExacto ?? creditosDeLaSocia[0] ?? todosSusCreditos[0];
    const claveDelCredito = claveCredito(socio, credito.producto);

    const historial = historialGarantiaDelCredito(socio, claveDelCredito, credito.producto,
      /^garant[íi]a l[íi]quida( entregada| aplicada)?$/i);
    const historialGarantiaA = historialGarantiaDelCredito(socio, claveDelCredito, credito.producto,
      /^garant[íi]a a( entregada)?$/i);

    const { disponible } = garantiaLiquidaDisponible(usuario, socio, credito.producto);
    const { disponible: disponibleA } = garantiaADisponible(usuario, socio, credito.producto);

    return {
      socio, nombre: credito.nombre, centro: credito.centro, producto: credito.producto,
      saldoActual: disponible, creditosVivos: creditosDeLaSocia.length, historial,
      saldoActualGarantiaA: disponibleA, historialGarantiaA,
      elegibilidadLiberacion: elegibilidadLiberacionGarantia(usuario, socio, credito.producto),
      pendientes: PENDIENTES_FICHA_GARANTIA,
    };
  }

  // CANDADO — NO GARANTÍA EN REESTRUCTURA (CU-006 item 30, 19-sep-2026:
  // Dirección resuelve que "NO debe existir garantía en reestructura. Si
  // existía una garantía, debió aplicarse al crédito antes de reestructurar;
  // una vez reestructurado no se solicita aportación adicional de garantía,
  // porque la reestructura ocurre precisamente porque la clienta no tiene
  // solvencia para pagar — mucho menos para aportar a una garantía."). El
  // crédito se identifica como reestructura por su etiqueta (catálogo ETIQUETAS
  // de server.js, "Reestructura" — asignada por Dirección/admin vía
  // /api/creditos/etiqueta). Regresa null si NO hay problema (se puede
  // capturar la aportación); regresa el mensaje de rechazo si SÍ lo hay.
  function validarAportacionGarantiaEnReestructura(credito) {
    if (!credito) return null;
    if (!/reestructura/i.test(String(credito.etiqueta || ""))) return null;
    return "Este crédito está etiquetado \"Reestructura\": no se solicita aportación "
      + "adicional de garantía (CU-006 item 30, respuesta de Dirección 18-sep-2026). "
      + "Si ya existía una garantía, debió aplicarse al crédito antes de reestructurar.";
  }

  // ELEGIBILIDAD DE LIBERACIÓN AL CIERRE DE CICLO (CU-006 item 27, 19-sep-2026:
  // Dirección confirma que "se libera al cierre/liquidación del crédito que
  // garantiza, EXCEPTO si esa garantía está garantizando además otro crédito" —
  // esa excepción, item 26, es una decisión manual de Dirección caso por caso,
  // NO parametrizable, así que el sistema no puede saber por sí solo si esta
  // garantía en particular quedó aplicada cruzada a otro crédito. Lo único que
  // SÍ puede verificar es si la clienta tiene OTRO crédito activo: si lo tiene,
  // no asume que está libre — deja la decisión a Dirección (mismo criterio que
  // el resto del módulo: advertir, nunca mover dinero solo). No genera ningún
  // movimiento — es solo informativo, para que el tablero/ficha lo muestre.
  //
  // Nota de fusión (20-sep-2026, PR #27 sobre PR #28 ya mergeado): solo cubre
  // Garantía Líquida por ahora (usa garantiaLiquidaDisponible) — extender a
  // Garantía A queda para cuando Dirección confirme que el mismo criterio de
  // liberación aplica a ese tipo de garantía (no está resuelto en CU-006).
  function elegibilidadLiberacionGarantia(usuario, socio, producto) {
    const padron = obtenerPadron();
    const credito = padron.find((c) => String(c.id).split("|")[0] === String(socio)
      && norm(c.producto) === norm(producto));
    if (!credito) return { liberable: false, motivo: "No encuentro ese crédito.", otroCreditoActivo: null };

    const { disponible } = garantiaLiquidaDisponible(usuario, socio, producto);
    if (!(disponible > 0.009)) {
      return { liberable: false, motivo: "No hay garantía guardada que liberar.", otroCreditoActivo: null };
    }

    const cerrado = credito.activa === false || credito.estatus === "BAJA";
    if (!cerrado) {
      return { liberable: false, motivo: "El crédito que garantiza sigue vigente — se libera hasta que cierre/liquide (CU-006 item 27).", otroCreditoActivo: null };
    }

    const otroActivo = padron.find((c) => String(c.id).split("|")[0] === String(socio)
      && claveCredito(c.id, c.producto) !== claveCredito(credito.id, credito.producto)
      && c.activa !== false && c.estatus !== "BAJA");
    if (otroActivo) {
      return {
        liberable: false,
        motivo: "La clienta tiene otro crédito activo (" + otroActivo.producto + ") — Dirección debe decidir si "
          + "esta garantía se aplica cruzada antes de liberarla (CU-006 item 26, decisión manual caso por caso).",
        otroCreditoActivo: { id: otroActivo.id, producto: otroActivo.producto },
      };
    }

    return {
      liberable: true,
      motivo: "Crédito cerrado y sin otro crédito activo de la clienta — puede liberarse (CU-006 item 27).",
      otroCreditoActivo: null,
    };
  }

  // MOTIVO OBLIGATORIO + ALERTA EN EL HISTORIAL AL SACAR LA GARANTÍA ANTES DE
  // TIEMPO (CU-006, RESUELTO 21-sep-2026, audio de Karina: "si se saca antes
  // tiene que poner ese motivo, y también hay que poner una alerta en el
  // historial de la clienta"). Investigado contra el código real: capturar
  // QUIÉN hizo el movimiento YA EXISTE (`registradoPor`); lo que faltaba es
  // que la salida CONSULTE elegibilidadLiberacionGarantia() y, si todavía NO
  // es liberable, EXIJA un motivo (en vez de aceptarlo como nota libre y
  // opcional) — es lo que hace esta función.
  //
  // NO BLOQUEA LA SALIDA: si el motivo viene, la salida procede igual (misma
  // doctrina del módulo — el candado duro es el antiduplicado, sobre el
  // dinero; esto es transparencia/rastro, no un candado de aprobación). Si
  // el motivo NO viene, sí se rechaza — no es opcional cuando la garantía
  // todavía no era liberable.
  //
  // Solo cubre Garantía Líquida por ahora (mismo alcance que
  // elegibilidadLiberacionGarantia — Garantía A queda pendiente de que
  // Dirección confirme que aplica el mismo criterio de liberación, CU-006).
  const JUSTIFICACION_MINIMA_SALIDA_ANTICIPADA = 5;

  function validarSalidaAnticipadaGarantiaLiquida(usuario, socio, producto, motivoPropuesto) {
    const elegibilidad = elegibilidadLiberacionGarantia(usuario, socio, producto);
    if (elegibilidad.liberable) return { salidaAnticipada: false, motivoSalidaAnticipada: null };

    const motivo = String(motivoPropuesto ?? "").trim();
    if (motivo.length < JUSTIFICACION_MINIMA_SALIDA_ANTICIPADA) {
      return {
        error: "Esta garantía todavía no es liberable (" + elegibilidad.motivo + "). Para sacarla de todos modos "
          + "hay que anotar el motivo (mínimo " + JUSTIFICACION_MINIMA_SALIDA_ANTICIPADA + " caracteres) — queda "
          + "marcado en el historial de la clienta (CU-006, audio de Karina 21-sep-2026).",
        status: 400, elegibilidad,
      };
    }
    return { salidaAnticipada: true, motivoSalidaAnticipada: motivo, elegibilidadEnElMomento: elegibilidad.motivo };
  }

  // ---------------------------------------------------------------------
  // REPORTES DE GARANTÍAS (CU-008). Solo se construyen los DOS reportes del
  // catálogo de cinco que ya tienen ejemplo real y corte confirmado por
  // Dirección — ver PENDIENTES_POR_CONFIRMAR.md sección 3, fila "Requerimientos
  // exactos y ejemplos del reporte": "pendientes de devolución" y "aplicadas a
  // crédito" siguen sin ejemplo (pedidos a Dirección el 10-sep-2026, sin
  // respuesta todavía), y el "ticket de depósitos" de cuadre sigue sin que
  // Administración defina qué datos lleva y quién lo firma — ninguno de los
  // tres se inventa aquí. El corte oficial es LUNES (RESUELTO 11-sep-2026) y
  // la semana del sistema cierra en domingo (RESUELTO 11-sep-2026, ya cubre
  // recuperaciones de domingo dentro de su propia semana).
  //
  // Cubren los DOS tipos de garantía que hoy se capturan como movimiento de
  // caja (Líquida y A) — un solo reporte de garantías, no uno por tipo,
  // mostrando el tipo en cada fila. La Garantía Hipotecaria no tiene
  // movimiento de caja (es documental, Regla 8.1) y no aplica a estos reportes.
  const PATRON_TIPOS_GARANTIA = /^garant[íi]a (l[íi]quida( entregada| aplicada)?|a( entregada)?)$/i;

  function movimientosDeGarantiaEntre(desdeISO, hastaISO) {
    return store.todosMovimientos().filter((mov) => !mov.anulado
      && PATRON_TIPOS_GARANTIA.test((tipoDeMov(mov) ?? "").trim())
      && String(mov.fecha || "") >= desdeISO && String(mov.fecha || "") <= hastaISO);
  }

  // DESGLOSE POR TIPO DE GARANTÍA Y MODALIDAD DE PAGO (CU-008, RESUELTO
  // 21-sep-2026 — Dirección, vía Excel "LUNES PRIMERA PARTE 2109.xlsx":
  // "tienen que ser por modalidad y tipo de garantía"). El TIPO se
  // normaliza a los dos conceptos de caja que hoy existen (Garantía Líquida
  // y Garantía A — la Hipotecaria es documental, sin movimiento de caja,
  // Regla 8.1), sin importar si el movimiento es la entrada, la entregada o
  // la aplicada; la MODALIDAD es la forma de pago del movimiento (mismo
  // criterio que ya usaba porFormaPago en el reporte semanal).
  function tipoGarantiaNormalizado(tipoRaw) {
    return /^garant[íi]a a\b/i.test(String(tipoRaw || "").trim()) ? "Garantía A" : "Garantía Líquida";
  }
  function modalidadPagoDeMov(mov) {
    return mov.metodo === "retencion" ? "Retención automática" : (mov.metodo || "—");
  }

  // REPORTE SEMANAL DE ENTRADA/SALIDA (página del catálogo CU-008 #1, con
  // ejemplo real en "PLANILLA-GARANTIAS LUNES PRIMERA PARTE.xlsx"): por día,
  // por quién lo capturó, y por forma de pago. `fechaLunes` YA debe venir
  // normalizada al lunes de su semana (server.js la resuelve con
  // lunesDeLaSemana antes de llamar aquí, mismo patrón que el resto de
  // reportes de corte semanal).
  function reporteSemanalGarantias(fechaLunes) {
    const desde = fechaLunes;
    const hastaDt = new Date(fechaLunes + "T12:00:00");
    hastaDt.setDate(hastaDt.getDate() + 6);
    const hasta = hastaDt.toISOString().slice(0, 10);

    const movs = movimientosDeGarantiaEntre(desde, hasta);
    const sumar = (mapa, llave, monto) => { mapa[llave] = Math.round(((mapa[llave] || 0) + monto) * 100) / 100; };

    const porDia = {}, porQuien = {}, porForma = {}, porTipoGarantia = {};
    let totalEntradas = 0, totalSalidas = 0;
    for (const mov of movs) {
      const monto = Number(mov.monto) || 0;
      const quien = mov.ejecutivo || mov.registradoPor || "—";
      const forma = modalidadPagoDeMov(mov);
      const tipoG = tipoGarantiaNormalizado(mov.tipo || tipoDeMov(mov));
      if (!porDia[mov.fecha]) porDia[mov.fecha] = { entradas: 0, salidas: 0 };
      if (!porQuien[quien]) porQuien[quien] = { entradas: 0, salidas: 0 };
      if (!porForma[forma]) porForma[forma] = { entradas: 0, salidas: 0 };
      if (!porTipoGarantia[tipoG]) porTipoGarantia[tipoG] = { entradas: 0, salidas: 0 };
      const campo = mov.entrada ? "entradas" : "salidas";
      sumar(porDia[mov.fecha], campo, monto);
      sumar(porQuien[quien], campo, monto);
      sumar(porForma[forma], campo, monto);
      sumar(porTipoGarantia[tipoG], campo, monto);
      if (mov.entrada) totalEntradas = Math.round((totalEntradas + monto) * 100) / 100;
      else totalSalidas = Math.round((totalSalidas + monto) * 100) / 100;
    }

    const aArreglo = (mapa, llaveNombre) => Object.keys(mapa).sort()
      .map((k) => ({ [llaveNombre]: k, entradas: mapa[k].entradas, salidas: mapa[k].salidas }));

    return {
      semana: { desde, hasta },
      totalEntradas, totalSalidas,
      porDia: aArreglo(porDia, "fecha"),
      porQuienCaptura: aArreglo(porQuien, "quien"),
      porFormaPago: aArreglo(porForma, "forma"),
      porTipoGarantia: aArreglo(porTipoGarantia, "tipo"),
    };
  }

  // REPORTE DE SALIDAS POR CLIENTA (página del catálogo CU-008 #2, con
  // ejemplo real en la misma planilla): folio, centro, ejecutivo, monto,
  // periodo — con rollup mensual por centro. `mes` en formato "YYYY-MM".
  function reporteSalidaGarantiasPorClienta(mes) {
    const desde = mes + "-01";
    const hastaDt = new Date(desde + "T12:00:00");
    hastaDt.setMonth(hastaDt.getMonth() + 1);
    hastaDt.setDate(hastaDt.getDate() - 1);
    const hasta = hastaDt.toISOString().slice(0, 10);
    const padron = obtenerPadron();

    const salidas = movimientosDeGarantiaEntre(desde, hasta)
      .filter((mov) => !mov.entrada)
      .map((mov) => {
        const socio = socioDeMov(mov);
        const cred = padron.find((c) => String(c.id).split("|")[0] === socio
          && norm(c.producto) === norm(productoDeMov(mov) || "")) || null;
        const tipoRaw = mov.tipo || mov.concepto;
        return {
          folio: mov.folio, fecha: mov.fecha, socio, nombre: (cred && cred.nombre) || null,
          centro: (cred && cred.centro) || "—", quien: mov.ejecutivo || mov.registradoPor || "—",
          monto: Number(mov.monto) || 0, tipo: tipoRaw,
          // RESUELTO 21-sep-2026 (Dirección, Excel "LUNES PRIMERA PARTE
          // 2109.xlsx"): "tienen que ser por modalidad y tipo de garantía".
          // `tipo` ya trae el texto crudo del movimiento (para no perder
          // detalle, p. ej. "Garantía líquida entregada" vs "aplicada");
          // `tipoGarantia` es la versión normalizada para agrupar, y
          // `modalidad` es la forma de pago.
          tipoGarantia: tipoGarantiaNormalizado(tipoRaw),
          modalidad: modalidadPagoDeMov(mov),
        };
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const sumarEn = (mapa, llave, monto) => { mapa[llave] = Math.round(((mapa[llave] || 0) + monto) * 100) / 100; };
    const porCentro = {}, porTipoGarantia = {}, porModalidad = {};
    for (const s of salidas) {
      sumarEn(porCentro, s.centro, s.monto);
      sumarEn(porTipoGarantia, s.tipoGarantia, s.monto);
      sumarEn(porModalidad, s.modalidad, s.monto);
    }

    return {
      mes, periodo: { desde, hasta }, salidas,
      rollupPorCentro: Object.keys(porCentro).sort().map((centro) => ({ centro, total: porCentro[centro] })),
      rollupPorTipoGarantia: Object.keys(porTipoGarantia).sort()
        .map((tipo) => ({ tipo, total: porTipoGarantia[tipo] })),
      rollupPorModalidad: Object.keys(porModalidad).sort()
        .map((modalidad) => ({ modalidad, total: porModalidad[modalidad] })),
    };
  }

  // CORTE DIARIO DE GARANTÍAS, POR GRUPO (centro) Y POR TIPO DE CRÉDITO
  // (producto) — 21-sep-2026, audio de Karina/Dirección: "el corte diario de
  // garantías tiene que ser por grupo por tipo de crédito", reforzando que
  // "es muy importante que haya un corte diario". Ella misma no sabía si esto
  // se complementa con el arqueo diario que ya existe (`calcularArqueo` en
  // server.js) — SE VALIDÓ TÉCNICAMENTE (21-sep-2026) que NO conviene meterlo
  // ahí: `calcularArqueo` agrupa por EJECUTIVA desde los snapshots del día
  // (caja física de una persona, protegido por 81+ casos de
  // tests/bateria_arqueo.js); este corte agrupa por CENTRO y PRODUCTO desde
  // el padrón/créditos — es una unidad de agrupación distinta. Forzarlo
  // dentro del arqueo arriesgaría el cuadre de caja ya probado por una
  // funcionalidad que ni comparte esa unidad. Por eso este corte vive como
  // reporte APARTE, con su propio endpoint, mismo criterio de fecha que el
  // arqueo (misma fecha, código separado) — nunca modifica calcularArqueo.
  //
  // No existe un catálogo canónico de "tipo de crédito" en el sistema (ver
  // PENDIENTES_POR_CONFIRMAR.md sección 3) — se usa el texto de `producto` ya
  // normalizado (mismo criterio que el resto del módulo), no se inventa un
  // catálogo nuevo aquí.
  function corteDiarioGarantias(fechaISO) {
    const padron = obtenerPadron();
    const movs = movimientosDeGarantiaEntre(fechaISO, fechaISO);

    const filas = movs.map((mov) => {
      const socio = socioDeMov(mov);
      const credito = padron.find((c) => String(c.id).split("|")[0] === socio
        && norm(c.producto) === norm(productoDeMov(mov) || "")) || null;
      return {
        folio: mov.folio,
        socio, nombre: (credito && credito.nombre) || null,
        centro: (credito && credito.centro) || "—",
        producto: (credito && credito.producto) || productoDeMov(mov) || "—",
        entrada: !!mov.entrada,
        monto: Number(mov.monto) || 0,
        tipo: mov.tipo || mov.concepto,
        // QUIÉN y CÓMO (24-sep-2026, panel "Garantías de hoy" de Karina:
        // "cuánto de garantía por ejecutivo") — mismo criterio que el
        // reporte semanal (porQuienCaptura) y que modalidadPagoDeMov.
        quien: mov.ejecutivo || mov.registradoPor || "—",
        modalidad: modalidadPagoDeMov(mov),
        ts: mov.ts || 0,
      };
    });

    const sumar = (mapa, llave, campo, monto) => {
      if (!mapa[llave]) mapa[llave] = { entradas: 0, salidas: 0 };
      mapa[llave][campo] = Math.round((mapa[llave][campo] + monto) * 100) / 100;
    };

    const porCentro = {}, porProducto = {}, porCentroYProducto = {};
    let totalEntradas = 0, totalSalidas = 0;
    for (const fila of filas) {
      const campo = fila.entrada ? "entradas" : "salidas";
      sumar(porCentro, fila.centro, campo, fila.monto);
      sumar(porProducto, fila.producto, campo, fila.monto);
      sumar(porCentroYProducto, fila.centro + " · " + fila.producto, campo, fila.monto);
      if (fila.entrada) totalEntradas = Math.round((totalEntradas + fila.monto) * 100) / 100;
      else totalSalidas = Math.round((totalSalidas + fila.monto) * 100) / 100;
    }

    const aArreglo = (mapa, llaveNombre) => Object.keys(mapa).sort()
      .map((k) => ({ [llaveNombre]: k, entradas: mapa[k].entradas, salidas: mapa[k].salidas }));

    return {
      fecha: fechaISO,
      totalEntradas, totalSalidas,
      porGrupoYTipoCredito: Object.keys(porCentroYProducto).sort().map((llave) => {
        const [centro, producto] = llave.split(" · ");
        return { centro, producto, entradas: porCentroYProducto[llave].entradas, salidas: porCentroYProducto[llave].salidas };
      }),
      porCentro: aArreglo(porCentro, "centro"),
      porTipoCredito: aArreglo(porProducto, "producto"),
      movimientos: filas,
      notaArqueo: "Este corte es un reporte APARTE del arqueo diario de caja (GET /api/arqueo): el arqueo agrupa "
        + "por EJECUTIVA (caja física de una persona); este corte agrupa por CENTRO y TIPO DE CRÉDITO desde el "
        + "padrón — son unidades de agrupación distintas, y mezclarlas arriesgaría el cuadre de caja ya probado. "
        + "Se consulta para la misma fecha que el arqueo, pero con código y endpoint separados.",
    };
  }

  // ---------------------------------------------------------------------
  // VIGENCIA DE LA GARANTÍA HIPOTECARIA (21-sep-2026, audio de Karina —
  // "el sistema tiene que decir con tres días antes que ya está por
  // expirar" — y pedido explícito de Carlos: "avisar 3 días antes de vencer
  // la vigencia del documento hipotecario"). Aclara la ambigüedad que había
  // quedado abierta en PENDIENTES_POR_CONFIRMAR.md: el aviso es sobre la
  // VIGENCIA DEL DOCUMENTO hipotecario (ej. escritura, avalúo, póliza que
  // respalda la garantía), NO sobre el plazo de 2 semanas para entregar la
  // garantía líquida al cierre (ese es otro pendiente, distinto, todavía sin
  // definir la consecuencia de excederlo).
  //
  // MODELO DE DATOS MÍNIMO Y ADITIVO: hasta hoy NO existía ningún campo para
  // esto (confirmado por grep — server.js solo tenía un comentario diciendo
  // que la garantía hipotecaria "no se inventa aquí"). Se sigue el MISMO
  // patrón ya aprobado por Dirección para DOC-01 (INE/comprobante de
  // domicilio, ver dominios/renovacion_documentos.js): un campo opcional en
  // el crédito, `credito.garantiaHipotecaria.fechaVencimiento`, capturado vía
  // store.agregarCambioPadron (mismo mecanismo que documentosRenovacion) —
  // así que sin esa fecha, el sistema simplemente no puede avisar (no
  // adivina un vencimiento que Dirección no ha capturado).
  //
  // A diferencia de vigenciaDocumentosRenovacion() (que solo regresa
  // vencido/no vencido/null), esto necesita adelantar el aviso ANTES del
  // vencimiento — por eso calcula días restantes, no solo un booleano.
  const GARANTIA_HIPOTECARIA_DIAS_ALERTA = Number(garantiaHipotecariaDiasAlerta) || 3;

  function diasEntre(desdeISO, hastaISO) {
    const a = new Date(desdeISO + "T12:00");
    const b = new Date(hastaISO + "T12:00");
    return Math.round((b - a) / 86400000);
  }

  // Pura: dado UN crédito del padrón, regresa su alerta de vigencia
  // hipotecaria, o null si esa clienta no tiene fecha de vencimiento
  // capturada todavía (no hay nada que avisar sin el dato).
  function alertaVencimientoGarantiaHipotecaria(credito) {
    const fechaVencimiento = credito && credito.garantiaHipotecaria && credito.garantiaHipotecaria.fechaVencimiento;
    if (!fechaVencimiento) return null;
    const hoy = hoyMX();
    const diasRestantes = diasEntre(hoy, fechaVencimiento);
    return {
      fechaVencimiento,
      diasRestantes,
      vencida: diasRestantes < 0,
      porVencer: diasRestantes >= 0 && diasRestantes <= GARANTIA_HIPOTECARIA_DIAS_ALERTA,
      diasAlerta: GARANTIA_HIPOTECARIA_DIAS_ALERTA,
    };
  }

  // Lista, para TODO el padrón activo, solo las clientas cuya garantía
  // hipotecaria ya está vencida o está por vencer dentro de la ventana de
  // aviso — pensado para el tablero de Dirección (mismo criterio que
  // reporteSalidaGarantiasPorClienta: no regresa a quien no necesita alerta).
  function alertasGarantiaHipotecariaPorVencer() {
    const padron = obtenerPadron().filter((c) => c.activa !== false && c.estatus !== "BAJA");
    const alertas = padron
      .map((credito) => {
        const alerta = alertaVencimientoGarantiaHipotecaria(credito);
        if (!alerta || !(alerta.vencida || alerta.porVencer)) return null;
        return {
          socio: String(credito.id).split("|")[0], nombre: credito.nombre,
          centro: credito.centro, producto: credito.producto,
          ...alerta,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.diasRestantes - b.diasRestantes);
    return { fecha: hoyMX(), diasAlerta: GARANTIA_HIPOTECARIA_DIAS_ALERTA, alertas };
  }

  // ---------------------------------------------------------------------
  // TICKET DE LIBERACIÓN DE GARANTÍAS (CU-006, formato exacto de la "HOJA DE
  // LIBERACION DE GARANTIAS" de Karina/Dirección — Excel validado 21-sep-2026).
  //
  // Es DISTINTO al ticket H.14 (ticketGarantiaLiquidaH14): el H.14 es el
  // comprobante de CADA movimiento suelto (una entrada o una salida); este es
  // el documento de CIERRE — pensado para IMPRIMIRSE y que la clienta lo
  // FIRME en papel al recibir de vuelta TODA su garantía guardada al terminar
  // su ciclo. No recalcula nada: solo junta, en el formato del Excel de
  // Karina, datos que YA existen — estadoDeCuentaGarantia() para el saldo y el
  // historial, el crédito del padrón para nombre/centro/ejecutivo, y la(s)
  // salida(s) ya registradas para fecha y monto entregado.
  //
  // ARMA LOS DATOS (el objeto que lleva el ticket); la vista imprimible que
  // los renderiza como HTML vive en ../ticket-liberacion-garantia.js, servida
  // por GET /api/garantias/liberacion/ticket (21-sep-2026, hallazgo de
  // validación sobre el audio de Karina: "cuando entregas la garantía tienes
  // que imprimir un ticket que se los deje firmar y que el ejecutivo lo deje
  // escanear").
  //
  // TELÉFONO DE CONTACTO de la nota del sobre sellado: configurable por
  // variable de entorno, nunca el número real hardcodeado — mismo patrón que
  // PORCENTAJE_GARANTIA_LIQUIDA. Custodia/autoriza (ver CUSTODIA_GARANTIAS /
  // AUTORIZA_GARANTIAS arriba) siguen el mismo patrón.
  const TELEFONO_CONTACTO_GARANTIAS = process.env.TELEFONO_CONTACTO_GARANTIAS
    || "(configurar TELEFONO_CONTACTO_GARANTIAS)";

  // CUSTODIA/AUTORIZA: los dos roles fijos de Dirección que el Excel real
  // ("REPORTE DE SALIDA A", validado 21-sep-2026) exige en cada liberación —
  // "Custodia: Ing. Alejandra González Arango · Autoriza: Lic. Anel Aydee
  // Díaz Silva, Directora General". Van por variable de entorno, nunca
  // hardcodeados sin poder cambiar (mismo patrón que TELEFONO_CONTACTO_GARANTIAS):
  // si Dirección cambia de responsable, se actualiza la variable, no el código.
  const CUSTODIA_GARANTIAS = process.env.CUSTODIA_GARANTIAS
    || "Ing. Alejandra González Arango";
  const AUTORIZA_GARANTIAS = process.env.AUTORIZA_GARANTIAS
    || "Lic. Anel Aydee Díaz Silva, Directora General";

  // Dos cosas que el Excel de Karina asume pero que el sistema NO puede
  // resolver por sí solo — se declaran como dato, no se adivinan (mismo
  // patrón que PENDIENTES_FICHA_GARANTIA/PENDIENTES_RESUMEN_GARANTIAS).
  const PENDIENTES_TICKET_LIBERACION = [
    {
      tema: "Ejecutivo responsable de la ENTREGA física",
      motivo: "El ticket usa el ejecutivo asignado al crédito en el padrón (quién lo cobra) — el sistema no "
        + "captura quién entrega físicamente el sobre si es una persona distinta (ej. Dirección entrega en "
        + "oficina). No se adivina: se cita cuál de los dos es.",
      responsable: "Dirección",
    },
    {
      tema: "Folio único cuando se liberan Garantía Líquida y Garantía A el mismo cierre",
      motivo: "El folio SIEMPRE es 1:1 con un movimiento (una salida = un folio) — nunca agrupa varias "
        + "entregas bajo un solo folio. Si la clienta recibe Líquida y A en el mismo cierre son DOS folios "
        + "(uno por tipo); el ticket los lista como dos partidas con Subtotal por tipo y un Total, en vez de "
        + "inventar un folio agrupador que no existe en los movimientos reales.",
      responsable: "Sistemas (documentado, no bloquea la entrega)",
    },
  ];

  function formatoDDMMAAAA(fechaISO) {
    const [anio, mes, dia] = String(fechaISO || "").split("-");
    return (anio && mes && dia) ? `${dia}-${mes}-${anio}` : (fechaISO || null);
  }

  // Una partida del ticket por tipo de garantía (Líquida o A) — folio, fecha y
  // monto SON los de su propio movimiento de salida; el periodo cubierto va
  // desde el primer movimiento de ese historial (la primera aportación) hasta
  // la fecha de esa misma salida.
  function partidaDeSalida(filaSalida, historialCompleto, tipoGarantia) {
    if (!filaSalida) return null;
    const primeraFila = historialCompleto[0];
    return {
      tipoGarantia,
      folio: filaSalida.folio,
      fechaEntrega: filaSalida.fecha,
      monto: Math.round((filaSalida.monto || 0) * 100) / 100,
      periodo: { desde: primeraFila.fecha, hasta: filaSalida.fecha },
      comentarioPeriodo: "GARANTIAS DEL " + formatoDDMMAAAA(primeraFila.fecha)
        + " AL " + formatoDDMMAAAA(filaSalida.fecha),
    };
  }

  function ticketLiberacionGarantia(usuario, socioSolicitado, productoSolicitado) {
    const ficha = estadoDeCuentaGarantia(usuario, socioSolicitado, productoSolicitado);
    if (ficha.error) return ficha;

    const credito = buscarCreditoDeSocia(ficha.socio, ficha.producto);
    if (!credito) {
      return { error: "No encuentro el crédito de esa clienta para armar el ticket.", status: 400 };
    }

    const ultimaSalidaLiquida = ficha.historial.filter((fila) => !fila.entrada).at(-1) || null;
    const ultimaSalidaA = ficha.historialGarantiaA.filter((fila) => !fila.entrada).at(-1) || null;

    const partidas = [
      partidaDeSalida(ultimaSalidaLiquida, ficha.historial, "Líquida"),
      partidaDeSalida(ultimaSalidaA, ficha.historialGarantiaA, "A"),
    ].filter(Boolean);

    // SIN SALIDA REGISTRADA no hay nada que liberar todavía: no se genera un
    // ticket vacío o inventado — se avisa con claridad (una clienta que aún
    // no recibió su garantía no debería salir con un ticket en $0.00).
    if (partidas.length === 0) {
      return {
        error: "Esta clienta todavía no tiene ninguna salida de garantía registrada — no hay nada que liberar.",
        status: 400,
      };
    }

    const cv = carteraViva(usuario);
    const saldoActual = infoCredito(cv, credito).saldoActual;
    const pagoAlCierre = numeroDePago(credito, saldoActual);
    const notaPagoAlCierre = pagoAlCierre && pagoAlCierre.pago != null
      ? " — CIERRE AL PAGO " + pagoAlCierre.pago
      : "";

    const total = Math.round(partidas.reduce((suma, p) => suma + p.monto, 0) * 100) / 100;

    return {
      folio: partidas.length === 1 ? partidas[0].folio : null,
      folios: partidas.map((p) => p.folio),
      fechaEntrega: partidas.at(-1).fechaEntrega,
      nombreClienta: credito.nombre,
      socio: ficha.socio,
      producto: credito.producto,
      partidas,
      subtotal: partidas.map((p) => ({ tipoGarantia: p.tipoGarantia, monto: p.monto })),
      montoEntregado: total,
      total,
      comentarios: partidas.map((p) => p.comentarioPeriodo).join(" / ") + notaPagoAlCierre,
      numeroDePagoCierre: pagoAlCierre && pagoAlCierre.pago != null ? pagoAlCierre.pago : null,
      firmaRecibido: {
        firmado: false,
        fecha: null,
        nota: "El sistema no captura firma digital — se marca a mano en el papel impreso, al momento en que "
          + "la clienta recibe su garantía.",
      },
      ejecutivo: {
        nombre: credito.ejecutivo || null,
        centro: credito.centro || null,
        firma: { firmado: false, fecha: null },
      },
      notaSobreSellado: "El sobre de la garantía debe entregarse SELLADO. Si se nota manipulado, NO se recibe "
        + "— llamar antes al " + TELEFONO_CONTACTO_GARANTIAS + ".",
      custodia: CUSTODIA_GARANTIAS,
      autoriza: AUTORIZA_GARANTIAS,
      elegibilidadLiberacion: ficha.elegibilidadLiberacion,
      pendientes: PENDIENTES_TICKET_LIBERACION,
    };
  }

  // ---------------------------------------------------------------------
  // ALERTA/ESCALACIÓN POR EXCEDER EL PLAZO DE 2 SEMANAS PARA ENTREGAR LA
  // GARANTÍA (CU-006, PENDIENTES_POR_CONFIRMAR.md sección 3: "Consecuencia
  // de exceder el plazo de 2 semanas para entregar la garantía"). RESUELTO
  // 21-sep-2026 — Dirección aprueba sin cambios la propuesta de Sistemas del
  // 11-sep-2026: "Respuesta: alerta y escala." Nunca bloquea — "es la
  // doctrina de la casa: los candados duros van en el dinero, no en las
  // entregas" (mismo criterio que el resto del módulo: elegibilidadLiberacion-
  // Garantia y validarAportacionGarantiaEnReestructura tampoco mueven ni
  // detienen nada solos, solo avisan).
  //
  // El plazo corre desde que el crédito que garantiza CIERRA (fecha_baja,
  // store.js aplicarCambios "baja" — se fija también en la baja que genera
  // una renovación/recrédito, así que cubre ese caso sin código aparte) y la
  // garantía queda LIBERABLE (elegibilidadLiberacionGarantia().liberable ===
  // true) pero todavía sigue guardada (nadie la ha entregado). Días
  // configurables por variable de entorno, nunca fijos en código — mismo
  // patrón que PORCENTAJE_GARANTIA_LIQUIDA/GARANTIA_HIPOTECARIA_DIAS_ALERTA.
  const DIAS_PLAZO_ENTREGA_GARANTIA = Number(process.env.GARANTIA_DIAS_PLAZO_ENTREGA) || 14;
  // PLAZO DE 5 DÍAS PARA REGRESAR LA HOJA DE LIBERACIÓN FIRMADA (CU-006,
  // RESUELTO 21-sep-2026: Carlos confirma por escrito que SÍ es política
  // vigente — no es solo formato interno de una sucursal, ver
  // PENDIENTES_POR_CONFIRMAR.md sección 3, fila "Plazo de 5 días...").
  //
  // Cuando se entrega la garantía (salida "Garantía líquida entregada" o
  // "Garantía A entregada", ver ticketGarantiaLiquidaH14/ticket-liberacion-
  // garantia.js) se le da a la clienta la hoja de liberación para firmar y
  // debe regresarla a oficina dentro de 5 días. Hasta hoy nada registraba
  // si esa hoja YA regresó firmada — este candado agrega justo esa pieza,
  // con el mismo criterio ya usado en el resto del módulo (INFORMATIVO,
  // "alerta y escala", NUNCA bloquea — es la misma doctrina que el plazo de
  // 2 semanas para entregar la garantía).
  //
  // POR QUÉ UN REGISTRO APPEND-ONLY (store.registro/agregarRegistro) Y NO UN
  // CAMPO MUTABLE: el mecanismo ya existe para bitácoras de cumplimiento
  // (riesgo, PLD, ARCO, expediente) — una fila nueva por cada regreso de
  // hoja, nunca un update; el estado vigente ("¿ya regresó?") se DERIVA de
  // si existe al menos una fila con ese folio, igual que el resto de estas
  // bitácoras. El folio de la SALIDA (mov.folio, el mismo que ya imprime el
  // ticket H.14) es la llave — así no hace falta inventar un id nuevo.
  const REGISTRO_HOJA_LIBERACION_REGRESO = "hoja_liberacion_garantia_regreso";
  const DIAS_PLAZO_REGRESO_HOJA_LIBERACION = Number(process.env.GARANTIA_DIAS_PLAZO_REGRESO_HOJA) || 5;
  const PATRON_TIPOS_SALIDA_GARANTIA = /^garant[íi]a (l[íi]quida|a) entregada$/i;
  function diasEntreFechasISO(desdeISO, hastaISO) {
    const d1 = new Date(String(desdeISO).slice(0, 10) + "T12:00:00");
    const d2 = new Date(String(hastaISO).slice(0, 10) + "T12:00:00");
    return Math.round((d2.getTime() - d1.getTime()) / 86400000);
  }

  // Todas las clientas con una garantía YA liberable (crédito cerrado, sin
  // otro crédito activo, con saldo guardado > 0) que lleva DIAS_PLAZO_ENTREGA_
  // GARANTIA días o más sin que nadie la entregue — para que el tablero de
  // Dirección la muestre como alerta y decida escalar. Informativo, no
  // genera ningún movimiento ni bloquea la entrega cuando por fin ocurra.
  function alertasPlazoEntregaGarantia(usuario) {
    const hoy = hoyMX();
    const padron = obtenerPadron();
    const cerrados = padron.filter((credito) => (credito.activa === false || credito.estatus === "BAJA")
      && credito.fecha_baja);

    const alertas = cerrados.reduce((filas, credito) => {
      const socio = String(credito.id).split("|")[0];
      const elegibilidad = elegibilidadLiberacionGarantia(usuario, socio, credito.producto);
      if (!elegibilidad.liberable) return filas;
      const diasSinEntregar = diasEntreFechasISO(credito.fecha_baja, hoy);
      if (diasSinEntregar < DIAS_PLAZO_ENTREGA_GARANTIA) return filas;
      const { disponible } = garantiaLiquidaDisponible(usuario, socio, credito.producto);
      return [...filas, {
        socio, nombre: credito.nombre, centro: credito.centro, producto: credito.producto,
        fechaCierre: credito.fecha_baja, diasSinEntregar, guardado: disponible,
        motivo: "Han pasado " + diasSinEntregar + " días desde que el crédito cerró y la garantía "
          + "sigue sin entregarse (plazo: " + DIAS_PLAZO_ENTREGA_GARANTIA + " días). Alertar y escalar "
          + "a Dirección — nunca bloquear (CU-006, aprobado por Dirección 21-sep-2026).",
      }];
    }, []);

    return {
      diasPlazo: DIAS_PLAZO_ENTREGA_GARANTIA,
      alertas: alertas.sort((a, b) => b.diasSinEntregar - a.diasSinEntregar),
    };
  }

  // El movimiento de salida real (folio) contra el que se marca el regreso —
  // nunca se acepta un folio inventado: si no hay una salida de garantía con
  // ese folio, no hay hoja de liberación que regresar.
  function buscarSalidaGarantiaPorFolio(folio) {
    return store.todosMovimientos().find((mov) => !mov.anulado
      && String(mov.folio) === String(folio)
      && PATRON_TIPOS_SALIDA_GARANTIA.test((tipoDeMov(mov) ?? "").trim())) || null;
  }

  // Ya hay una fila de regreso para este folio (no importa quién la puso ni
  // cuándo — basta una).
  function hojaLiberacionYaRegresada(folio) {
    return store.registro(REGISTRO_HOJA_LIBERACION_REGRESO)
      .some((fila) => String(fila.folio) === String(folio));
  }

  // Registrar que la hoja de liberación firmada YA regresó a oficina para
  // el folio de salida `folio`. `fecha` default hoyMX() (no se puede
  // registrar un regreso en el futuro). Regresa { error, status } si el
  // folio no corresponde a una salida real de garantía, o si ya estaba
  // marcada — nunca se duplica ni se sobrescribe una fila.
  function registrarRegresoHojaLiberacion({ folio, fecha }, usuario) {
    const salida = buscarSalidaGarantiaPorFolio(folio);
    if (!salida) {
      return { error: "No encuentro una salida de garantía (\"Garantía líquida entregada\" o \"Garantía A entregada\") con ese folio.", status: 400 };
    }
    if (hojaLiberacionYaRegresada(folio)) {
      return { error: "Ya está registrado el regreso de la hoja de liberación para este folio.", status: 400 };
    }
    const fechaRegreso = String(fecha || hoyMX()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRegreso)) {
      return { error: "La fecha de regreso no es válida.", status: 400 };
    }
    if (fechaRegreso > hoyMX()) {
      return { error: "La fecha de regreso no puede ser futura.", status: 400 };
    }
    const socio = socioDeMov(salida);
    const fila = store.agregarRegistro(REGISTRO_HOJA_LIBERACION_REGRESO, {
      folio: String(folio), socio, producto: productoDeMov(salida) || salida.producto || null,
      fechaSalida: salida.fecha, fechaRegreso,
      diasParaRegresar: diasEntreFechasISO(salida.fecha, fechaRegreso),
      registradoPor: (usuario && usuario.nombre) || null, usuarioId: (usuario && usuario.id) || null,
    });
    return { ok: true, registro: fila };
  }

  // Todas las salidas de garantía (líquida o A) que llevan
  // DIAS_PLAZO_REGRESO_HOJA_LIBERACION días o más sin que nadie registre el
  // regreso de su hoja de liberación firmada — para que el tablero de
  // Dirección la muestre como alerta y decida escalar. Informativo, igual
  // que alertasPlazoEntregaGarantia: nunca bloquea ninguna operación futura.
  function alertasPlazoRegresoHojaLiberacion() {
    const hoy = hoyMX();
    const padron = obtenerPadron();
    const salidas = store.todosMovimientos().filter((mov) => !mov.anulado
      && PATRON_TIPOS_SALIDA_GARANTIA.test((tipoDeMov(mov) ?? "").trim()));

    const alertas = salidas.reduce((filas, mov) => {
      if (hojaLiberacionYaRegresada(mov.folio)) return filas;
      const diasSinRegresar = diasEntreFechasISO(mov.fecha, hoy);
      if (diasSinRegresar < DIAS_PLAZO_REGRESO_HOJA_LIBERACION) return filas;
      const socio = socioDeMov(mov);
      const producto = productoDeMov(mov) || mov.producto || null;
      const credito = padron.find((c) => String(c.id).split("|")[0] === socio
        && norm(c.producto) === norm(producto || "")) || null;
      return [...filas, {
        socio, nombre: (credito && credito.nombre) || null, centro: (credito && credito.centro) || null,
        producto, folio: mov.folio, tipo: mov.tipo || mov.concepto,
        fechaSalida: mov.fecha, monto: Number(mov.monto) || 0, diasSinRegresar,
        motivo: "Han pasado " + diasSinRegresar + " días desde que se entregó la garantía y la hoja de "
          + "liberación firmada sigue sin regresar a oficina (plazo: " + DIAS_PLAZO_REGRESO_HOJA_LIBERACION
          + " días). Alertar y escalar a Dirección — nunca bloquear (misma doctrina que el plazo de "
          + "entrega, CU-006, confirmado por Carlos 21-sep-2026).",
      }];
    }, []);

    return {
      diasPlazo: DIAS_PLAZO_REGRESO_HOJA_LIBERACION,
      alertas: alertas.sort((a, b) => b.diasSinRegresar - a.diasSinRegresar),
    };
  }

  // BOTÓN "AJUSTE MANUAL" DE GARANTÍA, CON AUTORIZACIÓN (CU-006, RESUELTO
  // 21-sep-2026): audio de Karina confirma quién autoriza — Lic. Alejandra
  // (Ing. Alejandra González Arango) o Lic. Monse, cualquiera de las dos; y
  // Carlos confirma por escrito el mismo día que aplica IGUAL a los demás
  // tipos de garantía/crédito — no es exclusivo de Garantía Líquida (por eso
  // `tipoGarantia` acepta "Garantía Líquida" o "Garantía A", nunca una tercera
  // opción inventada aquí).
  //
  // QUIÉN AUTORIZA SE VERIFICA POR IDENTIDAD DE SESIÓN, NO POR UN CAMPO DE
  // TEXTO: en vez de un campo "autorizadoPor" libre (que cualquiera podría
  // escribir), la propia cuenta con la que se hace el ajuste TIENE que ser
  // Alejandra o Monse — mismo criterio que puedeCambiarRiesgo() en
  // riesgo_bitacora.js. `usuariosAutorizanAjusteManual` llega como parámetro
  // (no hardcodeado) para poder confirmarlo distinto sin deploy, igual que
  // RIESGO_ROLES_PUEDEN_CAMBIAR.
  //
  // SE REUTILIZAN LOS MISMOS TIPOS DE MOVIMIENTO DEL CATÁLOGO ("Garantía
  // líquida"/"Garantía líquida entregada"/"Garantía A"/"Garantía A entregada")
  // — así garantiaLiquidaDisponible/garantiaADisponible, los 2 reportes de
  // CU-008 y el estado de cuenta de la ficha ya cuentan el ajuste sin tocar
  // nada de esa lógica (es la MISMA cifra, con motivo de ajuste anotado en la
  // nota); no se inventa un tipo nuevo. `metodo: "ajuste"` (como "retencion")
  // es invisible al arqueo/cierre de caja — un ajuste manual de garantía NO es
  // efectivo entrando o saliendo de una caja física.
  //
  // UNA SALIDA de ajuste SÍ respeta el tope de lo guardado (no se puede
  // "ajustar" a un guardado negativo) — el candado duro sigue siendo sobre el
  // dinero, la autorización es lo que permite saltarse el resto de reglas
  // (p. ej. la de reestructura). Si algún día Dirección necesita ajustar POR
  // ENCIMA de ese tope (corregir un guardado que se sabe mal capturado desde
  // antes), es una decisión nueva que hay que pedirle — no se asume aquí.
  function puedeAutorizarAjusteManual(usuario) {
    return Boolean(usuario) && usuariosAutorizanAjusteManual.includes(String(usuario.id || "").toLowerCase());
  }

  const JUSTIFICACION_MINIMA_AJUSTE = 5;
  const TIPOS_GARANTIA_AJUSTE_MANUAL = ["Garantía Líquida", "Garantía A"];

  function registrarAjusteManualGarantia({ socio, producto, tipoGarantia, direccion, monto, motivo }, usuario) {
    if (!puedeAutorizarAjusteManual(usuario)) {
      return { error: "Solo Lic. Alejandra o Lic. Monse pueden autorizar un ajuste manual de garantía (CU-006, audio de Karina 21-sep-2026) — entra con esa cuenta para hacerlo.", status: 403 };
    }
    if (!TIPOS_GARANTIA_AJUSTE_MANUAL.includes(tipoGarantia)) {
      return { error: "El tipo de garantía debe ser \"Garantía Líquida\" o \"Garantía A\".", status: 400 };
    }
    if (direccion !== "entrada" && direccion !== "salida") {
      return { error: "La dirección del ajuste debe ser \"entrada\" o \"salida\".", status: 400 };
    }
    const montoNum = Number(monto);
    if (!(montoNum > 0)) return { error: "El monto del ajuste debe ser mayor a cero.", status: 400 };
    const justificacion = String(motivo ?? "").trim();
    if (justificacion.length < JUSTIFICACION_MINIMA_AJUSTE) {
      return { error: `La justificación es obligatoria (mínimo ${JUSTIFICACION_MINIMA_AJUSTE} caracteres): un ajuste manual de garantía sin explicación es indefendible ante una autoridad.`, status: 400 };
    }
    const socioLimpio = String(socio ?? "").replace(/[\s\-.]/g, "").trim();
    if (!socioLimpio) return { error: "Falta el número de socio.", status: 400 };
    const cred = buscarCreditoDeSocia(socioLimpio, producto);
    if (!cred) return { error: "No encuentro un crédito de esa clienta con ese producto.", status: 400 };

    const esLiquida = tipoGarantia === "Garantía Líquida";
    const disponibleFn = esLiquida ? garantiaLiquidaDisponible : garantiaADisponible;
    const { disponible } = disponibleFn(usuario, socioLimpio, cred.producto);
    if (direccion === "salida" && montoNum > disponible + 0.009) {
      return {
        error: "Esta clienta solo tiene $" + disponible.toFixed(2) + " guardado de " + tipoGarantia
          + " en ese crédito — el ajuste manual no puede sacar más de lo que hay guardado.",
        status: 400, disponible,
      };
    }

    const tipoNombre = direccion === "entrada" ? tipoGarantia : tipoGarantia + " entregada";
    const fecha = hoyMX();
    const folio = "AJUSTE-" + norm(socioLimpio) + "-" + nprod(cred.producto) + "-" + Date.now();
    const mov = {
      folio, fecha, monto: Math.round(montoNum * 100) / 100,
      concepto: "Ajuste manual de " + tipoGarantia + " — " + justificacion,
      categoria: "Otro", metodo: "ajuste",
      ejecutivo: null, socio: socioLimpio, producto: cred.producto,
      tipo: tipoNombre, entrada: direccion === "entrada",
      ajusteManual: true, motivo: justificacion,
      autorizadoPor: usuario.nombre, autorizadoPorId: usuario.id,
      registradoPor: usuario.nombre, rol: usuario.rol, usuario: usuario.id, ts: Date.now(),
    };
    store.agregarMovimiento(mov);
    const disponibleDespues = direccion === "entrada" ? disponible + montoNum : Math.max(0, disponible - montoNum);
    const ticket = ticketGarantiaLiquidaH14(mov, disponible, disponibleDespues);
    return { ok: true, movimiento: mov, ticket };  }

  // ---------------------------------------------------------------------
  // SOLICITUDES DE GARANTÍAS CON APROBACIÓN DE DIRECCIÓN (Karina, 24-sep-2026:
  // "un botón para solicitar que suelten las garantías donde se le mande la
  // notificación al panel de la Ing. Monse con el nombre y número de socio,
  // qué crédito, el monto; así también cuando Alejandra quiera modificar el
  // saldo, solo se modifique si la Ing. Monse lo aprueba").
  //
  // DOS TIPOS de solicitud, UNA sola cola:
  //   "liberacion" — pedir que se SUELTE (entregue) la garantía guardada de
  //     una clienta. Aprobarla NO mueve dinero: el dinero solo sale con el
  //     flujo de entrega que ya existe (movimiento "…entregada" + ticket
  //     H.14 / hoja de liberación) — la doctrina de la casa: los candados
  //     duros van en el dinero, la solicitud es el aviso formal.
  //   "ajuste" — un ajuste manual de saldo pedido por quien NO aprueba
  //     (Alejandra). Aprobarla SÍ aplica el ajuste en el acto, vía
  //     registrarAjusteManualGarantia con la SESIÓN de quien aprueba — así
  //     el movimiento queda autorizado por identidad de sesión, nunca por un
  //     campo de texto (mismo criterio que puedeAutorizarAjusteManual).
  //
  // APPEND-ONLY (mismo patrón que la hoja de liberación): una fila por
  // solicitud + una fila por resolución; el estado se DERIVA de si existe
  // resolución con ese folio — nunca se edita ni se borra nada.
  const REGISTRO_SOLICITUDES_GARANTIA = "solicitudes_garantia";
  const REGISTRO_RESOLUCION_SOLICITUD = "solicitudes_garantia_resolucion";

  function puedeAprobarSolicitudGarantia(usuario) {
    return Boolean(usuario) && usuariosApruebanSolicitudes.includes(String(usuario.id || "").toLowerCase());
  }

  function solicitudesGarantiaConEstado() {
    const porFolio = {};
    for (const r of store.registro(REGISTRO_RESOLUCION_SOLICITUD)) porFolio[r.folio] = r;
    return store.registro(REGISTRO_SOLICITUDES_GARANTIA).map((s) => {
      const r = porFolio[s.folio] || null;
      return { ...s, estado: r ? (r.decision === "aprobar" ? "aprobada" : "rechazada") : "pendiente", resolucion: r };
    });
  }

  function crearSolicitudGarantia({ tipo, socio, producto, monto, tipoGarantia, direccion, motivo }, usuario) {
    if (tipo !== "liberacion" && tipo !== "ajuste") {
      return { error: "El tipo de solicitud debe ser \"liberacion\" o \"ajuste\".", status: 400 };
    }
    const socioLimpio = String(socio ?? "").replace(/[\s\-.]/g, "").trim();
    if (!socioLimpio) return { error: "Falta el número de socio.", status: 400 };
    const cred = buscarCreditoDeSocia(socioLimpio, producto);
    if (!cred) return { error: "No encuentro un crédito de esa clienta con ese producto.", status: 400 };

    const { disponible: guardadaLiquida } = garantiaLiquidaDisponible(usuario, socioLimpio, cred.producto);
    const { disponible: guardadaA } = garantiaADisponible(usuario, socioLimpio, cred.producto);

    let montoNum = Number(monto);
    let camposAjuste = {};
    if (tipo === "ajuste") {
      // Mismas validaciones que el ajuste directo — una solicitud que quien
      // aprueba no podría aplicar tal cual no debe entrar a la cola.
      if (!TIPOS_GARANTIA_AJUSTE_MANUAL.includes(tipoGarantia)) {
        return { error: "El tipo de garantía debe ser \"Garantía Líquida\" o \"Garantía A\".", status: 400 };
      }
      if (direccion !== "entrada" && direccion !== "salida") {
        return { error: "La dirección del ajuste debe ser \"entrada\" o \"salida\".", status: 400 };
      }
      if (!(montoNum > 0)) return { error: "El monto del ajuste debe ser mayor a cero.", status: 400 };
      const justificacion = String(motivo ?? "").trim();
      if (justificacion.length < JUSTIFICACION_MINIMA_AJUSTE) {
        return { error: `La justificación es obligatoria (mínimo ${JUSTIFICACION_MINIMA_AJUSTE} caracteres): la Ing. Monse tiene que poder entender qué está aprobando.`, status: 400 };
      }
      camposAjuste = { tipoGarantia, direccion };
    } else {
      // Liberación: sin monto explícito se pide TODO lo guardado (Líquida +
      // A, cada una con su cifra en la fila); sin nada guardado no hay nada
      // que soltar.
      if (!(montoNum > 0)) montoNum = Math.round((guardadaLiquida + guardadaA) * 100) / 100;
      if (!(montoNum > 0)) return { error: "Esta clienta no tiene garantía guardada que soltar en ese crédito.", status: 400 };
    }

    const yaPendiente = solicitudesGarantiaConEstado().find((s) => s.estado === "pendiente"
      && s.tipo === tipo && s.socio === socioLimpio && norm(s.producto || "") === norm(cred.producto));
    if (yaPendiente) {
      return {
        error: "Ya hay una solicitud de " + (tipo === "liberacion" ? "liberación" : "ajuste")
          + " pendiente para esa clienta y crédito (folio " + yaPendiente.folio
          + ") — espera a que la Ing. Monse la resuelva.",
        status: 400,
      };
    }

    const fecha = hoyMX();
    const folio = "SG-" + fecha.slice(8, 10) + fecha.slice(5, 7) + "-"
      + String(store.registro(REGISTRO_SOLICITUDES_GARANTIA).length + 1).padStart(3, "0");
    const fila = store.agregarRegistro(REGISTRO_SOLICITUDES_GARANTIA, {
      folio, tipo, fecha,
      socio: socioLimpio, nombre: cred.nombre, centro: cred.centro || null, producto: cred.producto,
      monto: Math.round(montoNum * 100) / 100,
      guardadaLiquida, guardadaA,
      motivo: String(motivo ?? "").trim() || null,
      ...camposAjuste,
      solicitadoPor: (usuario && usuario.nombre) || null,
      solicitadoPorId: (usuario && usuario.id) || null,
    });
    return { ok: true, solicitud: { ...fila, estado: "pendiente", resolucion: null } };
  }

  function listarSolicitudesGarantia(usuario) {
    const solicitudes = solicitudesGarantiaConEstado().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return {
      solicitudes: solicitudes.slice(0, 100),
      pendientes: solicitudes.filter((s) => s.estado === "pendiente").length,
      puedeAprobar: puedeAprobarSolicitudGarantia(usuario),
      aprueban: usuariosApruebanSolicitudes,
    };
  }

  function resolverSolicitudGarantia({ folio, decision, nota }, usuario) {
    if (!puedeAprobarSolicitudGarantia(usuario)) {
      return { error: "Solo la Ing. Monse puede aprobar o rechazar solicitudes de garantías (Karina, 24-sep-2026) — entra con esa cuenta para resolverla.", status: 403 };
    }
    if (decision !== "aprobar" && decision !== "rechazar") {
      return { error: "La decisión debe ser \"aprobar\" o \"rechazar\".", status: 400 };
    }
    const solicitud = solicitudesGarantiaConEstado().find((s) => String(s.folio) === String(folio));
    if (!solicitud) return { error: "No encuentro una solicitud con ese folio.", status: 400 };
    if (solicitud.estado !== "pendiente") {
      return { error: "Esa solicitud ya está " + solicitud.estado + " — no se resuelve dos veces.", status: 400 };
    }

    // El AJUSTE aprobado se aplica en el acto con la sesión de quien aprueba.
    // Si el ajuste ya no procede (p. ej. el guardado cambió y una salida
    // excede lo disponible), NO se registra la resolución: la solicitud
    // sigue pendiente y quien aprueba ve el porqué exacto.
    let resultadoAjuste = null;
    if (decision === "aprobar" && solicitud.tipo === "ajuste") {
      resultadoAjuste = registrarAjusteManualGarantia({
        socio: solicitud.socio, producto: solicitud.producto,
        tipoGarantia: solicitud.tipoGarantia, direccion: solicitud.direccion,
        monto: solicitud.monto,
        motivo: (solicitud.motivo || "Ajuste solicitado") + " — solicitud " + solicitud.folio + " de "
          + (solicitud.solicitadoPor || "—") + ", aprobada por " + usuario.nombre + ".",
      }, usuario);
      if (resultadoAjuste.error) return resultadoAjuste;
    }

    const resolucion = store.agregarRegistro(REGISTRO_RESOLUCION_SOLICITUD, {
      folio: String(solicitud.folio), decision, nota: String(nota ?? "").trim() || null,
      fecha: hoyMX(), por: usuario.nombre, porId: usuario.id,
    });
    return {
      ok: true,
      solicitud: { ...solicitud, estado: decision === "aprobar" ? "aprobada" : "rechazada", resolucion },
      resultadoAjuste,
    };
  }

  return {
    registrarGarantiaLiquidaAlDesembolsar,
    garantiaLiquidaDisponible,
    garantiaADisponible,
    ultimaSalidaGarantiaLiquida,
    ultimaSalidaGarantiaA,
    ticketGarantiaLiquidaH14,
    resumenGarantias,
    estadoDeCuentaGarantia,
    reporteSemanalGarantias,
    reporteSalidaGarantiasPorClienta,
    corteDiarioGarantias,
    validarAportacionGarantiaEnReestructura,
    elegibilidadLiberacionGarantia,
    ticketLiberacionGarantia,
    alertaVencimientoGarantiaHipotecaria,
    alertasGarantiaHipotecariaPorVencer,
    alertasPlazoEntregaGarantia,
    registrarRegresoHojaLiberacion,
    alertasPlazoRegresoHojaLiberacion,
    registrarAjusteManualGarantia,
    validarSalidaAnticipadaGarantiaLiquida,
    movimientosDeGarantiaEntre,
    crearSolicitudGarantia,
    listarSolicitudesGarantia,
    resolverSolicitudGarantia,
  };
};
