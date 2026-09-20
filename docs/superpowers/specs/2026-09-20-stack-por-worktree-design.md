# Diseño: un stack completo por worktree

**Date:** 2026-09-20
**Owner:** Cesar Matheus
**Estado:** aprobado el enfoque (opción A), pendiente de aprobación el plan.

**Problema:** dos sesiones no pueden correr Playwright ni un smoke manual a la vez, porque
backend y frontend son **uno solo** para todos los worktrees. El turno lo reparte a mano una
sesión orquestadora: una red con una persona adentro.

---

## 1. La causa raíz, medida

`.env.example:64` trae `COMPOSE_PROJECT_NAME=tecnica_fullstack`. Cada worktree copió ese
ejemplo, así que **los cuatro `.env` que existen declaran el mismo proyecto de compose**
(verificado uno por uno el 2026-09-20). De ahí que `reset-db.sh` corrido en un worktree haga
`down -v` sobre los contenedores de todos.

**Y el proyecto compartido no es el único mecanismo.** El compose fija
`container_name: tecnica_postgres|backend|frontend`, que es un nombre **global** del daemon.
Arreglar solo el nombre de proyecto deja el segundo stack sin poder arrancar; arreglar solo
`container_name` deja el `down -v` compartido. Los dos, o ninguno.

**Por qué exigir el puerto en el resguardo de `reset-db.sh:142` no cerraba nada:** ese
resguardo valida el **`.env`**, y lo que `down -v` destruye es el **proyecto de compose**, que
es compartido diga lo que diga el `.env`. Dos worktrees apuntando los dos al 5432 se siguen
pisando con el resguardo más estricto del mundo.

## 2. Mediciones — disco y RAM son dos cosas y van separadas

Un stack completo de prueba (proyecto y puertos propios) levantado el 2026-09-20 sobre un
worktree **sin `.env`**, y bajado después con `down -v`:

| Tiempo | medido |
|---|---|
| `build` (dos imágenes, `npm ci` adentro) | 40 s |
| `up -d` | 21 s |
| hasta `Seed complete` | 12 s |
| **total, de cero a stack usable** | **73 s** |

| **Disco** — marginal por stack | medido |
|---|---|
| imágenes del proyecto | **+2,83 GB** |
| volúmenes (`node_modules` back 221 MB + front 438 MB + datos pg 53 MB) | **+0,65 GB** |
| **total en disco por stack** | **≈ 3,5 GB** |

| **RAM** — es otro presupuesto, y no es el que aprieta | medido |
|---|---|
| stack **en reposo** | 423 MB (front 238 · back 167 · pg 18) |
| stack **con el backend trabajando** | **915 MB** (front 314 · back 546 · pg 55) † |
| solo Postgres (modo barato) | 35–38 MB |
| Docker asignado en esta máquina | 3,83 GiB |

† El número con carga lo midió la sesión orquestadora, no este frente; el de reposo lo medí
acá. **Tres stacks completos con carga son ~2,7 GB de los 3,83 GiB: entra, pero ajustado.**
Consecuencia de diseño, no comentario: **el modo barato (solo Postgres, 35 MB) es el default
para quien solo corre `test:e2e`**, y el stack completo se levanta cuando hace falta navegador.

⚠️ **Los 3,5 GB son disco, no memoria.** Se aclara porque leerlos como RAM hace parecer que
tres stacks no entran, y la conclusión es la opuesta.

**Lo que el probe además probó:**

- **El aislamiento es real:** `down -v` del proyecto de prueba borró solo lo suyo. Los tres IDs
  de contenedor del stack compartido y su contador de `Seed complete` quedaron **idénticos**
  antes y después.
- **Un worktree sin `.env` levanta el stack igual**, con los defaults del compose, incluido el
  proxy del front a su propio backend (`front /api/docs` → 200, ADR-022). El `.env` hace falta
  para los `npm` del host, no para los contenedores.
- **`down -v` NO borra las imágenes**: quedaron 2,83 GB colgados. Es el mecanismo que dejó
  vivas las imágenes `intelligent-taussig-880ae6-backend|frontend` (1,9 GB, de un worktree que
  ya no existe).

## 3. Diseño

### 3.1 `docker-compose.yml` parametrizado, con los defaults de hoy

```yaml
container_name: ${PREFIJO_CONTENEDOR:-tecnica}_postgres
ports: ["${PUERTO_POSTGRES:-5432}:5432"]     # backend 3000 · frontend ${PUERTO_FRONTEND:-5173}:3000
```

El offset aplica al **lado host**: el frontend sigue escuchando 3000 adentro del contenedor.

**`container_name` se queda parametrizado y no se borra.** Sin él, compose nombra por proyecto
y un worktree que se olvide del setup **adopta en silencio los contenedores de otro**; con un
nombre fijo ese caso choca ruidoso. Es el único de los dos que falla en la dirección correcta.

**`COMPOSE_PROJECT_NAME` sale de `.env.example`** (queda comentado con su porqué). Sin esa
línea el default de compose es el **nombre del directorio**, único por worktree por
construcción. El `.env` del checkout principal ya la tiene puesta y no se toca: conserva su
proyecto, sus nombres y su volumen. **Cero acción para main.**

### 3.2 Puertos: un offset por worktree

`OFFSET` 1–49 → postgres `5432+N`, backend `3000+N`, frontend `5173+N`. Los tres rangos son
disjuntos (5433–5481 · 3001–3049 · 5174–5222) y el de postgres es el que `db-aislada.sh` ya
usa. Main es el offset 0 y por eso no cambia.

Lo elige el script (el más bajo libre) y lo registra en el `.env`; al re-correr verifica que
siga libre **o que lo tengan los contenedores de este worktree** — el mismo chequeo
`--filter publish=` que `db-aislada.sh` ya hace. Escape: `--offset N`.

**Automático y no a mano como hoy** porque ahora son tres puertos —tres chances de colisión— y
porque el offset tiene que ser estable para que el `.env` y la pestaña del navegador del owner
no se muevan entre sesiones.

El `.env` del worktree lleva además `FRONTEND_URL` y `API_PUBLIC_URL` con **sus** puertos: son
lo que el backend pone en los links de invitación y en los retornos de pasarela, y con el
default un link emitido por un worktree apunta al frontend del checkout principal.

### 3.3 `scripts/entorno.sh`, único dueño del `.env`

Modos: `db` (solo Postgres) · `stack` · `estado` · `borrar [--purgar]` · `verificar`.

**Por qué absorbe a `db-aislada.sh` en vez de convivir con él:** el bug que abre este frente es
que dos scripts eran dueños de la misma línea del `.env` sin saber uno del otro. Dos scripts
escribiendo `DATABASE_URL` y puertos es esa misma forma de bug con nombres nuevos. **El `.env`
tiene un solo escritor.**

**Por qué el modo barato sobrevive:** el e2e de la API no usa el backend del compose —levanta
su propia app en proceso— así que le alcanza Postgres: 35 MB y segundos, contra 73 s y 3,5 GB
del stack completo. Obligar el stack a una sesión que solo corre `test:e2e` sería el remedio
costando más que la enfermedad.

`db-aislada.sh` **se borra en el mismo commit.** Los contenedores se siguen llamando
`pg_<slug>`, así que `entorno.sh db` adopta el que ya existe; y un script borrado falla
ruidoso en vez de seguir escribiendo el `.env` por un camino que nadie mira.

`--purgar` borra también las imágenes del proyecto, porque `down -v` las deja (medido).

### 3.4 `reset-db.sh`: el resguardo cambia de pregunta, no de campo

**Deriva** el proyecto del worktree y se lo pasa a compose con `-p` explícito —nunca lo hereda
del `.env`—, y entonces verifica dos igualdades: el proyecto que va a destruir es el de este
worktree, y el `DATABASE_URL` del `.env` apunta al puerto que **ese** proyecto publica. Si una
falla, se niega nombrando los dos valores.

El resguardo viejo contestaba *"¿esta URL es local?"*, que nunca fue la pregunta. El nuevo
contesta *"¿lo que estoy por destruir es mío?"*. No es el mismo chequeo con un campo más.

Arrastra **7 literales de `tecnica_backend`** en el script (líneas 48, 55, 64, 74, 189, 213,
223), que se arreglan en tres grupos distintos:

| Grupo | Líneas | Qué se hace |
|---|---|---|
| Código que resuelve el contenedor | 48, 55, 189, 213, 223 | `docker compose -p <proj> ps -q backend` |
| Comentario que **queda falso** | 64 | dice que el `ESTADO` es compartido *porque `tecnica_backend` es uno solo*; esa razón muere, y el archivo pasa a `--git-dir` |
| Mensaje de error | 74 | nombraría un contenedor que no existe |

`docs/agent/caza-timeout-pool.sh` tiene un `tecnica_postgres` por el mismo motivo.

### 3.5 Playwright: la puerta existe y no alcanza

`E2E_BASE_URL` y `E2E_API_URL` cubren todos los sitios que llaman a la API directo
(`e2e/support/api.ts:14`, `e2e/inicio/dashboard.spec.ts:45`,
`e2e/salones/cuenta-hasta-cobro.spec.ts:33`; el resto va por `baseURL`).

**El problema no es que falte la puerta: es que olvidarse de exportarla hace que la suite corra
contra el 5173 de otro worktree y pase.** Un fallo que informa éxito.

`playwright.config.ts` deriva las dos URLs del `.env` del worktree cuando no hay `E2E_*` ni
`CI`, y **se niega a correr** si el worktree tiene offset registrado y la URL resuelta no es la
suya. CI intacto: `process.env.CI` sigue mandando y ahí no hay `.env`.

(El `storageState` no arrastra el origen viejo: `frontend/e2e/.auth` está en `.gitignore` y
`auth.setup.ts` lo reescribe en cada corrida.)

### 3.6 MCP de Postgres

El `.mcp.json` trackeado **no se toca** (main sigue en 5432). `entorno.sh` registra un
`postgres` de **scope local** para la ruta del worktree: `~/.claude.json` →
`projects["<ruta>"].mcpServers`, mecanismo verificado (`startup-app` ya tiene `nuxt-ui` ahí).
Untracked, no ensucia `git status` — que importa con tres sesiones vivas.

⚠️ **Va como tarea con comprobación, no como supuesto:** que el de scope local shadowee por
nombre al de `.mcp.json`, y si hace falta reiniciar la sesión para que tome efecto.

## 4. Cómo se verifica que el aislamiento existe

| Nivel | Dónde corre | Qué lo pone rojo |
|---|---|---|
| **Estático** — `scripts/check-aislamiento.mjs` | **CI y pre-commit** | un puerto host literal en el compose, un `container_name` sin variable, `.env.example` volviendo a fijar el proyecto, un `tecnica_backend` literal en `reset-db.sh` |
| **Runtime** — `entorno.sh verificar` | a mano | dos worktrees que comparten offset, proyecto o puerto publicado: los nombra |
| **La propiedad end-to-end** | una vez, al ejecutar | con dos stacks arriba, `reset-db.sh` en A deja los IDs de contenedor y el contador de seeds de B **idénticos** |

El estático es el único que **no depende de que nadie se acuerde**; los otros dos hay que
invocarlos. Por eso es el que no se negocia si hay que recortar alcance.

## 5. Qué deja de ser posible, y qué queda compartido

El turno desaparece para los cuatro casos que lo pedían: e2e de API, e2e de navegador, smoke
manual y `reset-db.sh`.

**Queda compartido:** el daemon de Docker (disco, RAM, build cache), el stack de `git stash`, y
el espacio de puertos —ahora particionado, así que una colisión solo puede venir de un registro
mal hecho, que es lo que caza `verificar`—.

⚠️ **El riesgo se muda, no se borra.** Hoy el peligro es que la persona que reparte turno se
distraiga; después es que **una sesión no corra el setup** y sus comandos peguen en los puertos
del checkout principal. El fail-fast de Playwright y el chequeo estático no son adornos: son lo
que reemplaza a la persona. Un frente de infraestructura que se vende como *"ahora es imposible
equivocarse"* es el que te deja sin fail-fast.

## 6. Costo de arrancar un worktree nuevo

| | Hoy | Después |
|---|---|---|
| copiar `.env` | sí | sí (lo escribe el script) |
| `npm ci` ×2 en el host (~700 MB) | sí | sí, igual — lo pide el gate |
| **pedir turno a la orquestadora** | **sí** | **no** |
| `./scripts/entorno.sh stack` | — | **73 s medidos**, 3,5 GB en disco |

Neto: **un paso humano menos y un comando de 73 s.**

## 7. Migración — nadie queda a mitad de un frente con el entorno roto

- **Main:** nada. Su `.env` ya fija `COMPOSE_PROJECT_NAME` y los defaults del compose son sus
  puertos de hoy.
- **Los dos worktrees vivos** (`reportes-varianza` con pg en 5436, `interesting-mclean-6b053e`
  en 5439): el commit no toca su `.env` ni sus contenedores. Sus puertos ya **son** offsets
  válidos —5436 = 5432+4, 5439 = 5432+7— así que `entorno.sh db` adopta el contenedor que ya
  tienen con el offset que ya usan.
- El cambio se siente recién al correr el script.

## 8. Qué se rompe si alguien lo usa mal

| Uso mal | Qué pasa |
|---|---|
| worktree sin setup corre `docker-compose up` | choca con `tecnica_*` → **falla ruidoso**, no comparte |
| dos worktrees con el mismo offset | el segundo `up` falla por puerto ocupado; `verificar` lo nombra antes |
| `reset-db.sh` desde un worktree sin proyecto propio | se niega, nombrando proyecto y puerto |
| `npm run e2e` sin stack propio arriba | el fail-fast de la config lo para; sin él, pasaba contra otro worktree |
| `borrar` sin `--purgar` | filtra 2,8 GB; `estado` lo reporta |

## 9. Fuera de alcance, medido y anotado

**Docker ocupa 141,2 GB y 138,7 GB son recuperables** (2026-09-20: imágenes 27,26 GB, 25,47
recuperables · volúmenes 91,81 GB en 38 volúmenes, 91,08 recuperables, 35 sin usar · build cache
22,13 GB, todo recuperable), de los worktrees que se fueron
borrando estos días. Este diseño **evita que siga creciendo** (`--purgar`), pero limpiar lo ya
acumulado es una operación destructiva de una vez, con tres sesiones vivas, y la decide el
owner. Va como entrada de `docs/agent/pendientes.md` con el número medido, no como tarea de
este frente.

## 10. Decisiones tomadas y preguntas abiertas

| Decisión | Quién |
|---|---|
| Opción A (un proyecto de compose por worktree) sobre back/front en el host | owner, 2026-09-20 — *"dale con A"*, con B presentada y su ventaja en disco |
| El MCP de Postgres apunta a la base del worktree | owner, 2026-09-20 — elegido entre cuatro opciones preguntadas antes de diseñar; las otras tres eran dejarlo apuntando a main, sacar el MCP de Postgres, y delegarlo al diseño |
| `db-aislada.sh` se absorbe en `entorno.sh` y se borra | este diseño (§3.3) |
| El modo barato es el default para `test:e2e` | este diseño (§2) |

**Cómo se lee la columna:** `owner, <fecha>` significa que **él lo eligió explícitamente**, y al
lado va cómo lo eligió, para que sea auditable y no un "hecho congelado" sin dueño. Una
referencia a `spec §X` significa que **lo decidió el diseño** y se puede discutir leyendo ese
argumento.

**Abierta:** si el shadow del MCP de scope local no funciona como se espera (§3.6), la salida
es sacar el `postgres` del `.mcp.json` trackeado — y eso cambia la conducta del checkout
principal, así que se pregunta antes de hacerlo.
