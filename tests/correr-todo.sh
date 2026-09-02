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
# Llave de cifrado SOLO para esta corrida desechable (documentos del
# expediente, ver cifrado.js). Nunca es la llave real de producción.
LLAVE_PRUEBA="$(node "$RAIZ/scripts/generar-llave-cifrado.js")"

DATA_DIR="$TMP/data" PORT=$PUERTO DOC_ENCRYPTION_KEY="$LLAVE_PRUEBA" node "$RAIZ/server.js" > "$LOG" 2>&1 &
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

# 4) La batería completa (cobranza) y las pruebas del expediente.
node "$RAIZ/tests/bateria_arqueo.js"
SALIDA_A=$?
echo ""
node "$RAIZ/tests/expediente.js"
SALIDA_B=$?

# 5) Motor de reglas. Va DESPUÉS de expediente.js a propósito: esta prueba
# cambia temporalmente el tope/checklist compartidos para probar que el
# cambio surte efecto de inmediato, y los revierte al final — pero si
# corriera ANTES, una revert fallida dejaría a expediente.js corriendo contra
# un tope distinto del que sus asserts asumen.
echo ""
node "$RAIZ/tests/reglas.js"
SALIDA_C=$?

SALIDA=0
[ $SALIDA_A -ne 0 ] && SALIDA=1
[ $SALIDA_B -ne 0 ] && SALIDA=1
[ $SALIDA_C -ne 0 ] && SALIDA=1

# 6) Persistencia tras reinicio — levanta y apaga su PROPIO servidor (puerto
# 3898, DATA_DIR desechable aparte) dos veces seguidas. No comparte el
# servidor de los pasos 3-5.
echo ""
node "$RAIZ/tests/reinicio_persistencia.js"
SALIDA_D=$?
[ $SALIDA_D -ne 0 ] && SALIDA=1

echo ""
if [ $SALIDA -eq 0 ]; then
  echo "✅ TODO EN VERDE — se puede subir."
else
  echo "❌ ALGO FALLÓ — NO subas hasta arreglarlo."
fi
exit $SALIDA
