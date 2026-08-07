#!/usr/bin/env bash
# TODAS LAS PRUEBAS, DE UN SOLO COMANDO:  npm test
#
# Levanta un servidor de prueba sobre una COPIA DESECHABLE de los datos, corre
# todo y limpia. Nunca toca `data/`, que es cobranza de verdad.
#
# Existe porque la batería necesita datos limpios y un servidor en el 3899, y
# eso antes había que armarlo a mano cada vez — un paso que se olvida justo
# cuando más prisa hay.
set -u
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PUERTO=3899
LOG="$TMP/servidor.log"

limpiar() {
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null
  rm -rf "$TMP"
}
trap limpiar EXIT

echo ""
echo "═══ PRUEBAS DE FOOAX ═══"

# 1) LA PANTALLA. No necesita servidor y es la más rápida: si el tablero no
#    compila, no tiene caso correr lo demás.
echo ""
node "$RAIZ/tests/tablero_render.js" || exit 1

# 2) Copia desechable de los datos. La batería EXIGE datos limpios: no es
#    re-ejecutable sobre un día ya cerrado (la fusión post-cierre sumaría las
#    corridas y daría faltantes falsos).
cp -R "$RAIZ/data" "$TMP/data"
printf '{}' > "$TMP/data/snapshots.json"
printf '[]' > "$TMP/data/movimientos.json"
printf '[]' > "$TMP/data/padron_cambios.json"
rm -f "$TMP/data/snapshots_hist.jsonl"

# 3) El servidor, sobre esa copia. Sin DATABASE_URL usa archivos, no Postgres.
if lsof -ti:$PUERTO >/dev/null 2>&1; then
  echo ""
  echo "  ⚠ El puerto $PUERTO está ocupado. Ciérralo y vuelve a correr:"
  echo "      lsof -ti:$PUERTO | xargs kill -9"
  exit 1
fi
DATA_DIR="$TMP/data" PORT=$PUERTO node "$RAIZ/server.js" > "$LOG" 2>&1 &
PID=$!

# Esperar a que responda. El arranque corre reparaciones y puede tardar.
for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://localhost:$PUERTO/api/health" && break
  sleep 0.5
done
if ! curl -s -o /dev/null "http://localhost:$PUERTO/api/health"; then
  echo "  ❌ El servidor no arrancó. Últimas líneas:"
  tail -15 "$LOG"
  exit 1
fi

# 4) La batería completa.
node "$RAIZ/tests/bateria_arqueo.js"
SALIDA=$?

echo ""
if [ $SALIDA -eq 0 ]; then
  echo "✅ TODO EN VERDE — se puede subir."
else
  echo "❌ ALGO FALLÓ — NO subas hasta arreglarlo."
fi
exit $SALIDA
