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
#   5. Espera a que el backend quede QUIETO antes de devolver el control.
#
# Esperar el `Seed complete` es el punto entero del script: el contenedor
# levanta antes de que el seed termine, y una suite que arranca a mitad del seed
# falla con errores que no son regresiones.
#
# Por qué además espera a que quede quieto (paso 5). El compose corre el backend
# con `npm run start:dev` y el fuente bind-mounteado (`./backend:/app`), así que
# **cada cambio de un `.ts` lo recompila, lo reinicia y VUELVE A SEMBRAR** —
# medido el 2026-08-06: crear un archivo `.ts` llevó el contador de
# `Seed complete` de 1 a 2, y borrarlo a 3. Si eso pasa con la suite en vuelo, el
# seed escribe encima y salen decenas de fallos repartidos que no son
# regresiones (visto dos veces el 2026-07-28: 42 y 46 fallos, verde al repetir).
# El e2e **no usa este contenedor** —levanta su propia app en proceso— así que el
# backend del compose no le aporta nada a la suite: solo puede contaminarla.
#
# Uso:
#   ./scripts/reset-db.sh              reset completo (antes del e2e)
#   ./scripts/reset-db.sh --verificar  NO resetea; dice si la corrida que acabás
#                                      de hacer es válida o si algo re-sembró
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
ylw() { printf '\033[33m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }

# `|| true`: `grep -c` sale 1 cuando no hay match, y con `set -e` eso mataba el
# script **sin imprimir nada** (contenedor caído, docker apagado, o
# `NODE_ENV=production`, donde el seeder retorna antes de loguear). Devolver 0 y
# diagnosticarlo arriba es la diferencia entre un mensaje y una terminal vacía.
seeds() { docker logs tecnica_backend 2>&1 | grep -c 'Seed complete' || true; }

# Identidad de la INSTANCIA del contenedor, no del nombre. `docker logs` es por
# instancia: si el contenedor se recrea (`--build`, `--force-recreate`, un
# cambio de `.env`), el log arranca de cero y el contador vuelve a 1 aunque la
# base haya sido re-sembrada encima del mismo volumen. Sin esto, `--verificar`
# daba VERDE justo en el caso que existe para detectar (medido, 2026-08-06).
cid() { docker inspect -f '{{.Id}}' tecnica_backend 2>/dev/null || true; }

# `--git-common-dir` y no `.git` a secas: en un **worktree enlazado** `.git` es un
# ARCHIVO, no un directorio, así que escribir `.git/algo` falla con "Not a
# directory" y —al ser la última línea del reset— mataba el script después de
# haber hecho todo bien, sin registrar el Id y sin imprimir el verde. El
# `--verificar` siguiente caía en "no hay registro": la detección de recreación
# quedaba apagada **en silencio**, justo en el contexto que el proyecto usa para
# verificar sin `git stash`.
# Y es `--git-common-dir` y no `--git-dir` porque `tecnica_backend` es UNO SOLO
# para todos los worktrees: el registro tiene que ser compartido.
ESTADO="$(git rev-parse --git-common-dir)/reset-db.estado"

sin_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    red "✖ No encontré 'docker' en el PATH."
    exit 1
  fi
  if [ -z "$(cid)" ]; then
    red "✖ El contenedor 'tecnica_backend' no existe o docker no responde."
    ylw "  Levantá el stack (docker-compose up -d) antes de verificar."
    exit 1
  fi
}

# ── Modo verificación: se corre DESPUÉS del e2e ──────────────────────────────
# No toca nada. Solo responde la pregunta que un e2e con fallos raros deja
# abierta: ¿la base se movió abajo de la suite? Sin esto, la respuesta cuesta
# una sesión de forense sobre fallos que no son regresiones.
#
# ⚠️ Lo que mide y lo que NO. Detecta que el backend haya vuelto a sembrar
# —por el watcher o por una recreación del contenedor— desde el último reset.
# **No** dice nada del estado que acumula el propio e2e: correr la suite dos
# veces seguidas deja cajas abiertas y stock agotado, y eso este comando no lo
# ve (ver el encabezado del script).
if [ "${1:-}" = "--verificar" ]; then
  sin_docker
  n=$(seeds)
  actual=$(cid)
  previo=""
  [ -f "$ESTADO" ] && previo=$(cat "$ESTADO")

  if [ -z "$previo" ]; then
    # Sale distinto de 0 A PROPÓSITO. Acá el comando está admitiendo que **no
    # puede responder**, y un exit 0 es lo que lee un script o una mirada
    # rápida: sería un verde falso justo en la rama donde no hay evidencia.
    # "No sé" tiene que doler igual que "no", no parecerse a "sí".
    red "✖ No puedo verificar: no hay registro de un reset previo."
    ylw "  (${ESTADO} no existe o está vacío.) Cuento ${n} 'Seed complete',"
    ylw "  pero sin saber de qué contenedor son, ese número no prueba nada."
    ylw "  Corré ./scripts/reset-db.sh y el e2e en la misma sesión."
    exit 2
  fi
  if [ "$actual" != "$previo" ]; then
    red "✖ El contenedor del backend fue RECREADO desde el reset."
    ylw "  Su log arrancó de cero, así que el contador de seeds no sirve como"
    ylw "  evidencia: la base pudo re-sembrarse sobre el mismo volumen."
    ylw "  Tratá la corrida como inválida: reset-db.sh y el e2e de nuevo."
    exit 1
  fi
  if [ "$n" -eq 1 ]; then
    grn "✓ Mismo contenedor y 1 solo 'Seed complete': la base no se re-sembró."
    exit 0
  fi
  red "✖ Hay ${n} 'Seed complete': el backend re-sembró DESPUÉS del reset."
  ylw "  Alguien tocó un .ts y el watcher del contenedor reinició el backend"
  ylw "  encima de la suite. Los fallos que viste probablemente no son"
  ylw "  regresiones: volvé a correr reset-db.sh y el e2e, sin tocar fuentes."
  exit 1
fi

# Cualquier otra cosa que un flag conocido: NO caer al camino destructivo. Un
# `--verify` mal tipeado después del e2e haría `down -v` y borraría justo la
# base que se quería peritar.
if [ -n "${1:-}" ]; then
  red "✖ Opción desconocida: $1"
  ylw "  Uso: ./scripts/reset-db.sh [--verificar]"
  exit 1
fi

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
until [ "$(seeds)" -ge 1 ]; do
  if [ "$elapsed" -ge "$timeout" ]; then
    red "✖ El backend no sembró en ${timeout}s. Últimas líneas:"
    docker logs --tail 20 tecnica_backend 2>&1
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

n=$(seeds)
if [ "$n" -ne 1 ]; then
  red "✖ Hay ${n} 'Seed complete': el contenedor reinició y la base ya acumuló estado."
  ylw "  Volvé a correr este script antes de confiar en un e2e."
  exit 1
fi

# ── 5. Esperar a que el backend quede quieto ─────────────────────────────────
# Una recompilación disparada por un cambio ANTERIOR al reset puede seguir en
# vuelo: si aterriza con la suite corriendo, re-siembra encima. Se espera a que
# el log no crezca por unos segundos y recién ahí se devuelve el control.
ylw "▶ Esperando a que el backend quede quieto…"
quieto=0
espera=0
espera_max=60
# Misma protección que `seeds()`: con `pipefail`, un `docker logs` que falle a
# mitad de la espera (contenedor removido) mataría el script mudo.
lineas_log() { docker logs tecnica_backend 2>&1 | wc -l | tr -d ' ' || true; }
lineas_prev=$(lineas_log)
while [ "$quieto" -lt 6 ]; do
  # Timeout propio: `restart: unless-stopped` en el compose significa que un
  # backend en crash-loop escribe log para siempre, y sin esto el script quedaba
  # colgado en silencio — peor que fallar, porque es el paso que el checklist
  # manda correr antes de cada e2e.
  if [ "$espera" -ge "$espera_max" ]; then
    red "✖ El backend no se queda quieto (${espera_max}s de log continuo)."
    ylw "  Puede estar en crash-loop o recompilando sin parar. Últimas líneas:"
    docker logs --tail 20 tecnica_backend 2>&1
    exit 1
  fi
  sleep 2
  espera=$((espera + 2))
  elapsed=$((elapsed + 2))
  lineas=$(lineas_log)
  if [ "$lineas" -eq "$lineas_prev" ]; then
    quieto=$((quieto + 2))
  else
    quieto=0
    lineas_prev=$lineas
  fi
done

n=$(seeds)
if [ "$n" -ne 1 ]; then
  red "✖ El backend volvió a sembrar mientras se esperaba (${n} 'Seed complete')."
  ylw "  Hay un cambio de fuente en vuelo. Esperá a que compile y repetí."
  exit 1
fi

# Se registra la instancia del contenedor para que `--verificar` pueda detectar
# una recreación posterior, que resetea el log y volvería invisible una
# re-siembra.
cid > "$ESTADO"

grn "✓ Base limpia y sembrada (1 seed, ${elapsed}s). El e2e que corras ahora es válido."
ylw "  Si el e2e falla raro: ./scripts/reset-db.sh --verificar dice si la base se movió."
