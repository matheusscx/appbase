#!/bin/bash
# Caza del `timeout exceeded when trying to connect` con la sonda correlacionada.
# ⛔ Al primer positivo FRENA y NO resetea: `reset-db.sh` hace `down -v` y se lleva
#    el contenedor y el log de Postgres, que es la mitad de servidor de la pericia.
set -u
RAIZ=/Users/m2pro/cmatheus/startup-app
S=${CAZA_SALIDA:-/tmp/caza-timeout-pool}
mkdir -p "$S"
JSONL=$RAIZ/backend/test/tmp-pool.jsonl
N=${1:-20}

for ((i=1;i<=N;i++)); do
  echo "=== vuelta $i/$N — $(date -u +%FT%TZ) ==="
  cd "$RAIZ" && ./scripts/reset-db.sh >"$S/reset-$i.log" 2>&1 || { echo "RESET FALLÓ en la vuelta $i"; exit 2; }
  ANTES=$(wc -l < "$JSONL")
  cd "$RAIZ/backend" && npm run test:e2e >"$S/e2e-$i.log" 2>&1
  E2E=$?
  NUEVAS=$(tail -n +$((ANTES+1)) "$JSONL")
  CAZADO=$(printf '%s' "$NUEVAS" | grep -c 'timeout exceeded when trying to connect')
  RESUMEN=$(grep -E '^Tests:' "$S/e2e-$i.log" | tail -1)
  echo "  e2e=$E2E  timeouts=$CAZADO  $RESUMEN"
  if [ "$CAZADO" -gt 0 ] || [ "$E2E" -ne 0 ]; then
    echo "*** POSITIVO en la vuelta $i — NO se resetea, el contenedor queda para peritar ***"
    printf '%s\n' "$NUEVAS" > "$S/CAPTURA-vuelta-$i.jsonl"
    docker logs tecnica_postgres > "$S/CAPTURA-postgres-$i.log" 2>&1
    cd "$RAIZ" && ./scripts/reset-db.sh --verificar > "$S/CAPTURA-verificar-$i.log" 2>&1
    exit 1
  fi
done
echo "=== $N vueltas limpias, ningún timeout ==="
