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
        var antes = c.saldo + "|" + c.esp + "|" + c.plazo + "|" + c.unidad + "|" + c.dia + "|" + c.mora;
        if (v.saldo >= 0) c.saldo = v.saldo;
        if (v.cuota > 0) c.esp = v.cuota;
        if (v.plazo > 0) c.plazo = v.plazo;
        if (v.unidad) c.unidad = v.unidad;
        if (v.dia) c.dia = v.dia;
        if (typeof v.mora === "number") c.mora = v.mora;
        if (v.importe > 0) { c.imp = v.importe; c.impOrig = v.importe; c.sug = Math.round(v.importe * 1.2); }
        if (antes !== (c.saldo + "|" + c.esp + "|" + c.plazo + "|" + c.unidad + "|" + c.dia + "|" + c.mora)) cambios++;
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

  function repintar() {
    if (typeof fillCentros === "function") try { fillCentros(); } catch (e) { }
    if (typeof render === "function") try { render(); } catch (e) { }
    if (typeof renderIndiv === "function") try { renderIndiv(); } catch (e) { }
    if (typeof renderRenov === "function") try { renderRenov(); } catch (e) { }
    if (typeof recalc === "function") try { recalc(); } catch (e) { }
  }

  // Aplica un paquete completo. Devuelve cuántas cosas cambiaron.
  function aplicar(d) {
    if (!d) return 0;
    var t = 0;
    try { t += quitar(d.quitar); } catch (e) { }
    try { t += altas(d.altas, d.centros); } catch (e) { }
    try { t += montos(d.vivos); } catch (e) { }
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
})();
