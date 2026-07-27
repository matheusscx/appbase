#!/usr/bin/env bash
# reset-db.sh — deja la base en estado limpio y verificado para correr el e2e.
#
# Por qué existe: el e2e local se contamina solo. Correr `npm run test:e2e` dos
# veces seguidas deja cajas abiertas, causas duplicadas y stock agotado, y los
# números de la 2da corrida NO son válidos. La única corrida que vale es la
# primera sobre una base recién sembrada.
#
# Qué hace, en orden:
#   1. Verifica que apunta a la base del compose local (nunca a una remota).
#   2. `down -v` — destruye el volumen. Es seguro acá: el proyecto no tiene
#      datos productivos (decisión registrada del owner).
#   3. `up -d` y espera el `Seed complete` del backend en los logs.
#   4. Verifica que haya EXACTAMENTE uno: dos seeds significan que el contenedor
#      reinició y la base ya acumuló estado.
#
# Esperar el `Seed complete` es el punto entero del script: el contenedor
# levanta antes de que el seed termine, y una suite que arranca a mitad del seed
# falla con errores que no son regresiones.
#
# Uso:  ./scripts/reset-db.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
ylw() { printf '\033[33m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }

# ── 1. Resguardo: solo la base del compose local ─────────────────────────────
# Si alguien apuntó .env a una base real, `down -v` no la tocaría (borra el
# volumen de Docker, no la remota), pero el script mentiría sobre el estado.
# Mejor negarse que dejar correr un e2e contra datos ajenos.
if [ -f .env ] && grep -q '^DATABASE_URL=' .env; then
  url=$(grep '^DATABASE_URL=' .env | head -1)
  case "$url" in
    *@postgres:*|*@localhost:*|*@127.0.0.1:*) ;;
    *)
      red "✖ DATABASE_URL no apunta al Postgres del compose local."
      ylw "  $url"
      ylw "  Este script borra volúmenes: no corre contra una base ajena."
      exit 1
      ;;
  esac
fi

# ── 2. Elegir el binario de compose (v2 plugin o v1 standalone) ──────────────
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  red "✖ No encontré ni 'docker compose' ni 'docker-compose'."
  exit 1
fi

# ── 3. Reset ─────────────────────────────────────────────────────────────────
# compose escribe su progreso a stderr: se guarda y solo se muestra si falla,
# para que la salida del script sea legible.
log=$(mktemp)
trap 'rm -f "$log"' EXIT

run() {
  if ! "$@" >"$log" 2>&1; then
    red "✖ Falló: $*"
    cat "$log"
    exit 1
  fi
}

ylw "▶ Bajando el stack y borrando el volumen…"
run compose down -v

ylw "▶ Levantando…"
run compose up -d

# ── 4. Esperar el seed ───────────────────────────────────────────────────────
ylw "▶ Esperando 'Seed complete' del backend…"
timeout=180
elapsed=0
until [ "$(docker logs tecnica_backend 2>&1 | grep -c 'Seed complete')" -ge 1 ]; do
  if [ "$elapsed" -ge "$timeout" ]; then
    red "✖ El backend no sembró en ${timeout}s. Últimas líneas:"
    docker logs --tail 20 tecnica_backend 2>&1
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

seeds=$(docker logs tecnica_backend 2>&1 | grep -c 'Seed complete')
if [ "$seeds" -ne 1 ]; then
  red "✖ Hay ${seeds} 'Seed complete': el contenedor reinició y la base ya acumuló estado."
  ylw "  Volvé a correr este script antes de confiar en un e2e."
  exit 1
fi

grn "✓ Base limpia y sembrada (1 seed, ${elapsed}s). El e2e que corras ahora es válido."
