// PRODUCTO ELEGIDO DE LISTA, NO ESCRITO A MANO (regla Karina 25-jul-2026).
// El tipo de crédito se pica de un menú; abajo se puede dar de alta uno nuevo.
// Lo que se prueba: que la lista traiga los productos reales, que un producto
// nuevo QUEDE GUARDADO y aparezca en la lista, y que un nombre escrito con otra
// puntuación NO cree un producto gemelo. Corre contra el servidor local (3899).
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
  const listas = async () => j(await fetch(U + "/api/centros", { headers: H(ca) }));
  let d = await listas();
  const centro = d.centros[0].centro;
  const nombres = (x) => (x.productos || []).map((p) => p.producto);

  console.log("\n— LA LISTA DE PRODUCTOS —");
  ok("el tablero recibe la lista de productos", Array.isArray(d.productos) && d.productos.length > 0,
    JSON.stringify(d.productos));
  ok("trae los tipos reales del padrón (Grupal-Basico)", nombres(d).includes("Grupal-Basico"), JSON.stringify(nombres(d)));
  ok("el más usado va primero (para picarlo rápido)", d.productos[0].producto === "Grupal-Basico",
    JSON.stringify(d.productos.slice(0, 3)));
  ok("cada uno dice cuántos créditos tiene", d.productos[0].creditos > 0, JSON.stringify(d.productos[0]));

  console.log("\n— PRODUCTO GEMELO POR DEDAZO (lo que ya pasó con Foxi Plus) —");
  const antes = nombres(await listas()).length;
  const ID = "99900033301";
  let r = await post(cm, "/api/clientes/alta", {
    id: ID, nombre: "PRUEBA GEMELO", centro, ejecutivo: "Neri",
    producto: "grupal basico", saldo: 5000, cuota: 300,   // mismo producto, mal escrito
  });
  d = await j(r);
  ok("un producto mal escrito SÍ se acepta…", r.ok, d.error);
  ok("…pero se guarda con el nombre bueno (Grupal-Basico)", d.clienta && d.clienta.producto === "Grupal-Basico",
    d.clienta && d.clienta.producto);
  ok("y NO nació un producto gemelo en la lista", nombres(await listas()).length === antes,
    JSON.stringify(nombres(await listas())));

  console.log("\n— DAR DE ALTA UN PRODUCTO NUEVO —");
  const ID2 = "99900033302";
  r = await post(cm, "/api/clientes/alta", {
    id: ID2, nombre: "PRUEBA PROD NUEVO", centro, ejecutivo: "Neri",
    producto: "Grupal-Especial", saldo: 7000, cuota: 400,
  });
  d = await j(r);
  ok("se acepta un producto que no existía", r.ok, d.error);
  ok("se guarda tal cual se escribió", d.clienta && d.clienta.producto === "Grupal-Especial", d.clienta && d.clienta.producto);
  const listaDespues = nombres(await listas());
  ok("YA APARECE en la lista del tablero", listaDespues.includes("Grupal-Especial"), JSON.stringify(listaDespues));

  console.log("\n— SIN TIPO DE CRÉDITO —");
  r = await post(cm, "/api/clientes/alta", {
    id: "99900033303", nombre: "PRUEBA SIN PROD", centro, ejecutivo: "Neri",
    producto: "  ", saldo: 1000, cuota: 100,
  });
  d = await j(r);
  ok("un alta sin tipo de crédito se rechaza", !r.ok, JSON.stringify(d));

  console.log("\n— EN EL RE-DAR CRÉDITO TAMBIÉN —");
  const ID3 = "99900033304";
  await post(cm, "/api/clientes/alta", { id: ID3, nombre: "PRUEBA REC PROD", centro, ejecutivo: "Neri", producto: "Grupal-Micro", saldo: 0, cuota: 200 });
  r = await post(ca, "/api/creditos/recredito", {
    id: ID3, nombre: "PRUEBA REC PROD", centro, ejecutivo: "Neri",
    producto: "GRUPAL   MICRO", saldo: 9000, cuota: 500,   // mismo, mal escrito
  });
  d = await j(r);
  ok("el recrédito también corrige el nombre", r.ok && d.clienta.producto === "Grupal-Micro",
    JSON.stringify(d.clienta && d.clienta.producto) + " " + (d.error || ""));
  ok("y por eso cerró el ciclo anterior (lo reconoció como el mismo)", d.cerroAnterior === "Grupal-Micro",
    JSON.stringify(d.cerroAnterior));

  console.log("\n══════════════════════════════════");
  console.log(FAIL === 0 ? "✅✅ TODO PASÓ: " + PASS + " pruebas" : "❌ " + FAIL + " fallaron de " + (PASS + FAIL));
  process.exit(FAIL === 0 ? 0 : 1);
})();
