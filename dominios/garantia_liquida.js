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
  hoyMX,
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
    { tema: "Exportar PDF (para la socia) / Excel (para conciliar)", motivo: "No hay generación de documentos para esta ficha todavía.", responsable: "Carlos / Karina" },
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
    registrarRegresoHojaLiberacion,
    alertasPlazoRegresoHojaLiberacion,
  };
};
