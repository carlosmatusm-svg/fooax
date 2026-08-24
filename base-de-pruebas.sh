#!/usr/bin/env bash
# LA BASE DE PRUEBAS PARA DESARROLLAR (Karina, 24-ago-2026).
#
#   ./base-de-pruebas.sh            → arranca el servidor de pruebas
#   ./base-de-pruebas.sh --fresca   → regenera la base desde data/ y arranca
#
# Qué es: una COPIA de la cartera real (data/ → data-pruebas/) con la
# cobranza del día vaciada, corriendo en su propio servidor en el puerto
# 3900. Ahí se desarrolla y se rompe lo que haga falta:
#   · NUNCA toca data/ (la operación real de la Mac)
#   · NUNCA toca producción (Railway ni se entera)
#   · no está en git (data-pruebas/ va en .gitignore)
#
# Entrar: http://localhost:3900
#   Dirección:  monse / monse2026        (ve la cartera copiada completa)
#   Ejecutivas: neri / neri2026 · karina / karina2026
#               christopher / chris2026 · julio / julio2026
#   Burbuja aparte: prueba / PruebaFOOAX2026 · pruebadir / PruebaFOOAX2026
#
# La base trae los 638 créditos vivos con sus productos reales (Grupal-Basico,
# FOXI/Individual, Foxi Plus, MAGNUS, COMADRE, reestructuras…): todo lo que el
# motor, el puente y los reportes necesitan para probarse de verdad.
#
# Para empezar de cero otra vez: ./base-de-pruebas.sh --fresca
set -u
RAIZ="$(cd "$(dirname "$0")" && pwd)"
BASE="$RAIZ/data-pruebas"
PUERTO=3900

if [ "${1:-}" = "--fresca" ] || [ ! -d "$BASE" ]; then
  echo "→ Regenerando la base de pruebas desde data/ …"
  rm -rf "$BASE"
  cp -R "$RAIZ/data" "$BASE"
  # La cobranza del día empieza limpia: el padrón y los saldos se quedan.
  printf '{}' >  "$BASE/snapshots.json"
  printf '[]' >  "$BASE/movimientos.json"
  printf '[]' >  "$BASE/padron_cambios.json"
  rm -f "$BASE/snapshots_hist.jsonl"
  # Los respaldos .bak no hacen falta en pruebas.
  find "$BASE" -name "*.bak*" -delete 2>/dev/null
  echo "   listo: $(ls "$BASE" | wc -l | tr -d ' ') archivos."
fi

if lsof -ti:$PUERTO >/dev/null 2>&1; then
  echo "⚠ El puerto $PUERTO ya está ocupado (¿ya está corriendo?). Para matarlo:"
  echo "    lsof -ti:$PUERTO | xargs kill -9"
  exit 1
fi

echo "→ Servidor de PRUEBAS en http://localhost:$PUERTO   (Ctrl+C para parar)"
echo "  Dirección: monse / monse2026 · la base vive en data-pruebas/"
DATA_DIR="$BASE" PORT=$PUERTO exec node "$RAIZ/server.js"
