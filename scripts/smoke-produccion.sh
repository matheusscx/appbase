#!/usr/bin/env bash
# smoke-produccion.sh — pregunta si el demo de Railway FUNCIONA, no si arrancó.
#
# Verifica **el deployment que está sirviendo ahora**, que es distinto de lo que
# mira el healthcheck: éste corre una sola vez, durante la promoción del deploy.
# Una base que se cae dos horas después no la ve nadie.
#
# Las tres preguntas, en orden de lo que descartan:
#   1. `GET /api/health` → 200. Proceso arriba **y** base contestando: la ruta
#      consulta `usuarios` (ver `app.service.ts`). Es la misma que usa el
#      `healthcheckPath` de `backend/railway.json`.
#   2. `POST /api/auth/login` con credenciales inventadas → **401, no 500**.
#      Agrega lo que el healthcheck no toca: una request real de punta a punta
#      —pipe de validación, DTO, controller, service— y no una query suelta. Un
#      500 acá es el síntoma de la base desenganchada; un 401 es el éxito.
#   3. `GET /` del frontend → 200.
#
# ⚠️ Lo que NO prueba: **cuál** deployment midió. Railway despliega en paralelo
# al CI (ver `docs/ARCHITECTURE.md` § Demo en Railway), así que correr esto justo
# después de un `git push` puede estar midiendo el deployment ANTERIOR y dar un
# verde que no corresponde al commit que acabás de subir. Correrlo recién cuando
# `railway deployment list --service backend --json` diga SUCCESS.
#
# Uso:
#   ./scripts/smoke-produccion.sh
#   BACKEND_URL=... FRONTEND_URL=... ./scripts/smoke-produccion.sh
set -uo pipefail

BACKEND_URL="${BACKEND_URL:-https://backend-production-8635.up.railway.app}"
FRONTEND_URL="${FRONTEND_URL:-https://frontend-production-c0db.up.railway.app}"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }

fallos=0

# `--max-time`: sin esto un servicio colgado deja el script esperando para
# siempre y el smoke deja de ser un semáforo.
codigo() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

echo "Backend:  $BACKEND_URL"
echo "Frontend: $FRONTEND_URL"
echo

# --- 1. Proceso arriba y base contestando ------------------------------------
http=$(codigo "$BACKEND_URL/api/health")
if [[ "$http" == "200" ]]; then
  grn "✓ backend + base          GET /api/health → 200"
elif [[ "$http" == "503" ]]; then
  red "✗ backend + base          GET /api/health → 503 (el proceso vive, la base no responde)"
  red "  Mirá si Postgres está arriba y si el backend tiene DATABASE_URL."
  red "  Skill: railway-sync-db."
  fallos=$((fallos + 1))
else
  red "✗ backend + base          GET /api/health → ${http:-sin respuesta} (se esperaba 200)"
  fallos=$((fallos + 1))
fi

# --- 2. Una request real de punta a punta ------------------------------------
# El email usa el TLD reservado `.invalid` (RFC 2606): no puede colisionar con un
# usuario real ni ahora ni nunca. El login no tiene rate limiting ni bloqueo por
# intentos fallidos (verificado 2026-08-09), así que repetir el smoke es inocuo.
http=$(codigo -X POST "$BACKEND_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@no-existe.invalid","password":"clave-que-no-existe"}')
case "$http" in
  401)
    grn "✓ request de punta a punta  POST /api/auth/login → 401"
    ;;
  500 | 502 | 503 | 504)
    red "✗ request de punta a punta  POST /api/auth/login → $http"
    red "  El proceso está vivo pero la request muere antes de contestar."
    fallos=$((fallos + 1))
    ;;
  *)
    red "✗ request de punta a punta  POST /api/auth/login → ${http:-sin respuesta} (se esperaba 401)"
    fallos=$((fallos + 1))
    ;;
esac

# --- 3. El frontend sirve ----------------------------------------------------
http=$(codigo "$FRONTEND_URL/")
if [[ "$http" == "200" ]]; then
  grn "✓ frontend sirve          GET / → 200"
else
  red "✗ frontend sirve          GET / → ${http:-sin respuesta} (se esperaba 200)"
  fallos=$((fallos + 1))
fi

echo
if [[ "$fallos" -eq 0 ]]; then
  grn "Demo operativo."
else
  red "$fallos verificación(es) fallida(s) — el demo NO está operativo."
  exit 1
fi
