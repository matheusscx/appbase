#!/usr/bin/env bash
# date-time-inputs-e2e.sh — smoke + mutaciones de AppDateInput / AppDateTimeInput / AppTimeInput.
#
# Cubre:
#   - unit (vitest date-value)
#   - no-nativos (sin input[type=date|datetime-local] en pantallas clave)
#   - turno-crear (AppTimeInput → POST → assert DB → DELETE)
#   - liquidacion-crear (fixtures + AppDateTimeInput → borrador → assert)
#   - descuento-promocional (AppDateInput fechas → POST → assert → DELETE)
#   - filtros-mermas / filtros-ordenes / filtros-sesiones (desde/hasta en query)
#
# Prerrequisitos:
#   npm i -g chrome-devtools-mcp@latest
#   chrome-devtools start --headless=false
#   frontend :5173 + API :3000 con seed (admin@sistema.com / admin)
#   Postgres localhost:5432 (docker-compose)
#
# Uso:
#   ./scripts/qa/date-time-inputs-e2e.sh --list
#   ./scripts/qa/date-time-inputs-e2e.sh --case turno-crear
#   ./scripts/qa/date-time-inputs-e2e.sh --all
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

QA_DB_URL="${QA_DB_URL:-postgresql://dev_user:dev_password_123@localhost:5432/tecnica_db}"
QA_REPLICA_URL="${QA_REPLICA_URL:-$QA_DB_URL}"

QA_TURNO_NOMBRE="${QA_TURNO_NOMBRE:-QA DateTime Turno}"
QA_DESCUENTO_NOMBRE="${QA_DESCUENTO_NOMBRE:-QA DateTime Promo}"
QA_TIPO_PROMOCIONAL='550e8400-e29b-41d4-a716-446655440121'

PASS=0
FAIL=0

die() { echo "ERROR: $*" >&2; exit 1; }
need_cd() {
  command -v "$CD" >/dev/null 2>&1 \
    || die "Falta '$CD'. Instala: npm i -g chrome-devtools-mcp@latest"
}
need_psql() { command -v psql >/dev/null 2>&1 || die "Falta psql"; }

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
    if isinstance(data, (list, dict)):
        print(json.dumps(data, separators=(",", ":")))
        raise SystemExit(0)
except json.JSONDecodeError:
    pass
m = re.search(
    r'"(installed|ready|ok|yes|no|submitted|miss|pass|fail|saved:[^"]+|no-[a-z:-]+|[^"]{1,240})"',
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
text = sys.stdin.read()
for line in text.splitlines():
    m = re.match(r"^uid=(\S+)\s+(.*)$", line.strip())
    if not m:
        continue
    uid, rest = m.group(1), m.group(2)
    if pat.search(rest):
        print(uid)
        raise SystemExit(0)
raise SystemExit(1)
' "$pattern"
}

click_button_label() {
  local label=$1
  local uid out
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

qa_set() {
  local qa=$1 value=$2
  local qa_js val_js out
  qa_js=$(printf '%s' "$qa" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  val_js=$(printf '%s' "$value" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  out=$(cd_eval "() => {
    const el = document.querySelector('[data-qa=' + JSON.stringify($qa_js) + ']');
    if (!el) return 'miss:' + $qa_js;
    el.dispatchEvent(new CustomEvent('qa-set-value', { detail: $val_js }));
    return 'ok';
  }" | eval_extract)
  [[ "$out" == "ok" ]] || die "qa_set falló ($out) qa=$qa"
  sleep 0.25
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

pass() { echo "  PASS $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL $1 — $2" >&2; FAIL=$((FAIL + 1)); }

# ── Auth ─────────────────────────────────────────────────────────────────────
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

goto() {
  cd_select_latest
  cd_nav "${BASE_URL}$1" "${2:-1.5}"
  cd_select_latest
  # Confirmar que no nos mandó a login
  local path
  path=$(cd_eval '() => location.pathname' | eval_extract)
  if [[ "$path" == *login* || "$path" == *select-tenant* ]]; then
    do_login
    cd_nav "${BASE_URL}$1" "${2:-1.5}"
    cd_select_latest
    path=$(cd_eval '() => location.pathname' | eval_extract)
  fi
  [[ "$path" == "$1"* || "$path" == *"$1"* ]] || echo "  ⚠ path esperado~$1 got=$path"
}

fill_input_qa_or_placeholder() {
  local qa=$1 placeholder=$2 value=$3
  local qa_js ph_js val_js out
  qa_js=$(printf '%s' "$qa" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  ph_js=$(printf '%s' "$placeholder" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  val_js=$(printf '%s' "$value" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  out=$(cd_eval "() => {
    let el = null;
    if ($qa_js) {
      const root = document.querySelector('[data-qa=' + JSON.stringify($qa_js) + ']');
      el = root && (root.matches('input') ? root : root.querySelector('input'));
    }
    if (!el) {
      el = [...document.querySelectorAll('input')].find(i => i.placeholder === $ph_js);
    }
    if (!el) return 'miss';
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, $val_js);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }" | eval_extract)
  [[ "$out" == "ok" ]] || die "fill_input falló ($out) qa=$qa ph=$placeholder"
  sleep 0.2
}

count_native_date_inputs() {
  # Ignora VisuallyHiddenInput de UInputDate/UInputTime (aria-hidden).
  cd_eval '() => {
    const n = [...document.querySelectorAll(
      "input[type=date], input[type=datetime-local]"
    )].filter(i => i.getAttribute("aria-hidden") !== "true").length;
    const ui = document.querySelectorAll(
      "[data-qa], [data-segment=year], [data-segment=hour]"
    ).length;
    return n + "|" + ui;
  }' | eval_extract
}

# ── Casos ────────────────────────────────────────────────────────────────────
case_unit() {
  echo "→ unit (vitest date-value)"
  if (cd "$ROOT/frontend" && npm test -- app/utils/date-value.spec.ts >/tmp/qa-date-unit.log 2>&1); then
    pass "unit"
  else
    fail "unit" "ver /tmp/qa-date-unit.log"
    tail -20 /tmp/qa-date-unit.log >&2 || true
  fi
}

case_no_nativos() {
  echo "→ no-nativos"
  ensure_session
  local routes=(
    "/propinas/liquidaciones"
    "/configuracion/turnos"
    "/mermas"
    "/ordenes"
    "/sesiones-garzon"
    "/configuracion/descuentos"
  )
  local r out native ui ok=1
  for r in "${routes[@]}"; do
    goto "$r" 1.4
    local path
    path=$(cd_eval '() => location.pathname' | eval_extract)
    if [[ "$path" != "$r" && "$path" != "$r/"* ]]; then
      echo "  ✗ $r redirigió a $path (¿sesión?)"
      ok=0
      continue
    fi
    out=$(count_native_date_inputs)
    native="${out%%|*}"
    ui="${out##*|}"
    if [[ "$native" != "0" ]]; then
      echo "  ✗ $r aún tiene $native input nativo date/datetime-local"
      ok=0
    else
      echo "  ✓ $r sin nativos (ui-nodes~$ui)"
    fi
  done
  if [[ "$ok" == "1" ]]; then pass "no-nativos"; else fail "no-nativos" "quedan inputs nativos"; fi
}

case_turno_crear() {
  echo "→ turno-crear (AppTimeInput + mutación)"
  need_psql
  ensure_session

  # Cleanup previo idempotente
  psql_db -c "
UPDATE turnos SET eliminado_el = NOW(), actualizado_el = NOW()
WHERE tenant_id = '$QA_TENANT_ID' AND nombre = '$QA_TURNO_NOMBRE' AND eliminado_el IS NULL;
" >/dev/null

  goto "/configuracion/turnos" 1.5
  click_button_label "Nuevo turno"
  sleep 1.2

  fill_input_qa_or_placeholder "turno-nombre" "Brunch" "$QA_TURNO_NOMBRE"
  qa_set "turno-hora-inicio" "10:30"
  qa_set "turno-hora-fin" "14:45"

  click_button_label "Crear"
  sleep 1.5

  local ok=1
  assert_sql "turno en DB" \
    "SELECT COUNT(*) FROM turnos WHERE tenant_id='$QA_TENANT_ID' AND nombre='$QA_TURNO_NOMBRE' AND eliminado_el IS NULL" \
    "1" || ok=0
  assert_sql "horaInicio=10:30" \
    "SELECT hora_inicio FROM turnos WHERE tenant_id='$QA_TENANT_ID' AND nombre='$QA_TURNO_NOMBRE' AND eliminado_el IS NULL" \
    "10:30" || ok=0
  assert_sql "horaFin=14:45" \
    "SELECT hora_fin FROM turnos WHERE tenant_id='$QA_TENANT_ID' AND nombre='$QA_TURNO_NOMBRE' AND eliminado_el IS NULL" \
    "14:45" || ok=0

  # Cleanup: soft-delete
  psql_db -c "
UPDATE turnos SET eliminado_el = NOW(), actualizado_el = NOW()
WHERE tenant_id = '$QA_TENANT_ID' AND nombre = '$QA_TURNO_NOMBRE' AND eliminado_el IS NULL;
" >/dev/null

  if [[ "$ok" == "1" ]]; then pass "turno-crear"; else fail "turno-crear" "assert DB"; fi
}

case_liquidacion_crear() {
  echo "→ liquidacion-crear (AppDateTimeInput + mutación)"
  need_psql
  ensure_session

  echo "  setup fixtures…"
  "$ROOT/scripts/qa/liquidacion-propinas-e2e.sh" --setup >/tmp/qa-dt-liq-setup.log 2>&1 \
    || die "Falló setup liquidacion (ver /tmp/qa-dt-liq-setup.log)"

  # shellcheck source=/dev/null
  source /tmp/qa-liq-propinas.env 2>/dev/null || true
  # compute_window deja vars en el setup; re-leer desde el script de fixtures
  local from_local to_local
  from_local=$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
now = datetime.now().astimezone()
print((now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M"))
PY
)
  to_local=$(python3 - <<'PY'
from datetime import datetime, timedelta
now = datetime.now().astimezone()
print((now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"))
PY
)

  goto "/propinas/liquidaciones" 1.8
  qa_set "liq-fecha-desde" "$from_local"
  qa_set "liq-fecha-hasta" "$to_local"
  click_button_label "Crear borrador"
  sleep 2.0

  local path
  path=$(cd_eval '() => location.pathname' | eval_extract)
  local ok=1
  if [[ "$path" =~ /propinas/liquidaciones/[0-9a-f-]{36} ]]; then
    echo "  ✓ navegó a detalle ($path)"
  else
    echo "  ✗ no navegó a detalle (path=$path)" >&2
    ok=0
  fi

  assert_sql "borrador reciente" \
    "SELECT CASE WHEN COUNT(*) >= 1 THEN '1' ELSE '0' END FROM liquidacion_propinas WHERE tenant_id='$QA_TENANT_ID' AND estado='borrador' AND eliminado_el IS NULL AND creado_el > NOW() - INTERVAL '5 minutes'" \
    "1" || ok=0

  if [[ "$ok" == "1" ]]; then pass "liquidacion-crear"; else fail "liquidacion-crear" "UI/DB"; fi
}

case_descuento_promocional() {
  echo "→ descuento-promocional (AppDateInput + mutación)"
  need_psql
  ensure_session

  psql_db -c "
UPDATE descuentos SET eliminado_el = NOW(), actualizado_el = NOW()
WHERE tenant_id = '$QA_TENANT_ID' AND nombre = '$QA_DESCUENTO_NOMBRE' AND eliminado_el IS NULL;
" >/dev/null 2>&1 || true

  goto "/configuracion/descuentos" 1.6
  click_button_label "Nuevo descuento"
  sleep 1.2

  fill_input_qa_or_placeholder "" "Mi descuento" "$QA_DESCUENTO_NOMBRE"
  sleep 0.3

  # Seleccionar tipo Promocional
  cd_eval '() => {
    const triggers = [...document.querySelectorAll("button, [role=combobox], input")]
      .filter(e => /tipo|selecciona/i.test((e.textContent || e.getAttribute("placeholder") || "")));
    const t = triggers[0] || [...document.querySelectorAll("[role=combobox]") ][0];
    if (t) t.click();
    return t ? "ok" : "miss-trigger";
  }' | eval_extract >/dev/null
  sleep 0.5
  cd_eval '() => {
    const opt = [...document.querySelectorAll("[role=option], [cmdk-item], li, div, button")]
      .find(e => (e.textContent || "").trim() === "Promocional");
    if (!opt) return "miss-tipo";
    opt.click();
    return "ok";
  }' | eval_extract >/dev/null
  sleep 0.8

  # Modo porcentaje si aparece
  cd_eval '() => {
    const el = [...document.querySelectorAll("button, label, [role=radio]")].find(e =>
      /porcentaje/i.test(e.textContent || "")
    );
    if (el) el.click();
    return "ok";
  }' >/dev/null
  sleep 0.3

  cd_eval '() => {
    const inputs = [...document.querySelectorAll("input")].filter(i =>
      (i.placeholder || "").includes("0.10") || (i.getAttribute("inputmode") === "decimal")
    );
    const el = inputs.find(i => i.placeholder !== "Mi descuento") || inputs[0];
    if (!el) return "miss-valor";
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    d.set.call(el, "0.10");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  }' | eval_extract >/dev/null
  sleep 0.3

  local tries=0
  while [[ $tries -lt 10 ]]; do
    if cd_eval '() => document.querySelector("[data-qa=descuento-fecha-inicio]") ? "ok" : "miss"' | eval_extract | grep -q '^ok$'; then
      break
    fi
    sleep 0.4
    tries=$((tries + 1))
  done
  qa_set "descuento-fecha-inicio" "2026-07-01"
  qa_set "descuento-fecha-fin" "2026-07-31"

  click_button_label "Crear"
  sleep 1.8

  local ok=1
  assert_sql "descuento en DB" \
    "SELECT COUNT(*) FROM descuentos WHERE tenant_id='$QA_TENANT_ID' AND nombre='$QA_DESCUENTO_NOMBRE' AND eliminado_el IS NULL" \
    "1" || ok=0
  assert_sql "fecha_inicio" \
    "SELECT fecha_inicio::date::text FROM descuentos WHERE tenant_id='$QA_TENANT_ID' AND nombre='$QA_DESCUENTO_NOMBRE' AND eliminado_el IS NULL" \
    "2026-07-01" || ok=0
  assert_sql "fecha_fin" \
    "SELECT fecha_fin::date::text FROM descuentos WHERE tenant_id='$QA_TENANT_ID' AND nombre='$QA_DESCUENTO_NOMBRE' AND eliminado_el IS NULL" \
    "2026-07-31" || ok=0

  psql_db -c "
UPDATE descuentos SET eliminado_el = NOW(), actualizado_el = NOW()
WHERE tenant_id = '$QA_TENANT_ID' AND nombre = '$QA_DESCUENTO_NOMBRE' AND eliminado_el IS NULL;
" >/dev/null

  if [[ "$ok" == "1" ]]; then pass "descuento-promocional"; else fail "descuento-promocional" "assert DB"; fi
}

assert_filter_query() {
  local path_substr=$1 param=$2
  local out
  out=$(cd_eval "() => {
    const entries = performance.getEntriesByType('resource')
      .map(e => e.name)
      .filter(n => n.includes('$path_substr'));
    const last = entries[entries.length - 1] || '';
    if (!last) return 'no-req';
    try {
      const u = new URL(last, location.origin);
      const v = u.searchParams.get('$param');
      return v ? ('ok:' + v) : ('miss-param:' + last.slice(-120));
    } catch (e) {
      return 'err';
    }
  }" | eval_extract)
  [[ "$out" == ok:* ]] || return 1
  echo "  ✓ query $param en $path_substr ($out)"
  return 0
}

case_filtros_mermas() {
  echo "→ filtros-mermas"
  ensure_session
  goto "/mermas" 1.5
  cd_eval '() => { performance.clearResourceTimings(); return "ok"; }' >/dev/null
  qa_set "mermas-desde" "2026-07-01"
  qa_set "mermas-hasta" "2026-07-31"
  sleep 1.2
  local ok=1
  assert_filter_query "/mermas" "desde" || ok=0
  assert_filter_query "/mermas" "hasta" || ok=0
  if [[ "$ok" == "1" ]]; then pass "filtros-mermas"; else fail "filtros-mermas" "query params"; fi
}

case_filtros_ordenes() {
  echo "→ filtros-ordenes"
  ensure_session
  goto "/ordenes" 1.5
  cd_eval '() => { performance.clearResourceTimings(); return "ok"; }' >/dev/null
  qa_set "ordenes-desde" "2026-07-01"
  qa_set "ordenes-hasta" "2026-07-31"
  sleep 1.2
  local ok=1
  # usePaginatedList puede usar fechaDesde/fechaHasta
  local out
  out=$(cd_eval '() => {
    const entries = performance.getEntriesByType("resource").map(e => e.name).filter(n => n.includes("/ordenes"));
    const last = entries[entries.length - 1] || "";
    if (!last) return "no-req";
    const u = new URL(last, location.origin);
    const d = u.searchParams.get("fechaDesde");
    const h = u.searchParams.get("fechaHasta");
    if (d && h) return "ok:" + d + ".." + h;
    return "miss:" + last.slice(-140);
  }' | eval_extract)
  if [[ "$out" == ok:* ]]; then
    echo "  ✓ $out"
    pass "filtros-ordenes"
  else
    fail "filtros-ordenes" "$out"
  fi
}

case_filtros_sesiones() {
  echo "→ filtros-sesiones"
  ensure_session
  goto "/sesiones-garzon" 1.6
  cd_eval '() => { performance.clearResourceTimings(); return "ok"; }' >/dev/null
  qa_set "sesiones-desde" "2026-07-01"
  qa_set "sesiones-hasta" "2026-07-31"
  sleep 1.2
  local out
  out=$(cd_eval '() => {
    const entries = performance.getEntriesByType("resource").map(e => e.name)
      .filter(n => n.includes("sesion") || n.includes("garzon"));
    const last = entries[entries.length - 1] || "";
    if (!last) return "no-req";
    const u = new URL(last, location.origin);
    const has = [...u.searchParams.keys()].some(k => /fecha|desde|hasta/i.test(k) && u.searchParams.get(k));
    return has ? ("ok:" + [...u.searchParams.keys()].join(",")) : ("miss:" + last.slice(-140));
  }' | eval_extract)
  if [[ "$out" == ok:* ]]; then
    echo "  ✓ $out"
    pass "filtros-sesiones"
  else
    fail "filtros-sesiones" "$out"
  fi
}

# ── CLI ──────────────────────────────────────────────────────────────────────
CASES=(
  unit
  no-nativos
  turno-crear
  liquidacion-crear
  descuento-promocional
  filtros-mermas
  filtros-ordenes
  filtros-sesiones
)

run_case() {
  case "$1" in
    unit) case_unit ;;
    no-nativos) case_no_nativos ;;
    turno-crear) case_turno_crear ;;
    liquidacion-crear) case_liquidacion_crear ;;
    descuento-promocional) case_descuento_promocional ;;
    filtros-mermas) case_filtros_mermas ;;
    filtros-ordenes) case_filtros_ordenes ;;
    filtros-sesiones) case_filtros_sesiones ;;
    *) die "Caso desconocido: $1" ;;
  esac
}

usage() {
  cat <<EOF
Uso: $0 [--list | --case NAME | --all]

Casos: ${CASES[*]}
EOF
}

main() {
  local arg=${1:-}
  case "$arg" in
    ""|-h|--help) usage; exit 0 ;;
    --list) printf '%s\n' "${CASES[@]}"; exit 0 ;;
    --case)
      [[ -n "${2:-}" ]] || die "--case requiere nombre"
      run_case "$2"
      ;;
    --all)
      local c
      for c in "${CASES[@]}"; do
        echo ""
        run_case "$c" || true
      done
      ;;
    *) die "Arg desconocido: $arg (usa --help)" ;;
  esac

  echo ""
  echo "═══ Resumen: pass=$PASS fail=$FAIL ═══"
  [[ "$FAIL" -eq 0 ]]
}

main "$@"
