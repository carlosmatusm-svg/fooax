// REASIGNAR / CONFIRMAR EJECUTIVO AL RE-DAR CRÉDITO (regla Karina 25-jul-2026).
// Al renovar se confirma quién lo cobra, o se reasigna. Lo que se prueba aquí es
// que el crédito DE VERDAD aparezca en la app del ejecutivo elegido y le
// desaparezca al anterior. Corre contra el servidor local (3899).
const U = "http://localhost:3899";
let PASS = 0, FAIL = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { PASS++; console.log("  ✅ " + nombre); }
  else { FAIL++; console.log("  ❌ " + nombre + (detalle ? "  → " + detalle : "")); }
};
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
async function login(u, p) {
  const r = await fetch(U + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: u, password: p }) });
  return r.headers.get("set-cookie").split(";")[0];
}
const H = (c) => ({ "Content-Type": "application/json", Cookie: c });
const post = (c, url, body) => fetch(U + url, { method: "POST", headers: H(c), body: JSON.stringify(body) });

// Lee lo que el servidor le manda a la app de una ejecutiva: qué le AGREGA
// (altas) y qué le QUITA (quitar) de su lista de clientas.
//
// CORREGIDO (auditoría de pruebas, 25-sep-2026): esto ANTES leía var _A=/var
// _Q= embebidas como texto en el HTML de /app. Esa lógica se movió a
// public/vivos.js + GET /api/vivos (paqueteVivo(), server.js) el 12-sep-2026
// y esta prueba nunca se actualizó — las 3 pruebas de este archivo pasaban
// vacío ([]) silenciosamente porque la regex ya no encontraba nada, no
// porque el comportamiento real estuviera roto.
async function inyeccion(cookie) {
  const j = await (await fetch(U + "/api/vivos", { headers: { Cookie: cookie } })).json();
  return { altas: j.altas || [], quitar: j.quitar || [], vivos: j.vivos || [] };
}
const tiene = (lista, id, prod) => lista.some((x) => String(x.id) === String(id) && x.producto === prod);

// Reproduce EXACTAMENTE lo que hace el script inyectado (public/vivos.js):
// 1) quita, 2) agrega, 3) ACTUALIZA MONTOS de lo que ya estaba (montos()).
//
// CORREGIDO (auditoría de pruebas, 25-sep-2026): faltaba el paso 3. Cuando el
// viejo y el nuevo comparten socio+producto (renovar confirmando al MISMO
// ejecutivo), `quitar` no los separa (misma llave sigue viva) y `altas` no
// reemplaza lo que ya existe (altas() en vivos.js hace lo mismo: salta si ya
// está) — el saldo actualizado llega por otro paquete distinto (`vivos`,
// paqueteVivo() en server.js → montos() en vivos.js), que esta prueba nunca
// aplicaba. No es un bug de producción: es que la prueba solo reproducía 2 de
// los 3 pasos reales.
function simularApp(centroLista, inj) {
  const arr = centroLista.slice();
  const n = (s) => String(s || "").toLowerCase().trim();
  for (let i = arr.length - 1; i >= 0; i--) {
    const c = arr[i];
    if (inj.quitar.some((q) => String(c.f) === String(q.id) && n(c.sub) === n(q.producto))) arr.splice(i, 1);
  }
  inj.altas.forEach((a) => {
    const cl = { n: a.nombre, f: String(a.id), sub: a.producto, saldo: a.saldo, esp: a.cuota };
    if (!arr.some((c) => String(c.f) === String(a.id) && n(c.sub) === n(a.producto))) arr.push(cl);
  });
  (inj.vivos || []).forEach((v) => {
    const c = arr.find((x) => String(x.f) === String(v.id) && n(x.sub) === n(v.producto));
    if (c && v.saldo >= 0) c.saldo = v.saldo;
  });
  return arr;
}

(async () => {
  const ca = await login("anel", "anel2026");
  const cm = await login("monse", "monse2026");
  const cNeri = await login("neri", "neri2026");
  const cKna = await login("karina", "karina2026");
  const centro = (await j(await fetch(U + "/api/centros", { headers: H(ca) }))).centros[0].centro;

  console.log("\n— CONFIRMAR EL MISMO EJECUTIVO (el caso normal) —");
  const ID = "99900022201";
  await post(cm, "/api/clientes/alta", { id: ID, nombre: "PRUEBA MISMO EJEC", centro, ejecutivo: "Neri", producto: "Grupal-Basico", saldo: 0, cuota: 570 });

  let r = await post(ca, "/api/creditos/recredito", { id: ID, nombre: "PRUEBA MISMO EJEC", centro, ejecutivo: "Neri", producto: "Grupal-Basico", saldo: 12000, cuota: 720 });
  let d = await j(r);
  ok("renovar confirmando a Neri se acepta", r.ok, d.error);
  ok("no se marca como reasignado", d.reasignadoDe === null, JSON.stringify(d.reasignadoDe));

  let iNeri = await inyeccion(cNeri);
  ok("a Neri se le AGREGA el crédito renovado", tiene(iNeri.altas, ID, "Grupal-Basico"));
  const alta = iNeri.altas.find((x) => String(x.id) === ID);
  ok("y con el monto NUEVO ($12,000, no el viejo)", alta && alta.saldo === 12000, JSON.stringify(alta));

  // LO CRÍTICO: el viejo y el nuevo comparten socio+producto. Si el "quitar"
  // corriera después del "agregar", borraría el crédito NUEVO.
  const final = simularApp([{ n: "PRUEBA MISMO EJEC", f: ID, sub: "Grupal-Basico", saldo: 0 }], iNeri);
  ok("en la app de Neri queda UNA sola vez (no duplicado)", final.filter((c) => String(c.f) === ID).length === 1,
    JSON.stringify(final));
  ok("y NO desapareció por el quitar (sobrevive el nuevo)", final.some((c) => String(c.f) === ID && c.saldo === 12000),
    JSON.stringify(final));

  console.log("\n— REASIGNAR A OTRO EJECUTIVO —");
  const ID2 = "99900022202";
  // saldo:0 a propósito (igual que ID en la sección 1): con saldo > 0 el
  // recrédito de más abajo se rechaza por el candado antiduplicado de
  // renovación ("todavía tiene saldo... primero liquídalo") — el mismo
  // candado que ya hace posible la sección 1.
  await post(cm, "/api/clientes/alta", { id: ID2, nombre: "PRUEBA REASIGNA", centro, ejecutivo: "Neri", producto: "Grupal-Basico", saldo: 0, cuota: 570 });
  // CORREGIDO (auditoría de pruebas, 25-sep-2026): un alta con saldo:0 nunca
  // aparece en `altas` de /api/vivos (regla "llegó a cero", altasParaApp en
  // server.js — un saldo 0 se trata igual que un crédito ya liquidado, sin
  // distinguir "recién nacido" de "recién pagado"). Antes esta prueba lo
  // verificaba ahí y por eso pasaba con la vieja _A embebida (que no tenía
  // ese filtro) pero fallaría aquí por una razón AJENA a lo que se quiere
  // probar (a quién pertenece el crédito). Se verifica directo contra el
  // padrón, que es la fuente de verdad real, no contra la lista de cobro.
  const antes = await j(await fetch(U + "/api/creditos?q=" + ID2, { headers: H(ca) }));
  ok("antes de reasignar, el crédito es de Neri",
    (antes.resultados || []).some((c) => String(c.id) === ID2 && c.ejecutivo === "Neri"),
    JSON.stringify(antes.resultados));

  r = await post(ca, "/api/creditos/recredito", { id: ID2, nombre: "PRUEBA REASIGNA", centro, ejecutivo: "Karina", producto: "Grupal-Basico", saldo: 9000, cuota: 540 });
  d = await j(r);
  ok("reasignar a Karina se acepta", r.ok, d.error);
  ok("avisa de quién a quién pasó", d.reasignadoDe === "Neri" && d.ejecutivo === "Karina", JSON.stringify([d.reasignadoDe, d.ejecutivo]));

  iNeri = await inyeccion(cNeri);
  const iKna = await inyeccion(cKna);
  ok("a Karina SÍ le aparece el crédito", tiene(iKna.altas, ID2, "Grupal-Basico"), JSON.stringify(iKna.altas.slice(-2)));
  ok("a Neri YA NO le aparece", !tiene(iNeri.altas, ID2, "Grupal-Basico"));
  ok("y se le manda QUITAR de su teléfono", iNeri.quitar.some((q) => String(q.id) === ID2), JSON.stringify(iNeri.quitar.slice(-3)));

  const finalNeri = simularApp([{ n: "PRUEBA REASIGNA", f: ID2, sub: "Grupal-Basico", saldo: 0 }], iNeri);
  ok("en la app de Neri el crédito desaparece de verdad", !finalNeri.some((c) => String(c.f) === ID2), JSON.stringify(finalNeri));

  console.log("\n— EJECUTIVO INVÁLIDO —");
  const ID3 = "99900022203";
  await post(cm, "/api/clientes/alta", { id: ID3, nombre: "PRUEBA EJEC MALO", centro, ejecutivo: "Neri", producto: "Grupal-Basico", saldo: 0, cuota: 570 });
  r = await post(ca, "/api/creditos/recredito", { id: ID3, nombre: "PRUEBA EJEC MALO", centro, ejecutivo: "Nery", producto: "Grupal-Basico", saldo: 9000, cuota: 540 });
  d = await j(r);
  ok("un ejecutivo mal escrito se rechaza", !r.ok, JSON.stringify(d));
  ok("y el mensaje dice cuáles son válidos", !r.ok && /Neri/.test(d.error || ""), d.error);

  console.log("\n══════════════════════════════════");
  console.log(FAIL === 0 ? "✅✅ TODO PASÓ: " + PASS + " pruebas" : "❌ " + FAIL + " fallaron de " + (PASS + FAIL));
  process.exit(FAIL === 0 ? 0 : 1);
})();
