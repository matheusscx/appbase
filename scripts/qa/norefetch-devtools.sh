#!/usr/bin/env bash
# norefetch-devtools.sh — suite Chrome DevTools CLI.
# Tras mutar (POST/PUT/PATCH/DELETE) no debe aparecer un GET de re-lista
# (anti-patrón en CLAUDE.md / docs/patterns/frontend.md).
#
# Prerrequisitos:
#   npm i -g chrome-devtools-mcp@latest
#   frontend :5173 + API :3000 con seed (admin@sistema.com / admin)
#
# Uso:
#   ./scripts/qa/norefetch-devtools.sh --list
#   ./scripts/qa/norefetch-devtools.sh --login
#   ./scripts/qa/norefetch-devtools.sh --case categorias-create --auto
#   ./scripts/qa/norefetch-devtools.sh --case categorias-create       # mutas tú → Enter → assert
#   ./scripts/qa/norefetch-devtools.sh --all-manual
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5173}"
EMAIL="${QA_EMAIL:-admin@sistema.com}"
PASSWORD="${QA_PASSWORD:-admin}"
CD="${CD:-chrome-devtools}"

PASS=0
FAIL=0

die() { echo "ERROR: $*" >&2; exit 1; }
need_cd() {
  command -v "$CD" >/dev/null 2>&1 \
    || die "Falta '$CD'. Instala: npm i -g chrome-devtools-mcp@latest"
}

# evaluate_script → stdout crudo (markdown/json según versión CLI)
cd_eval() {
  "$CD" evaluate_script "$1" 2>/dev/null
}

cd_nav() {
  "$CD" navigate_page --url "$1" >/dev/null
  sleep "${2:-1.2}"
}

# Extrae string/JSON del output de evaluate_script
eval_extract() {
  python3 - <<'PY'
import sys, re
s = sys.stdin.read()
m = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", s, re.S)
if m:
    s = m.group(1).strip()
m = re.search(
    r'"(installed|ready|ok|yes|no|submitted|miss|saved:[^"]+|no-[a-z]+)"',
    s,
)
if m:
    print(m.group(1))
    raise SystemExit(0)
m = re.search(r"\[.*\]", s, re.S)
if m:
    print(m.group(0))
    raise SystemExit(0)
for line in s.splitlines():
    t = line.strip().strip("\"'")
    if t and not t.startswith("#") and "evaluate" not in t.lower():
        print(t)
        raise SystemExit(0)
print(s.strip())
PY
}

# ── Catálogo (campos separados por @@) ───────────────────────────────────────
# id @@ título @@ ruta @@ writeMethodsRE @@ forbidGetRE @@ auto(yes|no)
# writeMethodsRE / forbidGetRE son regex; pueden incluir | sin romper el parseo.
CASES=$(cat <<'EOF'
categorias-create@@Crear categoría@@/configuracion/categorias@@POST@@/categorias(\?|$)@@yes
categorias-patch@@Editar categoría@@/configuracion/categorias@@PATCH@@/categorias(\?|$)@@no
categorias-delete@@Eliminar categoría@@/configuracion/categorias@@DELETE@@/categorias(\?|$)@@no
impuestos-create@@Crear impuesto@@/configuracion/impuestos@@POST@@/impuestos(\?|$)@@yes
terceros-create@@Crear tercero@@/terceros@@POST@@/terceros(\?|$)@@yes
descuentos-create@@Crear descuento@@/configuracion/descuentos@@POST@@/descuentos(\?|$)@@no
recargos-create@@Crear recargo@@/configuracion/recargos@@POST@@/recargos(\?|$)@@no
causas-merma-create@@Crear causa de merma@@/configuracion/causas-merma@@POST@@/causas-merma(\?|$)@@yes
razones-sociales-create@@Crear razón social@@/configuracion/razones-sociales@@POST@@/razones-sociales(\?|$)@@no
garzones-create@@Crear garzón@@/configuracion/garzones@@POST@@/garzones(\?|$)@@yes
impresoras-create@@Crear impresora@@/configuracion/impresoras@@POST@@/impresoras(\?|$)@@yes
salones-create@@Crear salón@@/configuracion/salones@@POST@@/salones(\?|$)@@no
roles-create@@Crear rol@@/configuracion/roles@@POST@@/roles(\?|$)@@no
usuarios-create@@Crear usuario@@/configuracion/usuarios@@POST@@/usuarios(\?|$)@@no
pasarelas-patch@@Editar pasarela@@/configuracion/pasarelas@@PUT|PATCH@@/pasarela|/tenant-pasarela@@no
mermas-create@@Registrar merma@@/mermas@@POST@@/mermas(\?|$)@@no
suscripciones-create@@Crear suscripción@@/tienda/suscripciones@@POST@@/suscripciones(\?|$)@@no
items-create@@Crear item@@/configuracion/items@@POST@@/items(\?|$)@@no
caja-movimiento@@Movimiento de caja@@/caja@@POST@@/movimientos(\?|$)|/movimientos/resumen@@yes
ventas-abono@@Abono a venta@@/ventas@@POST@@/pagos|/ventas/[^/?]+$|/ventas(\?|$)@@no
ventas-nc@@Nota de crédito@@/ventas@@POST@@/notas-credito|/ventas/[^/?]+$|/ventas(\?|$)@@no
ordenes-reembolso@@Reembolso orden@@/ordenes@@POST@@/reembolsos|/pasarela/admin/ordenes/[^/?]+$@@no
salones-cerrar-cuenta@@Cerrar cuenta mesa@@/salones@@POST@@/cerrar|/salones|/operacion@@no
EOF
)

# Parte un renglón id@@title@@path@@writes@@forbids@@auto → vars
parse_case_line() {
  local line=$1
  CASE_ID=${line%%@@*}
  local rest=${line#*@@}
  CASE_TITLE=${rest%%@@*}
  rest=${rest#*@@}
  CASE_PATH=${rest%%@@*}
  rest=${rest#*@@}
  CASE_WRITES=${rest%%@@*}
  rest=${rest#*@@}
  CASE_FORBIDS=${rest%%@@*}
  CASE_AUTO=${rest#*@@}
}

list_cases() {
  printf '%-22s %-5s %s\n' ID AUTO TÍTULO
  while IFS= read -r line; do
    [[ -z "${line:-}" ]] && continue
    parse_case_line "$line"
    printf '%-22s %-5s %s\n' "$CASE_ID" "$CASE_AUTO" "$CASE_TITLE"
  done <<< "$CASES"
}

case_row() {
  local want=$1
  while IFS= read -r line; do
    [[ -z "${line:-}" ]] && continue
    parse_case_line "$line"
    [[ "$CASE_ID" == "$want" ]] && { printf '%s\n' "$line"; return 0; }
  done <<< "$CASES"
  return 1
}

# ── Interceptor ──────────────────────────────────────────────────────────────
install_interceptor() {
  local out
  out=$(cd_eval '() => {
    if (window.__qaNorefetch) return "ready";
    window.__qaNorefetch = { log: [] };
    const push = (method, url) => {
      window.__qaNorefetch.log.push({ t: Date.now(), method: String(method).toUpperCase(), url: String(url) });
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      try {
        const url = typeof input === "string" ? input : input.url;
        const method = (init && init.method) || (input && input.method) || "GET";
        push(method, url);
      } catch (e) {}
      return origFetch(input, init);
    };
    const XO = XMLHttpRequest.prototype;
    const open = XO.open;
    const send = XO.send;
    XO.open = function(method, url) {
      this.__qaM = method; this.__qaU = url;
      return open.apply(this, arguments);
    };
    XO.send = function() {
      try { push(this.__qaM || "GET", this.__qaU || ""); } catch (e) {}
      return send.apply(this, arguments);
    };
    return "installed";
  }' | eval_extract)
  [[ "$out" == "installed" || "$out" == "ready" ]] || die "No pude instalar interceptor (out=$out). ¿Hay página abierta?"
}

clear_log() {
  cd_eval '() => { if (window.__qaNorefetch) window.__qaNorefetch.log = []; return "ok"; }' >/dev/null
}

dump_log() {
  cd_eval '() => JSON.stringify(window.__qaNorefetch ? window.__qaNorefetch.log : [])' | eval_extract
}

# ── Login ────────────────────────────────────────────────────────────────────
do_login() {
  need_cd
  echo "→ Login $EMAIL @ $BASE_URL/login"
  "$CD" new_page "$BASE_URL/login" >/dev/null 2>&1 || cd_nav "$BASE_URL/login" 2
  sleep 1.5

  local email_js pass_js
  email_js=$(printf '%s' "$EMAIL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  pass_js=$(printf '%s' "$PASSWORD" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

  cd_eval "() => {
    const email = document.querySelector('input[type=email]');
    const pass = document.querySelector('input[type=password]');
    if (!email || !pass) return 'no-form';
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(email, $email_js);
    set(pass, $pass_js);
    const btn = [...document.querySelectorAll('button')].find(b => /iniciar sesión/i.test(b.textContent || ''));
    if (!btn) return 'no-button';
    btn.click();
    return 'submitted';
  }" >/dev/null

  sleep 2.5
  install_interceptor
  echo "  OK"
}

goto_path() {
  cd_nav "${BASE_URL}$1" 1.5
  install_interceptor
  clear_log
}

click_text() {
  local needle_js
  needle_js=$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  local out
  out=$(cd_eval "() => {
    const n = ($needle_js).toLowerCase();
    const el = [...document.querySelectorAll('button, a, [role=button]')].find(
      e => (e.textContent || '').toLowerCase().includes(n) && !e.disabled
    );
    if (!el) return 'miss';
    el.click();
    return 'ok';
  }" | eval_extract)
  [[ "$out" == "ok" ]] || echo "  warn: no hallé control con texto ~ $1"
  sleep 0.5
}

fill_first_text_and_save() {
  local label="${1:-QA}"
  local label_js
  label_js=$(printf '%s' "$label-$(date +%s | tail -c 6)" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
  cd_eval "() => {
    const inp = document.querySelector('[role=dialog] input:not([type=hidden]), form input:not([type=hidden]), input[type=text]');
    if (!inp) return 'no-input';
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(inp, $label_js);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find(b => /guardar|crear|registrar/i.test(b.textContent || ''));
    if (!btn) return 'no-save';
    btn.click();
    return 'ok';
  }" >/dev/null
  sleep 1.2
}

auto_mutate() {
  local id=$1
  case "$id" in
    categorias-create|impuestos-create|terceros-create|causas-merma-create|garzones-create|impresoras-create)
      click_text "nueva"
      sleep 0.4
      fill_first_text_and_save "QA"
      ;;
    caja-movimiento)
      click_text "movimiento"
      sleep 0.5
      cd_eval '() => {
        const inputs = [...document.querySelectorAll("input:not([type=hidden])")];
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        if (inputs[0]) { d.set.call(inputs[0], "QA mov"); inputs[0].dispatchEvent(new Event("input", { bubbles: true })); }
        if (inputs[1]) { d.set.call(inputs[1], "100"); inputs[1].dispatchEvent(new Event("input", { bubbles: true })); }
        const btn = [...document.querySelectorAll("button")].find(b => /registrar|guardar/i.test(b.textContent || ""));
        btn && btn.click();
        return "ok";
      }' >/dev/null
      sleep 1.2
      ;;
    *) die "auto no implementado para $id" ;;
  esac
}

assert_norefetch() {
  local writes_re=$1
  local forbids_re=$2
  local log_json
  log_json=$(dump_log)

  WRITES_RE="$writes_re" FORBIDS_RE="$forbids_re" LOG_JSON="$log_json" python3 <<'PY'
import json, os, re, sys

writes_re = re.compile(os.environ["WRITES_RE"], re.I)
forbids_re = re.compile(os.environ["FORBIDS_RE"])
raw = os.environ.get("LOG_JSON") or "[]"
try:
    log = json.loads(raw)
except json.JSONDecodeError:
    print("FAIL: log inválido:", raw[:200], file=sys.stderr)
    sys.exit(2)

def is_api(url: str) -> bool:
    return "/api/" in url or "localhost:3000" in url

api = [e for e in log if is_api(e.get("url", ""))]
print("— Tráfico API —")
for e in api:
    print(f"  {e.get('method','?'):6} {e.get('url')}")

write_idx = next((i for i, e in enumerate(api) if writes_re.search(e.get("method", ""))), None)
if write_idx is None:
    print("FAIL: no hubo write que matchee", os.environ["WRITES_RE"], file=sys.stderr)
    sys.exit(2)

bad = []
for e in api[write_idx + 1 :]:
    if e.get("method") != "GET":
        continue
    if forbids_re.search(e.get("url", "")):
        bad.append(f"{e['method']} {e['url']}")

if bad:
    print("FAIL: GET de re-lista tras mutación:")
    for b in bad:
        print(" ", b)
    sys.exit(1)

print("PASS: write OK, sin GET prohibido después")
sys.exit(0)
PY
}

run_case() {
  local id=$1 mode_auto=${2:-no}
  local row
  row=$(case_row "$id") || die "caso desconocido: $id"
  parse_case_line "$row"

  echo ""
  echo "══ $CASE_ID — $CASE_TITLE ══"
  echo "  $CASE_PATH | write=$CASE_WRITES | forbid GET~$CASE_FORBIDS"

  need_cd
  goto_path "$CASE_PATH"
  sleep 0.8
  clear_log

  if [[ "$mode_auto" == "yes" ]]; then
    [[ "$CASE_AUTO" == "yes" ]] || die "$id no es auto (quita --auto)"
    echo "  → auto…"
    auto_mutate "$CASE_ID"
  else
    echo "  Haz la mutación en Chrome ($CASE_TITLE), luego Enter."
    read -r -p "  › " _
  fi

  if assert_norefetch "$CASE_WRITES" "$CASE_FORBIDS"; then
    echo "  ✓ PASS"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL"
    FAIL=$((FAIL + 1))
  fi
}

ensure_session() {
  if cd_eval '() => window.__qaNorefetch ? "yes" : "no"' 2>/dev/null | eval_extract | grep -qi yes; then
    return 0
  fi
  do_login
}

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
}

CMD=${1:-}
shift || true

case "$CMD" in
  --list|-l) list_cases ;;
  --login) need_cd; do_login ;;
  --case)
    id=${1:-}; [[ -n "$id" ]] || die "--case <id>"
    shift || true
    auto=no
    [[ ${1:-} == --auto ]] && auto=yes
    need_cd
    ensure_session
    run_case "$id" "$auto"
    echo "pass=$PASS fail=$FAIL"
    [[ $FAIL -eq 0 ]]
    ;;
  --all-manual)
    need_cd
    do_login
    while IFS= read -r line; do
      [[ -z "${line:-}" ]] && continue
      parse_case_line "$line"
      run_case "$CASE_ID" no || true
    done <<< "$CASES"
    echo "pass=$PASS fail=$FAIL"
    [[ $FAIL -eq 0 ]]
    ;;
  --help|-h|"")
    usage
    echo
    list_cases
    ;;
  *) die "comando desconocido: $CMD" ;;
esac
