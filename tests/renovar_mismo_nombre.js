// RENOVAR CON EL MISMO NOMBRE DE CRÉDITO (regla Karina 25-jul-2026).
// Una clienta que liquidó su "Grupal-Basico" debe poder renovarlo con ESE MISMO
// nombre, sin el "2" pegado. Corre contra el servidor local (3899).
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

(async () => {
  const ca = await login("anel", "anel2026");
  const cm = await login("monse", "monse2026");
  const buscar = async (id) => (await j(await fetch(U + "/api/creditos?q=" + id, { headers: H(ca) }))).resultados || [];

  // Centro real del padrón, para que el alta pase la validación de centro.
  const centro = (await j(await fetch(U + "/api/centros", { headers: H(ca) }))).centros?.[0]?.centro
    || (await j(await fetch(U + "/api/clientes", { headers: H(ca) }))).centros?.[0];

  console.log("\n— RENOVAR CON EL MISMO NOMBRE —");

  // 1) Clienta nueva con un Grupal-Basico LIQUIDADO (saldo 0).
  const ID = "99900011122";
  await post(cm, "/api/clientes/alta", {
    id: ID, nombre: "PRUEBA RENOVACION", centro, ejecutivo: "Neri",
    producto: "Grupal-Basico", saldo: 0, cuota: 570,
  });
  let lista = await buscar(ID);
  ok("la clienta queda con su Grupal-Basico liquidado", lista.length === 1 && lista[0].producto === "Grupal-Basico",
    JSON.stringify(lista.map((c) => c.producto)));

  // 2) EL CASO: renovar con el MISMO nombre. Antes esto se rechazaba.
  let r = await post(ca, "/api/creditos/recredito", {
    id: ID, nombre: "PRUEBA RENOVACION", centro, ejecutivo: "Neri",
    producto: "Grupal-Basico", saldo: 12000, cuota: 720,
  });
  let d = await j(r);
  ok("renovar con el MISMO nombre AHORA se acepta", r.ok, d.error);
  ok("avisa que cerró el ciclo anterior", d.cerroAnterior === "Grupal-Basico", JSON.stringify(d.cerroAnterior));

  // 3) Lo crítico: queda UN SOLO crédito activo, y es el nuevo.
  lista = await buscar(ID);
  const activos = lista.filter((c) => c.activa !== false && c.estatus !== "BAJA");
  ok("queda UN solo Grupal-Basico activo (no dos)", activos.length === 1,
    "activos=" + activos.length + " " + JSON.stringify(activos.map((c) => c.producto + ":" + c.saldo)));
  ok("y es el ciclo NUEVO ($12,000, no el viejo)", activos.length === 1 && activos[0].saldo === 12000,
    JSON.stringify(activos.map((c) => c.saldo)));
  ok("la clienta NO desapareció del padrón", activos.length > 0);

  // 4) La protección de verdad sigue viva: con saldo pendiente, NO se deja.
  const ID2 = "99900011133";
  await post(cm, "/api/clientes/alta", {
    id: ID2, nombre: "PRUEBA CON DEUDA", centro, ejecutivo: "Neri",
    producto: "Grupal-Basico", saldo: 8000, cuota: 570,
  });
  r = await post(ca, "/api/creditos/recredito", {
    id: ID2, nombre: "PRUEBA CON DEUDA", centro, ejecutivo: "Neri",
    producto: "Grupal-Basico", saldo: 12000, cuota: 720,
  });
  d = await j(r);
  ok("con saldo PENDIENTE se sigue rechazando (no se revuelven pagos)", !r.ok, JSON.stringify(d));
  ok("y el mensaje dice cuánto debe", !r.ok && /saldo de 8000/.test(d.error || ""), d.error);

  // 5) Con OTRO nombre sigue funcionando como siempre (dos créditos a la vez).
  r = await post(ca, "/api/creditos/recredito", {
    id: ID2, nombre: "PRUEBA CON DEUDA", centro, ejecutivo: "Neri",
    producto: "Grupal-Micro", saldo: 12000, cuota: 720,
  });
  ok("con OTRO nombre sí convive con el que tiene saldo", r.ok, JSON.stringify(await j(r)));
  lista = await buscar(ID2);
  ok("y quedan los DOS créditos activos", lista.filter((c) => c.activa !== false && c.estatus !== "BAJA").length === 2,
    JSON.stringify(lista.map((c) => c.producto)));

  console.log("\n══════════════════════════════════");
  console.log(FAIL === 0 ? "✅✅ TODO PASÓ: " + PASS + " pruebas" : "❌ " + FAIL + " fallaron de " + (PASS + FAIL));
  process.exit(FAIL === 0 ? 0 : 1);
})();
