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
   SOLO local y necesita DATOS LIMPIOS antes de correr:

   ```bash
   printf '{}' > data/snapshots.json; printf '[]' > data/movimientos.json
   printf '[]' > data/padron_cambios.json; rm -f data/snapshots_hist.jsonl
   # reiniciar el servidor y luego:
   node tests/bateria_arqueo.js
   ```

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
