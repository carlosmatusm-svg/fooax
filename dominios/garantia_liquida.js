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

  return {
    registrarGarantiaLiquidaAlDesembolsar,
    garantiaLiquidaDisponible,
    ultimaSalidaGarantiaLiquida,
    ticketGarantiaLiquidaH14,
  };
};
