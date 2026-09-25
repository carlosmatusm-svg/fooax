// DOMINIO: HOJA DE LIBERACIÓN DE GARANTÍAS POR CENTRO (formato "GARANTIA
// GRUPAL") + CATÁLOGO DE JEFAS DE CENTRO + REGRESO ESCANEADO Y VALIDACIÓN DE
// ALEJANDRA (CU-006, 25-sep-2026).
//
// ORIGEN (audio de Karina + mensaje de Anel, 25-sep-2026): "falta otro ticket
// con la jefa del centro... firma el cliente y el gerente, firma también la
// del centro. Para cada centro con su jefa de centro, nombre de la jefa de
// centro... regresar la hoja firmada, la van a regresar los ejecutivos
// escaneada desde su cel y Alejandra va a validar que sí esté". El formato
// real está en la hoja "HOJA DE LIBERACION DE GARANTIAS" del Excel de Karina
// (PLANILLA-GARANTIAS LUNES PRIMERA PARTE), bloque "GARANTIA GRUPAL": UNA hoja
// por centro y por fecha de entrega, un renglón por clienta con su "FIRMA DE
// RECIBIDO", y al pie "FIRMA DEL GERENTE DE SUCURSAL" y "JEFA DE CENTRO".
//
// Por qué es una hoja por CENTRO y no un ticket por clienta: el ticket
// individual (ticketLiberacionGarantia en garantia_liquida.js) ya existe y no
// cambia. Lo que faltaba es el documento grupal que junta todas las entregas
// de un centro en el mismo día, con UNA firma de la gerente y UNA de la jefa
// de centro al pie — así se firma en la reunión del centro.
//
// LA JEFA DE CENTRO ES UNA CLIENTA, NO UNA EMPLEADA: el sistema anterior la
// guardaba como `rol_en_grupo: "Jefa de Centro"` (respaldo rescatado
// rescate/respaldo-eshlider-2026-07-24-2339/grupo_clientes.json), pero ese
// dato no se migró al padrón actual. No se recupera de ese respaldo (es de
// jul-2026 y puede estar viejo): Karina va a mandar un Excel vigente con la
// jefa de cada centro y se carga aquí. Mientras un centro no tenga jefa
// cargada, la hoja se imprime con el renglón de firma vacío y un aviso — no se
// bloquea la entrega (doctrina de la casa: los candados duros van en el
// dinero, no en los documentos).
//
// EL ESCANEO: hoy el sistema NO guarda imágenes (no hay almacenamiento de
// archivos; store.registro vive completo en memoria). Guardar fotos de hojas
// firmadas —con datos personales y retención de 10 años— es una decisión de
// infraestructura y de cumplimiento que no se toma aquí. El regreso se
// registra con una `evidencia` obligatoria (dónde quedó el escaneo: "WhatsApp
// de Neri 25-sep 15:40", liga de Drive, etc.) y Alejandra valida contra esa
// evidencia. Queda como pendiente en PENDIENTES_POR_CONFIRMAR.md.
//
// TODO APPEND-ONLY (store.registro/agregarRegistro, igual que el resto de
// bitácoras de cumplimiento): el catálogo de jefas y los eventos de cada hoja
// (regreso / validada / rechazada) nunca se editan — el estado vigente se
// DERIVA de la última fila.
//
// Fábrica con dependencias inyectadas (mismo patrón que garantia_liquida.js);
// no conoce req/res.
"use strict";

module.exports = function crearDominioHojaLiberacionGrupal({
  store,
  norm,
  nprod,
  hoyMX,
  obtenerPadron,
  carteraViva,
  tipoDeMov,
  socioDeMov,
  productoDeMov,
  garantias,
  usuariosValidanHoja,
}) {
  const REGISTRO_JEFAS_CENTRO = "jefa_centro";
  const REGISTRO_HOJA_GRUPAL = "hoja_liberacion_grupal";
  const PATRON_SALIDA_GARANTIA = /^garant[íi]a (l[íi]quida|a) entregada$/i;
  const LARGO_MINIMO_TEXTO = 5;
  const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

  // ---------------------------------------------------------------------
  // CENTROS
  // ---------------------------------------------------------------------

  // Los créditos individuales viven en el "centro" C-0 del padrón. No tienen
  // jefa de centro (el formato "GARANTIA INDIVIDUAL" del Excel solo lleva
  // firma de la clienta y del ejecutivo).
  function esCentroIndividual(centro) {
    return ["c0", "individual"].includes(nprod(centro));
  }

  // Resuelve lo que escribe una persona ("C-59", "C-59 24 DE FEBRERO",
  // "24 de febrero") al nombre de centro canónico del padrón. Regresa null si
  // no existe — nunca se inventa un centro nuevo por un error de dedo.
  function resolverCentro(texto) {
    const limpio = String(texto ?? "").trim();
    if (!limpio) return null;
    const padron = obtenerPadron();
    const centros = [...new Set(padron.map((c) => c.centro).filter(Boolean))];

    const porNombre = centros.find((centro) => norm(centro) === norm(limpio));
    if (porNombre) return porNombre;

    const conNumero = limpio.match(/^c\s*-?\s*0*(\d+)\b\s*[-·.]?\s*(.*)$/i);
    if (conNumero) {
      const noCentro = "C-" + Number(conNumero[1]);
      const resto = conNumero[2].trim();
      if (resto) {
        const porResto = centros.find((centro) => norm(centro) === norm(resto));
        if (porResto) return porResto;
      }
      const porNoCentro = padron.find((c) => String(c.noCentro || "").toUpperCase() === noCentro);
      if (porNoCentro) return porNoCentro.centro;
    }
    return null;
  }

  function noCentroDe(centro) {
    return obtenerPadron().find((c) => c.centro === centro && c.noCentro)?.noCentro ?? null;
  }

  function creditoDeMovimiento(mov) {
    const socio = socioDeMov(mov);
    const producto = productoDeMov(mov) || mov.producto || "";
    return obtenerPadron().find((c) => String(c.id).split("|")[0] === socio
      && norm(c.producto) === norm(producto)) || null;
  }

  // ---------------------------------------------------------------------
  // CATÁLOGO DE JEFAS DE CENTRO
  // ---------------------------------------------------------------------

  // Jefa vigente por centro = la última fila cargada para ese centro.
  function jefasVigentes() {
    return store.registro(REGISTRO_JEFAS_CENTRO).reduce((vigentes, fila) => ({
      ...vigentes,
      [fila.centro]: { nombre: fila.nombre, desde: fila.fecha, registradoPor: fila.registradoPor ?? null },
    }), {});
  }

  function jefaDeCentro(centro) {
    return jefasVigentes()[centro] ?? null;
  }

  // Lista para la pantalla: TODOS los centros grupales del padrón, con su
  // jefa o vacío — así se ve de un vistazo cuáles faltan.
  function catalogoJefasDeCentro() {
    const vigentes = jefasVigentes();
    const centros = [...new Set(obtenerPadron().map((c) => c.centro).filter(Boolean))]
      .filter((centro) => !esCentroIndividual(centro))
      .sort((a, b) => a.localeCompare(b, "es"));
    const filas = centros.map((centro) => ({
      centro, noCentro: noCentroDe(centro), jefa: vigentes[centro] ?? null,
    }));
    return { centros: filas, sinJefa: filas.filter((fila) => !fila.jefa).length };
  }

  // Convierte lo que se pega desde Excel (dos columnas: centro y nombre,
  // separadas por tabulador, coma o punto y coma) en filas. Ignora un
  // encabezado si la primera línea dice "centro".
  function parsearFilasJefas(texto) {
    const lineas = String(texto ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const sinEncabezado = lineas.length && /centro/i.test(lineas[0]) && /jef|nombre/i.test(lineas[0])
      ? lineas.slice(1) : lineas;
    // Con 3 o más columnas (p. ej. "C-59 | 24 DE FEBRERO | NOMBRE") el nombre
    // es la ÚLTIMA columna y todo lo anterior describe el centro.
    return sinEncabezado.map((linea) => {
      const partes = linea.split(/\t|;/).length > 1
        ? linea.split(/\t|;/).map((p) => p.trim()).filter(Boolean)
        : linea.split(/,(?=[^,]*$)/).map((p) => p.trim()).filter(Boolean);
      return { centro: partes.slice(0, -1).join(" ").trim(), nombre: (partes.length > 1 ? partes.at(-1) : "").trim() };
    });
  }

  // Carga (una o muchas) jefas de centro. Una fila por cambio real: si el
  // centro ya tiene esa misma jefa, no se duplica. Los centros que no existen
  // en el padrón se regresan como rechazados (con su motivo), no se guardan.
  function cargarJefasDeCentro({ filas, texto }, usuario) {
    const entrada = Array.isArray(filas) ? filas : parsearFilasJefas(texto);
    if (entrada.length === 0) {
      return { error: "No hay filas para cargar. Pega dos columnas: centro y nombre de la jefa de centro.", status: 400 };
    }
    const vigentes = jefasVigentes();
    const resultado = { guardadas: [], sinCambio: [], rechazadas: [] };

    for (const { centro: centroTexto, nombre: nombreTexto } of entrada) {
      const nombre = String(nombreTexto ?? "").replace(/\s+/g, " ").trim();
      const centro = resolverCentro(centroTexto);
      if (!centro) {
        resultado.rechazadas.push({ centro: centroTexto, nombre, motivo: "No encuentro ese centro en el padrón." });
        continue;
      }
      if (esCentroIndividual(centro)) {
        resultado.rechazadas.push({ centro, nombre, motivo: "Los créditos individuales (C-0) no llevan jefa de centro." });
        continue;
      }
      if (nombre.length < 3) {
        resultado.rechazadas.push({ centro, nombre, motivo: "Falta el nombre de la jefa de centro." });
        continue;
      }
      if (norm(vigentes[centro]?.nombre ?? "") === norm(nombre)) {
        resultado.sinCambio.push({ centro, nombre });
        continue;
      }
      const fila = store.agregarRegistro(REGISTRO_JEFAS_CENTRO, {
        centro, noCentro: noCentroDe(centro), nombre: nombre.toUpperCase(), fecha: hoyMX(),
        registradoPor: usuario?.nombre ?? null, usuarioId: usuario?.id ?? null,
      });
      vigentes[centro] = { nombre: fila.nombre };
      resultado.guardadas.push({ centro, nombre: fila.nombre });
    }
    return { ok: true, ...resultado };
  }

  // ---------------------------------------------------------------------
  // HOJA DE LIBERACIÓN POR CENTRO
  // ---------------------------------------------------------------------

  function salidasDelDia(fecha) {
    return store.todosMovimientos().filter((mov) => !mov.anulado
      && String(mov.fecha || "") === fecha
      && PATRON_SALIDA_GARANTIA.test((tipoDeMov(mov) ?? "").trim()));
  }

  // Qué centros tuvieron entregas de garantía ese día (para elegir la hoja).
  function centrosConEntregasDelDia(fecha) {
    if (!FECHA_ISO.test(String(fecha || ""))) return { error: "La fecha no es válida.", status: 400 };
    const porCentro = salidasDelDia(fecha).reduce((acc, mov) => {
      const centro = creditoDeMovimiento(mov)?.centro ?? "—";
      const previo = acc[centro] ?? { centro, entregas: 0, total: 0 };
      return {
        ...acc,
        [centro]: { ...previo, entregas: previo.entregas + 1, total: Math.round((previo.total + (Number(mov.monto) || 0)) * 100) / 100 },
      };
    }, {});
    const centros = Object.values(porCentro)
      .map((fila) => ({ ...fila, individual: esCentroIndividual(fila.centro), estado: estadoDeHoja(folioDeHoja(fila.centro, fecha)).estado }))
      .sort((a, b) => a.centro.localeCompare(b.centro, "es"));
    return { fecha, centros };
  }

  function folioDeHoja(centro, fecha) {
    return "HLG-" + nprod(centro).toUpperCase() + "-" + String(fecha).replace(/-/g, "");
  }

  function eventosDeHoja(folioHoja) {
    return store.registro(REGISTRO_HOJA_GRUPAL).filter((fila) => fila.folioHoja === folioHoja);
  }

  // Estado derivado de la última fila de la bitácora de esa hoja.
  function estadoDeHoja(folioHoja) {
    const eventos = eventosDeHoja(folioHoja);
    const ultimo = eventos.at(-1) ?? null;
    const regreso = [...eventos].reverse().find((e) => e.evento === "regreso") ?? null;
    const descripcion = {
      null: "Pendiente de regresar firmada",
      regreso: "Regresó escaneada — falta que Alejandra la valide",
      validada: "Validada por Alejandra",
      rechazada: "Rechazada por Alejandra — debe regresar de nuevo",
    };
    return {
      estado: ultimo?.evento ?? "pendiente",
      descripcion: descripcion[ultimo?.evento ?? null],
      regreso: regreso ? { fecha: regreso.fechaRegreso, evidencia: regreso.evidencia, registradoPor: regreso.registradoPor } : null,
      validacion: ultimo && ultimo.evento !== "regreso"
        ? { resultado: ultimo.evento, nota: ultimo.nota ?? null, por: ultimo.registradoPor, fecha: ultimo.fecha }
        : null,
      eventos,
    };
  }

  function gerenteDelCentro(creditos, centro) {
    const deLasEntregas = [...new Set(creditos.map((c) => c?.ejecutivo).filter(Boolean))];
    const nombres = deLasEntregas.length
      ? deLasEntregas
      : [...new Set(obtenerPadron().filter((c) => c.centro === centro).map((c) => c.ejecutivo).filter(Boolean))];
    return nombres.join(" / ") || null;
  }

  function hojaLiberacionGrupal(usuario, centroTexto, fecha) {
    const centro = resolverCentro(centroTexto);
    if (!centro) return { error: "No encuentro ese centro en el padrón.", status: 400 };
    if (!FECHA_ISO.test(String(fecha || ""))) return { error: "La fecha de entrega no es válida.", status: 400 };

    const cv = carteraViva(usuario);
    const partidas = salidasDelDia(fecha)
      .map((mov) => ({ mov, credito: creditoDeMovimiento(mov) }))
      .filter(({ credito }) => credito?.centro === centro)
      .map(({ mov, credito }) => {
        const { observaciones, periodo, numeroDePagoCierre } = garantias.observacionesDeSalida(mov, cv);
        return {
          socio: socioDeMov(mov), nombre: credito.nombre, producto: credito.producto,
          tipoGarantia: garantias.tipoGarantiaNormalizado(mov.tipo || tipoDeMov(mov)),
          folio: mov.folio, monto: Math.round((Number(mov.monto) || 0) * 100) / 100,
          observaciones, periodo, numeroDePagoCierre, credito,
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.tipoGarantia.localeCompare(b.tipoGarantia));

    if (partidas.length === 0) {
      return { error: `No hay entregas de garantía registradas en ${centro} el ${fecha}.`, status: 400 };
    }

    const subtotales = partidas.reduce((acc, { tipoGarantia, monto }) => ({
      ...acc, [tipoGarantia]: Math.round(((acc[tipoGarantia] ?? 0) + monto) * 100) / 100,
    }), {});
    const total = Math.round(partidas.reduce((suma, p) => suma + p.monto, 0) * 100) / 100;
    const individual = esCentroIndividual(centro);
    const jefa = individual ? null : jefaDeCentro(centro);
    const folioHoja = folioDeHoja(centro, fecha);

    const avisos = [
      ...(!individual && !jefa ? [`Falta cargar la jefa de centro de ${centro}: la hoja sale con el renglón de firma vacío. Cárgala en "Jefas de centro".`] : []),
      ...(gerenteDelCentro(partidas.map((p) => p.credito), centro)?.includes("/")
        ? ["Las entregas de este centro son de más de un ejecutivo — firma la gerente que entregó."] : []),
    ];

    return {
      folioHoja, centro, noCentro: noCentroDe(centro), fechaEntrega: fecha, individual,
      partidas: partidas.map(({ credito, ...resto }, i) => ({ numero: i + 1, ...resto })),
      subtotales: Object.entries(subtotales).map(([tipoGarantia, monto]) => ({ tipoGarantia, monto })),
      total,
      firmas: {
        gerente: gerenteDelCentro(partidas.map((p) => p.credito), centro),
        jefaDeCentro: individual ? null : (jefa?.nombre ?? null),
        jefaNoAplica: individual,
      },
      notaSobreSellado: "Asegúrese de que su sobre de garantía venga SELLADO. Si nota que está manipulado, NO lo "
        + "reciba y comuníquese al " + garantias.responsablesGarantias.telefono + ".",
      custodia: garantias.responsablesGarantias.custodia,
      autoriza: garantias.responsablesGarantias.autoriza,
      estado: estadoDeHoja(folioHoja),
      avisos,
    };
  }

  // ---------------------------------------------------------------------
  // REGRESO ESCANEADO Y VALIDACIÓN DE ALEJANDRA
  // ---------------------------------------------------------------------

  function puedeValidarHoja(usuario) {
    return Boolean(usuario) && usuariosValidanHoja.includes(String(usuario.id || "").toLowerCase());
  }

  // El ejecutivo (o quien reciba el escaneo en oficina) registra que la hoja
  // firmada YA regresó. `evidencia` es obligatoria: dónde quedó el escaneo.
  function registrarRegresoHojaGrupal({ centro: centroTexto, fecha, evidencia, fechaRegreso }, usuario) {
    const hoja = hojaLiberacionGrupal(usuario, centroTexto, fecha);
    if (hoja.error) return hoja;
    const { estado } = hoja.estado;
    if (estado === "regreso") return { error: "Esta hoja ya se registró como regresada y está esperando la validación de Alejandra.", status: 400 };
    if (estado === "validada") return { error: "Esta hoja ya fue validada por Alejandra.", status: 400 };

    const textoEvidencia = String(evidencia ?? "").trim();
    if (textoEvidencia.length < LARGO_MINIMO_TEXTO) {
      return { error: "Anota dónde quedó el escaneo de la hoja firmada (por ejemplo: \"WhatsApp de Neri 25-sep 15:40\" o la liga de Drive).", status: 400 };
    }
    const hoy = hoyMX();
    const cuando = String(fechaRegreso || hoy).slice(0, 10);
    if (!FECHA_ISO.test(cuando)) return { error: "La fecha de regreso no es válida.", status: 400 };
    if (cuando > hoy) return { error: "La fecha de regreso no puede ser futura.", status: 400 };
    if (cuando < hoja.fechaEntrega) return { error: "La hoja no puede regresar antes de la fecha de entrega.", status: 400 };

    const fila = store.agregarRegistro(REGISTRO_HOJA_GRUPAL, {
      folioHoja: hoja.folioHoja, centro: hoja.centro, fechaEntrega: hoja.fechaEntrega,
      evento: "regreso", fechaRegreso: cuando, evidencia: textoEvidencia,
      folios: hoja.partidas.map((p) => p.folio), fecha: hoy,
      registradoPor: usuario?.nombre ?? null, usuarioId: usuario?.id ?? null,
    });
    return { ok: true, registro: fila, estado: estadoDeHoja(hoja.folioHoja) };
  }

  // Alejandra valida (o rechaza) la hoja contra el escaneo. Solo su cuenta
  // puede hacerlo (identidad de sesión, mismo criterio que el ajuste manual).
  // Al VALIDAR se marca también el regreso de cada folio incluido en la
  // bitácora de hoja de liberación que ya existe — así la alerta de 5 días
  // (alertasPlazoRegresoHojaLiberacion) se apaga sola para esas entregas.
  function validarHojaGrupal({ centro: centroTexto, fecha, resultado, nota }, usuario) {
    if (!puedeValidarHoja(usuario)) {
      return { error: "Solo Alejandra puede validar la hoja de liberación regresada — entra con su cuenta para hacerlo.", status: 403 };
    }
    if (resultado !== "validada" && resultado !== "rechazada") {
      return { error: "El resultado debe ser \"validada\" o \"rechazada\".", status: 400 };
    }
    const hoja = hojaLiberacionGrupal(usuario, centroTexto, fecha);
    if (hoja.error) return hoja;
    if (hoja.estado.estado !== "regreso") {
      return { error: "Primero se tiene que registrar el regreso de la hoja escaneada; después se valida.", status: 400 };
    }
    const textoNota = String(nota ?? "").trim();
    if (resultado === "rechazada" && textoNota.length < LARGO_MINIMO_TEXTO) {
      return { error: "Anota por qué se rechaza (por ejemplo: \"falta la firma de la jefa de centro\").", status: 400 };
    }

    const fila = store.agregarRegistro(REGISTRO_HOJA_GRUPAL, {
      folioHoja: hoja.folioHoja, centro: hoja.centro, fechaEntrega: hoja.fechaEntrega,
      evento: resultado, nota: textoNota || null, fecha: hoyMX(),
      registradoPor: usuario?.nombre ?? null, usuarioId: usuario?.id ?? null,
    });

    const foliosMarcados = resultado === "validada"
      ? hoja.partidas
        .filter(({ folio }) => !garantias.hojaLiberacionYaRegresada(folio))
        .map(({ folio }) => garantias.registrarRegresoHojaLiberacion({ folio, fecha: hoja.estado.regreso.fecha }, usuario))
        .filter((r) => r.ok)
        .map((r) => r.registro.folio)
      : [];

    return { ok: true, registro: fila, foliosMarcados, estado: estadoDeHoja(hoja.folioHoja) };
  }

  // Bandeja de Alejandra: hojas que regresaron y esperan su validación.
  function hojasPendientesDeValidar() {
    const ultimas = store.registro(REGISTRO_HOJA_GRUPAL).reduce((acc, fila) => ({ ...acc, [fila.folioHoja]: fila }), {});
    const regresos = store.registro(REGISTRO_HOJA_GRUPAL).filter((fila) => fila.evento === "regreso");
    const pendientes = Object.values(ultimas)
      .filter((fila) => fila.evento === "regreso")
      .map((fila) => {
        const regreso = [...regresos].reverse().find((r) => r.folioHoja === fila.folioHoja);
        return {
          folioHoja: fila.folioHoja, centro: fila.centro, fechaEntrega: fila.fechaEntrega,
          fechaRegreso: regreso?.fechaRegreso ?? null, evidencia: regreso?.evidencia ?? null,
          registradoPor: regreso?.registradoPor ?? null, folios: regreso?.folios ?? [],
        };
      })
      .sort((a, b) => String(a.fechaRegreso).localeCompare(String(b.fechaRegreso)));
    return { pendientes };
  }

  return {
    resolverCentro,
    catalogoJefasDeCentro,
    jefaDeCentro,
    parsearFilasJefas,
    cargarJefasDeCentro,
    centrosConEntregasDelDia,
    hojaLiberacionGrupal,
    registrarRegresoHojaGrupal,
    validarHojaGrupal,
    hojasPendientesDeValidar,
    puedeValidarHoja,
  };
};
