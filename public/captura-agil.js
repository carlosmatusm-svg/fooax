// FOOAX · captura más ágil — capa de optimización que se inyecta sobre la app.
// No modifica el archivo original del ejecutivo: solo mejora la experiencia.
//   1) La alerta gigante "Falta: plazo y semana…" (que hoy sale en CADA clienta)
//      se vuelve una etiqueta chiquita "sin ficha" → mucho menos scroll.
//   2) Renglones más compactos: caben más clientas por pantalla.
// La captura de "pagó su cuota completa" ya es de un toque (el ✓ de cada clienta).

// Protección del teléfono (corre siempre, aunque la app cambie). Limpia TODOS
// los datos de FOOAX del teléfono si la cuenta se deshabilitó (sesión inválida)
// o si Dirección marcó el teléfono para borrado remoto (perdido / dejó de
// trabajar). Los datos en tránsito ya van cifrados por HTTPS.
window.__limpiarFooax = function () {
  Object.keys(localStorage).forEach((k) => { if (k.indexOf("fooax_") === 0) localStorage.removeItem(k); });
};
(function proteccionTelefono() {
  fetch("/api/me", { credentials: "include" }).then(async (r) => {
    if (r.status === 401) { window.__limpiarFooax(); return; }
    const d = await r.json().catch(() => ({}));
    if (d && d.wipe) {
      window.__limpiarFooax();
      try { await fetch("/api/telefono/borrado-hecho", { method: "POST", credentials: "include" }); } catch (e) {}
      location.reload();
    }
  }).catch(() => {});
})();

(function () {
  if (typeof window.fichaClienteDato !== "function" || typeof window.render !== "function") {
    console.warn("[captura-agil] app no compatible");
    return;
  }

  const esc = (k) => String(k).replace(/'/g, "\\'");

  // 1) Etiqueta compacta en vez del bloque rojo largo.
  //    Reutiliza la función original para saber el estado (con/sin ficha) — así
  //    lee los datos por el mismo camino que la app y nunca se desincroniza.
  const original = window.fichaClienteDato;
  window.fichaClienteDato = function (key) {
    let html = "";
    try { html = original(key) || ""; } catch (e) {}
    const onc = 'onclick="editarDato(\'' + esc(key) + '\')"';
    const m = html.match(/Pago\s+(\d+)\s+de\s+(\d+)/i);
    if (html.indexOf("clidato ok") !== -1 && m) {
      return '<span class="clidato ok agil" ' + onc + ">pago " + m[1] + "/" + m[2] + " ✎</span>";
    }
    return '<span class="clidato falta agil" ' + onc + ">sin ficha ✎</span>";
  };

  // 2) Estilos de compactación (se aplican aunque la app vuelva a dibujar).
  const st = document.createElement("style");
  st.textContent =
    ".clidato.agil{display:inline-block;font-size:10px;padding:2px 8px;margin:3px 0 0;" +
    "border-radius:99px;font-weight:700;line-height:1.4}" +
    ".clidato.falta.agil{background:#FFF3E0;color:#9A5B00}" +
    ".clidato.ok.agil{background:#E7F6EE;color:#0B7247}" +
    ".cli{padding:8px 2px}" +
    ".cli-head{gap:9px}" +
    ".nm{font-size:13.5px}" +
    ".mt{font-size:10.5px}" +
    ".micromora{font-size:10.5px;padding:3px 7px;margin-top:3px}" +
    ".buscador-cli{margin:0 0 10px;position:relative}" +
    ".buscador-cli input{width:100%;font:inherit;font-size:15px;padding:11px 12px 11px 40px;" +
    "border:1.5px solid #E2E3F0;border-radius:12px;background:#fff;-webkit-appearance:none}" +
    ".buscador-cli input:focus{outline:none;border-color:#F1228E;box-shadow:0 0 0 3px rgba(241,34,142,.12)}" +
    ".buscador-cli .lupa{position:absolute;left:13px;top:50%;transform:translateY(-50%);" +
    "width:17px;height:17px;color:#7A6E86;pointer-events:none}" +
    ".buscador-cli .nores{font-size:12.5px;color:#7A6E86;padding:7px 2px 0}" +
    ".buscador-cli .otros{margin-top:8px;display:flex;flex-direction:column;gap:6px}" +
    ".buscador-cli .otros-h{font-size:10.5px;font-weight:700;color:#7A6E86;" +
    "text-transform:uppercase;letter-spacing:.05em;margin-top:2px}" +
    ".buscador-cli .otros-item{display:flex;flex-direction:column;align-items:flex-start;" +
    "gap:1px;text-align:left;width:100%;background:#fff;border:1px solid #E2E3F0;" +
    "border-radius:11px;padding:9px 12px;cursor:pointer;font:inherit}" +
    ".buscador-cli .otros-item b{font-size:13.5px;font-weight:700;color:#2A1F35}" +
    ".buscador-cli .otros-item span{font-size:11.5px;color:#7A6E86}" +
    ".buscador-cli .otros-item:active{background:#F6F3F9}" +
    ".denom-modal{position:fixed;inset:0;z-index:99999;background:rgba(42,31,53,.5);" +
    "display:none;align-items:flex-end;justify-content:center}" +
    ".denom-sheet{background:#fff;width:100%;max-width:460px;max-height:92vh;" +
    "border-radius:22px 22px 0 0;display:flex;flex-direction:column}" +
    ".denom-head{display:flex;align-items:center;gap:10px;padding:16px 16px 10px}" +
    ".denom-head>div:first-child{flex:1;min-width:0}" +
    ".denom-title{font-size:16px;font-weight:800;color:#2A1F35}" +
    ".denom-sub{font-size:12.5px;color:#7A6E86;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".denom-x{background:#F1ECF7;border:none;width:32px;height:32px;border-radius:50%;" +
    "font-size:14px;color:#7A6E86;cursor:pointer;flex-shrink:0}" +
    ".denom-rows{overflow-y:auto;padding:0 16px;flex:1}" +
    ".denom-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #F1ECF7}" +
    ".denom-lbl{width:74px;font-weight:700;font-size:15px;color:#2A1F35}" +
    ".denom-lbl span{display:block;font-size:9.5px;font-weight:600;color:#7A6E86;text-transform:uppercase;letter-spacing:.04em}" +
    ".denom-step{display:flex;align-items:center;gap:6px;flex:1;justify-content:center}" +
    ".denom-step button{width:34px;height:34px;border-radius:9px;border:1.5px solid #E2E3F0;" +
    "background:#fff;font-size:18px;font-weight:700;color:#324AB6;cursor:pointer;line-height:1}" +
    ".denom-qty{width:52px;text-align:center;font:inherit;font-size:16px;font-weight:700;" +
    "padding:7px 2px;border:1.5px solid #E2E3F0;border-radius:9px;-webkit-appearance:none;margin:0}" +
    ".denom-sub2{width:70px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:13px;color:#2A1F35}" +
    ".denom-foot{padding:12px 16px 16px;border-top:1px solid #ECE6F1;background:#fff}" +
    ".denom-total{font-size:14px;color:#7A6E86;margin-bottom:10px;text-align:center}" +
    ".denom-total b{font-size:22px;color:#2A1F35;font-variant-numeric:tabular-nums}" +
    ".denom-total span{display:block;font-size:12.5px;font-weight:700;margin-top:2px}" +
    ".denom-ok{width:100%;font:inherit;font-size:16px;font-weight:700;color:#fff;" +
    "background:#13A463;border:none;border-radius:13px;padding:13px;cursor:pointer}" +
    ".denom-cancel{width:100%;font:inherit;font-size:14px;font-weight:600;color:#7A6E86;" +
    "background:none;border:none;padding:9px;cursor:pointer;margin-top:4px}" +
    // arreglos móviles: pestaña "Renovaciones" no se sale; fecha no se desborda;
    // ficha del centro con scroll; header con logo a la izquierda.
    ".tab{font-size:11.5px;padding:9px 8px;white-space:nowrap;min-width:auto}" +
    "input[type=date]{box-sizing:border-box;max-width:100%;min-width:0;-webkit-appearance:none;appearance:none}" +
    ".card table,.fichacuotas,table{display:block;overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}" +
    "header{display:flex;align-items:center;gap:12px}" +
    "header .fooax-logo{width:46px;height:46px;border-radius:12px;object-fit:cover;flex-shrink:0;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
    "header .fooax-htext{flex:1;min-width:0}" +
    "header .fooax-salir{flex-shrink:0;background:rgba(255,255,255,.22);border:none;color:#fff;" +
    "font:700 13px inherit;font-family:inherit;padding:0 15px;height:40px;min-width:40px;border-radius:99px;" +
    "cursor:pointer;display:inline-flex;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent}" +
    "header .fooax-salir:active{background:rgba(255,255,255,.35)}" +
    "header .fooax-salir svg{width:16px;height:16px}";
  document.head.appendChild(st);

  // 3) Alerta fuerte para dedazos gordos: si el pago es >=5x la cuota (y >=$1,000),
  //    en vez del aviso normal "pagó de más" sale un rojo de "¿segura? revisa los
  //    billetes". Los avisos normales de la app se conservan tal cual.
  if (typeof window.cuotaAviso === "function") {
    const origAviso = window.cuotaAviso;
    window.cuotaAviso = function (r, cuota) {
      const pago = (r && r.pago) || 0;
      if (cuota > 0 && pago >= 1000 && pago >= cuota * 5) {
        const f = typeof fmt === "function" ? fmt : (x) => "$" + x;
        return '<div class="cuotamas" style="background:#FDECEC;color:#B4232F;font-weight:800">' +
          "⚠ ¿Segura? Anotaste " + f(pago) + ", pero la cuota es " + f(cuota) +
          ". Revisa los billetes antes de continuar.</div>";
      }
      return origAviso.apply(this, arguments);
    };
  }

  // 4) Buscador de barra: filtra las clientas del centro mientras se escribe
  //    (por nombre o socio). La barra vive FUERA de #listaClientas para que la
  //    app pueda redibujar la lista sin borrarla; el filtro se re-aplica solo.
  (function montarBuscadorClientas() {
    const lista = document.getElementById("listaClientas");
    if (!lista || typeof window.render !== "function") return;
    const wrap = document.createElement("div");
    wrap.className = "buscador-cli";
    wrap.style.display = "none";
    wrap.innerHTML =
      '<svg class="lupa" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/>' +
      '<line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input type="search" inputmode="search" autocomplete="off" ' +
      'placeholder="Buscar clienta por nombre o socio…">' +
      '<div class="nores" style="display:none"></div>' +
      '<div class="otros"></div>';
    lista.parentNode.insertBefore(wrap, lista);
    const input = wrap.querySelector("input");
    const nores = wrap.querySelector(".nores");
    const otros = wrap.querySelector(".otros");
    const nrm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    let tFetch;

    function setNores(hayTermino, visLocal, enOtros) {
      if (hayTermino && visLocal === 0 && enOtros === 0) {
        nores.textContent = "Ninguna clienta coincide con “" + input.value.trim() + "”.";
        nores.style.display = "block";
      } else nores.style.display = "none";
    }

    // Filtra las clientas del centro abierto (en pantalla). Devuelve cuántas quedan.
    function filtrarLocal() {
      const q = nrm(input.value).trim();
      const terms = q ? q.split(/\s+/) : [];
      const cards = lista.querySelectorAll(".cli");
      let vis = 0;
      cards.forEach((c) => {
        const nm = c.querySelector(".nm") ? c.querySelector(".nm").textContent : "";
        const mt = c.querySelector(".mt") ? c.querySelector(".mt").textContent : "";
        const heno = nrm(nm + " " + mt);
        const ok = !terms.length || terms.every((t) => heno.indexOf(t) !== -1);
        c.style.display = ok ? "" : "none";
        if (ok) vis++;
      });
      return vis;
    }

    // Busca en TODOS los centros del ejecutivo vía el padrón del servidor y
    // ofrece saltar. Requiere conexión (offline solo filtra el centro abierto).
    async function buscarOtros(q, visLocal) {
      const actual = (document.getElementById("selCentro") || {}).value || "";
      let d;
      try {
        const r = await fetch("/api/clientes?q=" + encodeURIComponent(q), { credentials: "include" });
        if (!r.ok) { otros.innerHTML = ""; return; }
        d = await r.json();
      } catch { otros.innerHTML = ""; return; } // sin señal: solo centro abierto
      const matches = (d.resultados || []).filter((c) => c.centro !== actual).slice(0, 12);
      otros.innerHTML = "";
      if (matches.length) {
        otros.innerHTML = '<div class="otros-h">También en otros centros:</div>';
        matches.forEach((m) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "otros-item";
          b.innerHTML = "<b>" + m.nombre + "</b><span>" + m.centro + " · " + (m.producto || "") + "</span>";
          b.addEventListener("click", () => irA(m));
          otros.appendChild(b);
        });
      }
      setNores(q.length > 0, visLocal, matches.length);
    }

    // Salta al centro de la clienta y la resalta (la ubica por su número de socio).
    function irA(m) {
      const sel = document.getElementById("selCentro");
      if (!sel) return;
      input.value = "";
      otros.innerHTML = "";
      sel.value = m.centro;
      sel.dispatchEvent(new Event("change", { bubbles: true })); // dispara render()
      setTimeout(() => {
        const cards = lista.querySelectorAll(".cli");
        for (const el of cards) {
          const mt = el.querySelector(".mt");
          if (mt && mt.textContent.indexOf(m.id) !== -1) {
            el.scrollIntoView({ block: "center" });
            el.style.transition = "background .25s";
            el.style.background = "#FFF3E0";
            setTimeout(() => { el.style.background = ""; }, 1500);
            break;
          }
        }
      }, 200);
    }

    function filtrar() {
      const vis = filtrarLocal();
      const q = input.value.trim();
      clearTimeout(tFetch);
      if (q.length < 2) { otros.innerHTML = ""; setNores(q.length > 0, vis, 0); return; }
      if (vis > 0) nores.style.display = "none";
      tFetch = setTimeout(() => buscarOtros(q, vis), 250);
    }
    input.addEventListener("input", filtrar);

    const origRender = window.render;
    window.render = function () {
      const rv = origRender.apply(this, arguments);
      try {
        const hay = lista.querySelector(".cli");
        wrap.style.display = hay ? "block" : "none";
        if (hay) filtrarLocal();
      } catch (e) {}
      return rv;
    };
  })();

  // 5) Desglose de efectivo: al elegir "Efe" se abre una pantalla con las
  //    denominaciones (billetes y monedas). El total contado se vuelve el pago,
  //    y el desglose se guarda en el registro para que el arqueo cuadre.
  (function montarDenominaciones() {
    if (typeof window.setForma !== "function" || typeof window.setCampo !== "function") return;
    const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
    const desgloses = {}; // socio(key) -> { centro, desglose }
    const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("es-MX");

    // La app guarda su estado en localStorage (objeto reg, que no expone). Tras
    // cada guardado inyectamos el desglose para que viaje en la sincronización.
    const gPrev = window.guardar;
    if (typeof gPrev === "function") {
      window.guardar = function () {
        const rv = gPrev.apply(this, arguments);
        try {
          const sk = Object.keys(localStorage).filter((k) => k.indexOf("fooax_cob_") === 0)[0];
          if (sk) {
            const data = JSON.parse(localStorage.getItem(sk));
            let ch = false;
            for (const key in desgloses) {
              const info = desgloses[key];
              if (info.centro) {
                if (data.reg && data.reg[info.centro] && data.reg[info.centro][key]) {
                  data.reg[info.centro][key].desglose = info.desglose; ch = true;
                }
              } else if (data.regI && data.regI[key]) {
                data.regI[key].desglose = info.desglose; ch = true;
              }
            }
            if (ch) localStorage.setItem(sk, JSON.stringify(data));
          }
        } catch (e) {}
        return rv;
      };
    }

    const modal = document.createElement("div");
    modal.className = "denom-modal";
    modal.innerHTML =
      '<div class="denom-sheet">' +
      '<div class="denom-head"><div><div class="denom-title" id="denomTitulo">Efectivo recibido</div>' +
      '<div class="denom-sub" id="denomCli"></div></div>' +
      '<button class="denom-x" id="denomX" type="button" aria-label="Cerrar">✕</button></div>' +
      '<div class="denom-rows"></div>' +
      '<div class="denom-foot"><div class="denom-total">Total contado: ' +
      '<b id="denomTotal">$0</b> <span id="denomRef"></span></div>' +
      '<button class="denom-ok" id="denomOk" type="button">Usar este total</button>' +
      '<button class="denom-cancel" id="denomCancel" type="button">Cancelar</button></div>' +
      "</div>";
    document.body.appendChild(modal);

    const rowsHost = modal.querySelector(".denom-rows");
    DENOMS.forEach((d) => {
      const row = document.createElement("div");
      row.className = "denom-row";
      const etiqueta = d % 1 ? d.toFixed(2) : String(d);
      row.innerHTML =
        '<div class="denom-lbl">$' + etiqueta + "<span>" + (d >= 20 ? "billete" : "moneda") + "</span></div>" +
        '<div class="denom-step">' +
        '<button type="button" class="denom-menos" data-d="' + d + '">−</button>' +
        '<input type="number" inputmode="numeric" min="0" value="0" class="denom-qty" data-d="' + d + '">' +
        '<button type="button" class="denom-mas" data-d="' + d + '">+</button></div>' +
        '<div class="denom-sub2" data-sub="' + d + '">$0</div>';
      rowsHost.appendChild(row);
    });

    let curCentro = "", curSocio = "", curCuota = 0, curModo = "pago";
    function cerrar() { modal.style.display = "none"; }
    function recompute() {
      let total = 0;
      DENOMS.forEach((d) => {
        const inp = modal.querySelector('.denom-qty[data-d="' + d + '"]');
        const q = Math.max(0, parseInt(inp.value, 10) || 0);
        const sub = d * q; total += sub;
        modal.querySelector('.denom-sub2[data-sub="' + d + '"]').textContent = money(sub);
      });
      modal.querySelector("#denomTotal").textContent = money(total);
      const ref = modal.querySelector("#denomRef");
      if (curCuota > 0) {
        if (Math.abs(total - curCuota) < 0.01) ref.innerHTML = '<span style="color:#0B7247">= su cuota</span>';
        else if (total > curCuota) ref.innerHTML = '<span style="color:#7A6E86">' + money(total - curCuota) + " sobre la cuota</span>";
        else ref.innerHTML = '<span style="color:#B4232F">faltan ' + money(curCuota - total) + "</span>";
      } else ref.innerHTML = "";
      return total;
    }
    function abrir(centro, socio, card, modo) {
      curCentro = centro || ""; curSocio = socio; curModo = modo || "pago";
      const nmEl = card && card.querySelector(".nm");
      modal.querySelector("#denomCli").textContent = nmEl ? nmEl.textContent.trim() : "Clienta";
      modal.querySelector("#denomTitulo").textContent =
        curModo === "mixEfe" ? "Efectivo del pago mixto" : "Efectivo recibido";
      // En mixto la referencia es la parte en efectivo, no la cuota: no comparamos.
      if (curModo === "mixEfe") curCuota = 0;
      else {
        const mt = card && card.querySelector(".mt") ? card.querySelector(".mt").textContent : "";
        const mm = mt.replace(/,/g, "").match(/cuota\s*\$?([\d.]+)/i);
        curCuota = mm ? parseFloat(mm[1]) : 0;
      }
      modal.querySelectorAll(".denom-qty").forEach((i) => { i.value = "0"; });
      recompute();
      modal.style.display = "flex";
    }

    rowsHost.addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest("button[data-d]") : null;
      if (!b) return;
      const d = b.getAttribute("data-d");
      const inp = modal.querySelector('.denom-qty[data-d="' + d + '"]');
      let q = Math.max(0, parseInt(inp.value, 10) || 0);
      q = b.classList.contains("denom-mas") ? q + 1 : Math.max(0, q - 1);
      inp.value = q; recompute();
    });
    rowsHost.addEventListener("input", (e) => { if (e.target.classList.contains("denom-qty")) recompute(); });
    modal.querySelector("#denomOk").addEventListener("click", () => {
      const total = recompute();
      const desglose = {};
      DENOMS.forEach((d) => {
        const q = Math.max(0, parseInt(modal.querySelector('.denom-qty[data-d="' + d + '"]').value, 10) || 0);
        if (q > 0) desglose[d] = q;
      });
      desgloses[curSocio] = { centro: curCentro, desglose: desglose };
      if (curModo === "mixEfe" && typeof window.setMix === "function") {
        window.setMix(curCentro, curSocio, "mixEfe", total); // llena la parte en efectivo del mixto
      } else {
        window.setCampo(curCentro, curSocio, "pago", total);
      }
      cerrar();
    });
    modal.querySelector("#denomCancel").addEventListener("click", cerrar);
    modal.querySelector("#denomX").addEventListener("click", cerrar);
    modal.addEventListener("click", (e) => { if (e.target === modal) cerrar(); });

    // En pago MIXTO: al tocar el campo "En efectivo", abre la pantalla de billetes
    // para contar esa parte (su total llena el efectivo del mixto).
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if (!el || el.tagName !== "INPUT") return;
      const oc = el.getAttribute("onchange") || "";
      const m = oc.match(/setMix\('([^']*)','([^']*)','mixEfe'/);
      if (m) { el.blur(); abrir(m[1], m[2], el.closest(".cli"), "mixEfe"); }
    });

    const sfPrev = window.setForma;
    window.setForma = function (centro, socio, f) {
      const rv = sfPrev.apply(this, arguments);
      if (f === "E") setTimeout(() => {
        const pre = centro ? "c|" + centro : "i";
        const id = "cli_" + pre.replace(/[^a-zA-Z0-9]/g, "") + "_" + String(socio).replace(/[^a-zA-Z0-9]/g, "");
        const card = document.getElementById(id);
        if (card && card.querySelector(".forma button.efe")) abrir(centro, socio, card);
      }, 40);
      return rv;
    };
  })();

  // 6b) Fecha en horario de México (no UTC): así el "día" cambia a medianoche
  //     real y la cobranza de la tarde NO se parte ni desaparece del tablero.
  if (typeof window.hoyISO === "function") {
    window.hoyISO = function () {
      return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    };
    const inp = document.getElementById("inpFecha");
    if (inp && !inp.value) inp.value = window.hoyISO();
    else if (inp && inp.value) {
      const utcHoy = new Date().toISOString().slice(0, 10);
      if (inp.value === utcHoy) inp.value = window.hoyISO();
    }
    // Arregla el desfase de un día: la app hacía new Date("AAAA-MM-DD") que se
    // interpreta como UTC y en México (−6) caía al día anterior. Aquí la fecha
    // se arma LOCAL, así el encabezado y el campo muestran SIEMPRE el mismo día.
    if (typeof window.updFecha === "function") {
      const DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
      window.updFecha = function () {
        const v = (document.getElementById("inpFecha").value || window.hoyISO());
        const pz = String(v).split("-").map(Number);
        const d = pz.length === 3 && pz[0] ? new Date(pz[0], pz[1] - 1, pz[2]) : new Date(v);
        const fh = document.getElementById("fechaHoy");
        if (fh) fh.textContent = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        const ds = DIAS[(d.getDay() + 6) % 7];
        const sel = document.getElementById("selDia");
        if (sel) for (const o of sel.options) { if (o.value === ds) { sel.value = ds; break; } }
        if (typeof window.render === "function") window.render();
      };
      try { window.updFecha(); } catch (e) {}
    }
  }

  // 6) Logo de FOOAX a la izquierda del encabezado.
  (function ponerLogo() {
    const header = document.querySelector("header");
    if (!header || header.querySelector(".fooax-logo")) return;
    const img = document.createElement("img");
    img.src = "/img/logo-fooax.jpg";
    img.className = "fooax-logo";
    img.alt = "FOOAX";
    const wrap = document.createElement("div");
    wrap.className = "fooax-htext";
    while (header.firstChild) wrap.appendChild(header.firstChild);
    header.appendChild(img);
    header.appendChild(wrap);

    // Botón de salir (cerrar sesión). Antes de salir fuerza una última
    // sincronización para no dejar nada sin subir a la nube.
    const salir = document.createElement("button");
    salir.className = "fooax-salir";
    salir.type = "button";
    salir.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
      '<polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Salir</span>';
    salir.addEventListener("click", async () => {
      if (!confirm("¿Cerrar sesión? Tu captura ya está guardada.")) return;
      salir.disabled = true;
      let subio = false;
      try { if (window.__forzarSync) subio = await window.__forzarSync(); } catch (e) {}
      try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch (e) {}
      // Limpia los datos del teléfono SOLO si ya subieron a la nube (si estaba
      // sin señal, se conservan para no perder la captura del día).
      if (subio && window.__limpiarFooax) window.__limpiarFooax();
      location.href = "/";
    });
    header.appendChild(salir);
  })();

  // Re-dibujar por si ya había un centro seleccionado al cargar.
  try { window.render(); } catch (e) {}
})();
