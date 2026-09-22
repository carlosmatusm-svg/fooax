// FOOAX · ALTA Y CAPTURA DE CLIENTA EN CAMPO, SIN CONEXIÓN (CU-009).
// Capa que se inyecta sobre la app de cada ejecutivo (igual que
// captura-agil.js): no toca el HTML original. Agrega el botón "Alta de clienta
// (expediente)" y un formulario completo con los datos de la Solicitud de
// Crédito FOOAX 2026 (identidad, domicilio con GPS, negocio, capacidad de pago,
// vivienda, familia, responsable/aval, 2 referencias, PLD/PEP, Firma 1).
//
// SIN SEÑAL: la captura se guarda en el teléfono (localStorage
// `fooax_capturas_pend`) con un folio único y se manda a
// POST /api/expediente/captura en cuanto hay red (evento online + cada 60 s).
// El folio hace que reintentar NUNCA duplique. Al confirmarse, la captura sale
// del teléfono: el expediente vive en el servidor, no en el celular.
//
// LO QUE NO HACE: no sube fotos (solo marca qué documentos se fotografiaron;
// el cifrado/retención de imágenes está pendiente, CU-009 §10.2) y no da de
// alta en el padrón de cobranza — la clienta nace "en captura", no autorizada.
(function () {
  "use strict";
  if (window.__altaCampoCargada) return;
  window.__altaCampoCargada = true;
  const PEND_KEY = "fooax_capturas_pend";
  let CAT = null;

  const $ = (id) => document.getElementById(id);
  const hesc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const leerPend = () => { try { return JSON.parse(localStorage.getItem(PEND_KEY) || "[]"); } catch (e) { return []; } };
  const guardarPend = (l) => { try { localStorage.setItem(PEND_KEY, JSON.stringify(l)); } catch (e) {} };
  const folioNuevo = () => "CAP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();

  // ---------- envío con reintento ----------
  async function subirPendientes() {
    const lista = leerPend();
    if (!lista.length) { pintarEstado(); return; }
    for (const cap of lista) {
      if (cap.enviada) continue;
      try {
        const r = await fetch("/api/expediente/captura", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cap.datos) });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) { cap.enviada = true; cap.socio = d.socio; cap.resultado = "Expediente " + d.socio + (d.socioGenerado ? " (número asignado por el sistema)" : ""); }
        else if (r.status === 400) { cap.error = (d.errores || [d.error]).join(" · "); }   // rechazo de validación: no reintentar a ciegas, mostrar
        else if (r.status === 401) { cap.error = "Sesión vencida: vuelve a iniciar sesión; la captura sigue guardada en el teléfono."; }
      } catch (e) { /* sin señal: se queda pendiente */ }
    }
    // Las enviadas se conservan 1 día para que la ejecutiva vea el número asignado; luego se limpian.
    guardarPend(lista.filter((c) => !c.enviada || Date.now() - (c.ts || 0) < 86400000));
    pintarEstado();
  }
  window.addEventListener("online", subirPendientes);
  setInterval(subirPendientes, 60000);

  // ---------- UI ----------
  function pintarEstado() {
    const el = $("acEstado"); if (!el) return;
    const l = leerPend(), pend = l.filter((c) => !c.enviada && !c.error), err = l.filter((c) => c.error && !c.enviada), ok = l.filter((c) => c.enviada);
    el.innerHTML = (pend.length ? "<div class='ac-pend'>⏳ " + pend.length + " captura(s) guardada(s) en el teléfono, esperando señal.</div>" : "")
      + err.map((c) => "<div class='ac-err'>❌ " + hesc(c.resumen) + ": " + hesc(c.error) + " <button data-f='" + hesc(c.folio) + "' class='ac-reint'>Corregir</button></div>").join("")
      + ok.map((c) => "<div class='ac-ok'>✅ " + hesc(c.resumen) + " → " + hesc(c.resultado) + "</div>").join("");
    el.querySelectorAll(".ac-reint").forEach((b) => b.addEventListener("click", () => {
      const cap = leerPend().find((c) => c.folio === b.dataset.f); if (!cap) return;
      guardarPend(leerPend().filter((c) => c.folio !== b.dataset.f));
      abrirForm(cap.datos);
    }));
  }

  const css = "<style>#acPanel{position:fixed;inset:0;background:#f5f6f8;z-index:9999;overflow:auto;padding:12px;font-family:system-ui,sans-serif;font-size:15px}"
    + "#acPanel h2{margin:4px 0 10px;font-size:18px}#acPanel h3{margin:14px 0 6px;font-size:15px;color:#1a4d8f;border-bottom:1px solid #d5dbe5}"
    + "#acPanel label{display:block;margin:6px 0 2px;font-size:13px;color:#333}#acPanel input,#acPanel select{width:100%;padding:8px;border:1px solid #bbb;border-radius:6px;font-size:15px;box-sizing:border-box}"
    + ".ac-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ac-chk{display:flex;gap:8px;align-items:flex-start;margin:8px 0}.ac-chk input{width:auto;margin-top:3px}"
    + ".ac-btn{padding:12px 16px;border:0;border-radius:8px;font-size:16px;font-weight:600;margin:4px 4px 4px 0}.ac-pri{background:#1a4d8f;color:#fff}.ac-sec{background:#ddd}"
    + ".ac-pend{background:#fff4d6;padding:8px;border-radius:6px;margin:6px 0}.ac-err{background:#ffe0e0;padding:8px;border-radius:6px;margin:6px 0}.ac-ok{background:#e0f5e6;padding:8px;border-radius:6px;margin:6px 0}"
    + ".ac-errs{background:#ffe0e0;padding:10px;border-radius:6px;margin:8px 0;white-space:pre-wrap}#acAbrir{width:100%;margin:8px 0}</style>";

  const sel = (id, lista, actual) => "<select id='" + id + "'><option value=''>Selecciona…</option>" + lista.map((o) => "<option" + (actual === o ? " selected" : "") + ">" + hesc(o) + "</option>").join("") + "</select>";
  const inp = (id, label, v, type, extra) => "<label for='" + id + "'>" + hesc(label) + "</label><input id='" + id + "' type='" + (type || "text") + "' value='" + hesc(v == null ? "" : v) + "' " + (extra || "") + ">";
  const persona = (p, d) => "<div class='ac-row'>" + inp(p + "Nombre", "Nombre completo", d.nombre) + inp(p + "Curp", "CURP", d.curp) + inp(p + "Tel", "Teléfono", d.telefono, "tel")
    + inp(p + "Ocup", "Ocupación", d.ocupacion) + inp(p + "Ident", "Identificación (tipo y folio)", d.identificacion) + inp(p + "Dom", "Domicilio", d.domicilio) + "</div>"
    + "<div class='ac-chk'><input type='checkbox' id='" + p + "Cons'" + (d.consentimiento ? " checked" : "") + "><label for='" + p + "Cons'>Da su consentimiento para el tratamiento de sus datos (es una persona distinta de la clienta).</label></div>";

  function centrosDeLaApp() {
    try {
      const out = [];
      if (typeof CENTROS === "object") for (const k in CENTROS) out.push(k);
      const s = $("altaCentro"); if (s) for (const o of s.options) if (o.value && !out.includes(o.value)) out.push(o.value);
      return out;
    } catch (e) { return []; }
  }

  function abrirForm(prev) {
    prev = prev || {}; const d = prev.datos || {}, dom = d.domicilio || {}, neg = d.negocio || {}, cp = d.capacidadPago || {}, viv = d.vivienda || {}, fam = d.familia || {}, otros = d.creditosOtros || {};
    const pld = prev.pld || {}, pep = pld.pep || {}, refs = prev.referencias || [{}, {}], resp = prev.responsable || {}, aval = prev.aval || {};
    const cat = CAT || { estadosCiviles: [], generos: [], identificaciones: [], actividadesEconomicas: [], origenesRecursos: [], pepTipos: [], pepParentescos: [], relacionesReferencia: [], tiposDocumento: [], montoRequiereAval: 10000 };
    const panel = document.createElement("div"); panel.id = "acPanel";
    panel.innerHTML = css + "<h2>Alta de clienta · expediente (CU-009)</h2><div id='acErrs'></div>"
      + "<h3>1 · Identidad</h3><div class='ac-row'>" + inp("acApP", "Apellido paterno", d.apellidoPaterno) + inp("acApM", "Apellido materno", d.apellidoMaterno) + inp("acNom", "Nombre(s)", d.nombres)
      + inp("acCurp", "CURP (18)", d.curp, "text", "maxlength=18 style='text-transform:uppercase'") + inp("acRfc", "RFC", d.rfc, "text", "style='text-transform:uppercase'") + inp("acFN", "Fecha de nacimiento", d.fechaNacimiento, "date")
      + inp("acLN", "Lugar de nacimiento", d.lugarNacimiento) + inp("acNac", "Nacionalidad", d.nacionalidad || "Mexicana") + "<div><label>Estado civil</label>" + sel("acEC", cat.estadosCiviles, d.estadoCivil) + "</div><div><label>Género</label>" + sel("acGen", cat.generos, d.genero) + "</div>"
      + inp("acTelM", "Teléfono móvil", d.telefonoMovil, "tel") + inp("acTelF", "Teléfono fijo (opcional)", d.telefonoFijo, "tel") + inp("acMail", "Correo (opcional)", d.correo, "email")
      + "<div><label>Identificación oficial</label>" + sel("acIdT", cat.identificaciones, d.identificacion && d.identificacion.tipo) + "</div>" + inp("acIdF", "Folio de la identificación", d.identificacion && d.identificacion.folio) + "</div>"
      + "<h3>2 · Domicilio (con GPS)</h3><div class='ac-row'>" + inp("acCalle", "Calle", dom.calle) + inp("acNum", "Número", dom.numero) + inp("acCol", "Colonia", dom.colonia) + inp("acCP", "C.P.", dom.cp, "text", "maxlength=5") + inp("acMun", "Municipio", dom.municipio) + inp("acCd", "Ciudad", dom.ciudad) + inp("acEdo", "Estado", dom.estado || "Oaxaca") + inp("acRes", "Tiempo de residencia (meses)", dom.tiempoResidenciaMeses, "number") + "</div>"
      + "<div class='ac-row'>" + inp("acLat", "GPS latitud", d.gps && d.gps.lat, "text", "readonly") + inp("acLng", "GPS longitud", d.gps && d.gps.lng, "text", "readonly") + "</div><button class='ac-btn ac-sec' id='acGps'>📍 Tomar GPS del domicilio</button><small> Croquis y 4 fotos del domicilio: se marcan abajo en documentos (las imágenes aún no se suben).</small>"
      + "<h3>3 · Negocio y capacidad de pago</h3><div class='ac-row'>" + inp("acGiro", "Giro del negocio", neg.giro) + inp("acAnt", "Antigüedad (meses)", neg.antiguedadMeses, "number") + inp("acIng", "Ingreso declarado ($)", neg.ingresoDeclarado, "number")
      + "<div><label>Actividad económica (catálogo PLD)</label>" + sel("acAct", cat.actividadesEconomicas, d.actividadEconomica) + "</div>" + inp("acIS", "Ingreso semanal ($)", cp.ingresoSemanal, "number") + inp("acGN", "Gastos del negocio ($)", cp.gastosNegocio, "number") + inp("acGH", "Gastos del hogar ($)", cp.gastosHogar, "number") + inp("acMB", "Mes de ingreso más bajo", cp.mesIngresoMasBajo) + inp("acCap", "Capacidad de pago semanal ($)", cp.capacidadPago, "number") + "</div>"
      + "<div class='ac-chk'><input type='checkbox' id='acOtros'" + (otros.tiene ? " checked" : "") + "><label for='acOtros'>Tiene créditos vigentes con otras instituciones o prestamistas</label></div><div class='ac-row' id='acOtrosBox'>" + inp("acOInst", "Institución", otros.institucion) + inp("acOMonto", "Monto ($)", otros.monto, "number") + inp("acODeuda", "Deuda actual ($)", otros.deudaActual, "number") + inp("acOPago", "Pago semanal ($)", otros.pagoSemanal, "number") + "</div>"
      + "<h3>4 · Vivienda y familia</h3><div class='ac-row'>" + inp("acVT", "Tipo de vivienda (propia/rentada/prestada)", viv.tipo) + inp("acVS", "Superficie (m²)", viv.superficie, "number") + inp("acVN", "Niveles", viv.niveles, "number") + inp("acVH", "Habitaciones", viv.habitaciones, "number") + inp("acVP", "Material de paredes", viv.paredes) + inp("acVPi", "Material de piso", viv.piso) + inp("acVTe", "Material de techo", viv.techo)
      + inp("acFD", "Dependientes económicos", fam.dependientes, "number") + inp("acFH", "Hijos menores", fam.hijosMenores, "number") + inp("acFO", "¿Alguien más aporta ingreso? (quién)", fam.otroIngreso) + inp("acFT", "Ingreso total del hogar ($)", fam.ingresoTotalHogar, "number") + "</div>"
      + "<h3>5 · Crédito, responsable y aval</h3><div class='ac-row'><div><label>Tipo de crédito</label>" + sel("acTipo", ["grupal", "individual"], prev.tipoCredito) + "</div>" + inp("acImp", "Importe solicitado ($)", prev.importeSolicitado, "number") + "<div><label>Centro (C-#)</label>" + sel("acCentro", centrosDeLaApp(), prev.centro) + "</div>" + inp("acSocio", "No. de socio (vacío = lo asigna el sistema)", prev.socio) + "</div>"
      + "<h3>Responsable / solidaria (obligatoria en crédito grupal)</h3>" + persona("acR", resp) + "<h3>Aval (obligatorio si el crédito es mayor a $" + cat.montoRequiereAval + ")</h3>" + persona("acA", aval)
      + "<h3>6 · Referencias personales (2)</h3>" + [0, 1].map((i) => { const r = refs[i] || {}; return "<div class='ac-row'>" + inp("acRef" + i + "N", "Referencia " + (i + 1) + " · nombre", r.nombre) + "<div><label>Relación con la solicitante</label>" + sel("acRef" + i + "R", cat.relacionesReferencia, r.relacion) + "</div>" + inp("acRef" + i + "T", "Teléfono", r.telefono, "tel") + inp("acRef" + i + "C", "CURP (opcional)", r.curp) + "</div><div class='ac-chk'><input type='checkbox' id='acRef" + i + "Cons'" + (r.consentimiento ? " checked" : "") + "><label for='acRef" + i + "Cons'>La referencia da su consentimiento (es un tercero).</label></div>"; }).join("")
      + "<h3>7 · PLD / FT</h3><div><label>Origen de los recursos con los que pagará</label>" + sel("acOrig", cat.origenesRecursos, pld.origenRecursos) + "</div>"
      + "<div><label>¿La clienta o un familiar cercano es Persona Políticamente Expuesta (PEP)?</label>" + sel("acPep", ["No", "Sí"], pep.es === true ? "Sí" : (pep.es === false ? "No" : undefined)) + "</div>"
      + "<div class='ac-row' id='acPepBox'><div><label>Tipo de PEP</label>" + sel("acPepT", cat.pepTipos, pep.tipo) + "</div><div><label>Parentesco con la clienta</label>" + sel("acPepP", cat.pepParentescos, pep.parentesco) + "</div>" + inp("acPepC", "Cargo", pep.cargo) + inp("acPepD", "Dependencia", pep.dependencia) + inp("acPepPer", "Periodo", pep.periodo) + "</div>"
      + "<h3>8 · Documentos fotografiados (checklist)</h3>" + [["solicitante", "ine", "INE de la clienta"], ["solicitante", "comprobante_domicilio", "Comprobante de domicilio"], ["solicitante", "curp", "CURP"], ["solicitante", "foto_negocio", "Foto del negocio"], ["responsable", "ine", "INE de la responsable"], ["responsable", "comprobante_domicilio", "Comprobante de la responsable"], ["aval", "ine", "INE del aval"], ["aval", "comprobante_domicilio", "Comprobante del aval"]]
        .map((x) => "<div class='ac-chk'><input type='checkbox' class='acDoc' data-p='" + x[0] + "' data-t='" + x[1] + "'><label>" + x[2] + "</label></div>").join("")
      + "<div class='ac-row'>" + inp("acIneV", "Vigencia de la INE de la clienta", "", "date") + inp("acCompE", "Fecha de emisión del comprobante", "", "date") + "</div>"
      + "<h3>9 · Firma 1 — Solicitud de crédito</h3><div class='ac-chk'><input type='checkbox' id='acFirma'><label for='acFirma'>La clienta acepta el trámite y declara veraz la información. Se sella con fecha, hora, GPS y dispositivo.</label></div>" + inp("acFirmante", "Nombre de quien firma", "")
      + "<div style='margin:16px 0 40px'><button class='ac-btn ac-pri' id='acGuardar'>Guardar captura</button><button class='ac-btn ac-sec' id='acCerrar'>Cancelar</button></div>";
    document.body.appendChild(panel);
    const togglePep = () => { $("acPepBox").style.display = $("acPep").value === "Sí" ? "" : "none"; };
    const toggleOtros = () => { $("acOtrosBox").style.display = $("acOtros").checked ? "" : "none"; };
    $("acPep").addEventListener("change", togglePep); $("acOtros").addEventListener("change", toggleOtros); togglePep(); toggleOtros();
    $("acGps").addEventListener("click", (e) => { e.preventDefault(); if (!navigator.geolocation) return alert("Este teléfono no da GPS."); navigator.geolocation.getCurrentPosition((p) => { $("acLat").value = p.coords.latitude.toFixed(6); $("acLng").value = p.coords.longitude.toFixed(6); }, () => alert("No se pudo leer el GPS. Activa la ubicación."), { enableHighAccuracy: true, timeout: 15000 }); });
    $("acCerrar").addEventListener("click", () => panel.remove());
    $("acGuardar").addEventListener("click", () => guardarCaptura(panel, prev.folioCaptura));
  }

  function leerPersona(p) {
    const nombre = $(p + "Nombre").value.trim();
    if (!nombre && !$(p + "Curp").value.trim()) return null;
    return { nombre, curp: $(p + "Curp").value.trim().toUpperCase(), telefono: $(p + "Tel").value.trim(), ocupacion: $(p + "Ocup").value.trim(), identificacion: $(p + "Ident").value.trim(), domicilio: $(p + "Dom").value.trim(), consentimiento: $(p + "Cons").checked };
  }

  function guardarCaptura(panel, folioPrevio) {
    const v = (id) => $(id).value.trim();
    const lat = v("acLat"), lng = v("acLng");
    const ahora = new Date().toISOString();
    const pepSi = v("acPep") === "Sí";
    const datos = {
      folioCaptura: folioPrevio || folioNuevo(), socio: v("acSocio") || null, centro: v("acCentro"), tipoCredito: v("acTipo"), importeSolicitado: Number(v("acImp")) || 0, capturadoEn: ahora,
      datos: {
        apellidoPaterno: v("acApP"), apellidoMaterno: v("acApM"), nombres: v("acNom"), curp: v("acCurp").toUpperCase(), rfc: v("acRfc").toUpperCase(), fechaNacimiento: v("acFN"), lugarNacimiento: v("acLN"), nacionalidad: v("acNac"),
        estadoCivil: v("acEC"), genero: v("acGen"), telefonoMovil: v("acTelM"), telefonoFijo: v("acTelF"), correo: v("acMail"), identificacion: { tipo: v("acIdT"), folio: v("acIdF") },
        domicilio: { calle: v("acCalle"), numero: v("acNum"), colonia: v("acCol"), cp: v("acCP"), municipio: v("acMun"), ciudad: v("acCd"), estado: v("acEdo"), tiempoResidenciaMeses: v("acRes") },
        gps: lat && lng ? { lat, lng } : null,
        negocio: { giro: v("acGiro"), antiguedadMeses: v("acAnt"), ingresoDeclarado: v("acIng") }, actividadEconomica: v("acAct"),
        capacidadPago: { ingresoSemanal: v("acIS"), gastosNegocio: v("acGN"), gastosHogar: v("acGH"), mesIngresoMasBajo: v("acMB"), capacidadPago: v("acCap") },
        creditosOtros: $("acOtros").checked ? { tiene: true, institucion: v("acOInst"), monto: v("acOMonto"), deudaActual: v("acODeuda"), pagoSemanal: v("acOPago") } : { tiene: false },
        vivienda: { tipo: v("acVT"), superficie: v("acVS"), niveles: v("acVN"), habitaciones: v("acVH"), paredes: v("acVP"), piso: v("acVPi"), techo: v("acVTe") },
        familia: { dependientes: v("acFD"), hijosMenores: v("acFH"), otroIngreso: v("acFO"), ingresoTotalHogar: v("acFT") },
      },
      pld: { origenRecursos: v("acOrig"), pep: pepSi ? { es: true, tipo: v("acPepT"), parentesco: v("acPepP"), cargo: v("acPepC"), dependencia: v("acPepD"), periodo: v("acPepPer") } : (v("acPep") === "No" ? { es: false } : {}) },
      referencias: [0, 1].map((i) => ({ nombre: v("acRef" + i + "N"), relacion: v("acRef" + i + "R"), telefono: v("acRef" + i + "T"), curp: v("acRef" + i + "C").toUpperCase(), consentimiento: $("acRef" + i + "Cons").checked })),
      responsable: leerPersona("acR"), aval: leerPersona("acA"),
      documentos: Array.from(panel.querySelectorAll(".acDoc:checked")).map((c) => ({ propietario: c.dataset.p, tipo: c.dataset.t, fotografiado: true,
        fechaVencimiento: c.dataset.p === "solicitante" && c.dataset.t === "ine" ? (v("acIneV") || null) : null,
        fechaEmision: c.dataset.p === "solicitante" && c.dataset.t === "comprobante_domicilio" ? (v("acCompE") || null) : null })),
      firma1: $("acFirma").checked ? { aceptada: true, fechaHora: ahora, gps: lat && lng ? { lat, lng } : null, dispositivo: navigator.userAgent.slice(0, 160), nombreFirmante: v("acFirmante") } : null,
    };
    // Candados mínimos en el teléfono (los completos los aplica el servidor).
    const faltan = [];
    if (!datos.datos.nombres || !datos.datos.apellidoPaterno) faltan.push("nombre completo");
    if (!/^[A-Z0-9]{18}$/.test(datos.datos.curp)) faltan.push("CURP de 18 caracteres");
    if (!datos.datos.gps) faltan.push("GPS del domicilio");
    if (!datos.firma1) faltan.push("Firma 1");
    if (!datos.centro) faltan.push("centro");
    if (faltan.length) { $("acErrs").innerHTML = "<div class='ac-errs'>Falta: " + hesc(faltan.join(", ")) + ".</div>"; panel.scrollTop = 0; return; }
    const resumen = datos.datos.nombres + " " + datos.datos.apellidoPaterno + " · " + datos.centro;
    const lista = leerPend(); lista.push({ folio: datos.folioCaptura, ts: Date.now(), resumen, datos, enviada: false });
    guardarPend(lista);
    panel.remove();
    alert("Captura guardada en el teléfono: " + resumen + ". Se enviará sola en cuanto haya señal. La clienta queda EN CAPTURA (no autorizada) hasta que se arme y valide su expediente.");
    subirPendientes();
  }

  // Botón de entrada, junto al alta rápida de la app si existe; si no, flotante.
  function montar() {
    const btn = document.createElement("button"); btn.id = "acAbrir"; btn.className = "ac-btn ac-pri"; btn.textContent = "➕ Alta de clienta en campo (expediente)";
    const estado = document.createElement("div"); estado.id = "acEstado";
    const ancla = $("altaCentro") ? $("altaCentro").closest("div") : null;
    if (ancla && ancla.parentNode) { ancla.parentNode.insertBefore(estado, ancla); ancla.parentNode.insertBefore(btn, estado); }
    else { btn.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:9998"; document.body.appendChild(btn); document.body.appendChild(estado); }
    document.head.insertAdjacentHTML("beforeend", css);
    btn.addEventListener("click", async () => {
      if (!CAT) { try { const r = await fetch("/api/expediente/catalogos"); if (r.ok) { CAT = await r.json(); try { localStorage.setItem("fooax_exp_catalogos", JSON.stringify(CAT)); } catch (e) {} } } catch (e) {} }
      if (!CAT) { try { CAT = JSON.parse(localStorage.getItem("fooax_exp_catalogos") || "null"); } catch (e) {} }
      if (!CAT) return alert("Abre la app una vez con señal para bajar los catálogos del expediente; después ya puedes capturar sin conexión.");
      abrirForm();
    });
    pintarEstado();
    subirPendientes();
    // Catálogos: se bajan al abrir con señal para que el formulario sirva sin conexión.
    fetch("/api/expediente/catalogos").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) { CAT = c; try { localStorage.setItem("fooax_exp_catalogos", JSON.stringify(c)); } catch (e) {} } }).catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar); else montar();
})();
