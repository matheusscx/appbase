#!/usr/bin/env bash
# db-aislada.sh — un Postgres propio para el e2e de la API de ESTE worktree.
#
# Por qué existe: el stack del compose es uno solo (`tecnica_postgres`) y lo
# comparten todos los worktrees. Con varias sesiones en paralelo, el e2e de la
# API hacía fila por el Postgres, y cuando alguien se salteaba la fila pasaban
# dos cosas: el `synchronize` de una rama le borraba columnas a la otra
# (2026-09-18, `compra_linea_id` y `secuencia`), y el watcher del backend del
# compose re-sembraba en medio de una suite ajena.
#
# El e2e de la API NO usa el backend del compose: levanta su propia app en
# proceso contra el `DATABASE_URL` del `.env` de la raíz del worktree
# (`backend/test/setup-env.ts`), y esa app crea el esquema (`synchronize`) y
# siembra en su arranque. Así que lo único que hacía falta aislar era el
# Postgres. Este script le da a cada worktree el suyo, en su propio puerto.
#
# Por qué un contenedor por worktree y no varias bases en el mismo Postgres:
# hay specs que cuentan sesiones en `pg_stat_activity` sin filtrar por base
# (las compuertas de concurrencia). Con dos suites en el mismo cluster, cada
# una vería los locks en espera de la otra.
#
# Lo que NO cubre: el e2e de navegador (Playwright) y el smoke manual necesitan
# backend y frontend corriendo, así que siguen usando el stack del compose
# (`reset-db.sh`) con turno.
#
# Uso (desde cualquier carpeta del worktree):
#   ./scripts/db-aislada.sh reset <puerto>   crea o recrea el Postgres y apunta
#                                            el .env del worktree a él
#   ./scripts/db-aislada.sh estado           qué contenedor y puerto usa este worktree
#   ./scripts/db-aislada.sh borrar           baja el contenedor y devuelve el .env
#                                            al Postgres del compose
#
# Después de `reset`, `cd backend && npm run test:e2e` corre contra la base
# aislada. Cada `reset` es una base vacía: la primera suite que arranca la
# siembra, y es la única corrida válida (el estado que acumula el e2e no se
# limpia solo, igual que con el stack compartido).
set -euo pipefail

red() { printf '\033[31m%s\033[0m\n' "$1"; }
ylw() { printf '\033[33m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }

raiz="$(git rev-parse --show-toplevel)"
cd "$raiz"

# El checkout principal usa el stack del compose. Aislar ahí dejaría al
# `tecnica_backend` y a este script peleando por el mismo `.env`.
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
  red "✖ Esto es el checkout principal: usa el stack del compose (reset-db.sh)."
  ylw "  db-aislada.sh es para worktrees en .claude/worktrees/."
  exit 1
fi

slug="$(basename "$raiz" | tr -c 'a-zA-Z0-9_.-\n' '-')"
contenedor="pg_${slug}"
DB_USER=dev_user
DB_PASSWORD=dev_password_123
DB_NAME=tecnica_db
env_file="$raiz/.env"

url_para() { echo "postgresql://${DB_USER}:${DB_PASSWORD}@localhost:$1/${DB_NAME}"; }
url_compose="postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}"

# Reemplaza la línea DATABASE_URL del .env del worktree (o la agrega). El .env
# está en .gitignore: es local a este worktree y no viaja a ningún lado.
escribir_url() {
  local url="$1"
  if [ ! -f "$env_file" ]; then
    red "✖ No hay .env en ${raiz}."
    ylw "  Copialo del checkout principal: cp <checkout>/.env ${env_file}"
    exit 1
  fi
  local tmp
  tmp="$(mktemp)"
  grep -v '^DATABASE_URL=' "$env_file" > "$tmp" || true
  echo "DATABASE_URL=${url}" >> "$tmp"
  mv "$tmp" "$env_file"
}

url_actual() { grep '^DATABASE_URL=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- || true; }

case "${1:-}" in
  reset)
    puerto="${2:-}"
    if ! [[ "$puerto" =~ ^[0-9]+$ ]] || [ "$puerto" -le 5432 ] || [ "$puerto" -gt 5499 ]; then
      red "✖ Puerto inválido: '${puerto}'. Usá uno entre 5433 y 5499 (el 5432 es del compose)."
      exit 1
    fi
    # El puerto no puede ser de otro worktree. Si ya lo tiene ESTE contenedor,
    # es un reset normal.
    duenio="$(docker ps -a --filter "publish=${puerto}" --format '{{.Names}}' | head -1)"
    if [ -n "$duenio" ] && [ "$duenio" != "$contenedor" ]; then
      red "✖ El puerto ${puerto} ya lo usa '${duenio}'. Elegí otro."
      exit 1
    fi
    ylw "▶ Recreando ${contenedor} en el puerto ${puerto}…"
    docker rm -f "$contenedor" >/dev/null 2>&1 || true
    # tmpfs: la base vive en memoria. Es desechable a propósito —cada reset
    # empieza de cero— y así la suite no paga disco.
    docker run -d --name "$contenedor" \
      -p "${puerto}:5432" \
      -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      --tmpfs /var/lib/postgresql/data \
      --label startup-app.db-aislada="$raiz" \
      postgres:15-alpine >/dev/null
    ylw "▶ Esperando a que acepte conexiones…"
    espera=0
    # pg_isready solo no alcanza: el entrypoint de la imagen arranca un Postgres
    # temporal para inicializar y lo reinicia. Se espera a una consulta real
    # por TCP, que es lo que va a hacer la suite.
    until docker exec "$contenedor" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1; do
      if [ "$espera" -ge 60 ]; then
        red "✖ ${contenedor} no respondió en 60s. Últimas líneas:"
        docker logs --tail 20 "$contenedor" 2>&1
        exit 1
      fi
      sleep 1
      espera=$((espera + 1))
    done
    escribir_url "$(url_para "$puerto")"
    grn "✓ Postgres aislado listo: ${contenedor} en localhost:${puerto}, base vacía."
    ylw "  El .env de este worktree apunta ahí. La primera suite crea el esquema y siembra."
    ylw "  Corré: cd backend && npm run test:e2e"
    ;;
  estado)
    if docker inspect "$contenedor" >/dev/null 2>&1; then
      puerto="$(docker port "$contenedor" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://')"
      grn "✓ ${contenedor}: $(docker inspect -f '{{.State.Status}}' "$contenedor"), puerto ${puerto:-?}."
    else
      ylw "• Este worktree no tiene Postgres aislado (${contenedor} no existe)."
    fi
    echo "  .env → $(url_actual)"
    ;;
  borrar)
    docker rm -f "$contenedor" >/dev/null 2>&1 || true
    [ -f "$env_file" ] && escribir_url "$url_compose"
    grn "✓ ${contenedor} borrado; el .env volvió al Postgres del compose (con turno)."
    ;;
  *)
    red "✖ Uso: ./scripts/db-aislada.sh reset <puerto> | estado | borrar"
    exit 1
    ;;
esac
