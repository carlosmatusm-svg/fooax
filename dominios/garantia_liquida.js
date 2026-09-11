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
  function garantiaLiquidaDisponible(usuario, socio, producto) {
    const padron = obtenerPadron();
    const cred = padron.find((c) => String(c.id).split("|")[0] === String(socio)
      && norm(c.producto) === norm(producto) && c.activa !== false && c.estatus !== "BAJA");
    if (!cred) return { disponible: 0, credito: null };
    const info = infoCredito(carteraViva(usuario), cred);
    return { disponible: Math.max(0, Math.round((info.garantia || 0) * 100) / 100), credito: cred };
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

  // RESUMEN (página 7 del lienzo, "GA · Garantías"): pasivo total y
  // desglose por centro. Reutiliza el mismo cálculo por crédito que ya usa
  // /api/creditos (infoCredito) — no inventa una fórmula nueva de garantía.
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

    const pasivoTotal = Math.round(
      creditosConGarantia.reduce((acumulado, { garantia }) => acumulado + garantia, 0) * 100,
    ) / 100;

    const pasivoPorCentro = creditosConGarantia.reduce((acumulado, { credito, garantia }) => {
      const centro = credito.centro || "—";
      const totalPrevio = acumulado[centro] ?? 0;
      return { ...acumulado, [centro]: Math.round((totalPrevio + garantia) * 100) / 100 };
    }, {});

    return {
      pasivoTotal,
      sociasConGarantia: creditosConGarantia.length,
      porCentro: Object.keys(pasivoPorCentro)
        .sort()
        .map((centro) => ({ centro, monto: pasivoPorCentro[centro] })),
      socias: [...creditosConGarantia]
        .sort((a, b) => b.garantia - a.garantia)
        .slice(0, 200)
        .map(({ credito, garantia }) => ({
          id: credito.id, nombre: credito.nombre, centro: credito.centro, producto: credito.producto, garantia,
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
  function estadoDeCuentaGarantia(usuario, socioSolicitado, productoSolicitado) {
    const socio = String(socioSolicitado ?? "").replace(/[\s\-.]/g, "").trim();
    if (!socio) return { error: "Falta el número de socio.", status: 400 };

    const creditosDeLaSocia = obtenerPadron().filter(
      (credito) => String(credito.id).split("|")[0] === socio
        && credito.activa !== false && credito.estatus !== "BAJA",
    );
    if (creditosDeLaSocia.length === 0) {
      return { error: "No encuentro una clienta activa con ese número de socio.", status: 400 };
    }

    const productoBuscado = productoSolicitado?.trim();
    const creditoExacto = productoBuscado
      ? creditosDeLaSocia.find((credito) => norm(credito.producto) === norm(productoBuscado))
      : null;
    if (productoBuscado && !creditoExacto) {
      return { error: `Esa clienta no tiene un crédito "${productoBuscado}" activo.`, status: 400 };
    }
    const credito = creditoExacto ?? creditosDeLaSocia[0];
    const claveDelCredito = claveCredito(socio, credito.producto);

    const movimientosDelCredito = store.todosMovimientos()
      .filter((mov) => !mov.anulado
        && /^garant[íi]a l[íi]quida( entregada| aplicada)?$/i.test((tipoDeMov(mov) ?? "").trim()))
      .filter((mov) => socioDeMov(mov) === socio
        && claveCredito(socioDeMov(mov), productoDeMov(mov) ?? credito.producto) === claveDelCredito)
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

    const historial = movimientosDelCredito.reduce((filas, mov) => {
      const saldoAnterior = filas.at(-1)?.saldoDespues ?? 0;
      const saldoDespues = Math.round((saldoAnterior + (mov.entrada ? mov.monto : -mov.monto)) * 100) / 100;
      return [...filas, {
        fecha: mov.fecha, folio: mov.folio, tipo: mov.tipo ?? mov.concepto, monto: mov.monto,
        entrada: !!mov.entrada, saldoDespues,
        capturadoPor: mov.registradoPor ?? null, nota: mov.nota ?? null,
      }];
    }, []);

    const { disponible } = garantiaLiquidaDisponible(usuario, socio, credito.producto);

    return {
      socio, nombre: credito.nombre, centro: credito.centro, producto: credito.producto,
      saldoActual: disponible, creditosVivos: creditosDeLaSocia.length, historial,
      pendientes: PENDIENTES_FICHA_GARANTIA,
    };
  }

  return {
    registrarGarantiaLiquidaAlDesembolsar,
    garantiaLiquidaDisponible,
    ultimaSalidaGarantiaLiquida,
    ticketGarantiaLiquidaH14,
    resumenGarantias,
    estadoDeCuentaGarantia,
  };
};
