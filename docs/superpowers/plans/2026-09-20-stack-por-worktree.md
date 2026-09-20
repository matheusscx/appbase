# Plan: un stack completo por worktree (matar el turno manual)

> **Para agentes:** ejecutar con `superpowers:executing-plans`, tarea por tarea, marcando los
> checkboxes. **No empezar sin el `Status: Approved`.**

**Status:** In Progress — aprobado por el owner el 2026-09-20 sobre el hash `48a150bf`
**Date:** 2026-09-20
**Owner:** Cesar Matheus
**Spec:** [`../specs/2026-09-20-stack-por-worktree-design.md`](../specs/2026-09-20-stack-por-worktree-design.md)
— el plan argumenta desde la spec; leer las dos.

**Goal:** que cada worktree tenga su propio proyecto de compose (Postgres + backend + frontend)
con sus propios puertos, para que el turno manual que hoy reparte la sesión orquestadora deje de
existir para Playwright, el smoke manual y `reset-db.sh`.

**Costo medido del resultado:** 73 s y ~3,5 GB **de disco** por stack; 915 MB de RAM con carga,
sobre 3,83 GiB asignados a Docker. Tres stacks entran, ajustados (spec §2).

---

## Global Constraints

- **Nunca `git commit --no-verify`.** Stagear **por ruta explícita**, nunca `git add -A`: hay
  tres sesiones trabajando en el repo.
- **Nunca `git stash`** — el stack de stash es compartido entre worktrees.
- **No mergear ni pushear.** Al terminar: rama y hash a la sesión orquestadora.
- **Los defaults del compose son los puertos y nombres de hoy.** Es lo que hace que cada tarea
  sea segura por separado: con los defaults puestos, el checkout principal no distingue el árbol
  viejo del nuevo. Si una tarea rompe esa propiedad, **se detiene**: es la diferencia entre
  tareas independientes y un solo cambio partido en pedazos peligrosos.
- **Un solo escritor del `.env`:** `entorno.sh`. Ningún otro script ni tarea escribe
  `DATABASE_URL`, puertos ni `COMPOSE_PROJECT_NAME`.
- **Reversibilidad:** todo el cambio vive en archivos trackeados (`git revert` alcanza). Lo
  único no trackeado que se toca son los `.env` locales, así que `entorno.sh` **imprime los
  valores que reemplaza** antes de escribir.
- Este worktree **no tiene `.env`**: la tarea 2 lo crea con `entorno.sh`.

---

## Scope

Infraestructura de desarrollo: `docker-compose.yml`, `.env.example`, `scripts/`,
`frontend/playwright.config.ts`, el hook pre-commit, el workflow de CI y las docs.

## Out of scope

- **La limpieza de los 138,7 GB de basura de Docker ya acumulada** (spec §9). Es destructiva, de
  una vez, con tres sesiones vivas, y la decide el owner → tarea 7 solo la **anota** en
  `pendientes.md` con el número medido.
- Código de backend y frontend: este frente no toca `src/`.
- El workspace compartido del monorepo (tema propio del owner).

---

## Tareas

### - [x] 1. `docker-compose.yml` y `.env.example` parametrizados, con los defaults de hoy

**Intención:** que el compose pueda describir un stack por worktree sin cambiar en nada el del
checkout principal.

- `container_name: ${PREFIJO_CONTENEDOR:-tecnica}_<servicio>` en los tres servicios.
- `ports` con `${PUERTO_POSTGRES:-5432}` / `${PUERTO_BACKEND:-3000}` / `${PUERTO_FRONTEND:-5173}`.
  El offset es del **lado host**: el frontend sigue en 3000 adentro del contenedor.
- `.env.example`: `COMPOSE_PROJECT_NAME` **comentado**, con el porqué (esa línea copiada es la
  causa raíz, spec §1). Agregar `PUERTO_*` y `PREFIJO_CONTENEDOR` comentados con su rango.
- **No** tocar `container_name` por la vía de borrarlo: sin nombre fijo, un worktree sin setup
  adopta en silencio los contenedores de otro (spec §3.1).

**Verificación — que sea un no-op para main:**

```bash
# la config resuelta del árbol nuevo tiene que ser idéntica a la del árbol viejo
git show HEAD:docker-compose.yml > /tmp/viejo-src.yml
docker compose --project-directory . -f /tmp/viejo-src.yml config > /tmp/viejo.yml
docker compose -f docker-compose.yml config > /tmp/nuevo.yml
diff /tmp/viejo.yml /tmp/nuevo.yml; echo "EXIT: $?"   # EXIT 0 = idéntico
```

⚠️ **`--project-directory .` no es opcional** (verificado 2026-09-20): sin él, compose resuelve
los bind-mounts relativos contra `/tmp` y el `diff` sale sucio por rutas —`source: /tmp/backend`—,
o sea que el chequeo se ensucia justo donde tiene que discriminar.

⚠️ El `diff` se corre **desde el checkout principal o con su `.env`**, que es el caso que tiene
que quedar igual. Sin `.env` los defaults también deben dar los puertos de hoy.

### - [x] 2. `scripts/entorno.sh`: único dueño del `.env`, y `db-aislada.sh` se borra

**Intención:** un solo script que derive todo del worktree y sea el único que escribe el `.env`.

Modos:

| Modo | Qué hace |
|---|---|
| `db` | solo Postgres (lo que hace hoy `db-aislada.sh reset`), **adoptando** un `pg_<slug>` existente |
| `stack` | proyecto de compose completo, con su offset |
| `estado` | offset, proyecto, puertos, contenedores, y **si hay imágenes/volúmenes colgados** |
| `borrar [--purgar]` | baja lo del worktree; `--purgar` borra también las imágenes del proyecto |
| `verificar` | recorre **todos** los worktrees y falla nombrando el par en conflicto |
| `derivar` | imprime `KEY=VALUE` (proyecto, prefijo, offset, puertos) para que otros scripts no vuelvan a derivar por su cuenta |

- **Offset:** el más bajo libre en 1–49; se registra en el `.env`; al re-correr se acepta si está
  libre **o si lo tienen los contenedores de este worktree** (`--filter publish=`, como hoy).
  Escape `--offset N`. Main es 0 y el script **se niega a correr en el checkout principal**
  (como hoy `db-aislada.sh`).
- El `.env` lleva también `FRONTEND_URL` y `API_PUBLIC_URL` con los puertos propios: son los
  links de invitación y los retornos de pasarela (spec §3.2).
- **Borrar `scripts/db-aislada.sh` en el mismo commit.** Un script borrado falla ruidoso; uno que
  sobrevive sigue escribiendo el `.env` por un camino que nadie mira.
- **Dos consumidores, una sola derivación:** `reset-db.sh` no re-implementa nada, le pregunta a
  `entorno.sh derivar`. Sin archivo nuevo de helpers.

**Desvío de alcance, decidido al ejecutar (2026-09-20).** Se tocó el `docker-compose.yml` una
segunda vez, más allá de lo que describía la tarea 1: el `DATABASE_URL` del contenedor del backend
**dejó de salir del `.env`** y se arma internamente contra el servicio `postgres`. El motivo
apareció leyendo `backend/test/setup-env.ts:8`, que traduce `@postgres:` → `@localhost:` para el
e2e del host **sin mover el puerto**: con un Postgres propio en 5433 esa traducción no alcanza, y
la misma variable no puede significar `localhost:5433` afuera y algo alcanzable adentro del
contenedor. Verificado que la config resuelta de main queda **byte a byte idéntica** (su `.env`
declara los mismos `DB_USER`/`DB_PASSWORD`/`DB_NAME`). En el mismo movimiento, `API_PROXY_TARGET`
pasó a estar comentado en `.env.example` y se borra del `.env`: copiado tal cual metía
`localhost:3000` en el contenedor del frontend, que entonces **se proxea a sí mismo**.

**Verificación:**
- `entorno.sh stack` en este worktree: los tres servicios responden en **sus** puertos, y
  `curl <front>/api/docs` → 200 (el proxy pega en su propio backend, ADR-022).
- `entorno.sh db` en un worktree que ya tiene `pg_<slug>`: lo **adopta**, no lo recrea (comparar
  el Id del contenedor antes y después).
- `entorno.sh verificar` con dos worktrees arriba: verde. Con dos `.env` puestos al mismo offset
  a mano: rojo, nombrando los dos worktrees.
- `entorno.sh` en el checkout principal: se niega.

### - [x] 3. `reset-db.sh`: el resguardo cambia de pregunta

**Intención:** que el script no pueda destruir un proyecto que no es de este worktree, y que lo
que valide sea el objetivo real y no un string del `.env`.

- Derivar proyecto y puertos de `entorno.sh derivar` y pasarle a compose **`-p` explícito**;
  nunca heredar el nombre del `.env`.
- Resguardo nuevo: (a) el proyecto a destruir es el de este worktree, y (b) el `DATABASE_URL` del
  `.env` apunta al puerto que **ese** proyecto publica. Si una falla → negarse **nombrando los
  dos valores**.
- **Los 7 literales de `tecnica_backend`** (48, 55, 64, 74, 189, 213, 223), en tres grupos:
  - código que resuelve el contenedor (48, 55, 189, 213, 223) → `docker compose -p <proj> ps -q backend`;
  - el comentario de la 64, que **queda falso**: hoy justifica que el `ESTADO` sea compartido
    *porque `tecnica_backend` es uno solo*. Reescribirlo con el porqué nuevo y pasar el archivo a
    `--git-dir` (por worktree);
  - el mensaje de error de la 74, que nombraría un contenedor inexistente.
- ⚠️ **Contar de nuevo antes de tocar** (`grep -c tecnica_backend scripts/reset-db.sh`): si el
  número no es 7, el árbol se movió y hay que releer.
- `docs/agent/caza-timeout-pool.sh` tiene un `tecnica_postgres` por lo mismo.

**Verificación — la propiedad, no la afirmación:**

```bash
# con el stack de main arriba y el de este worktree arriba:
docker inspect -f '{{.Id}}' tecnica_postgres tecnica_backend tecnica_frontend   # ANTES
docker logs tecnica_backend 2>&1 | grep -c 'Seed complete'                      # ANTES
./scripts/reset-db.sh            # desde ESTE worktree
# los tres Id y el contador de main tienen que quedar IDÉNTICOS
./scripts/reset-db.sh --verificar
```

⚠️ **Avisar a la sesión orquestadora antes de correr esto**: si el diseño está mal, lo que se
destruye es la base del checkout principal. No tiene datos productivos (decisión registrada del
owner) y el seed la reconstruye, pero se avisa igual y no se hace con un smoke ajeno en vuelo.
También correr el caso que **tiene** que fallar: un `.env` apuntando a otro puerto → el script se
niega.

### - [x] 4. Acceso a la base del worktree — el MCP por worktree NO existe; se sacó la dependencia

**Intención:** que el MCP conteste sobre la base de este worktree y no sobre la de main.

- `entorno.sh` registra un `postgres` de **scope local** para la ruta del worktree
  (`~/.claude.json` → `projects["<ruta>"].mcpServers`). El `.mcp.json` trackeado **no se toca**.
- **Comprobar, no suponer** (spec §3.6): que el local shadowee por nombre al de `.mcp.json`, y si
  hace falta reiniciar la sesión. Dejar escrito lo medido.
- Si el shadow **no** funciona: la salida es sacar el `postgres` del `.mcp.json` trackeado, lo que
  cambia la conducta de main → **detenerse y preguntar al owner**, no decidirlo acá.

⛔ **Medido el 2026-09-20, y el mecanismo quedó refutado, no postergado.** `claude mcp add --scope
local` corrido **desde el worktree** no guardó la config bajo la ruta del worktree: la guardó bajo
`projects["/Users/m2pro/cmatheus/startup-app"]`, o sea la clave del **checkout principal**. El
scope local se llavea por raíz del repo, que todos los worktrees comparten, así que **un MCP de
Postgres por worktree no se puede hacer por esta vía** — ni con otro nombre, porque el llaveado es
el mismo.

Efecto lateral que hubo que revertir: durante esos minutos el `postgres` de main apuntó a la base
de este worktree (5433). Se revirtió con `claude mcp remove postgres -s local`, verificado que
volvió a `localhost:5432` y que `~/.claude.json` no quedó con entradas colgadas.

Lo que sí se midió y sirve para la decisión: el scope local **sí gana** sobre el del `.mcp.json`
(quedó `Connected` contra 5433), y Claude Code avisa que el mismo nombre está definido en dos
scopes. O sea que el shadow funciona; lo que no funciona es que sea **por worktree**.

**Cómo se cerró:** el owner eligió acceso directo con `psql`, así que **la dependencia se sacó en vez
de reemplazar el mecanismo**. `entorno.sh` imprime el `psql` que pega en la base de este worktree
—host, puerto, usuario y base resueltos del `.env`, más la variante `docker exec` para quien no
tenga el cliente— y avisa en la misma línea que el conector MCP apunta al 5432 del checkout
principal y no a esta base. El `.mcp.json` trackeado no se tocó: cero cambio de conducta para main.

**Lo que quedaba antes de eso, para que se lea el razonamiento completo:** las dos salidas
restantes eran las que el owner ya había descartado al elegir esta opción, así que la decisión
volvió a él con evidencia nueva. Propuesta de este frente, que no estaba en la mesa
cuando decidió: dejar el `.mcp.json` intacto y que `entorno.sh` **avise en pantalla** que el MCP
apunta al 5432 de main y no a la base de este worktree, imprimiendo el `psql` que sí pega en la
propia. No cambia config global, no toca la herramienta de main, y pone la verdad donde la sesión
la va a leer.

### - [x] 5. Playwright: que no pueda correr contra el stack de otro

**Intención:** cerrar el fallo que informa éxito — olvidarse de `E2E_BASE_URL` hoy hace que la
suite corra contra el 5173 ajeno y **pase**.

- `playwright.config.ts` deriva `baseURL` y la URL de API del `.env` del worktree cuando no hay
  `E2E_*` ni `CI`.
- **Fail-fast:** si el worktree tiene offset registrado y la URL resuelta no es la suya, la config
  aborta con el motivo.
- Las tres puertas que existen siguen mandando si están puestas: `e2e/support/api.ts:14`,
  `e2e/inicio/dashboard.spec.ts:45`, `e2e/salones/cuenta-hasta-cobro.spec.ts:33`.
- **CI intacto:** `process.env.CI` sigue decidiendo el `webServer` y ahí no hay `.env`.

**Verificación:** `npm run e2e:smoke` contra el stack propio pasa; con el `.env` apuntando a otro
offset, la config **aborta** en vez de correr; `CI=1` resuelve como hoy.

### - [x] 6. `scripts/check-aislamiento.mjs` — el chequeo que no depende de acordarse

**Intención:** que volver a compartir algo ponga rojo un gate, no una revisión.

Familia de `check-docs-links.mjs` (mismo estilo, `--staged` para el hook). Falla si:

- `docker-compose.yml` publica un puerto host literal (un `"NNNN:` sin `${`);
- un `container_name` no lleva variable;
- `.env.example` vuelve a fijar `COMPOSE_PROJECT_NAME` sin comentar;
- `scripts/reset-db.sh` menciona `tecnica_backend|postgres|frontend` literal.

Engancharlo en **CI** (`.github/workflows/ci.yml`, junto a `docs · enlaces internos`) y en
`.githooks/pre-commit`.

**Verificación:** con el árbol corregido, verde. **Y un mutante por regla**: re-hardcodear cada
una de las cuatro cosas, una a la vez, y comprobar que el chequeo se pone rojo **por esa regla**
—no por otra— y que al revertir vuelve a verde. Un mutante que sobrevive es un chequeo decorativo.

### - [x] 7. Documentación (mismo commit que el código)

- **`CLAUDE.md` §Comandos:** hoy documenta `db-aislada.sh` y **el turno**. Reescribir: un stack por
  worktree, `entorno.sh`, y el turno **eliminado** para los cuatro casos. Nombrar qué queda
  compartido (daemon de Docker, stash, espacio de puertos) — la sección no puede quedar
  prometiendo que ahora es imposible equivocarse.
- **`docs/ARCHITECTURE.md`:** los puertos fijos 3000/5173/5432 pasan a ser "los del offset 0".
- **`docs/agent/pendientes.md`:** entrada nueva sobre la basura de Docker que el mecanismo viejo
  acumulaba. ⚠️ **Medir el número al escribir la entrada y publicar el comando, no citar los
  138,7 GB de este plan**: la sesión orquestadora limpió lo acumulado el 2026-09-20 (volúmenes sin
  usar, caché de build e imágenes no referenciadas), así que ese número ya está viejo — y un conteo
  de basura envejece por definición, así que la entrada lleva `docker system df` y la fecha de la
  medición al lado del número. Solo lo abierto, sin ✅.
- **`docs/agent/anti-patterns.md`:** ⛔ **no** agregar entrada. La regla 1 del archivo pide un bug
  ya cometido, y el de este frente (resguardo que valida una cosa y destruye otra) queda cerrado
  por el chequeo estático de la tarea 6 → si entra, entra como `✅` con su referencia, y solo si
  el owner lo pide. **Decidirlo con el owner, no por cuenta propia.**

---

## Verification

Gate completo, **entero y sin subsets** — ningún `-t`:

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
node scripts/check-docs-links.mjs && node scripts/check-aislamiento.mjs
```

- **Leer el exit code, no la última línea** (`; echo "EXIT: $?"`).
- **`test:e2e` va contra el Postgres propio** (`entorno.sh db` o el del stack), y la corrida que
  vale es la primera sobre base recién sembrada.
- **No tocar un `.ts` del backend con el e2e corriendo**, y cerrar con
  `./scripts/reset-db.sh --verificar`.
- **Revisión independiente** (`verify-feature` paso 7) sobre el diff staged, aunque el pre-commit
  no la exija: el diff no toca services ni `.vue` de pages/components, pero sí los scripts que
  pueden destruir la base de otra sesión.

### Criterio de aceptación del frente

1. Dos stacks arriba a la vez, cada uno respondiendo en sus puertos.
2. `reset-db.sh` en un worktree deja los **Id de contenedor y el contador de seeds** del otro
   **idénticos** (valores antes/después escritos, no afirmados).
3. `npm run e2e` de un worktree corre contra su propio frontend, y **aborta** si apunta a otro.
4. `check-aislamiento.mjs` verde, y rojo con cada uno de los cuatro mutantes.
5. `entorno.sh verificar` nombra un conflicto plantado a mano.
6. El checkout principal: `docker compose config` idéntico al de antes del cambio.

---

## Decisions / Open questions

| Decisión | Quién |
|---|---|
| Opción A sobre back/front en el host | owner, 2026-09-20 — *"dale con A"* |
| El MCP de Postgres apunta a la base del worktree | owner, 2026-09-20 — elegido entre cuatro opciones preguntadas antes de diseñar (ver spec §10) |
| `db-aislada.sh` se absorbe y se borra | spec §3.3 |
| El modo barato (solo Postgres) es el default para `test:e2e` | spec §2 |
| La limpieza de los 138,7 GB va a backlog, no a este frente | spec §9 |

**Cómo se lee la columna:** `owner, <fecha>` significa que **él lo eligió explícitamente**, y al
lado va cómo lo eligió, para que sea auditable y no un "hecho congelado" sin dueño. Una
referencia a `spec §X` significa que **lo decidió el diseño** y se puede discutir leyendo ese
argumento.

**Abiertas:**

1. **El shadow del MCP local** (tarea 4): si no funciona, la salida toca el `.mcp.json` trackeado
   y cambia la conducta de main → se pregunta.
2. **¿Entra una entrada en `anti-patterns.md`?** (tarea 7) — la decide el owner.
3. **El turno para la tarea 3**: la verificación de que no destruyo lo ajeno se corre con el stack
   de main arriba. Se avisa a la orquestadora; no se pide turno para *usarlo*, se avisa para no
   correrlo con un smoke en vuelo.
