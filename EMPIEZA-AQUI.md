# Empieza aquí

Sistema de cobranza de **FOOAX**, una SOFOM en Oaxaca. Cuatro ejecutivas cobran en la calle
con una app en el celular y Dirección lo ve todo desde un tablero.

**Esto ya está en producción y se usa todos los días.** Hay ~640 créditos vivos y una cartera
de **$4.6 millones de pesos**. Lo que subas hoy lo ven mañana cuatro personas cobrando dinero
real. Nada de lo que sigue es burocracia: es lo que evita que a una clienta se le pierda un
pago.

---

## Lo primero, sin excepción

```bash
npm install
npm test          # 259 pruebas + 4 de pantalla, sobre una copia desechable
```

Si `npm test` no está en verde, **el repo está roto y no es culpa tuya** — avísale a Karina
antes de tocar nada.

Para levantarlo local:

```bash
npm start         # http://localhost:3789
```

Sin `DATABASE_URL` usa los archivos de `data/`. En producción usa PostgreSQL.

---

## Las tres reglas

**1. `npm test` en verde ANTES de cada push.** No es un formalismo: cada prueba está ahí
porque algo se rompió de verdad y costó dinero. La batería exige datos limpios y el script ya
se encarga de eso.

**2. Un push a `main` se publica solo, en minutos.** Railway está conectado al repo. **No hay
ambiente de pruebas.** Si no estás seguro, trabaja en una rama y que Karina la revise.

**3. Nunca toques `data/` a mano.** Es cobranza de verdad. Para probar, el script ya hace una
copia desechable; si necesitas correr el servidor sobre datos de juguete:

```bash
DATA_DIR=/tmp/mis-datos PORT=3899 node server.js
```

---

## Cómo está armado

| Archivo | Qué es |
|---|---|
| `server.js` | Todo el backend. Express + PostgreSQL. Está seccionado con comentarios. |
| `store.js` | La capa de datos. Postgres en producción, archivos JSON en local. |
| `vistas/tablero.html` | El panel de Dirección. HTML + JS en un solo archivo, sin frameworks. |
| `apps/App_Cobranza_*.html` | Una app por ejecutiva. Funcionan **sin internet** y llevan el padrón escrito adentro. |
| `data/padron.json` | El padrón base. **Se reconstruye, no se edita**: al arrancar se siembra desde aquí y encima se aplican los cambios. |
| `tests/bateria_arqueo.js` | Las 259 pruebas de dinero. |
| `tests/tablero_render.js` | Que el tablero de verdad abra (el servidor puede estar bien y la pantalla en blanco). |
| `tests/smoke.js` | Contra producción: `npm run smoke`. |

**Sin dependencias nuevas y sin CDNs.** El navegador donde corre el tablero no tiene internet
garantizado. Todo lo que se ve está escrito a mano, incluidas las gráficas en SVG.

---

## Lo que hay que entender antes de tocar dinero

**La llave de un crédito es `socio + producto`.** Un dedazo en el nombre del producto crea un
crédito paralelo y el pago no le baja a nadie. Por eso el producto se elige de una lista, no
se escribe.

**`carteraViva()` es la ÚNICA fuente del saldo.** Si necesitas un saldo, sale de ahí. Cada vez
que alguien calculó uno por su cuenta salió mal — la última costó $21,587.

**El corte de saldos** es la fecha desde la que se descuentan los abonos. Existe porque el
saldo nace de una plantilla de Excel que manda FOOAX. Un abono anterior al corte **no
descuenta**, porque se supone que la plantilla ya lo traía. Hay una excepción ya resuelta: si
se captura después de fijar el corte, sí cuenta.

**Entrada o salida lo decide el TIPO, no el texto.** Un movimiento trae su tipo del menú.
Nunca leas el concepto para adivinar qué es — eso ya causó que liquidaciones no bajaran
saldos.

**La garantía NO se llama "ahorro", nunca.** FOOAX es una SOFOM E.N.R. y no está autorizada a
captar ahorro; esa palabra la expone legalmente. Hay una prueba que lo vigila.

---

## Los cuatro números que tienen que cuadrar

Si tocas algo de dinero, revisa que estos sigan bien en el tablero:

1. **Conciliación** (pestaña Cartera, hasta arriba): *todo lo cobrado está aplicado*.
2. **Arqueo del día**: lo contado contra lo que debe entregar cada ejecutiva.
3. **Cierre de la semana** (pestaña Caja): entró − salió = lo que queda el sábado.
4. **Cobros sin dueño**: debe estar en cero.

---

## Dónde está lo demás

- `CLAUDE.md` — contexto del proyecto para trabajar con Claude Code.
- **Vault de Obsidian** (con Karina) — las reglas de negocio, el glosario y la bitácora de por
  qué cada cosa está como está. Antes de discutir una cifra con FOOAX, búscala ahí.

**Si algo no te cuadra, pregúntale a Karina antes de cambiarlo.** Varias cosas que parecen
bugs son reglas del negocio que costó semanas entender.
