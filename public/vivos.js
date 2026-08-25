// ===================================================================
// DATOS VIVOS — el teléfono de la ejecutiva sigue al padrón del servidor.
//
// EL PROBLEMA (Karina, 7-ago-2026): «en dirección tienen bien los pagos, no se
// está ejecutando en las apps de los ejecutivos. Si Monse hace un cambio tiene
// que aparecer automáticamente en el del ejecutivo. Todo tiene que ir linkeado.»
//
// Y tenía razón: `sync.js` era de UNA SOLA VÍA. La app subía su captura y el
// servidor nunca le contestaba nada. Los montos que ve la ejecutiva nacían
// ESCRITOS dentro de su HTML, así que un ajuste de saldo, una liquidación
// capturada por Dirección, un alta o una baja se quedaban en el tablero y a
// ella no le llegaban jamás — había que regenerarle el archivo a mano.
//
// Ahora baja solo: al abrir, cada minuto, al recuperar señal y al volver a la
// pestaña. Sin recargar y sin que nadie tenga que acordarse.
//
// LO QUE NUNCA SE PISA: lo que la ejecutiva capturó en su teléfono. El saldo
// que manda el servidor viene *sin* descontar lo que ella misma capturó hoy
// (la app lo resta en pantalla con su captura local; si viniera ya descontado
// se restaría dos veces). Lo de DIRECCIÓN sí viene descontado — que se vea es
// justo el punto.
// ===================================================================
(function () {
  "use strict";
  var CADA = 60000;   // un minuto

  function n(s) {
    return String(s || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  }
  function esIndividual(centro, producto) {
    var c = n(centro);
    return !c || c === "c-0" || c === "0" || c === "individual" || /individual|foxi/.test(n(producto));
  }
  function listas() {
    var out = [];
    if (typeof CENTROS !== "undefined" && CENTROS)
      for (var k in CENTROS) if (CENTROS[k] && CENTROS[k].length) out.push(CENTROS[k]);
    if (typeof INDIVIDUALES !== "undefined" && INDIVIDUALES) out.push(INDIVIDUALES);
    return out;
  }

  // ---- 1. BAJAS: créditos que ya no son suyos o que llegaron a cero ----
  // Va PRIMERO, siempre. Al renovar con el mismo nombre, el crédito viejo (de
  // baja) y el nuevo comparten socio+producto: si se agregara antes de quitar,
  // el "quitar" borraría el NUEVO y la clienta desaparecería de su pantalla.
  function quitar(lista) {
    if (!lista || !lista.length) return 0;
    var fuera = 0;
    listas().forEach(function (arr) {
      for (var i = arr.length - 1; i >= 0; i--) {
        var c = arr[i];
        if (lista.some(function (q) { return String(c.f) === String(q.id) && n(c.sub) === n(q.producto); })) {
          arr.splice(i, 1); fuera++;
        }
      }
    });
    return fuera;
  }

  // ---- 2. ALTAS: clientas que Monse dio de alta en el tablero ----
  function altas(lista, nombresCentro) {
    if (!lista || !lista.length) return 0;
    if (typeof CENTROS === "undefined") return 0;
    var nuevas = 0;
    var porNombre = {};
    for (var k in CENTROS) porNombre[n(String(k).split("·").pop())] = k;
    lista.forEach(function (a) {
      var yaEsta = function (arr) {
        return (arr || []).some(function (c) {
          return String(c.f) === String(a.id) && n(c.sub) === n(a.producto);
        });
      };
      var cl = {
        n: a.nombre, f: String(a.id), sub: a.producto,
        k: a.id + "|" + a.producto + "|" + a.nombre + "|0",
        imp: a.saldo || 0, saldo: a.saldo || 0, esp: a.cuota || 0,
        impOrig: a.saldo || 0, mora: 0, sug: Math.round((a.saldo || 0) * 1.2),
        des: "", dia: "", _nueva: true,
      };
      if (esIndividual(a.centro, a.producto)) {
        if (typeof INDIVIDUALES === "undefined") return;
        if (!yaEsta(INDIVIDUALES)) { INDIVIDUALES.push(cl); nuevas++; }
      } else {
        var nm = n(a.centro), lv = porNombre[nm];
        if (!lv) { lv = (nombresCentro || {})[nm] || a.centro; CENTROS[lv] = CENTROS[lv] || []; porNombre[nm] = lv; }
        if (!yaEsta(CENTROS[lv])) { CENTROS[lv].push(cl); nuevas++; }
      }
    });
    return nuevas;
  }

  // ---- 3. MONTOS: saldo, cuota, plazo, unidad, día de pago e importe ----
  function montos(lista) {
    if (!lista || !lista.length) return 0;
    var ix = {};
    lista.forEach(function (v) { ix[String(v.id) + "|" + n(v.producto)] = v; });
    var cambios = 0, sembro = false;
    listas().forEach(function (arr) {
      arr.forEach(function (c) {
        var v = ix[String(c.f) + "|" + n(c.sub)];
        if (!v) return;
        var antes = c.saldo + "|" + c.esp + "|" + c.plazo + "|" + c.unidad + "|" + c.dia + "|" + c.mora + "|" + (c.etiqueta || "") + "|" + (c.des || "");
        if (v.saldo >= 0) c.saldo = v.saldo;
        if (v.cuota > 0) c.esp = v.cuota;
        if (v.plazo > 0) c.plazo = v.plazo;
        if (v.unidad) c.unidad = v.unidad;
        // La etiqueta puede venir vacía a propósito (se la quitaron), así que
        // se asigna siempre — con un `if (v.etiqueta)` nunca se podría borrar.
        c.etiqueta = v.etiqueta || "";
        if (v.dia) c.dia = v.dia;
        if (v.desembolso) c.des = v.desembolso;
        if (typeof v.mora === "number") c.mora = v.mora;
        if (v.importe > 0) { c.imp = v.importe; c.impOrig = v.importe; c.sug = Math.round(v.importe * 1.2); }
        if (antes !== (c.saldo + "|" + c.esp + "|" + c.plazo + "|" + c.unidad + "|" + c.dia + "|" + c.mora + "|" + (c.etiqueta || "") + "|" + (c.des || ""))) cambios++;
        // El plazo se siembra para que la app ya no se lo pregunte a mano.
        // NUNCA se pisa el que la ejecutiva haya escrito ella.
        if (typeof datosCli !== "undefined" && datosCli) {
          var key = c.k || c.f, d = datosCli[key] || (datosCli[key] = {});
          if (v.plazo > 0 && !d.plazo) { d.plazo = v.plazo; sembro = true; }
          if (v.unidad && d.unidad !== v.unidad) { d.unidad = v.unidad; sembro = true; }
        }
      });
    });
    if (sembro && typeof guardarDatosCli === "function") try { guardarDatosCli(); } catch (e) { }
    return cambios;
  }

  // REPINTAR SIN BORRARLE LA PANTALLA (Christopher, 12-ago: «cada 40 segundos
  // o un minuto se me reinicia y tengo que volver a poner todo»). El reinicio
  // de página se arregló aparte; esto era lo otro: cada vez que Dirección
  // registraba algo de una clienta suya, el repintado reconstruía el selector
  // de centros (se perdía el elegido) y tiraba lo que estaba a medio teclear.
  //
  // Tres reglas:
  //   1. Si está ESCRIBIENDO (un campo con foco), NO se repinta: se apunta y
  //      se repinta cuando suelte el campo o al siguiente minuto.
  //   2. El centro elegido SE CONSERVA: se guarda antes y se repone después.
  //   3. Nada de esto toca los datos — solo la pintada.
  var repintadoPendiente = false;
  function estaEscribiendo() {
    try {
      var el = document.activeElement;
      return !!(el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName || ""));
    } catch (e) { return false; }
  }
  function repintar() {
    if (estaEscribiendo()) { repintadoPendiente = true; return; }
    repintadoPendiente = false;
    var sel = null, centroElegido = null;
    try {
      sel = document.getElementById("selCentro");
      centroElegido = sel ? sel.value : null;
    } catch (e) { }
    if (typeof fillCentros === "function") try { fillCentros(); } catch (e) { }
    // Reponer el centro ANTES de render(): render lee el selector para saber
    // qué lista pintar. Sin esto, el repintado lo regresaba a "— Elige…".
    if (sel && centroElegido) try { sel.value = centroElegido; } catch (e) { }
    if (typeof render === "function") try { render(); } catch (e) { }
    if (typeof renderIndiv === "function") try { renderIndiv(); } catch (e) { }
    if (typeof renderRenov === "function") try { renderRenov(); } catch (e) { }
    if (typeof recalc === "function") try { recalc(); } catch (e) { }
  }
  // Cuando suelta el campo, si quedó una pintada pendiente, ahora sí.
  try {
    document.addEventListener("focusout", function () {
      if (repintadoPendiente) setTimeout(function () { if (!estaEscribiendo()) repintar(); }, 250);
    });
  } catch (e) { }

  // ---- 4. CORRECCIONES DE DIRECCIÓN sobre la captura de HOY ----
  // Si Monse le anula un pago o le quita una garantía, la ejecutiva tiene que
  // verlo en su pantalla. Si no, el tablero cuadra y su teléfono no, y al día
  // siguiente vuelve a capturar lo mismo.
  function correcciones(lista) {
    if (!lista || !lista.length) return 0;
    if (typeof reg === "undefined" && typeof regI === "undefined") return 0;
    var tocadas = 0;
    lista.forEach(function (c) {
      var nodo = null;
      if (c.centro && typeof reg !== "undefined" && reg[c.centro]) nodo = reg[c.centro];
      else if (typeof regI !== "undefined" && regI[c.clave]) nodo = regI;
      else if (typeof reg !== "undefined") {
        for (var k in reg) if (reg[k] && reg[k][c.clave]) { nodo = reg[k]; break; }
      }
      if (!nodo || !nodo[c.clave]) return;
      var r = nodo[c.clave];
      if ((r.pago || 0) === c.pago && (r.garantia || 0) === c.garantia
        && (r.solidario || 0) === c.solidario && !!r._dir === !!c.anulado) return;
      // UNA CORRECCIÓN SE APLICA UNA SOLA VEZ. Antes se re-imponía en cada
      // sondeo: si la ejecutiva volvía a capturarle a esa clienta DESPUÉS de la
      // corrección (la clienta pasó a pagar más tarde), el minuto siguiente se
      // lo pisaba en silencio — parte del «tengo que volver a poner todo» de
      // Christopher. La misma corrección (misma firma) ya no se re-aplica; una
      // corrección NUEVA de Dirección trae otra firma y sí entra.
      var firma = c.clave + "|" + c.pago + "|" + c.garantia + "|" + c.solidario + "|" + (c.anulado ? 1 : 0);
      try {
        if (window.sessionStorage && window.sessionStorage.getItem("fooax_corr_" + firma)) return;
        if (window.sessionStorage) window.sessionStorage.setItem("fooax_corr_" + firma, "1");
      } catch (e) { }
      r.pago = c.pago; r.garantia = c.garantia; r.solidario = c.solidario;
      r._dir = c.anulado ? "anulado" : "corregido";
      r._dirPor = c.por;
      if (c.anulado) r.forma = "";
      tocadas++;
    });
    // Se guarda para que no se pierda al recargar, pero NO se marca pendiente
    // de subir: la corrección ya vive en el servidor y volver a subirla sería
    // devolverle la pelota.
    if (tocadas && typeof guardar === "function") try { guardar(); } catch (e) { }
    return tocadas;
  }

  // ===================================================================
  // MI MORA — la ejecutiva la trae en la mano (Karina, 15-ago: «en las apps de
  // cada uno de los ejecutivos que le ponga cuánta mora llevan, con el nombre
  // de la clienta»).
  //
  // El número NO se calcula aquí: baja ya hecho del mismo reporte que ve
  // Dirección. Así el total que ella carga y el que Anel ve en el tablero son
  // el mismo, y cuando entra una recuperación baja en los dos a la vez.
  //
  // Se pinta en su propia tarjeta al principio de la pantalla de captura, y se
  // vuelve a dibujar sola en cada sondeo.
  function hesc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pesos(v) {
    var x = Math.round((Number(v) || 0) * 100) / 100;
    return "$" + x.toLocaleString("es-MX", { minimumFractionDigits: (x % 1) ? 2 : 0, maximumFractionDigits: 2 });
  }
  function cajaMora() {
    var box = document.getElementById("miMoraBox");
    if (box) return box;
    // Se cuelga arriba del primer contenedor de la app, sin depender de que el
    // HTML de cada ejecutiva traiga un hueco: así sirve para las cinco.
    var host = document.querySelector(".wrap:not(.hidden)") || document.querySelector(".wrap") || document.body;
    box = document.createElement("div");
    box.id = "miMoraBox";
    // DISCRETA (Karina, 15-ago: «no me gustó, está muy apantalloso; que
    // aparezca pero que no les bloquee la vista»). Un renglón delgado, no una
    // tarjeta: la ejecutiva abre la app para CAPTURAR, y el muro de mora le
    // empujaba su trabajo fuera de la pantalla. Se abre solo si ella la toca.
    box.style.cssText = "margin:8px 0 2px;font-size:13px";
    if (host.firstChild) host.insertBefore(box, host.firstChild); else host.appendChild(box);
    return box;
  }
  // Abierta o cerrada: se recuerda mientras dure la sesión, para no pelear con
  // la ejecutiva que ya decidió cómo la quiere.
  function moraAbierta() {
    try { return sessionStorage.getItem("fooax_mora_abierta") === "1"; } catch (e) { return false; }
  }
  window.__moraToggle = function () {
    try { sessionStorage.setItem("fooax_mora_abierta", moraAbierta() ? "0" : "1"); } catch (e) { }
    pintaMora();
  };
  // Qué está viendo: el lunes de la semana elegida, o "mes" para el acumulado.
  var moraVista = null;
  var moraDatos = null;

  function diaCorto(iso) {
    return String(iso || "").slice(8, 10) + "-" + String(iso || "").slice(5, 7);
  }

  function pintaMora() {
    var m = moraDatos;
    if (!m) return;
    var box = cajaMora();
    var semanas = m.semanas || [];
    var esMes = moraVista === "mes";
    var w = esMes ? null : (semanas.filter(function (x) { return x.lunes === moraVista; })[0]
      || semanas[semanas.length - 1] || m);
    var total = esMes ? (m.totalMes || 0) : (w ? w.total : 0);
    var cuantas = esMes ? (m.clientasMes || 0) : (w ? w.clientas : 0);
    var filas = esMes
      // En el mes se junta todo, la que más debe primero. Una clienta puede
      // salir en varias semanas: son cobranzas distintas y así se ve.
      ? semanas.reduce(function (a2, x) { return a2.concat((x.filas || []).map(function (f) {
          return Object.assign({}, f, { sem: x.lunes }); })); }, [])
          .sort(function (a2, b2) { return b2.falta - a2.falta; })
      : (w ? w.filas || [] : []);
    var porCentro = esMes
      ? (function () {
          var t = {};
          filas.forEach(function (f) { t[f.centro] = Math.round(((t[f.centro] || 0) + f.falta) * 100) / 100; });
          return Object.keys(t).sort(function (a2, b2) { return t[b2] - t[a2]; })
            .map(function (c) { return { centro: c, falta: t[c] }; });
        })()
      : (w ? w.porCentro || [] : []);

    // Los botones: cada semana del mes y el acumulado. El de hoy va marcado.
    var hoyL = semanas.length ? semanas[semanas.length - 1].lunes : m.lunes;
    var btns = semanas.map(function (x) {
      var sel = !esMes && x.lunes === (w ? w.lunes : "");
      var et = x.lunes === hoyL ? "Esta semana" : "Sem. " + diaCorto(x.lunes);
      return '<button type="button" onclick="window.__moraVer(\'' + x.lunes + '\')" '
        + 'style="border:1px solid ' + (sel ? "#B00020" : "rgba(0,0,0,.18)") + ";background:"
        + (sel ? "#FDECEC" : "transparent") + ";color:" + (sel ? "#B00020" : "inherit")
        + ';font:inherit;font-size:12px;font-weight:700;padding:5px 10px;border-radius:99px;'
        + 'margin:0 6px 6px 0;cursor:pointer">' + et
        + (x.total > 0 ? " · " + pesos(x.total) : " · 0") + "</button>";
    }).join("");
    var btnMes = '<button type="button" onclick="window.__moraVer(\'mes\')" '
      + 'style="border:1px solid ' + (esMes ? "#324AB6" : "rgba(0,0,0,.18)") + ";background:"
      + (esMes ? "#E5EAFB" : "transparent") + ";color:" + (esMes ? "#324AB6" : "inherit")
      + ';font:inherit;font-size:12px;font-weight:700;padding:5px 10px;border-radius:99px;'
      + 'margin:0 6px 6px 0;cursor:pointer">Todo el mes · ' + pesos(m.totalMes || 0) + "</button>";

    // EL RENGLÓN: siempre visible, chiquito, sin robar pantalla. Dice el
    // número —que es lo que ella necesita traer en la cabeza— y se abre si lo
    // toca. Cerrada ocupa una línea; abierta enseña el detalle completo.
    var abierta = moraAbierta();
    // VENCIDAS POR PLAZO CUMPLIDO (25-ago): terminaron su calendario y siguen
    // debiendo. Van fuera de la mora semanal (regla Monse: recuperación), pero
    // la app las MARCA — era la observación de la cartera de Neri. Es un dato
    // de HOY, así que se usa la lista vigente venga la vista que venga.
    var vencs = m.vencidas || [];
    var color = total > 0 || vencs.length ? "#B00020" : "#0B7247";
    var etiqueta = esMes ? "en el mes" : (w && w.lunes === hoyL ? "esta semana" : "esa semana");
    var renglon =
      '<div role="button" onclick="window.__moraToggle()" '
      + 'style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:7px 10px;'
      + "border:1px solid rgba(0,0,0,.12);border-radius:9px;background:"
      + (total > 0 ? "rgba(176,0,32,.05)" : "rgba(11,114,71,.05)") + '">'
      + '<span style="font-weight:800;color:' + color + '">Mi mora</span>'
      + '<span style="font-weight:800;color:' + color + '">' + pesos(total) + "</span>"
      + '<span style="opacity:.65;font-size:11.5px">'
      + (total > 0 ? cuantas + (cuantas === 1 ? " clienta " : " clientas ") + etiqueta : "al corriente")
      + "</span>"
      + (vencs.length ? '<span style="font-weight:800;color:#B00020;font-size:11.5px">· '
          + vencs.length + (vencs.length === 1 ? " vencida" : " vencidas") + "</span>" : "")
      + '<span style="margin-left:auto;opacity:.5;font-size:11px">' + (abierta ? "ocultar" : "ver") + "</span>"
      + "</div>";

    if (!abierta) { box.innerHTML = renglon; return; }

    var top = filas.slice(0, 15);
    box.innerHTML = renglon
      + '<div style="border:1px solid rgba(0,0,0,.12);border-top:0;border-radius:0 0 9px 9px;'
      + 'padding:8px 10px;margin-top:-3px">'
      + '<div style="margin-bottom:4px">' + btns + btnMes + "</div>"
      + (porCentro.length ? '<div style="opacity:.7;font-size:11.5px;margin-bottom:2px">'
          + porCentro.map(function (c) { return "<b>" + hesc(c.centro) + "</b> " + pesos(c.falta); })
              .join(" &nbsp;·&nbsp; ") + "</div>" : "")
      + top.map(function (x) {
          return '<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;'
            + 'border-top:1px solid rgba(0,0,0,.07);font-size:12.5px">'
            + "<span><b>" + hesc(x.clienta) + "</b><br>"
            + '<span style="opacity:.65;font-size:11px">' + hesc(x.centro) + " · " + hesc(x.dia)
            + (esMes && x.sem ? " · sem. " + diaCorto(x.sem) : "") + "</span></span>"
            + '<span style="text-align:right;white-space:nowrap">'
            + '<b style="color:#B00020">' + pesos(x.falta) + "</b><br>"
            + '<span style="opacity:.65;font-size:11px">'
            + (x.pagado > 0 ? "abonó " + pesos(x.pagado) : "cuota " + pesos(x.cuota))
            + "</span></span></div>";
        }).join("")
      + (filas.length > top.length
          ? '<div style="opacity:.65;font-size:11.5px;margin-top:5px">y ' + (filas.length - top.length)
            + " más — arriba van las que más deben.</div>" : "")
      + (vencs.length
          ? '<div style="margin-top:7px;padding-top:6px;border-top:2px solid rgba(176,0,32,.25)">'
            + '<div style="font-weight:800;color:#B00020;font-size:12px">VENCIDAS — terminó su plazo y siguen debiendo (recuperación)</div>'
            + vencs.map(function (x) {
                return '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:12.5px">'
                  + "<span><b>" + hesc(x.clienta) + "</b><br>"
                  + '<span style="opacity:.65;font-size:11px">' + hesc(x.centro || "") + " · " + hesc(x.producto || "")
                  + " · terminó " + diaCorto(x.fin) + "</span></span>"
                  + '<b style="color:#B00020;white-space:nowrap">' + pesos(x.saldo) + "</b></div>";
              }).join("")
            + "</div>" : "")
      + "</div>";
  }

  // Cambiar de semana NO vuelve a pedir nada al servidor: ya viene todo el mes
  // en el paquete, así que funciona sin señal, en plena calle.
  window.__moraVer = function (v) { moraVista = v; pintaMora(); };

  function mora(m) {
    if (!m || typeof m.total !== "number") return 0;
    var firma = JSON.stringify([m.total, m.clientas, m.totalMes, (m.semanas || []).length,
      (m.filas || []).length, (m.vencidas || []).length]);
    var box = cajaMora();
    if (box.getAttribute("data-firma") === firma) return 0;
    box.setAttribute("data-firma", firma);
    moraDatos = m;
    // Al llegar datos nuevos se respeta lo que la ejecutiva está viendo; si es
    // la primera vez, abre en su semana.
    if (!moraVista || (moraVista !== "mes"
        && !(m.semanas || []).some(function (x) { return x.lunes === moraVista; }))) {
      moraVista = m.lunes;
    }
    pintaMora();
    return 1;
  }
  window.__pintarMora = mora;

  // Aplica un paquete completo. Devuelve cuántas cosas cambiaron.
  function aplicar(d) {
    if (!d) return 0;
    // La fecha del servidor SIEMPRE se toma, venga lo que venga: es la única
    // referencia del vigilante del día y del resto de la app.
    if (d.hoy) window.__hoyServidor = d.hoy;
    var t = 0;
    try { t += quitar(d.quitar); } catch (e) { }
    try { t += altas(d.altas, d.centros); } catch (e) { }
    try { t += montos(d.vivos); } catch (e) { }
    try { t += correcciones(d.correcciones); } catch (e) { }
    try { t += mora(d.mora); } catch (e) { }
    return t;
  }
  window.__aplicarVivos = aplicar;

  // Primer paquete: viaja dentro del HTML, así que al abrir ya está al día
  // aunque no haya señal para el primer sondeo.
  try { if (window.__VIVOS0) { aplicar(window.__VIVOS0); repintar(); } } catch (e) { }

  // ---- el sondeo ----
  // Solo repinta si de verdad cambió algo: repintar por repintar le movería la
  // pantalla mientras captura.
  var corriendo = false;
  async function bajar() {
    if (corriendo || !navigator.onLine) return;
    corriendo = true;
    try {
      var r = await fetch("/api/vivos", { credentials: "include", cache: "no-store" });
      if (r.ok) {
        var d = await r.json();
        if (aplicar(d) > 0) repintar();
      }
    } catch (e) { /* sin señal: se reintenta al rato */ }
    corriendo = false;
  }
  window.__bajarVivos = bajar;

  setInterval(bajar, CADA);
  window.addEventListener("online", bajar);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) bajar(); });
  setTimeout(bajar, 4000);

  // ---- 5. EL DÍA QUE SE QUEDÓ ABIERTO ----
  // (12-ago) Los pagos de GUIE XHUUBA —clienta de LUNES— aparecieron fechados
  // miércoles: la app es una PWA que puede quedarse abierta días enteros, y la
  // fecha solo se fijaba AL ABRIR. Todo lo capturado después de medianoche caía
  // en el día viejo, y la mora de la semana no lo veía.
  //
  // Vigilancia cada minuto: si el día en pantalla ya no es hoy, se recarga. Al
  // recargar, la propia app aplica su regla del día anterior (si hay captura
  // sin enviar, BLOQUEA hasta mandar el arqueo de ese día) y lo nuevo queda
  // con la fecha correcta. Lo capturado no se pierde: vive en localStorage.
  // SOLO CONTRA EL SERVIDOR. La primera versión comparaba contra el reloj del
  // teléfono: si ese reloj andaba en otro día (pasa, y por eso la app usa la
  // fecha del servidor como oficial), la pantalla y el reloj nunca empataban y
  // esto recargaba la app CADA MINUTO — Christopher perdía lo que iba
  // tecleando una y otra vez (12-ago). Sin fecha del servidor, no se vigila.
  function hayCaptura() {
    try {
      return !!((typeof reg !== "undefined" && Object.keys(reg || {}).length)
        || (typeof regI !== "undefined" && Object.keys(regI || {}).length)
        || (typeof movs !== "undefined" && (movs || []).length)
        || (typeof arqueo !== "undefined" && Object.keys(arqueo || {}).length));
    } catch (e) { return true; }   // ante la duda, tratar como que sí hay
  }
  function vigilaDia() {
    try {
      var inp = document.getElementById("inpFecha");
      if (!inp || !inp.value) return;
      var hoySrv = window.__hoyServidor;
      if (!hoySrv || inp.value === hoySrv) return;
      // Fecha vieja SANCIONADA: la app está a propósito en el bloqueo del día
      // anterior (esperando su arqueo). Recargar aquí sería un ciclo infinito.
      try {
        if (window.sessionStorage && window.sessionStorage.getItem("fooax_fecha_ok") === inp.value) return;
      } catch (e) { }
      // UNA sola recarga por fecha: es la que resuelve el cambio de día real
      // (al recargar, la app bloquea el día viejo si traía captura). Si al
      // volver la fecha sigue sin empatar, recargar otra vez no va a arreglar
      // nada — sería el ciclo de Christopher.
      var marca = "fooax_vigilo_" + inp.value;
      var ya = null;
      try { ya = window.sessionStorage && window.sessionStorage.getItem(marca); } catch (e) { }
      if (!ya) {
        try { window.sessionStorage && window.sessionStorage.setItem(marca, "1"); } catch (e) { }
        window.location.reload();
        return;
      }
      // Segunda vez: el reloj del teléfono está mal, no el día. Si NO hay
      // captura, se corrige la fecha en silencio y a seguir. Si SÍ hay, no se
      // toca nada (moverla re-fecharía lo capturado): el banner de "captura de
      // un día anterior" ya lo está avisando.
      if (!hayCaptura()) {
        inp.value = hoySrv;
        if (typeof updFecha === "function") try { updFecha(); } catch (e) { }
      }
    } catch (e) { }
  }
  window.__vigilaDia = vigilaDia;
  setInterval(vigilaDia, CADA);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) vigilaDia(); });
})();
