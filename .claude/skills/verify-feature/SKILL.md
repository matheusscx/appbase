---
name: verify-feature
description: Verifica que una tarea o feature está realmente terminada antes de commitear. Ejecuta lint, tests, test:e2e de API y build del frontend; revisa invariantes, N+1/consultas, alcance y documentación; y cierra con una revisión independiente por sub-agente de contexto fresco. Usar al cerrar cualquier tarea, antes de commitear a main, o cuando el usuario pida "verifica", "revisa si está listo" o "cierra la tarea".
---

# verify-feature

Procedimiento de cierre. **No implementa ni corrige nada por su cuenta**: ejecuta,
revisa y reporta. Si algo falla, informar y esperar instrucciones.

Como el proyecto commitea directo a `main` sin PR, este es el único punto de control
antes de que un cambio quede en la rama principal.

## 1. Verificación ejecutable

Correr en orden y detenerse en el primer fallo:

```bash
./scripts/reset-db.sh        # obligatorio antes del e2e — ver abajo
cd backend  && npm run lint:check
cd backend  && npm run typecheck
cd backend  && npm test
cd backend  && npm run test:e2e
cd frontend && npm run build
cd frontend && npm run typecheck:ratchet
cd frontend && npm run design:check
cd frontend && npm run e2e          # solo si el diff cae en el criterio de CLAUDE.md (🎭)
```

Registrar el resultado real de cada comando. **No declarar que un paso pasó sin
haberlo ejecutado.**

**`reset-db.sh` no es opcional.** El e2e local se contamina solo: correr
`test:e2e` dos veces seguidas deja cajas abiertas, causas duplicadas y stock
agotado, y **los números de la 2da corrida no son válidos**. Solo la primera
corrida sobre una base recién sembrada cuenta. El script borra el volumen,
levanta el stack y espera el `Seed complete` del backend — esperar ese log es el
punto: el contenedor levanta antes de que el seed termine, y una suite que
arranca a mitad del seed falla con errores que no son regresiones. Tarda ~30s.
No hay datos productivos que perder (decisión registrada del owner).

**En un worktree, `./scripts/entorno.sh db` reemplaza a `reset-db.sh` para el
`test:e2e`**: le da al worktree un Postgres propio y vacío, sin turno. La regla de la
primera corrida vale igual —cada corrida del comando es una base vacía—, pero
`--verificar` no aplica en ese modo: ningún backend del compose apunta a esa base, así
que no hay watcher que la re-siembre; `reset-db.sh` se niega y te manda acá.

Para el e2e de **navegador** hace falta el stack: `./scripts/entorno.sh stack` le levanta
uno propio a este worktree (backend y frontend en sus puertos), y ahí sí `reset-db.sh` y
`--verificar` aplican, sobre el proyecto de este worktree y no sobre el de nadie más.
Playwright toma esos puertos del `.env` sola. (Desde el 2026-09-20; antes era
`db-aislada.sh` y el stack se pedía por turno. La CPU sigue yendo por turno: ver abajo.)

**Cómo leer la corrida de Playwright** (la secuencia está en el checklist de `CLAUDE.md`):

- **La base se resetea justo antes de `npm run e2e`, no antes del `test:e2e`.** En modo `stack`
  el `DATABASE_URL` del `.env` apunta al Postgres del stack, así que el e2e de la API escribe en
  la misma base que lee Playwright.
- **RestartCount y OOMKilled, antes y después:**
  `docker inspect wt-<slug>_backend wt-<slug>_frontend --format '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}} {{.State.StartedAt}}'`.
  El "antes" se toma **después** del `reset-db.sh`, que recrea los contenedores y deja el contador en 0.
  Un RC que sube **durante** la corrida la invalida. Un RC distinto de 0 ya en el "antes" tampoco
  es normal: el reinicio por el `ENOENT` de `.nuxt/nuxt-fonts-global.css` se cerró el 2026-10-09
  dándole al contenedor su propio `.nuxt` ([`resueltos.md`](../../../docs/agent/resueltos.md)).
  Leer el log del frontend antes de seguir.
- **Memoria de la VM de Docker (3,83 GiB).** El 2026-10-08, con tres stacks completos arriba
  (el del checkout principal y dos de worktrees), el frontend propio murió por OOM a mitad de
  una corrida (22:45:21 UTC). En la misma ventana se reiniciaron el frontend de otro worktree
  (22:44:32 UTC) y `tecnica_backend` (22:37:28 UTC). Si ya hay dos stacks completos arriba
  (`docker ps`), pedirle a la orquestadora que baje uno antes de levantar el tuyo. Si un
  contenedor de **otra** sesión se reinicia durante tu corrida, avisale: su corrida tampoco vale.
- **En frío, `auth.setup` paga la compilación de la SPA y por eso tiene 120 s.** `nuxt dev`
  transforma a pedido los ~1000 módulos del primer `/login`, y cada `reset-db.sh` lo vuelve a
  enfriar. Medido el 2026-10-09: tarda 9,9 s con load 7–8 y 29,4 s con la VM de Docker ocupada
  (load 17–22). Si aun así cae por timeout en `page.goto('/login')` con RC 0, lo probable es que
  el host esté más cargado que eso: se repite **una vez**, sin `reset-db.sh`. Con el servidor ya caliente, la 2ª
  corrida sola pasó 2 de 2. Si vuelve a caer ahí, la corrida no cuenta ni como verde ni como rojo:
  avisar a la orquestadora con `docker stats` y el load.
- **Timeouts por todos lados con otra suite corriendo en paralelo:** la corrida no cuenta. Se
  repite en turno.

**`typecheck:ratchet`**: `nuxt build` NO tipa-chequea, así que el frontend arrastra una
deuda de errores de tipo (vue-tsc estricto) registrada en `frontend/typecheck-baseline.json`.
El ratchet falla solo si un archivo **empeora** respecto a la baseline — no bloquea por la
deuda preexistente, sí impide meter nuevos. Si quemaste errores en esta tarea (bajó el
total), apretá el ratchet: `npm run typecheck:ratchet -- --update` y commiteá la baseline
en el mismo commit. Tarda ~1-2 min; por eso vive acá y no en el pre-commit.

## 2. Invariantes

Revisar el diff (`git diff`) contra las invariantes de `CLAUDE.md`:

- [ ] `tenant_id` proviene del token, nunca del body/query/params
- [ ] Todo cálculo de dinero o porcentaje usa Decimal.js; porcentajes en decimal
- [ ] Sin `DELETE` físico; **toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`**
      (revisar cada query raw agregada en el diff, una por una — no asumir)
- [ ] Columnas PK/FK UUID con `type: 'uuid'` explícito
- [ ] Sin cambios al sistema de tokens JWT
- [ ] "Exento" tratado como estado explícito, no como ausencia de impuesto
- [ ] Rutas nuevas con guard de permisos en el backend

Cualquier violación: **detener el cierre y reportar**, no corregir sobre la marcha.

## 2b. Consultas y rendimiento

Errores recurrentes que ni el lint ni los tests atrapan — revisar el diff a mano:

- [ ] **Sin N+1.** Ningún `for`/`.map(async …)`/`Promise.all` que ejecute una query
      por iteración sobre un resultado. El dato derivado por fila se resuelve en una
      sola query (`JOIN`/agregación) o batch-fetch con `WHERE id = ANY($1)` + map en
      memoria. Ver `docs/agent/anti-patterns.md` → "N+1".
- [ ] Toda query raw nueva lleva su filtro `eliminado_el IS NULL` en cada tabla del
      `FROM`/`JOIN` (ligado al check de soft delete de arriba).
- [ ] Sin `SELECT *` en tablas anchas ni traer columnas que no se usan.

Si aparece un N+1 o una lectura sin filtro de borrado: **detener el cierre y reportar.**

## 2c. Cobertura — inspeccionar no es ejercer

Los tres errores más caros de jul-2026 fueron el mismo: algo se verificó **mirándolo**
en vez de **usándolo**, y el gate quedó verde sobre una feature rota.

- [ ] **¿Qué ejercita esta distinción?** Si el cambio introduce una distinción —dos
      permisos que difieren, dos estados, dos roles, dos ramas de una regla— nombrar
      qué la ejerce. Si la respuesta es "nada", la distinción es **decorativa**: existe
      en el diseño y en la doc, pero ningún bug ahí es detectable.
      Caso real: contar (`Crear`) vs aplicar (`Actualizar`) en recuentos vivió meses sin
      que nada la ejerciera —el seed solo tenía admins, que tienen los dos permisos— y
      un bug de UI que le escondía "Aplicar" al aprobador pasó los cinco gates.
- [ ] **¿El gate corre lo que escribiste?** Un test que no está en CI es decorativo.
      Caso real: los 275 unit del frontend no estaban en `ci.yml`; el spec recién
      escrito para cubrir un bug no se ejecutaba en ningún lado.
- [ ] **Lo sembrado, ¿se puede usar?** Un seed correcto en SQL puede ser inservible en
      la app. Verificarlo **usándolo** (login + el flujo real), no consultando la tabla.
      Caso real: dos roles con los permisos exactos en la BD, pero sin `Items/Leer` no
      podían ni listar productos para empezar un recuento.

Si algo acá queda en "nada lo ejercita": **no está terminado**. No es deuda a documentar,
es el agujero por donde entra el próximo bug invisible.

## 3. Alcance

- [ ] El diff no contiene refactors ajenos a la tarea pedida
- [ ] No se crearon archivos nuevos que cabían en uno existente
- [ ] No se agregaron dependencias sin autorización explícita
- [ ] No se introdujo un patrón nuevo donde ya existía uno en el proyecto

Si el diff toca archivos que la tarea no mencionaba, listarlos y justificar cada uno.

## 4. Anti-patrones

Contrastar el diff con `docs/agent/anti-patterns.md`. Si aparece uno conocido,
señalarlo con la entrada correspondiente.

Si se detecta un patrón defectuoso **no listado** y se corrigió durante la tarea,
proponer al usuario agregarlo al archivo (una entrada, formato fijo, con el commit
de origen).

## 5. Documentación

Según la tabla de documentación viva de `CLAUDE.md`, verificar que en el mismo commit
se actualizó lo que corresponda:

- Feature nueva → `docs/features/<feature>.md` + link en `docs/README.md` + fila en `docs/ESTADO.md`
- Cambio de estado → `docs/ESTADO.md`
- Cambio estructural → `docs/ARCHITECTURE.md`
- Decisión técnica → ADR nuevo + índice
- Regla de negocio → `docs/PRODUCTO.md`
- Patrón nuevo → `docs/patterns/backend.md` o `frontend.md`

Si hay un plan activo en `docs/superpowers/plans/`, marcar los checkboxes completados
y actualizar `Status`.

## 6. Limpieza

- [ ] Sin `TODO` / `FIXME` nuevos
- [ ] Sin código comentado
- [ ] Sin código muerto ni imports sin usar
- [ ] Sin `console.log` de depuración

## 7. Revisión independiente — OBLIGATORIA, no self-review

Los pasos 2–6 son la auto-revisión del autor: débil por diseño: el mismo agente que
escribió el N+1 o se saltó el filtro de borrado es el que juzga si lo hizo, y racionaliza.
Este paso lo cierra un **par de ojos con contexto fresco**.

**Lanzar el sub-agente `domain-reviewer`** (Agent, `subagent_type: "domain-reviewer"`).
Arranca en frío: solo ve el diff, no la conversación que lo produjo — ese aislamiento
es el punto. Su system prompt ya lleva las invariantes, el chequeo N+1/consultas y el
alcance; no hay que pasarle el checklist:

```
Revisá el cierre de esta tarea. Corré `git diff --staged` (o `git diff <base>..HEAD`
si te doy una base) y devolvé hallazgos + veredicto BLOQUEA/LIMPIO.
```

**Delegale la duda que NO resolviste.** Ahí está todo el valor, y no en el formato del
prompt. Medido sobre nueve rondas de jul-2026: todas llevaban una lista de "prestá
atención a…", y aun así cinco volvieron LIMPIO. Los **cuatro bloqueos —los cuatro
correctos, y ninguno visto por el gate completo—** salieron de las cuatro veces que le
pedí verificar algo que yo no había verificado:

| Lo que le pedí | Lo que yo no había hecho |
|---|---|
| ¿este test puede pasar por otra razón? | sospechaba y no lo había resuelto |
| ¿queda algún consumidor de este valor sin actualizar? | grepeé la carpeta del módulo, no el repo |
| ¿el fixture descarta todas las heurísticas alternativas? | probé un mutante, había cuatro |
| ¿queda alguna referencia viva al valor que saqué? | ídem, búsqueda acotada |

La contracara: una lista sobre cosas que **ya comprobaste** pide confirmación, no revisión,
y vuelve LIMPIO. Antes de lanzar, la pregunta es *"¿qué me quedó sin verificar?"* — y eso
va en el prompt, formulado como propiedad falsable.

Además: **qué cambió y por qué** en dos líneas (aclarando que es contexto para juzgar el
alcance, no algo en qué confiar), **las decisiones de juicio** que querés que alguien
discuta, y ⚠️ **`No modifiques el árbol de trabajo`** — sin eso un revisor puede hacer
`git stash` para probar un mutante y dejarte cambios sin commitear en el piso.

**Señal de humo para el owner:** si el reporte dice "volvió LIMPIO" y no nombra ninguna
duda concreta que se haya delegado, se pidió confirmación. La pregunta que lo destapa es
*"¿qué duda le delegaste al revisor?"*.

**Si el diff toca controllers, guards, DTOs o entidades**, lanzar además
`api-security-reviewer` (`subagent_type: "api-security-reviewer"`) sobre esos archivos:
audita guards faltantes, inputs sin validar, exposición de datos, SQLi y mass-assignment
— ejes que `domain-reviewer` no cubre. Si el diff no toca capa HTTP, omitirlo.

**Al cerrar en LIMPIO, dejar el recibo.** El pre-commit bloquea el commit si el diff
toca services de backend o `.vue` de `pages`/`components` y no hay un recibo para
**ese diff exacto**:

```bash
d="$(git rev-parse --git-dir)" && git diff --cached --full-index > "$d/verify-feature.receipt.diff" && git hash-object --stdin < "$d/verify-feature.receipt.diff" > "$d/verify-feature.receipt"
```

`--full-index` es la mitad de un par: el hook hashea con la misma opción, y sin ella las
líneas `index` llevan hashes abreviados cuyo largo git elige según el estado del repo (el
mismo diff daba dos hashes y el recibo se rechazaba). Escribir el recibo sin ella, o con
otro comando, lo hace rechazar siempre.

Va al git-dir y no a `.git/` literal: en un worktree `.git` es un archivo. Guarda también
el diff del que sale, para que un rechazo se pueda comparar contra lo que vio el hook: el
hook deja su evidencia en el git-dir común (`.git/verify-feature-rechazos/` del checkout
principal, también desde un worktree, para que sobreviva a su borrado) y dice con qué `diff`
mirarla.
Si el recibo era de este mismo diff y aun así se rechaza, **no reescribirlo hasta pasar**:
comparar `recibo.diff` con `hook.diff`, reportarlo y abrir una entrada en
`docs/agent/pendientes.md` con la ruta de la evidencia. La excepción la nombra el propio
aviso: un recibo escrito sin `--full-index` (un worktree creado antes de que el arreglo
llegara a `main` trae el skill viejo) se reescribe con el comando de arriba sobre el mismo
diff revisado.

El recibo se emite **después** de que los revisores devuelvan LIMPIO, nunca antes.
Si después de revisar cambiás algo y lo stageás, el hash deja de coincidir y hay
que revisar de nuevo — que es exactamente lo que se quiere. Existe porque el aviso
no alcanzaba: en jul-2026 el hook lo imprimió en 4 commits seguidos, las 4 veces se
ignoró, y un bug de permisos llegó a `main`.

Reglas de este paso:
- **No sustituir la revisión independiente por la propia.** Si el sub-agente no se pudo
  lanzar, reportarlo y **no** declarar el paso como pasado. Sin revisión no hay recibo.
- Los hallazgos del revisor **no se corrigen dentro de este skill**: se reportan al
  usuario. `verify-feature` audita, no arregla (ver encabezado).
- Un veredicto BLOQUEA de cualquiera de los dos revisores ⇒ RESULTADO BLOQUEADO, sin
  importar los pasos 1–6.

## Reporte

Cerrar con este formato, sin adornos:

```
VERIFICACIÓN — <tarea>

Comandos
  backend lint:check  ✅ / ❌ <resumen del error>
  backend typecheck   ✅ / ❌ <error de tipo>
  backend test        ✅ / ❌
  backend test:e2e    ✅ / ❌
  frontend build      ✅ / ❌
  frontend typecheck  ✅ sin regresión / ❌ <archivo que empeoró>
  frontend design     ✅ / ❌ <neutral hardcodeado archivo:línea>
  frontend e2e (PW)   ✅ <pasados/total> / ❌ <spec> / — no aplica (<el diff solo toca la lista de CLAUDE.md>)

Invariantes      ✅ / ⚠️ <cuál>
Consultas        ✅ / ⚠️ <N+1 o lectura sin filtro de borrado>
Alcance          ✅ / ⚠️ <archivos fuera de alcance>
Anti-patrones    ✅ / ⚠️ <entrada>
Documentación    ✅ / ⚠️ <qué falta>
Limpieza         ✅ / ⚠️

domain-reviewer          ✅ LIMPIO / ❌ BLOQUEA <hallazgos archivo:línea> / ⚠️ no se pudo lanzar
api-security-reviewer    ✅ LIMPIO / ❌ BLOQUEA <hallazgos> / — no aplica (sin capa HTTP)

RESULTADO: LISTO PARA COMMIT / BLOQUEADO
```

Si el resultado es BLOQUEADO, no commitear.
