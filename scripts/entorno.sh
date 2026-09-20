#!/usr/bin/env bash
# entorno.sh — el entorno de ESTE worktree: su Postgres, o su stack completo.
#
# Por qué existe: hasta el 2026-09-20 `docker-compose` usaba UN nombre de proyecto
# para todos los worktrees —`.env.example` lo fijaba y cada `.env` lo copió—, así
# que backend y frontend eran uno solo y las sesiones se repartían turno a mano.
# Peor: `reset-db.sh` corrido en un worktree hacía `down -v` sobre los contenedores
# de todas las sesiones, y terminaba informando éxito (pasó el 2026-09-20).
#
# Este script le da a cada worktree su propio proyecto, sus propios puertos y su
# propio `.env`, y es **el único que escribe ese `.env`**. Ése no es un detalle de
# prolijidad: el bug de arriba nació de que `db-aislada.sh` escribía `DATABASE_URL`
# y `reset-db.sh` validaba otra cosa, sin que ninguno supiera del mundo del otro.
#
# Reemplaza a `db-aislada.sh` (borrado en el mismo commit). El modo `db` es lo que
# hacía aquél, y **sigue siendo el default para quien solo corre `test:e2e`**: son
# 35 MB de RAM y segundos, contra ~915 MB y 73 s del stack completo. El stack se
# levanta cuando hace falta navegador (Playwright o smoke manual).
#
# Uso (desde cualquier carpeta del worktree):
#   ./scripts/entorno.sh db          solo Postgres, para el e2e de la API
#   ./scripts/entorno.sh stack       Postgres + backend + frontend
#   ./scripts/entorno.sh estado      qué tiene este worktree, y qué quedó colgado
#   ./scripts/entorno.sh borrar [--purgar]   baja lo de este worktree
#   ./scripts/entorno.sh verificar   ¿algún worktree comparte offset/proyecto/puerto?
#   ./scripts/entorno.sh derivar     imprime KEY=VALUE para otros scripts
#
# Cualquiera de los dos primeros acepta `--offset N` (1–49) para fijar el puerto a
# mano; si no, se elige el más bajo libre y queda registrado en el `.env`.
set -euo pipefail

red() { printf '\033[31m%s\033[0m\n' "$1"; }
ylw() { printf '\033[33m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }

raiz="$(git rev-parse --show-toplevel)"
cd "$raiz"

# El checkout principal es el offset 0: sus puertos son los defaults del compose y
# su `.env` fija `COMPOSE_PROJECT_NAME`. Aislar ahí dejaría a `tecnica_backend` y a
# este script peleando por el mismo `.env` (misma razón que tenía `db-aislada.sh`).
es_principal() { [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; }

exigir_worktree() {
  if es_principal; then
    red "✖ Esto es el checkout principal: usa el stack del compose tal cual (reset-db.sh)."
    ylw "  entorno.sh levanta entornos propios solo para los worktrees de .claude/worktrees/."
    exit 1
  fi
}

slug="$(basename "$raiz" | tr -c 'a-zA-Z0-9_.-\n' '-' | tr 'A-Z' 'a-z')"
if es_principal; then
  proyecto="$(grep '^COMPOSE_PROJECT_NAME=' "$raiz/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  proyecto="${proyecto:-$(basename "$raiz")}"
  prefijo="tecnica"
else
  proyecto="wt-${slug}"      # nombre de proyecto de compose (minúsculas obligatorio)
  prefijo="wt-${slug}"       # → wt-<slug>_postgres|backend|frontend
fi
contenedor_db="pg_${slug}"   # el del modo `db`: MISMO nombre que usaba db-aislada.sh,
                             # para adoptar el que un worktree vivo ya tenga.
env_file="$raiz/.env"

DB_USER=dev_user
DB_PASSWORD=dev_password_123
DB_NAME=tecnica_db

BASE_PG=5432; BASE_BACK=3000; BASE_FRONT=5173
OFF_MIN=1; OFF_MAX=49   # 49 es el techo que mantiene los tres rangos disjuntos:
                        # 5174–5222 (front) < 5433–5481 (pg), y 3001–3049 aparte.

compose() { docker compose -p "$proyecto" "$@"; }

# ── Lectura y escritura del .env ─────────────────────────────────────────────
leer_env() { [ -f "$env_file" ] && grep "^$1=" "$env_file" 2>/dev/null | head -1 | cut -d= -f2- || true; }

# API_PROXY_TARGET entra en la lista para ser BORRADO, no escrito: `.env.example` lo
# trae como localhost:3000 y un worktree que copie el ejemplo mete ese valor en el
# contenedor del frontend, que entonces se proxea a sí mismo. Sacándolo del `.env`
# gana el default del compose (`http://backend:3000`, ADR-022), que es el correcto.
CLAVES_PROPIAS="COMPOSE_PROJECT_NAME PREFIJO_CONTENEDOR OFFSET_WORKTREE PUERTO_POSTGRES PUERTO_BACKEND PUERTO_FRONTEND DATABASE_URL FRONTEND_URL API_PUBLIC_URL API_PROXY_TARGET"

# Reescribe SOLO las claves que este script maneja y deja el resto intacto. Antes
# de escribir imprime lo que reemplaza: el `.env` no está en git, así que esto es
# lo único que permite volver atrás a mano.
escribir_env() {
  local off="$1" modo="$2" pg back front
  pg=$((BASE_PG + off)); back=$((BASE_BACK + off)); front=$((BASE_FRONT + off))

  if [ ! -f "$env_file" ]; then
    ylw "▶ Este worktree no tenía .env: lo creo desde .env.example."
    cp "$raiz/.env.example" "$env_file"
  fi

  local previo tmp
  previo="$(for k in $CLAVES_PROPIAS; do v="$(leer_env "$k")"; [ -n "$v" ] && echo "    $k=$v"; done || true)"
  if [ -n "$previo" ]; then
    ylw "▶ Reemplazo estas líneas del .env (anotalas si querés volver atrás):"
    echo "$previo"
  fi

  tmp="$(mktemp)"
  # shellcheck disable=SC2086
  grep -vE "^($(echo $CLAVES_PROPIAS | tr ' ' '|'))=" "$env_file" > "$tmp" || true
  {
    echo ""
    echo "# ── Escrito por scripts/entorno.sh — no editar a mano ──────────────────────"
    echo "# Worktree: ${raiz}"
    echo "# Modo: ${modo} · offset ${off}"
    echo "COMPOSE_PROJECT_NAME=${proyecto}"
    echo "PREFIJO_CONTENEDOR=${prefijo}"
    echo "OFFSET_WORKTREE=${off}"
    echo "PUERTO_POSTGRES=${pg}"
    echo "PUERTO_BACKEND=${back}"
    echo "PUERTO_FRONTEND=${front}"
    echo "# DATABASE_URL es la verdad DEL HOST (los npm de backend/ la usan tal cual)."
    echo "# El backend DENTRO de compose no la lee: su URL interna la arma el propio"
    echo "# docker-compose.yml contra el servicio 'postgres'. Un solo significado por"
    echo "# variable — mezclarlos es lo que hacía que 'localhost' fuera correcto afuera"
    echo "# y apuntara al vacío adentro del contenedor."
    echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${pg}/${DB_NAME}"
    echo "FRONTEND_URL=http://localhost:${front}"
    echo "API_PUBLIC_URL=http://localhost:${back}"
    echo "# ⛔ API_PROXY_TARGET NO se escribe acá a propósito: adentro de compose el"
    echo "# destino correcto es http://backend:3000 (red interna, ADR-022) y ése es el"
    echo "# default del compose. Ponerlo en el .env como localhost:<puerto> haría que el"
    echo "# frontend se proxee a sí mismo."
  } >> "$tmp"
  mv "$tmp" "$env_file"
}

# ── Puertos ──────────────────────────────────────────────────────────────────
# Quién tiene un puerto. Mira Docker Y el host: un proceso suelto en el puerto
# —un `npm run dev` olvidado, un backend de otra sesión— no aparece en docker ps,
# y descubrirlo cuando `up` falla es más caro que preguntarlo antes.
dueno_puerto() {
  local p="$1" d
  d="$(docker ps -a --filter "publish=${p}" --format '{{.Names}}' 2>/dev/null | head -1)"
  if [ -n "$d" ]; then echo "contenedor ${d}"; return; fi
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "proceso $(lsof -nP -iTCP:"$p" -sTCP:LISTEN -Fc 2>/dev/null | grep '^c' | head -1 | cut -c2-) (fuera de Docker)"
  fi
}

# Los cuatro nombres de contenedor que este worktree puede tener. Enumerarlos es lo
# que permite comparar EXACTO más abajo.
mis_contenedores() {
  echo "$contenedor_db"
  echo "${prefijo}_postgres"; echo "${prefijo}_backend"; echo "${prefijo}_frontend"
}

# Un puerto está libre para MÍ si nadie lo tiene, o si lo tiene un contenedor de este
# mismo worktree (entonces es un reset normal, no una colisión).
#
# ⚠️ Comparación exacta y no `case "$d" in *"${prefijo}_"*`, que era lo que había: un
# substring da por propio el contenedor de un vecino cuyo nombre CONTENGA el mío
# —medido: con prefijo `wt-costo`, `wt-costo_x_backend` matcheaba—. Es la misma familia
# del bug del `grep "^${proyecto}-"` de las imágenes, y la cazó la revisión en la
# segunda vuelta, después de que yo arreglara la otra mitad.
libre_para_mi() {
  local d nombre c; d="$(dueno_puerto "$1")"
  [ -z "$d" ] && return 0
  # `dueno_puerto` devuelve "contenedor <nombre>" o "proceso …": solo el primero puede
  # ser mío, y se compara contra la lista, no contra un patrón.
  case "$d" in
    "contenedor "*) nombre="${d#contenedor }" ;;
    *) return 1 ;;
  esac
  while read -r c; do [ "$nombre" = "$c" ] && return 0; done < <(mis_contenedores)
  return 1
}

offsets_ajenos() {
  local wt off
  git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
    [ "$wt" = "$raiz" ] && continue
    [ -f "$wt/.env" ] || continue
    off="$(grep '^OFFSET_WORKTREE=' "$wt/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
    [ -n "$off" ] && echo "$off $wt"
  done
}

elegir_offset() {
  local pedido="${1:-}" registrado ajenos off
  registrado="$(leer_env OFFSET_WORKTREE)"
  ajenos="$(offsets_ajenos | awk '{print $1}')"

  if [ -n "$pedido" ]; then
    if ! [[ "$pedido" =~ ^[0-9]+$ ]] || [ "$pedido" -lt "$OFF_MIN" ] || [ "$pedido" -gt "$OFF_MAX" ]; then
      red "✖ Offset inválido: '${pedido}'. Usá uno entre ${OFF_MIN} y ${OFF_MAX} (el 0 es del checkout principal)."
      exit 1
    fi
    echo "$pedido"; return
  fi

  # Un offset ya registrado se reusa: tiene que ser estable para que el `.env`, la
  # pestaña del navegador y el MCP de esta sesión no se muevan entre corridas.
  if [ -n "$registrado" ]; then echo "$registrado"; return; fi

  for off in $(seq "$OFF_MIN" "$OFF_MAX"); do
    echo "$ajenos" | tr ' ' '\n' | grep -qx "$off" && continue
    libre_para_mi $((BASE_PG + off))    || continue
    libre_para_mi $((BASE_BACK + off))  || continue
    libre_para_mi $((BASE_FRONT + off)) || continue
    echo "$off"; return
  done
  red "✖ No hay offset libre entre ${OFF_MIN} y ${OFF_MAX}."
  ylw "  Corré './scripts/entorno.sh verificar' y bajá algún entorno que no se use."
  exit 1
}

# Se niega si los tres puertos del offset no son míos, NOMBRANDO al dueño. Es el
# chequeo que convierte una colisión en un mensaje en vez de un `up` que falla
# a mitad, o peor, que se roba el puerto de una suite ajena.
exigir_puertos_libres() {
  local off="$1" p d falla=0
  for p in $((BASE_PG + off)) $((BASE_BACK + off)) $((BASE_FRONT + off)); do
    if ! libre_para_mi "$p"; then
      d="$(dueno_puerto "$p")"; red "✖ El puerto ${p} (offset ${off}) lo tiene: ${d}"; falla=1
    fi
  done
  local ajeno
  ajeno="$(offsets_ajenos | awk -v o="$off" '$1==o {print $2}')"
  if [ -n "$ajeno" ]; then
    red "✖ El offset ${off} ya está registrado en otro worktree:"; ylw "  $ajeno"; falla=1
  fi
  [ "$falla" -eq 1 ] && { ylw "  Elegí otro con --offset N, o bajá ese entorno."; exit 1; }
  return 0
}

# El slug sale del basename del worktree, que **no es único**: dos clones distintos del
# repo pueden tener un worktree con el mismo nombre, y `git worktree list` no ve el otro
# clon. Antes de adoptar un contenedor, se le pregunta a qué ruta pertenece; si no es
# ésta, es de otro árbol y hay que negarse en vez de apropiárselo.
exigir_identidad() {
  local c="$1" campo="$2" dueno
  docker inspect "$c" >/dev/null 2>&1 || return 0
  dueno="$(docker inspect -f "$campo" "$c" 2>/dev/null || true)"

  # La etiqueta VIEJA de `db-aislada.sh`, que este commit borra. Los contenedores que
  # ya están corriendo cuando el cambio entra la llevan a ella y no a la nueva: sin
  # este fallback, la migración —o sea el día exacto en que esto se mergea— cae en la
  # rama de "no sé de quién es". Medido sobre los dos worktrees vivos el 2026-09-20.
  if [ -z "$dueno" ]; then
    dueno="$(docker inspect -f '{{index .Config.Labels "startup-app.db-aislada"}}' "$c" 2>/dev/null || true)"
  fi

  # ⚠️ No saber de quién es NO es permiso. Antes esta rama devolvía 0 —y era la ÚNICA
  # alcanzable, porque `index` sobre una clave que no está devuelve la cadena vacía y
  # nunca el literal `<no value>`—, así que cualquier contenedor sin la etiqueta nueva
  # se adoptaba sin preguntar y el `docker rm -f` de más abajo se lo llevaba. En un
  # frente cuyo punto es no destruir lo ajeno, el silencio no puede ser un sí.
  if [ -z "$dueno" ]; then
    red "✖ El contenedor '${c}' ya existe y no puedo probar de quién es."
    ylw "  No tiene ninguna etiqueta de pertenencia, así que no lo toco: podría ser de"
    ylw "  otra sesión. Si es tuyo y sobró, borralo a mano y repetí:"
    ylw "    docker rm -f ${c}"
    exit 1
  fi

  if [ "$dueno" != "$raiz" ]; then
    red "✖ El contenedor '${c}' ya existe pero pertenece a otro árbol:"
    ylw "  su ruta : ${dueno}"
    ylw "  la mía  : ${raiz}"
    ylw "  Dos worktrees con el mismo nombre de carpeta en clones distintos comparten"
    ylw "  nombre de contenedor. Renombrá este worktree o bajá ese entorno."
    exit 1
  fi
}

modo_actual() {
  if docker inspect "${prefijo}_backend" >/dev/null 2>&1; then echo stack
  elif docker inspect "$contenedor_db" >/dev/null 2>&1; then echo db
  else echo ninguno; fi
}

# Los dos modos publican el MISMO puerto de Postgres, así que no pueden convivir.
# Se exige bajar el otro a mano en vez de borrarlo por cuenta propia: el que está
# arriba puede tener una suite corriendo encima.
exigir_modo_compatible() {
  local quiero="$1" hay; hay="$(modo_actual)"
  [ "$hay" = ninguno ] && return 0
  [ "$hay" = "$quiero" ] && return 0
  red "✖ Este worktree ya tiene el entorno en modo '${hay}' y pediste '${quiero}'."
  ylw "  Los dos publican el mismo puerto de Postgres. Bajá el actual primero:"
  ylw "    ./scripts/entorno.sh borrar"
  exit 1
}

esperar_pg() {
  local nombre="$1" espera=0
  ylw "▶ Esperando a que ${nombre} acepte conexiones…"
  # pg_isready no alcanza: el entrypoint de la imagen levanta un Postgres temporal
  # para inicializar y lo reinicia. Se espera una consulta real por TCP, que es lo
  # que va a hacer la suite.
  until docker exec "$nombre" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1; do
    if [ "$espera" -ge 60 ]; then
      red "✖ ${nombre} no respondió en 60s. Últimas líneas:"; docker logs --tail 20 "$nombre" 2>&1; exit 1
    fi
    sleep 1; espera=$((espera + 1))
  done
}

# ── Comandos ─────────────────────────────────────────────────────────────────
cmd_db() {
  exigir_worktree
  local off; off="$(elegir_offset "${1:-}")"
  exigir_identidad "$contenedor_db" '{{index .Config.Labels "startup-app.worktree"}}'
  exigir_modo_compatible db
  exigir_puertos_libres "$off"
  local pg=$((BASE_PG + off))
  ylw "▶ Recreando ${contenedor_db} en el puerto ${pg} (offset ${off})…"
  docker rm -f "$contenedor_db" >/dev/null 2>&1 || true
  # tmpfs: la base vive en memoria. Es desechable a propósito —cada reset empieza
  # de cero— y así la suite no paga disco.
  docker run -d --name "$contenedor_db" \
    -p "${pg}:5432" \
    -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    --tmpfs /var/lib/postgresql/data \
    --label startup-app.worktree="$raiz" \
    postgres:15-alpine >/dev/null
  esperar_pg "$contenedor_db"
  escribir_env "$off" db
  grn "✓ Postgres aislado listo: ${contenedor_db} en localhost:${pg}, base vacía."
  ylw "  Corré: cd backend && npm run test:e2e   (la primera suite crea el esquema y siembra)"
  imprimir_acceso_base "$pg" "$contenedor_db"
}

cmd_stack() {
  exigir_worktree
  local off; off="$(elegir_offset "${1:-}")"
  exigir_identidad "${prefijo}_postgres" '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'
  exigir_modo_compatible stack
  exigir_puertos_libres "$off"
  escribir_env "$off" stack   # compose lee el .env: se escribe ANTES de levantar
  local pg=$((BASE_PG + off)) back=$((BASE_BACK + off)) front=$((BASE_FRONT + off))
  ylw "▶ Levantando el stack '${proyecto}' (offset ${off}: pg ${pg} · api ${back} · front ${front})…"
  ylw "  La primera vez construye las imágenes; puede tardar minutos si la caché de build está vacía."
  compose up -d
  esperar_pg "${prefijo}_postgres"
  ylw "▶ Esperando el 'Seed complete' del backend…"
  local espera=0
  until [ "$(docker logs "${prefijo}_backend" 2>&1 | grep -c 'Seed complete' || true)" -ge 1 ]; do
    if [ "$espera" -ge 180 ]; then
      red "✖ El backend no sembró en 180s. Últimas líneas:"; docker logs --tail 20 "${prefijo}_backend" 2>&1; exit 1
    fi
    sleep 3; espera=$((espera + 3))
  done
  grn "✓ Stack propio arriba: front http://localhost:${front} · api http://localhost:${back}/api/docs"
  ylw "  Playwright y el smoke de este worktree van contra esos puertos, sin pedir turno."
  imprimir_acceso_base "$pg" "${prefijo}_postgres"
}

# El acceso a la base de este worktree se imprime, no se configura. Por qué: el MCP
# de Postgres del `.mcp.json` apunta al 5432 del checkout principal y **no se puede
# hacer uno por worktree** —`claude mcp add --scope local` se llavea por raíz del
# repo, que todos los worktrees comparten (medido 2026-09-20)—. Un conector que
# contesta la base equivocada EN SILENCIO es el mismo error que el resguardo viejo
# con otra cara, así que lo que queda es decirlo donde la sesión lo va a leer.
imprimir_acceso_base() {
  local pg="$1"
  ylw "  Para consultar ESTA base:"
  echo "    psql -h localhost -p ${pg} -U ${DB_USER} -d ${DB_NAME}     # contraseña: ${DB_PASSWORD}"
  echo "    docker exec -it ${2} psql -U ${DB_USER} -d ${DB_NAME}      # si no tenés psql en el host"
  ylw "  ⚠️ El conector MCP 'postgres' apunta al 5432 del checkout principal, NO a esta base."
}

# Los nombres que compose le da a lo de ESTE proyecto, enumerados en vez de
# grepeados: son dos imágenes y un volumen, y saberlos de memoria es más seguro que
# un patrón que puede alcanzar al worktree vecino.
imagenes_del_proyecto() {
  local i
  for i in "${proyecto}-backend" "${proyecto}-frontend"; do
    docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' --filter "reference=${i}:latest" 2>/dev/null || true
  done
}
volumenes_del_proyecto() {
  docker volume ls -q --filter "name=^${proyecto}_postgres_data$" 2>/dev/null || true
}

cmd_estado() {
  local modo off; modo="$(modo_actual)"; off="$(leer_env OFFSET_WORKTREE)"
  echo "worktree:  $raiz"
  echo "proyecto:  $proyecto   ·  modo: $modo  ·  offset: ${off:-—}"
  if [ -n "$off" ]; then
    printf 'puertos:   pg %s · api %s · front %s\n' $((BASE_PG + off)) $((BASE_BACK + off)) $((BASE_FRONT + off))
  fi
  echo ".env →     $(leer_env DATABASE_URL)"
  if [ -n "$off" ]; then
    local cont; cont="$([ "$(modo_actual)" = stack ] && echo "${prefijo}_postgres" || echo "$contenedor_db")"
    imprimir_acceso_base "$((BASE_PG + off))" "$cont"
  fi
  local c
  for c in "$contenedor_db" "${prefijo}_postgres" "${prefijo}_backend" "${prefijo}_frontend"; do
    if docker inspect "$c" >/dev/null 2>&1; then
      printf '  %-44s %s\n' "$c" "$(docker inspect -f '{{.State.Status}}' "$c")"
    fi
  done
  # Lo colgado se reporta porque `down -v` NO borra las imágenes del proyecto
  # (medido 2026-09-20: 2,83 GB). Sin esto, cada worktree abandonado filtra ese
  # espacio en silencio y nadie se entera hasta que el disco molesta.
  local imgs vols
  # ⚠️ Coincidencia EXACTA y no por prefijo. `grep "^${proyecto}-"` parecía equivalente y
  # no lo es: con worktrees `costo` y `costo-cero` —nombres que este repo ya usa— el
  # patrón de `wt-costo` matchea las imágenes de `wt-costo-cero`. Lo cazó la revisión
  # independiente: `borrar --purgar` le habría borrado la imagen al vecino.
  imgs="$(imagenes_del_proyecto)"
  vols="$(volumenes_del_proyecto)"
  if [ -n "$imgs" ] || [ -n "$vols" ]; then
    ylw "colgado de este proyecto (lo borra 'borrar --purgar'):"
    [ -n "$imgs" ] && echo "$imgs" | sed 's/^/  imagen  /'
    [ -n "$vols" ] && echo "$vols" | sed 's/^/  volumen /'
  fi
  # `return 0` explícito: el último `[ -n … ] && echo` devuelve 1 cuando no hay nada
  # colgado, y con `set -e` eso hacía salir a `estado` con código 1 **informando bien**.
  # Un comando de lectura que sale en error es un rojo falso para quien lo encadene.
  return 0
}

cmd_borrar() {
  local purgar="${1:-}"
  compose down -v >/dev/null 2>&1 || true
  docker rm -f "$contenedor_db" >/dev/null 2>&1 || true
  if [ "$purgar" = "--purgar" ]; then
    imagenes_del_proyecto | awk '{print $1}' | while read -r i; do
      [ -n "$i" ] && docker rmi "$i" >/dev/null 2>&1 || true
    done
    grn "✓ Entorno de este worktree borrado, imágenes del proyecto incluidas."
  else
    grn "✓ Entorno de este worktree borrado."
    ylw "  Las imágenes del proyecto siguen ocupando disco: 'borrar --purgar' las saca."
  fi
  ylw "  El .env sigue apuntando al offset de este worktree; 'db' o 'stack' lo vuelven a levantar."
}

# Falla si dos worktrees comparten offset, proyecto o puerto publicado. Es el nivel
# de runtime del chequeo de aislamiento: el estático (check-aislamiento.mjs) mira el
# repo, éste mira la máquina.
cmd_verificar() {
  local falla=0 tabla wt off proy
  tabla="$(mktemp)"; trap 'rm -f "$tabla"' RETURN

  while read -r wt; do
    [ -f "$wt/.env" ] || continue
    off="$(grep '^OFFSET_WORKTREE=' "$wt/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
    proy="$(grep '^COMPOSE_PROJECT_NAME=' "$wt/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
    printf '%s\t%s\t%s\n' "${off:-—}" "${proy:-—}" "$wt" >> "$tabla"
    printf '  %-56s offset %-4s proyecto %s\n' "$(basename "$wt")" "${off:-—}" "${proy:-—}"
  done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')

  # Un valor repetido no alcanza como reporte: hay que decir ENTRE QUIÉNES, porque lo
  # que el que lee tiene que hacer es bajar uno de los dos, y para eso necesita saber
  # cuáles son. Nombrar solo el valor deja el diagnóstico a medias.
  nombrar_repetidos() {
    local col="$1" etiqueta="$2" v
    for v in $(awk -F'\t' -v c="$col" '$c != "—" {print $c}' "$tabla" | sort | uniq -d); do
      red "✖ ${etiqueta} '${v}' declarado en más de un worktree:"
      awk -F'\t' -v c="$col" -v v="$v" '$c == v {print "    " $3}' "$tabla" | while read -r l; do ylw "$l"; done
      falla=1
    done
  }
  nombrar_repetidos 1 "Offset"
  nombrar_repetidos 2 "Proyecto de compose"

  # Y que lo declarado coincida con la máquina: un `.env` que dice un puerto y un
  # contenedor que publica otro es un registro podrido, y el que viene después le
  # cree al archivo.
  local decl real
  decl="$(leer_env PUERTO_POSTGRES)"
  if [ -n "$decl" ] && docker inspect "${prefijo}_postgres" >/dev/null 2>&1; then
    real="$(docker port "${prefijo}_postgres" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://')"
    if [ -n "$real" ] && [ "$real" != "$decl" ]; then
      red "✖ Este worktree declara PUERTO_POSTGRES=${decl} pero su contenedor publica ${real}."
      falla=1
    fi
  fi

  [ "$falla" -eq 1 ] && return 1
  grn "✓ Ningún worktree comparte offset, proyecto ni puerto publicado."
}

# Para que NINGÚN otro script vuelva a derivar esto por su cuenta: reset-db.sh
# evalúa esta salida. Dos derivaciones del mismo dato es exactamente el bug que
# este frente vino a matar.
cmd_derivar() {
  local off; off="$(leer_env OFFSET_WORKTREE)"
  if es_principal; then echo "ENTORNO_ES_PRINCIPAL=si"; else echo "ENTORNO_ES_PRINCIPAL=no"; fi
  # Lo DERIVADO y lo DECLARADO van los dos, separados a propósito: que no coincidan es
  # precisamente el estado que dejó el incidente del 2026-09-20 —un worktree con
  # `COMPOSE_PROJECT_NAME=tecnica_fullstack` en su `.env`—, y quien destruye algo tiene
  # que poder comparar los dos números en vez de confiar en uno.
  echo "ENTORNO_PROYECTO_DECLARADO=$(leer_env COMPOSE_PROJECT_NAME)"
  echo "ENTORNO_PROYECTO=${proyecto}"
  echo "ENTORNO_PREFIJO=${prefijo}"
  echo "ENTORNO_OFFSET=${off}"
  echo "ENTORNO_MODO=$(modo_actual)"
  if [ -n "$off" ]; then
    echo "ENTORNO_PUERTO_POSTGRES=$((BASE_PG + off))"
    echo "ENTORNO_PUERTO_BACKEND=$((BASE_BACK + off))"
    echo "ENTORNO_PUERTO_FRONTEND=$((BASE_FRONT + off))"
  fi
  echo "ENTORNO_CONTENEDOR_BACKEND=${prefijo}_backend"
  echo "ENTORNO_CONTENEDOR_DB=${contenedor_db}"
}

sub="${1:-}"; shift || true
offset_pedido=""
while [ $# -gt 0 ]; do
  case "$1" in
    --offset) offset_pedido="${2:-}"; shift 2 ;;
    --purgar) purgar=--purgar; shift ;;
    *) red "✖ Opción desconocida: $1"; exit 1 ;;
  esac
done

case "$sub" in
  db)        cmd_db "$offset_pedido" ;;
  stack)     cmd_stack "$offset_pedido" ;;
  estado)    cmd_estado ;;
  borrar)    cmd_borrar "${purgar:-}" ;;
  verificar) cmd_verificar ;;
  derivar)   cmd_derivar ;;
  *)
    red "✖ Uso: ./scripts/entorno.sh db|stack [--offset N] | estado | borrar [--purgar] | verificar | derivar"
    exit 1 ;;
esac
