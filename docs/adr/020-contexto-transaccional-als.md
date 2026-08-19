# ADR-020: Contexto transaccional con AsyncLocalStorage — la conexión de la transacción viaja sola

**Status**: Accepted

**Date**: 2026-08-18

## Context

**El bug, medido, no deducido.** `crearEnTransaccion` y otros 20 sitios llamaban, desde
adentro de una transacción abierta, a services que pedían una conexión **nueva** al pool en
vez de usar el `manager` de esa transacción. Cada una de esas operaciones necesitaba
entonces **dos conexiones a la vez**: una retenida por la transacción, otra para la llamada
que no la conocía. El pool de `pg` no tenía tamaño explícito (default mudo de 10,
`app.module.ts`), así que con N operaciones simultáneas y N = tamaño del pool, las N
transacciones tomaban su primera conexión y las N quedaban esperando una segunda que ninguna
iba a soltar. **Deadlock permanente** — no un timeout: las requests no vuelven nunca y el
proceso queda envenenado hasta reiniciar el contenedor.

Umbral verificado por experimento el 2026-08-11: 9 ok / 10 cuelga con el pool en 10; subiendo
el pool a 20, 19 ok / 20 cuelga. El número de conexiones ES la variable — subir el pool no
arregla nada, solo mueve el umbral. `pg_stat_activity` durante el cuelgue mostraba
conexiones `idle in transaction` esperando `ClientRead` junto a otras en `Lock: tuple`: el
ciclo es de agotamiento del pool, no de locks de fila, así que `deadlock_timeout` de Postgres
nunca dispara para romperlo.

**La reincidencia del 2026-08-15 es lo que define la forma del fix.** `auth.service.ts` →
`refresh` estrenó una transacción nueva y dejó adentro un `usersService.findById`: mismo
deadlock, en código nuevo, **cuatro días después** de que la causa quedara documentada en
`docs/agent/pendientes.md`. La vía no fue repetir el patrón conocido — fue **envolver código
viejo (una llamada a un service ya existente) en una transacción nueva**, invisible para
cualquier grep de "llamada agregada dentro de una transacción existente". Documentar la
causa no evitó la reincidencia. Arreglar los sitios conocidos tampoco la habría evitado: el
patrón depende de que quien escribe código nuevo recuerde pasar el `manager a mano en cada
sitio nuevo, para siempre. Conclusión: hay que eliminar el patrón **por construcción**, no
por disciplina.

## Decision

Contexto transaccional propio con `AsyncLocalStorage` (`node:async_hooks`, built-in de
Node — sin dependencia nueva):

- **`TxContext`** (`backend/src/common/db/tx-context.ts`): un
  `AsyncLocalStorage<EntityManager>` que ata el manager de la transacción en curso a la
  operación en vuelo (el árbol async de esa request), no a un campo — diez requests
  concurrentes pisándose un campo compartido es exactamente el bug que esto reemplaza.
- **`Db`** (`backend/src/common/db/db.service.ts`): la única puerta al acceso a datos fuera
  de los repos. `transaccion(fn)` abre la transacción y registra el manager en el contexto
  la primera vez; si ya hay una transacción activa, **la reusa** en vez de anidar — es lo
  que convierte "envolver código viejo en una transacción nueva" (el vector exacto de la
  reincidencia) en un no-op seguro en vez de en un segundo deadlock. `query(sql, params)`
  usa el manager del contexto si existe, el pool si no. `sinTransaccion(fn)` es la salida
  **explícita** para quien necesite deliberadamente una conexión propia estando dentro de
  una transacción (auditoría que debe sobrevivir a un rollback, poda de housekeeping que no
  necesita ser atómica con lo demás).
- **Repos como proxies context-aware** (`backend/src/common/db/repositorios.module.ts`):
  reemplazo drop-in de `TypeOrmModule.forFeature` que provee, bajo el **mismo token** de
  `@InjectRepository`, un `Proxy` que en cada acceso a una propiedad resuelve
  `TxContext.managerActivo() → manager.getRepository(X)`, o el repo del pool si no hay
  contexto. Consecuencia medida: los ~441 accesos a repos en 38 services **no se editaron**
  — en cuanto la transacción que los envuelve registra su manager, cada
  `service.repo.findOne(...)` ya existente resuelve ese manager sin saberlo, motor de
  precios incluido.

⚠️ **La garantía completa depende de CÓMO se registra el módulo, y hay que decirlo en voz
alta: es la precondición de todo lo anterior.** Un módulo que declare sus entities con
`TypeOrmModule.forFeature([...])` en vez de `RepositoriosModule.forFeature([...])` recibe
repos atados al `DataSource` del pool — sin proxy, sin resolución de contexto — y un
service que los use adentro de `db.transaccion` reabre el deadlock exacto que este ADR
cierra, sin que ningún selector de lint sobre `DataSource` lo vea (no hay `DataSource`
inyectado ahí: el registro pasa por el `Module` decorator, no por el constructor). Por eso
`docs/patterns/backend.md` §5 manda `RepositoriosModule.forFeature` como el único registro
válido, y `eslint.config.mjs` prohíbe además el propio `TypeOrmModule.forFeature` en
`src/**` (mismas exclusiones que el resto de esta regla). Verificado el 2026-08-18: 36 de
36 módulos de `backend/src` registran con `RepositoriosModule.forFeature`; la única
mención de `TypeOrmModule.forFeature` que queda es el docblock de
`repositorios.module.ts`, describiendo a qué reemplaza.

Barrido mecánico sobre `backend/src`: 76 `dataSource.transaction(...)` → `db.transaccion`,
153 `dataSource.query(...)` → `db.query` (el seeder, con 99 más, no se tocó — corre al boot,
sin concurrencia). Los sitios con `manager` explícito preexistente quedaron como estaban: son
correctos y el explícito gana donde ya está.

### Defensa en profundidad

- **Pool explícito + `connectTimeoutMS`** en `app.module.ts` (vía TypeORM hacia el pool de
  `pg`, `connectionTimeoutMillis`). No arregla nada por sí solo: si algún día algo vuelve a
  pedir una segunda conexión dentro de una transacción, esto convierte un cuelgue indefinido
  en un **500 ruidoso con stack trace**. Verificado con el mutante de la Task 7 (proxy
  revertido a ignorar el contexto): la ráfaga de 10 dio **10/10 en 500, en ~6.87 s** — falla
  rápido y ruidoso, no cuelga sin límite.
- **Regla de lint** (`eslint.config.mjs`, `no-restricted-syntax`) que prohíbe, en
  `src/**/*.ts` fuera de `src/common/db/**`, el seeder y `*.spec.ts`: acceder a
  `dataSource.query` / `.transaction` / `.manager` / `.createQueryRunner`, inyectar
  `DataSource` con `@InjectDataSource()`, declarar un parámetro de constructor (propiedad o
  plano) tipado `DataSource`, o registrar un módulo con `TypeOrmModule.forFeature` en vez
  de `RepositoriosModule.forFeature`. Vive en `lint:check`, que ya corre en gate,
  pre-commit y CI — sin escáner nuevo que mantener.
- **E2E de ráfaga** (`test/concurrencia-pool.e2e-spec.ts`): N = tamaño del pool de
  `POST /ventas` simultáneas, por HTTP real contra un puerto (no `supertest` sin listener,
  que revienta antes de que el pool importe). Antes del fix este test colgaba; con el fix
  responde completo.

### Alternativas descartadas, y por qué

| Alternativa | Por qué no |
|---|---|
| Pasar el `manager` a mano en los 21 sitios | Arregla los 21 de hoy; el sitio 22 sigue siendo posible mañana. No es una solución de raíz — es la misma disciplina que ya falló una vez, el 2026-08-15 |
| Cachear el catálogo de `unidad_medida` en memoria | Cubre 10 de los 21 sitios (los que resuelven conversión de unidades) y es una mejora de rendimiento, no un cierre del patrón — los otros 11 siguen abiertos |
| `typeorm-transactional` / `@nestjs-cls/transactional` | Misma arquitectura de fondo (ALS atando un manager al contexto), pero como dependencia nueva que parchea internals de un TypeORM 1.0 recién salido. El mecanismo que resuelve el problema es un built-in de Node (`AsyncLocalStorage`); no hace falta una librería externa para tenerlo |
| Migrar de ORM | **Prisma y Drizzle tienen el mismo modelo manual de transacciones que TypeORM** — pasar el `manager`/`tx` a mano por cada llamada — así que migrar a cualquiera de los dos no cierra este problema, lo reproduce con otra sintaxis. El único ORM que lo resuelve nativo es **MikroORM**, también con `AsyncLocalStorage` — es decir, el mismo mecanismo que este ADR adopta, ya integrado en el ORM en vez de construido a mano. Pero migrar 103 entidades + 252 queries crudas para resolver un problema de ~200 líneas de infraestructura propia es desproporcionado. Queda anotado en `docs/agent/pendientes.md` §6 como candidato **si alguna vez se cambia el ORM por razones propias** — no como pendiente de este trabajo |

## Consequences

### Positivo

- El vector exacto de la reincidencia — envolver código viejo en una transacción nueva —
  pasa de deadlock a no-op seguro (`Db.transaccion` reusa el manager si ya hay uno activo).
- Los repos no cambian de API ni de token de inyección: cero ediciones en los 38 services
  que los consumen, cero riesgo de regresión por refactor masivo.
- Los 37 archivos de spec que mockean con `getRepositoryToken` quedan intactos: el mock
  reemplaza el provider entero y el proxy nunca entra en juego.
- Un futuro descuido similar al de `auth.service.ts` (2026-08-15) ahora falla en `lint:check`
  antes de llegar a producción, en vez de esperar a que alguien lo mida con una ráfaga.

### Negativo

- **Los `Promise.all` de lecturas dentro de una transacción dejan de ser paralelos.** Todas
  resuelven contra el mismo `EntityManager` (un único `pg.Client`), así que
  `node-postgres` las encola en vez de correrlas en paralelo — es la semántica correcta (es
  lo que el `manager` explícito ya hacía donde existía antes de este trabajo), pero es un
  cambio real de comportamiento. Detectado el 2026-08-18 al cerrar el camino de la venta:
  dos `Promise.all` de `calculo-precios.service.ts` ahora emiten
  `DeprecationWarning: Calling client.query() when the client is already executing a query
  is deprecated and will be removed in pg@9.0`. No rompe nada hoy (el resultado es
  idéntico, solo cambia de paralelo-en-N-conexiones a serie-en-una), pero es una bomba de
  tiempo con puerta: se activa recién si el proyecto sube a `pg@9`. Anotado en
  `docs/agent/pendientes.md` § "Necesita que el owner conteste" — el arreglo (reemplazar los
  dos `Promise.all` por `await` secuenciales) toca `calculo-precios.service.ts`, que es zona
  de "detenerse y preguntar" (motor de cálculo de precios).
- Una pieza de infraestructura propia que mantener (`TxContext` + `Db` + el proxy de repos,
  ~200 líneas) en vez de delegar en una librería.
- `dataSource` directo queda prohibido por lint en todo `src/**` salvo la fachada `Db`, el
  seeder y `*.spec.ts` — cualquier necesidad legítima futura de acceso directo (poco
  probable, pero no imposible) exige una excepción explícita en `eslint.config.mjs`, no un
  import silencioso.

### Límites conocidos — declarados a propósito, para que nadie los redescubra como si fueran nuevos

**Del proxy de repos (`RepositoriosModule`), verificados con grep contra el repo el
2026-08-18 — cero consumidores hoy, ninguno bloquea la solución, pero son reales:**

- **No cubre `getTreeRepository`**: entidades con `@Tree()` seguirían resolviendo el repo
  plano del proxy, no el árbol. Hoy no hay ninguna entidad `@Tree` en el proyecto.
- **No alimenta `EntitiesMetadataStorage`** (el registro interno de Nest que llena
  `TypeOrmModule.forFeature`): si el proyecto activara `autoLoadEntities`, esas entidades no
  aparecerían resueltas por este camino. Hoy `autoLoadEntities` no se usa —las entidades se
  listan a mano en `app.module.ts`.
- **No pasa `targetEntitySchema`**: el workaround interno de Nest para desambiguar clases de
  entidad con el mismo nombre. Sin consumidores hoy porque no hay dos entidades con el mismo
  nombre de clase en el proyecto.
- **`forFeature` no acepta un segundo parámetro `dataSource`** (para conexiones con nombre,
  el caso multi-`DataSource` de Nest). El proyecto usa una sola conexión.

**Del enforcement de lint, verificados contra revisiones independientes de las Tasks 5, 6 y
8 — límites reales del enforcement automatizado, no del mecanismo en sí:**

- **La regla es *name-based*.** Un alias de importación (`import { DataSource as DS } from
  'typeorm'`) la esquiva: el selector busca el identificador `DataSource` en el tipo
  anotado, no resuelve el símbolo importado. Cero instancias hoy, realismo bajo — pero es un
  límite real de un `no-restricted-syntax` sobre AST sintáctico, no semántico.
- **El selector de `TypeOrmModule.forFeature` es *name-based* también — y este pesa más,
  porque es el que sostiene la PRECONDICIÓN de todo el mecanismo** (ver más arriba: sin ese
  registro, el proxy no aplica y no hay nada que el resto de la regla proteja). Verificado
  con cuatro mutantes (Task 9, revisión independiente): un alias de import
  (`TypeOrmModule as TOM`), un namespace (`import * as typeorm from '@nestjs/typeorm'`), un
  acceso computado (`TypeOrmModule['forFeature']`) y una const local
  (`const TOM = TypeOrmModule`) esquivan el selector, los cuatro con exit 0. Cero instancias
  hoy — pero a diferencia del límite de `DataSource` (bajo impacto si se esquiva: sigue
  habiendo otros dos selectores sobre la inyección), esquivar este deja un módulo entero
  **sin ninguna de las garantías de este ADR**, indistinguible en runtime de un módulo bien
  registrado. Un lector que no vivió esto puede asumir que el registro está cerrado del
  todo — no lo está: es AST sintáctico, no semántico, igual que el resto de la familia.
- **La regla ataca el chokepoint de *inyección* de `DataSource`, no cada *uso*.** Un
  `DataSource` recibido como parámetro de una **función libre** (no un constructor con DI de
  Nest) queda fuera por diseño: `nombre-sugerido.util.ts:188` y `rango-fecha.util.ts:79`
  reciben parámetros tipados así (`DataSource | Db` y `DataSource | EntityManager | Db`
  respectivamente) y no pasan por inyección de dependencias, así que ningún selector de
  constructor los alcanza. **Dos instancias reales, no cero** — siguen protegidas porque
  quien las llama ya pasó por el chokepoint de inyección (recibe `Db` y decide qué pasar),
  no porque el lint las cubra directamente. Es una decisión de alcance, no un agujero
  descubierto tarde.
- **Ningún e2e ejercita `suscripciones` ni `pasarela`** contra el camino ALS — son los dos
  módulos que el barrido de la Task 6 tocó sin que ninguna spec de `test/*.e2e-spec.ts` los
  llame (la única suite de pasarela existente, `pasarela-oneclick`, está *skipped*). Esa
  mitad del barrido está sostenida por los unit tests de esos services, no por el e2e de
  ráfaga — evidencia más débil que la que cubre ventas, salones y caja.

**Del uso del proxy en código consumidor — un límite que este mecanismo introduce, no que
hereda de algo previo:**

- **Guardar la referencia a un método de repo y llamarla después pierde el contexto.** El
  proxy resuelve `TxContext.managerActivo()` en el **acceso a la propiedad**
  (`this.repo.find`), no en la invocación (`find(...)`). `const find = this.repo.find`
  tomado fuera de una transacción y llamado adentro usa el repo del pool, no el de la
  transacción — reabre el mismo deadlock por una vía que ningún lint detecta (el `Proxy` es
  indistinguible de un repo real para un analizador estático). Cero ocurrencias verificadas
  en `backend/src` (Task 4, tres greps distintos) — es prevención, no un arreglo. Detalle y
  ejemplo MAL/BIEN en `docs/agent/anti-patterns.md`.

## Enforcement

La regla no vive solo en este documento:

- `eslint.config.mjs` — `no-restricted-syntax` sobre `src/**/*.ts` (excepciones:
  `src/common/db/**`, el seeder, `*.spec.ts`). Corre en `lint:check`: gate local,
  pre-commit y CI.
- `test/concurrencia-pool.e2e-spec.ts` — ráfaga de N = tamaño del pool contra `POST
  /ventas`. Mutante que la fija (Task 7, sin commit — revierte `crearRepoProxy` a ignorar el
  `TxContext`): 10/10 en 500 (~6.87 s) con el mutante puesto; verde en 1.9 s revertido.
- `backend/src/common/db/db.spec.ts` — unit del mecanismo: dentro de transacción resuelve el
  manager del contexto, fuera usa el pool, una transacción anidada reusa el manager
  existente, `sinTransaccion` escapa del contexto.

Si algún día aparece una necesidad legítima de acceso directo al `DataSource` fuera de `Db`
y el seeder, va como excepción explícita nombrada en `eslint.config.mjs` — con su
justificación al lado, igual que las allowlists de ADR-004 y ADR-019 — no como un import que
se cuela sin que la regla lo vea.
