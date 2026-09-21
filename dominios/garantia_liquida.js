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
  function ultimaSalidaGarantiaLiquida(socio, producto) {
    const clave = claveCredito(socio, producto);
    let ultimo = null;
    for (const m of store.todosMovimientos()) {
      if (m.anulado || m.entrada) continue;
      const t = tipoDeMov(m) || "";
      if (!/^garant[íi]a l[íi]quida (entregada|aplicada)$/i.test(t.trim())) continue;
      if (socioDeMov(m) !== String(socio)) continue;
      const p = productoDeMov(m) || producto;
      if (claveCredito(socioDeMov(m), p) !== clave) continue;
      if (!ultimo || (m.ts || 0) > (ultimo.ts || 0)) ultimo = m;
    }
    return ultimo;
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
    { tema: "Bienes en garantía (hipotecaria)", motivo: "Sin modelo de datos de documento/vencimiento — Dirección aún no define el control documental (Regla 8.1).", responsable: "Dirección" },
    { tema: "Filtro 'solo por vencer' (2 semanas para entregar)", motivo: "Falta definir la consecuencia de exceder el plazo — PENDIENTES sección 3.", responsable: "Dirección" },
    { tema: "Ajuste de garantía por salida de una integrante del grupo", motivo: "No existe la regla de reparto entre las que quedan.", responsable: "Dirección" },
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

    const porDia = {}, porQuien = {}, porForma = {};
    let totalEntradas = 0, totalSalidas = 0;
    for (const mov of movs) {
      const monto = Number(mov.monto) || 0;
      const quien = mov.ejecutivo || mov.registradoPor || "—";
      const forma = mov.metodo === "retencion" ? "Retención automática" : (mov.metodo || "—");
      if (!porDia[mov.fecha]) porDia[mov.fecha] = { entradas: 0, salidas: 0 };
      if (!porQuien[quien]) porQuien[quien] = { entradas: 0, salidas: 0 };
      if (!porForma[forma]) porForma[forma] = { entradas: 0, salidas: 0 };
      const campo = mov.entrada ? "entradas" : "salidas";
      sumar(porDia[mov.fecha], campo, monto);
      sumar(porQuien[quien], campo, monto);
      sumar(porForma[forma], campo, monto);
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
        return {
          folio: mov.folio, fecha: mov.fecha, socio, nombre: (cred && cred.nombre) || null,
          centro: (cred && cred.centro) || "—", quien: mov.ejecutivo || mov.registradoPor || "—",
          monto: Number(mov.monto) || 0, tipo: mov.tipo || mov.concepto,
        };
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const porCentro = salidas.reduce((acc, s) => {
      acc[s.centro] = Math.round(((acc[s.centro] || 0) + s.monto) * 100) / 100;
      return acc;
    }, {});

    return {
      mes, periodo: { desde, hasta }, salidas,
      rollupPorCentro: Object.keys(porCentro).sort().map((centro) => ({ centro, total: porCentro[centro] })),
    };
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

  return {
    registrarGarantiaLiquidaAlDesembolsar,
    garantiaLiquidaDisponible,
    garantiaADisponible,
    ultimaSalidaGarantiaLiquida,
    ticketGarantiaLiquidaH14,
    resumenGarantias,
    estadoDeCuentaGarantia,
    reporteSemanalGarantias,
    reporteSalidaGarantiasPorClienta,
    validarAportacionGarantiaEnReestructura,
    elegibilidadLiberacionGarantia,
    ticketLiberacionGarantia,
  };
};
