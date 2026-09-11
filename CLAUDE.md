# FOOAX · Sistema de cobranza (Karina)

Cobranza en campo para FOOAX (SOFOM). Node stdlib + Express-like en `server.js`,
PostgreSQL en Railway (producción) o archivos `data/` (local). Apps offline-first
por ejecutiva en `apps/`, tablero de dirección en `public/tablero.html`.

- Producción: https://fooax-production.up.railway.app (deploy = push a `main`,
  Railway tarda ~2-3 min).
- Puerto local de pruebas: `PORT=3899 node server.js`.
- Burbuja de prueba: cuentas `prueba` / `pruebadir` (`test:true`) ven SOLO datos
  de prueba; los reales nunca se mezclan. Toda prueba contra producción va por
  esta burbuja.

## Pruebas — correr SIEMPRE antes de dar por bueno un cambio

1) **Smoke (`tests/smoke.js`)** — lo viejo de punta a punta. RE-EJECUTABLE
   (fecha única por corrida, no necesita datos limpios) y seguro contra
   producción (burbuja de prueba). Correr contra prod DESPUÉS DE CADA DEPLOY:

   ```bash
   node tests/smoke.js                                          # local 3899
   SMOKE_URL=https://fooax-production.up.railway.app node tests/smoke.js
   ```

2) **Batería (`tests/bateria_arqueo.js`)** — casos finos del arqueo (81+).
   SOLO local y necesita DATOS LIMPIOS antes de correr. **NO vacíes `data/`** — eso
   es cobranza de verdad. Usa una carpeta desechable con `DATA_DIR` (29-jul-2026):

   ```bash
   D=/tmp/fooax-prueba; rm -rf $D; mkdir -p $D; cp data/padron.json $D/
   cp data/padron_corte.json $D/ 2>/dev/null || true
   printf '{}' > $D/snapshots.json; printf '[]' > $D/movimientos.json
   printf '[]' > $D/padron_cambios.json; printf '{}' > $D/sesiones.json
   DATA_DIR=$D PORT=3899 node server.js &   # y en otra terminal:
   node tests/bateria_arqueo.js
   ```

   `padron_corte.json` se copia también (2-sep-2026): sin él, `aplicarCorteDeLaPlantilla()`
   nunca encuentra la plantilla al arrancar, ningun cambio de corte queda marcado
   `dePlantilla`, y la prueba "la cartera avisa del corte adelantado..." (seccion 71)
   falla siempre en este entorno -- no es un bug de codigo, es que faltaba este archivo
   en la carpeta desechable.

   El padrón se copia porque la batería lo necesita para arrancar. Al terminar, el
   servidor de trabajo y sus datos siguen intactos. Si algún día hay que vaciar
   `data/` de verdad, **respaldar primero** (`archivo.bak-FECHA`).

## Reducir dependencia del monolito `server.js` (arrancado 10-sep-2026)

`server.js` (8300+ líneas) mezcla en un solo archivo: rutas HTTP, acceso a datos
(`store.js`/Postgres) y la lógica de negocio pura (cálculos de garantías, mora,
amortización). Reescribirlo de golpe es riesgo alto en un sistema financiero en
producción sin CI más allá de `smoke.js`/`bateria_arqueo.js`. En su lugar, se
adopta un patrón "strangler fig": sacar la lógica de negocio pura a módulos
propios, uno a la vez, cada vez que de todos modos se está tocando ese dominio —
nunca como un refactor grande aparte.

- **Carpeta `dominios/`** (nueva): un archivo por dominio de negocio
  (`dominios/garantia_liquida.js`, y así sucesivamente conforme se toquen mora,
  amortización, etc.). Solo funciones puras o casi-puras: reciben datos, regresan
  datos, sin abrir `require('http')` ni definir rutas. Pueden llamar a
  `store.js` si su rol es justo eso (ej. `store.agregarMovimiento`), pero no
  conocen `req`/`res`.
- **`server.js` se queda con el "pegamento"**: parsear el request, validar
  forma básica, llamar a la función del dominio correspondiente, mandar la
  respuesta. Ninguna regla de cálculo nueva se escribe directo en un handler de
  `server.js` — si es lógica de negocio, va a `dominios/`.
- **Cuándo extraer:** oportunista, no una tarea aparte. Cada vez que se
  construye o corrige un CU, se extrae ESE dominio como parte del mismo PR (o
  un PR de limpieza inmediato sobre la misma rama, antes de mergear). No se
  hace una extracción masiva de todo `server.js` de una sola vez.
- **Checklist de toda extracción (es refactor puro, NUNCA cambia comportamiento):**
  1. Mover las funciones tal cual (mismos nombres, misma firma) a
     `dominios/<nombre>.js`; `server.js` las importa con `require(...)`.
  2. `node --check server.js` y `node --check dominios/<nombre>.js`.
  3. Correr primero la prueba unitaria del dominio si existe (contra el módulo
     directo, sin levantar servidor — más rápido y aísla el dominio).
  4. Correr `smoke.js` + `bateria_arqueo.js` (`DATA_DIR` desechable) completos
     y confirmar CERO cambio de números — si algo cambia, es que no fue un
     refactor puro y hay que revisar antes de commitear.
  5. El PR dice explícitamente "refactor sin cambio de comportamiento" y cita
     los resultados de las pruebas.
- **Beneficio esperado:** cada dominio se puede probar y entender sin arrancar
  el servidor completo, y `server.js` deja de crecer con lógica de cálculo
  nueva — solo enruta.

## Gotchas que ya nos mordieron (no reaprender)

- **La app manda el snapshot como TEXTO** (su localStorage tal cual), no como
  objeto. Toda prueba nueva del sync debe mandar `snapshot: JSON.stringify(...)`
  — la batería mandaba objetos y por eso el bug del 27-jul pasó 78 pruebas.
- **Movimientos nunca se borran**: se marcan `anulado` (rastro). Anular solo
  procede en sesión ABIERTA y con lista NO vacía (lista vacía = app recién
  abierta / sync rechazada / arranque, no un borrado).
- **Post-cierre**: la fusión suma contra `baseCerrada` (foto congelada del
  cierre); un nodo IDÉNTICO es re-envío (no se suma); "capturar todo de nuevo"
  = `/api/dia/reinicio` (archiva y reemplaza).
- **Zona horaria**: usar `hoyMX()` / fechas con `T12:00`; `new Date("YYYY-MM-DD")`
  es medianoche UTC = día anterior en México.
- Los sábados/lunes cuidar pruebas que dependan de "ayer en la misma semana".
- No es repo con CI: **respaldos `archivo.bak-FECHA`** antes de ediciones
  grandes a las apps (y sintaxis-check de su JS embebido tras cada edición).
- Los Excel se validan leyéndolos de vuelta con exceljs, no a ojo.
