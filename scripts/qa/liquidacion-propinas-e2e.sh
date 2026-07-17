#!/usr/bin/env bash
# liquidacion-propinas-e2e.sh — suite funcional E2E (Chrome DevTools + fixtures SQL).
#
# Crea tips/ventas/sesión en runtime (seed Paris no trae venta_propina),
# luego ejercita UI: crear borrador → excluir → confirmar → 2ª liquidación → anular.
#
# Prerrequisitos:
#   npm i -g chrome-devtools-mcp@latest
#   chrome-devtools start --headless=false
#   frontend :5173 + API :3000 con seed (admin@sistema.com / admin)
#   Postgres accesible en localhost:5432 (docker-compose)
#
# Uso:
#   ./scripts/qa/liquidacion-propinas-e2e.sh --list
#   ./scripts/qa/liquidacion-propinas-e2e.sh --setup
#   ./scripts/qa/liquidacion-propinas-e2e.sh --case crear-pool
#   ./scripts/qa/liquidacion-propinas-e2e.sh --all
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/qa/fixtures/liquidacion-propinas-ids.env"

BASE_URL="${BASE_URL:-http://localhost:5173}"
API_URL="${API_URL:-http://localhost:3000/api}"
EMAIL="${QA_EMAIL:-admin@sistema.com}"
PASSWORD="${QA_PASSWORD:-admin}"
TENANT_LABEL="${QA_TENANT:-Paris}"
CD="${CD:-chrome-devtools}"

# Escrituras → primaria; lecturas → réplica (localmente suelen ser la misma).
QA_DB_URL="${QA_DB_URL:-postgresql://dev_user:dev_password_123@localhost:5432/tecnica_db}"
QA_REPLICA_URL="${QA_REPLICA_URL:-$QA_DB_URL}"

STATE_FILE="${QA_STATE_FILE:-/tmp/qa-liq-propinas.env}"
PASS=0
FAIL=0

die() { echo "ERROR: $*" >&2; exit 1; }
need_cd() {
  command -v "$CD" >/dev/null 2>&1 \
    || die "Falta '$CD'. Instala: npm i -g chrome-devtools-mcp@latest"
}
need_psql() {
  command -v psql >/dev/null 2>&1 || die "Falta psql"
}

psql_db() { PGPASSWORD="${PGPASSWORD:-dev_password_123}" psql "$QA_DB_URL" -v ON_ERROR_STOP=1 "$@"; }
psql_ro() { PGPASSWORD="${PGPASSWORD:-dev_password_123}" psql "$QA_REPLICA_URL" -v ON_ERROR_STOP=1 "$@"; }

cd_eval() { "$CD" evaluate_script "$1" 2>&1; }
cd_nav() {
  "$CD" navigate_page --url "$1" >/dev/null
  sleep "${2:-1.2}"
}

cd_select_latest() {
  local pages id
  pages=$("$CD" list_pages 2>&1 || true)
  id=$(printf '%s\n' "$pages" | python3 -c '
import sys, re
ids = re.findall(r"^(\d+):", sys.stdin.read(), re.M)
print(ids[-1] if ids else "")
')
  [[ -n "$id" ]] || die "No hay páginas abiertas en chrome-devtools.\n$pages"
  "$CD" select_page "$id" >/dev/null 2>&1 || true
}

eval_extract() {
  local data
  data=$(cat)
  EXTRACT_IN="$data" python3 - <<'PY'
import json, os, re, sys
s = os.environ.get("EXTRACT_IN", "")
if "selected page has been closed" in s or ("Error:" in s and "page" in s.lower()):
    sys.stderr.write(s + "\n")
    raise SystemExit(3)
m = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", s, re.S)
if m:
    s = m.group(1).strip()
try:
    data = json.loads(s)
    if isinstance(data, (str, int, float)):
        print(data)
        raise SystemExit(0)
    if isinstance(data, list):
        print(json.dumps(data, separators=(",", ":")))
        raise SystemExit(0)
    if isinstance(data, dict):
        print(json.dumps(data, separators=(",", ":")))
        raise SystemExit(0)
except json.JSONDecodeError:
    pass
m = re.search(
    r'"(installed|ready|ok|yes|no|submitted|miss|saved:[^"]+|no-[a-z]+|pass|fail|[^"]{1,200})"',
    s,
)
if m:
    print(m.group(1))
    raise SystemExit(0)
for line in s.splitlines():
    t = line.strip().strip('"').strip("'")
    if not t or t.startswith("#") or t.startswith("##"):
        continue
    if "script ran" in t.lower() or t.lower() == "pages":
        continue
    print(t)
    raise SystemExit(0)
print(s.strip())
PY
}

snapshot_uid() {
  local pattern=$1
  local snap
  snap=$("$CD" take_snapshot 2>&1)
  printf '%s\n' "$snap" | python3 -c '
import sys, re
pat = re.compile(sys.argv[1], re.I)
for line in sys.stdin:
    m = re.match(r"\s*uid=(\S+)\s+(.*)", line)
    if not m:
        continue
    if pat.search(m.group(2)):
        print(m.group(1))
        raise SystemExit(0)
raise SystemExit(1)
' "$pattern"
}

save_state() {
  {
    echo "QA_WINDOW_FROM='$QA_WINDOW_FROM'"
    echo "QA_WINDOW_TO='$QA_WINDOW_TO'"
    echo "QA_WINDOW_FROM_LOCAL='$QA_WINDOW_FROM_LOCAL'"
    echo "QA_WINDOW_TO_LOCAL='$QA_WINDOW_TO_LOCAL'"
    echo "QA_LIQUIDACION_ID='${QA_LIQUIDACION_ID:-}'"
    echo "QA_LIQUIDACION2_ID='${QA_LIQUIDACION2_ID:-}'"
  } > "$STATE_FILE"
}

load_state() {
  [[ -f "$STATE_FILE" ]] || return 0
  # shellcheck source=/dev/null
  source "$STATE_FILE"
}

# ── Casos ────────────────────────────────────────────────────────────────────
CASES=$(cat <<'EOF'
crear-pool@@Crear borrador con pool de tips fixture
excluir-recalcular@@Excluir participante sugerido y recalcular
confirmar@@Confirmar liquidación y bloquear tips
tips-ya-liquidados@@Segunda liquidación no reusa tips confirmados
anular@@Anular liberando tips
EOF
)

list_cases() {
  printf '%-22s %s\n' ID TÍTULO
  while IFS= read -r line; do
    [[ -z "${line:-}" ]] && continue
    printf '%-22s %s\n' "${line%%@@*}" "${line#*@@}"
  done <<< "$CASES"
}

# ── Setup SQL (writes → DB primaria) ─────────────────────────────────────────
compute_window() {
  # Ventana local ± para datetime-local + ISO para SQL
  eval "$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone

def pg_ts(dt):
    u = dt.astimezone(timezone.utc)
    return u.strftime("%Y-%m-%d %H:%M:%S+00")

now = datetime.now().astimezone()
start = (now - timedelta(hours=2)).replace(second=0, microsecond=0)
end = (now + timedelta(hours=1)).replace(second=0, microsecond=0)
mid = start + timedelta(minutes=30)
print(f"QA_WINDOW_FROM='{start.isoformat()}'")
print(f"QA_WINDOW_TO='{end.isoformat()}'")
print(f"QA_WINDOW_FROM_LOCAL='{start.strftime('%Y-%m-%dT%H:%M')}'")
print(f"QA_WINDOW_TO_LOCAL='{end.strftime('%Y-%m-%dT%H:%M')}'")
print(f"QA_TIP_CREATED='{pg_ts(mid)}'")
print(f"QA_SESION_INICIO='{pg_ts(start)}'")
print(f"QA_SESION_FIN='{pg_ts(start + timedelta(hours=4))}'")
PY
)"
}

do_setup() {
  need_psql
  compute_window
  echo "→ Setup fixtures tip (pool=$QA_POOL_EXPECTED) ventana $QA_WINDOW_FROM_LOCAL → $QA_WINDOW_TO_LOCAL"

  psql_db <<SQL
BEGIN;

-- Liberar tips QA de liquidaciones previas
UPDATE venta_propina
SET liquidacion_id = NULL, actualizado_el = NOW()
WHERE venta_propina_id IN ('$QA_TIP_1', '$QA_TIP_2', '$QA_TIP_3');

-- Soft-delete fuentes QA de liquidaciones previas (evita tips compartidos entre borradores)
UPDATE liquidacion_propinas_fuente
SET eliminado_el = NOW(), actualizado_el = NOW()
WHERE venta_propina_id IN ('$QA_TIP_1', '$QA_TIP_2', '$QA_TIP_3')
  AND eliminado_el IS NULL;

DELETE FROM liquidacion_propinas_fuente
WHERE venta_propina_id IN ('$QA_TIP_1', '$QA_TIP_2', '$QA_TIP_3');

DELETE FROM venta_propina
WHERE venta_propina_id IN ('$QA_TIP_1', '$QA_TIP_2', '$QA_TIP_3');

DELETE FROM sesiones_garzon
WHERE sesion_garzon_id = '$QA_SESION_1';

DELETE FROM ventas
WHERE venta_id IN ('$QA_VENTA_1', '$QA_VENTA_2', '$QA_VENTA_3');

INSERT INTO ventas (
  venta_id, tenant_id, moneda_id, canal, fecha, estado,
  total_bruto, total_descuentos, total_recargos, total_impuestos, total_final,
  base_ventas_total_final, base_ventas_sin_impuestos,
  creado_el, actualizado_el
) VALUES
  ('$QA_VENTA_1', '$QA_TENANT_ID', '$QA_CLP_ID', 'fisico', NOW(), 'pagada',
   10000, 0, 0, 1900, 11900, 11900, 10000, NOW(), NOW()),
  ('$QA_VENTA_2', '$QA_TENANT_ID', '$QA_CLP_ID', 'fisico', NOW(), 'pagada',
   20000, 0, 0, 3800, 23800, 23800, 20000, NOW(), NOW()),
  ('$QA_VENTA_3', '$QA_TENANT_ID', '$QA_CLP_ID', 'fisico', NOW(), 'pagada',
   15000, 0, 0, 2850, 17850, 17850, 15000, NOW(), NOW());

INSERT INTO sesiones_garzon (
  sesion_garzon_id, tenant_id, garzon_id, turno_id, tipo_garzon,
  inicio_el, fin_el, estado, creado_el, actualizado_el
) VALUES (
  '$QA_SESION_1', '$QA_TENANT_ID', '$QA_GARZON_ANA', '$QA_TURNO_MANANA', 'garzon',
  TIMESTAMPTZ '$QA_SESION_INICIO', TIMESTAMPTZ '$QA_SESION_FIN', 'cerrada',
  NOW(), NOW()
);

INSERT INTO venta_propina (
  venta_propina_id, tenant_id, venta_id, garzon_id,
  porcentaje_sugerido, monto_sugerido, monto_pagado,
  tipo, estado, sesion_garzon_id, turno_id, tipo_garzon, liquidacion_id,
  creado_el, actualizado_el
) VALUES
  ('$QA_TIP_1', '$QA_TENANT_ID', '$QA_VENTA_1', '$QA_GARZON_ANA',
   0.1, 1000, $QA_MONTO_1, 'manual', 'pagada',
   '$QA_SESION_1', '$QA_TURNO_MANANA', 'garzon', NULL,
   TIMESTAMPTZ '$QA_TIP_CREATED', NOW()),
  ('$QA_TIP_2', '$QA_TENANT_ID', '$QA_VENTA_2', '$QA_GARZON_BRUNO',
   0.1, 2000, $QA_MONTO_2, 'manual', 'pagada',
   NULL, '$QA_TURNO_MANANA', 'garzon', NULL,
   TIMESTAMPTZ '$QA_TIP_CREATED', NOW()),
  ('$QA_TIP_3', '$QA_TENANT_ID', '$QA_VENTA_3', '$QA_GARZON_CARLA',
   0.1, 3000, $QA_MONTO_3, 'manual', 'pagada',
   NULL, '$QA_TURNO_MANANA', 'garzon', NULL,
   TIMESTAMPTZ '$QA_TIP_CREATED', NOW());

COMMIT;
SQL

  QA_LIQUIDACION_ID=''
  QA_LIQUIDACION2_ID=''
  save_state
  echo "  OK fixtures (3 tips, pool $QA_POOL_EXPECTED)"
}

assert_sql() {
  local desc=$1 sql=$2 expect=$3
  local got
  got=$(psql_ro -Atc "$sql" | tr -d '[:space:]')
  if [[ "$got" == "$expect" ]]; then
    echo "  ✓ $desc ($got)"
    return 0
  fi
  echo "  ✗ $desc: esperado='$expect' got='$got'" >&2
  return 1
}

# ── Login / UI helpers ───────────────────────────────────────────────────────
do_login() {
  need_cd
  echo "→ Login $EMAIL @ $BASE_URL/login (tenant=$TENANT_LABEL)"
  "$CD" new_page "$BASE_URL/login" >/dev/null 2>&1 || true
  sleep 1.2
  cd_select_latest
  cd_nav "$BASE_URL/login" 1.5
  cd_select_latest
  sleep 0.5

  local email_uid pass_uid btn_uid tenant_uid url i
  email_uid=$(snapshot_uid 'textbox "Email"') || die "No hallé textbox Email"
  pass_uid=$(snapshot_uid 'textbox "Contraseña"') || die "No hallé textbox Contraseña"
  "$CD" fill "$email_uid" "$EMAIL" >/dev/null
  "$CD" fill "$pass_uid" "$PASSWORD" >/dev/null
  sleep 0.3
  btn_uid=$(snapshot_uid 'button "Iniciar sesión"') || die "No hallé botón Iniciar sesión"
  "$CD" click "$btn_uid" >/dev/null

  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.6
    cd_select_latest
    url=$(cd_eval '() => location.pathname' | eval_extract)
    case "$url" in
      *login*) continue ;;
      *select-tenant*)
        tenant_uid=$(snapshot_uid "$TENANT_LABEL") \
          || die "No hallé tenant '$TENANT_LABEL' en /select-tenant"
        "$CD" click "$tenant_uid" >/dev/null
        sleep 1.2
        ;;
      *) break ;;
    esac
  done

  cd_select_latest
  url=$(cd_eval '() => location.pathname' | eval_extract)
  [[ "$url" == *login* || "$url" == *select-tenant* ]] \
    && die "No salí del flujo auth (url=$url)"
  echo "  OK (en $url)"
}

ensure_session() {
  cd_select_latest 2>/dev/null || true
  local path
  path=$(cd_eval '() => location.pathname' 2>/dev/null | eval_extract || true)
  if [[ "$path" == *login* || -z "$path" ]]; then
    do_login
  fi
}

goto_liquidaciones() {
  cd_select_latest
  cd_nav "${BASE_URL}/propinas/liquidaciones" 1.8
  cd_select_latest
}

set_datetime_inputs() {
  local from_local=$1 to_local=$2
  local from_js to_js
  from_js=$(printf '%s' "$from_local" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  to_js=$(printf '%s' "$to_local" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  cd_eval "() => {
    const inputs = [...document.querySelectorAll('input[type=datetime-local]')];
    if (inputs.length < 2) return 'no-inputs:' + inputs.length;
    const setVal = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(inputs[0], $from_js);
    setVal(inputs[1], $to_js);
    return 'ok';
  }" | eval_extract >/dev/null
  sleep 0.3
}

click_button_label() {
  local label=$1
  local uid out
  # Preferir click por snapshot (más fiable con Nuxt UI).
  if uid=$(snapshot_uid "button \"${label}\""); then
    "$CD" click "$uid" >/dev/null
    sleep 1.0
    return 0
  fi
  if uid=$(snapshot_uid "button .*${label}"); then
    "$CD" click "$uid" >/dev/null
    sleep 1.0
    return 0
  fi
  local label_js
  label_js=$(printf '%s' "$label" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  out=$(cd_eval "() => {
    const n = ($label_js).toLowerCase();
    const el = [...document.querySelectorAll('button')].find(
      e => (e.textContent || '').trim().toLowerCase() === n && !e.disabled
    ) || [...document.querySelectorAll('button')].find(
      e => (e.textContent || '').toLowerCase().includes(n) && !e.disabled
    );
    if (!el) return 'miss';
    el.click();
    return 'ok';
  }" | eval_extract)
  [[ "$out" == "ok" ]] || die "No hallé botón ~ $label"
  sleep 1.0
}

wait_path() {
  local re=$1
  local i url
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 0.5
    cd_select_latest
    url=$(cd_eval '() => location.pathname' | eval_extract)
    if [[ "$url" =~ $re ]]; then
      echo "$url"
      return 0
    fi
  done
  die "Timeout esperando path ~ $re (último=$url)"
}

page_estado() {
  cd_eval '() => {
    const body = document.body.innerText || "";
    const estado = /\b(Borrador|Confirmada|Anulada)\b/.exec(body)?.[1] || "-";
    const fuentes = /Fuentes\s*\n?\s*(\d+)/i.exec(body)?.[1] || "-";
    const participantes = /Participantes\s*\n?\s*(\d+)/i.exec(body)?.[1] || "-";
    const id = (location.pathname.match(/liquidaciones\/([0-9a-f-]{36})/i) || [])[1] || "-";
    return [id, estado, fuentes, participantes].join("|");
  }' | eval_extract
}

parse_page_estado() {
  # id|estado|fuentes|participantes
  local raw=$1
  PAGE_ID=${raw%%|*}
  local rest=${raw#*|}
  PAGE_ESTADO=${rest%%|*}
  rest=${rest#*|}
  PAGE_FUENTES=${rest%%|*}
  PAGE_PARTICIPANTES=${rest#*|}
}

fill_first_motivo_ajuste() {
  local motivo=$1
  local motivo_js
  motivo_js=$(printf '%s' "$motivo" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  cd_eval "() => {
    const inp = [...document.querySelectorAll('input')].find(
      i => (i.getAttribute('placeholder') || '').toLowerCase().includes('motivo ajuste')
    );
    if (!inp) return 'no-input';
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(inp, $motivo_js);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  }" | eval_extract >/dev/null
}

fill_motivo_anulacion() {
  local motivo=$1
  local motivo_js
  motivo_js=$(printf '%s' "$motivo" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  cd_eval "() => {
    const inp = [...document.querySelectorAll('input')].find(
      i => (i.getAttribute('placeholder') || '').toLowerCase().includes('motivo de anulación')
        || (i.getAttribute('placeholder') || '').toLowerCase().includes('motivo de anulacion')
    );
    if (!inp) return 'no-input';
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(inp, $motivo_js);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  }" | eval_extract >/dev/null
}

mark_pass() { echo "  ✓ PASS"; PASS=$((PASS + 1)); }
mark_fail() { echo "  ✗ FAIL: $*"; FAIL=$((FAIL + 1)); }

# ── Casos ────────────────────────────────────────────────────────────────────
case_crear_pool() {
  echo ""
  echo "══ crear-pool — Crear borrador con pool de tips fixture ══"
  load_state
  [[ -n "${QA_WINDOW_FROM_LOCAL:-}" ]] || do_setup
  load_state

  goto_liquidaciones
  set_datetime_inputs "$QA_WINDOW_FROM_LOCAL" "$QA_WINDOW_TO_LOCAL"
  click_button_label "Crear borrador"
  wait_path 'liquidaciones/[0-9a-f-]{36}' >/dev/null
  sleep 0.8

  local info ok=1
  info=$(page_estado)
  parse_page_estado "$info"
  echo "  page: id=$PAGE_ID estado=$PAGE_ESTADO fuentes=$PAGE_FUENTES"

  QA_LIQUIDACION_ID="$PAGE_ID"
  save_state

  [[ "$PAGE_ESTADO" == "Borrador" ]] || { echo "  ✗ estado=$PAGE_ESTADO"; ok=0; }
  [[ "$PAGE_FUENTES" == "3" ]] || { echo "  ✗ fuentes=$PAGE_FUENTES (esperado 3)"; ok=0; }
  [[ "$PAGE_ID" != "-" && -n "$PAGE_ID" ]] || { echo "  ✗ sin id"; ok=0; }

  local pool_raw
  pool_raw=$(psql_ro -Atc "SELECT pool_total::numeric FROM liquidacion_propinas WHERE liquidacion_propinas_id='$PAGE_ID'")
  python3 -c "import sys; sys.exit(0 if float('$pool_raw')==float('$QA_POOL_EXPECTED') else 1)" \
    && echo "  ✓ pool_total=$pool_raw" || { echo "  ✗ pool_total=$pool_raw"; ok=0; }

  if [[ $ok -eq 1 ]]; then mark_pass; else mark_fail "crear-pool"; fi
}

case_excluir_recalcular() {
  echo ""
  echo "══ excluir-recalcular — Excluir participante sugerido ══"
  load_state
  [[ -n "${QA_LIQUIDACION_ID:-}" ]] || die "Falta QA_LIQUIDACION_ID (corre crear-pool antes)"

  cd_nav "${BASE_URL}/propinas/liquidaciones/${QA_LIQUIDACION_ID}" 1.5
  cd_select_latest
  fill_first_motivo_ajuste "QA E2E exclusión"
  click_button_label "Excluir"
  sleep 1.2

  local incluidos ok=1
  incluidos=$(psql_ro -Atc "
    SELECT COUNT(*)::text FROM liquidacion_propinas_participante
    WHERE liquidacion_id='$QA_LIQUIDACION_ID' AND incluido = true AND eliminado_el IS NULL")
  [[ "$incluidos" == "2" ]] || { echo "  ✗ incluidos=$incluidos (esperado 2)"; ok=0; }

  local suma
  suma=$(psql_ro -Atc "
    SELECT COALESCE(SUM(monto),0)::numeric FROM liquidacion_propinas_participante
    WHERE liquidacion_id='$QA_LIQUIDACION_ID' AND incluido = true AND eliminado_el IS NULL")
  python3 -c "import sys; sys.exit(0 if abs(float('$suma')-float('$QA_POOL_EXPECTED'))<0.0001 else 1)" \
    && echo "  ✓ suma montos incluidos=$suma" || { echo "  ✗ suma montos=$suma"; ok=0; }

  local ev
  ev=$(psql_ro -Atc "
    SELECT COUNT(*)::text FROM liquidacion_propinas_evento
    WHERE liquidacion_id='$QA_LIQUIDACION_ID' AND tipo='recalculada' AND eliminado_el IS NULL")
  [[ "${ev:-0}" -ge 1 ]] && echo "  ✓ evento recalculada ($ev)" || { echo "  ✗ sin evento recalculada"; ok=0; }

  if [[ $ok -eq 1 ]]; then mark_pass; else mark_fail "excluir-recalcular"; fi
}

case_confirmar() {
  echo ""
  echo "══ confirmar — Confirmar y bloquear tips ══"
  load_state
  [[ -n "${QA_LIQUIDACION_ID:-}" ]] || die "Falta QA_LIQUIDACION_ID"

  cd_nav "${BASE_URL}/propinas/liquidaciones/${QA_LIQUIDACION_ID}" 1.5
  cd_select_latest
  sleep 0.5
  click_button_label "Confirmar"
  # Esperar transición de estado
  local i estado_db
  for i in 1 2 3 4 5 6 7 8; do
    sleep 0.6
    estado_db=$(psql_ro -Atc "SELECT estado FROM liquidacion_propinas WHERE liquidacion_propinas_id='$QA_LIQUIDACION_ID'")
    [[ "$estado_db" == "confirmada" ]] && break
  done

  local info ok=1
  info=$(page_estado)
  parse_page_estado "$info"
  echo "  page: estado=$PAGE_ESTADO db=$estado_db"
  [[ "$PAGE_ESTADO" == "Confirmada" || "$estado_db" == "confirmada" ]] || { echo "  ✗ no confirmó"; ok=0; }

  assert_sql "estado confirmada" \
    "SELECT estado FROM liquidacion_propinas WHERE liquidacion_propinas_id='$QA_LIQUIDACION_ID'" \
    "confirmada" || ok=0

  local tip_count
  tip_count=$(psql_ro -Atc "
    SELECT COUNT(*)::text FROM venta_propina
    WHERE venta_propina_id IN ('$QA_TIP_1','$QA_TIP_2','$QA_TIP_3')
      AND liquidacion_id='$QA_LIQUIDACION_ID' AND eliminado_el IS NULL")
  [[ "$tip_count" == "3" ]] && echo "  ✓ tips bloqueados=$tip_count" || { echo "  ✗ tips bloqueados=$tip_count"; ok=0; }

  if [[ $ok -eq 1 ]]; then mark_pass; else mark_fail "confirmar"; fi
}

case_tips_ya_liquidados() {
  echo ""
  echo "══ tips-ya-liquidados — Segunda liquidación sin tips ══"
  load_state
  [[ -n "${QA_WINDOW_FROM_LOCAL:-}" ]] || die "Falta ventana (corre --setup)"

  goto_liquidaciones
  set_datetime_inputs "$QA_WINDOW_FROM_LOCAL" "$QA_WINDOW_TO_LOCAL"
  click_button_label "Crear borrador"
  wait_path 'liquidaciones/[0-9a-f-]{36}' >/dev/null
  sleep 0.8

  local info ok=1
  info=$(page_estado)
  parse_page_estado "$info"
  echo "  page: id=$PAGE_ID fuentes=$PAGE_FUENTES"
  QA_LIQUIDACION2_ID="$PAGE_ID"
  save_state

  [[ "$PAGE_FUENTES" == "0" ]] || { echo "  ✗ fuentes=$PAGE_FUENTES (esperado 0)"; ok=0; }
  local pool_raw
  pool_raw=$(psql_ro -Atc "SELECT pool_total::numeric FROM liquidacion_propinas WHERE liquidacion_propinas_id='$PAGE_ID'")
  python3 -c "import sys; sys.exit(0 if float('$pool_raw')==0 else 1)" \
    && echo "  ✓ pool 2ª liquidación=$pool_raw" || { echo "  ✗ pool=$pool_raw"; ok=0; }

  if [[ $ok -eq 1 ]]; then mark_pass; else mark_fail "tips-ya-liquidados"; fi
}

case_anular() {
  echo ""
  echo "══ anular — Anular liberando tips ══"
  load_state
  [[ -n "${QA_LIQUIDACION_ID:-}" ]] || die "Falta QA_LIQUIDACION_ID"

  cd_nav "${BASE_URL}/propinas/liquidaciones/${QA_LIQUIDACION_ID}" 1.5
  cd_select_latest
  fill_motivo_anulacion "QA E2E anulación"
  click_button_label "Anular"
  sleep 1.5

  local info ok=1
  info=$(page_estado)
  parse_page_estado "$info"
  echo "  page: estado=$PAGE_ESTADO"
  [[ "$PAGE_ESTADO" == "Anulada" ]] || { echo "  ✗ UI estado=$PAGE_ESTADO"; ok=0; }

  assert_sql "estado anulada" \
    "SELECT estado FROM liquidacion_propinas WHERE liquidacion_propinas_id='$QA_LIQUIDACION_ID'" \
    "anulada" || ok=0

  local liberados
  liberados=$(psql_ro -Atc "
    SELECT COUNT(*)::text FROM venta_propina
    WHERE venta_propina_id IN ('$QA_TIP_1','$QA_TIP_2','$QA_TIP_3')
      AND liquidacion_id IS NULL AND eliminado_el IS NULL")
  [[ "$liberados" == "3" ]] && echo "  ✓ tips liberados=$liberados" || { echo "  ✗ tips liberados=$liberados"; ok=0; }

  if [[ $ok -eq 1 ]]; then mark_pass; else mark_fail "anular"; fi
}

run_case() {
  local id=$1
  case "$id" in
    crear-pool) case_crear_pool ;;
    excluir-recalcular) case_excluir_recalcular ;;
    confirmar) case_confirmar ;;
    tips-ya-liquidados) case_tips_ya_liquidados ;;
    anular) case_anular ;;
    *) die "caso desconocido: $id" ;;
  esac
}

run_all() {
  do_setup
  need_cd
  do_login
  run_case crear-pool
  run_case excluir-recalcular
  run_case confirmar
  run_case tips-ya-liquidados
  run_case anular
  echo ""
  echo "pass=$PASS fail=$FAIL"
  [[ $FAIL -eq 0 ]]
}

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

CMD=${1:-}
shift || true

case "$CMD" in
  --list|-l) list_cases ;;
  --setup) do_setup ;;
  --login) need_cd; do_login ;;
  --case)
    id=${1:-}; [[ -n "$id" ]] || die "--case <id>"
    need_cd
    load_state
    [[ -n "${QA_WINDOW_FROM_LOCAL:-}" ]] || do_setup
    ensure_session
    run_case "$id"
    echo "pass=$PASS fail=$FAIL"
    [[ $FAIL -eq 0 ]]
    ;;
  --all)
    run_all
    ;;
  --help|-h|"")
    usage
    echo
    list_cases
    ;;
  *) die "comando desconocido: $CMD" ;;
esac
