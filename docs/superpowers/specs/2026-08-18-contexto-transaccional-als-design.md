# Contexto transaccional con AsyncLocalStorage — Design Spec

**Fecha:** 2026-08-18
**Estado:** 📐 Aprobado por el owner — listo para plan de implementación
**Backlog:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) — sección 🔴 "tanda propia", entrada *"Diez ventas simultáneas cuelgan la API para siempre"*
**ADR a crear:** el porqué de esta decisión (contexto propio vs librería vs cambio de ORM) sale de este spec hacia un ADR nuevo en el mismo commit de la implementación

---

## Contexto

**El bug (medido 2026-08-11, no deducido):** `crearEnTransaccion` y otros 20 sitios llaman,
desde adentro de una transacción abierta, a services que toman una conexión **nueva** del
pool en vez de usar el `manager`. Cada operación necesita entonces dos conexiones a la vez.
El pool de `pg` no está configurado (`app.module.ts` → default 10), así que con 10
operaciones simultáneas las 10 transacciones toman una conexión cada una y las 10 esperan
una segunda que no existe. **Deadlock permanente**: las requests no vuelven nunca y el
proceso queda envenenado. Umbral verificado por experimento: 9 ok / 10 cuelga; subiendo el
pool a 20, 19 ok / 20 cuelga — el número de conexiones ES la variable.

**La reincidencia (2026-08-15) es lo que define la forma del fix.** `auth.service.ts` →
`refresh` estrenó una transacción y dejó adentro un `usersService.findById`: mismo deadlock,
en código nuevo, cuatro días después de documentarse la causa. La vía fue **envolver código
viejo en una transacción nueva** — invisible para cualquier grep de "llamada agregada".
Conclusión: documentar no alcanza y arreglar los 21 sitios tampoco; el patrón depende de
disciplina humana y hay que **eliminarlo por construcción**.

**Decisión del owner (2026-08-18): cerrar de raíz, nada de parches.** Se evaluaron y
descartaron:

| Alternativa | Por qué no |
|---|---|
| Pasar el `manager` a los 21 sitios | Arregla los 21 de hoy; el sitio 22 sigue siendo posible. No es de raíz |
| Cachear el catálogo de unidades | Cubre 10 de 21 y es una mejora de perf, no un cierre del patrón |
| `typeorm-transactional` / `@nestjs-cls/transactional` | Misma arquitectura, pero dependencia nueva que parchea internals de un TypeORM 1.0 recién salido; el stack lo resuelve con un built-in de Node |
| Migrar de ORM | Prisma y Drizzle tienen el **mismo** modelo manual de transacciones — no resuelven esto. El único que lo resuelve nativo es MikroORM (con ALS, o sea lo mismo que acá), y migrar 103 entidades + 252 queries crudas por un problema de ~200 líneas es desproporcionado. MikroORM queda anotado en `pendientes.md` §6 como candidato si el ORM se cambia algún día por razones propias |

## Alcance

**Entra:** el agotamiento del pool (las 21 tomas de conexión dentro de transacciones), su
test de concurrencia, la regla automatizada y la defensa en profundidad del pool.

**No entra** (decisión del owner 2026-08-18, quedan en `pendientes.md` como piezas
siguientes de la misma tanda):
- Los dos ciclos de **orden de locks de fila** de la bandeja de desfases (`items` ↔
  `item_combo` y `item_receta` ↔ `item_combo`) — mecanismo distinto al pool.
- Los `FOR UPDATE` de `aplicarDesfases` que se toman antes de validar el tenant.
- El caché en memoria de `unidad_medida` — con este fix ya no hace falta para el deadlock;
  como perf, la medición del 2026-08-11 dijo "no encarar".
- El redondeo de plata (tercera entrada de la tanda).

---

## Arquitectura

### 1. `TxContext` + fachada `Db` (en `src/common/`)

**`TxContext`**: un `AsyncLocalStorage<EntityManager>` — el almacén que ata el manager de la
transacción a la operación en vuelo. Es el "singleton que maneja la conexión" que pedía el
owner, con la corrección de que el estado no vive en un campo (diez requests concurrentes lo
pisarían entre sí) sino en el árbol async de cada request.

**`Db`** (service inyectable): la única puerta al acceso a datos fuera de repos.

| Método | Semántica |
|---|---|
| `transaccion(fn)` | Si NO hay transacción en contexto: abre `dataSource.transaction`, guarda el manager en el ALS, corre `fn`. Si YA hay una: **reusa el manager existente** (sin savepoint — misma semántica que el enhebrado manual actual). Esto convierte el vector de la reincidencia (envolver código viejo en transacción nueva) en un no-op seguro |
| `query(sql, params)` | Manager del contexto si existe; pool si no |
| `sinTransaccion(fn)` | Corre `fn` con el contexto vaciado: la salida **explícita** para quien necesite una conexión aparte estando dentro de una transacción. Auditado el 2026-08-18: ningún sitio actual lo necesita — los que corren deliberadamente fuera de transacción (auditoría post-rollback de `cobros.service.ts`, poda de `auth.service.ts:493`, `abrir` de caja, restore de `items`) ya están lexicalmente fuera de los callbacks, y el ALS los deja en el pool solos |

### 2. Repos: proxy en el provider — cero ediciones en los services

Un helper propio reemplaza los 34 registros `TypeOrmModule.forFeature(...)`: provee, bajo
**el mismo token** de `@InjectRepository`, un proxy que en cada acceso resuelve
`contexto activo → manager.getRepository(X)`, sin contexto → repo normal del pool.

Consecuencias medidas contra el repo (2026-08-18):

- Los **441 accesos a repos en 38 services no se editan**.
- Los **21 sitios del deadlock se arreglan sin tocarlos**: en cuanto la transacción que los
  envuelve registra su manager en el ALS, `cajaService.findActiva`,
  `itemsService.cargarBasePorIds`, `calculoPreciosService.calcular` y el resto resuelven
  ese manager sin saberlo. Incluye el motor de precios sin enhebrar nada por sus firmas.
- Los **37 archivos de spec** que mockean con `getRepositoryToken` quedan intactos: el mock
  reemplaza el provider entero y el proxy nunca entra en juego.
- Cuidado de implementación: el proxy debe reenviar también **propiedades no-método**
  (`metadata`, `target`, `manager`) y soportar `createQueryBuilder()`.

### 3. Barrido mecánico

| Qué | Cuántos (medido) | Cambio |
|---|---|---|
| `this.dataSource.transaction(...)` | 76 | → `this.db.transaccion(...)` — es lo que activa el ALS |
| `this.dataSource.query(...)` | 153 (sin seeder) | → `this.db.query(...)` |
| `this.dataSource.manager` | 10 | Caso por caso |
| Seeder (99 `query`) | — | **No se toca**: corre al boot, sin concurrencia |
| Firmas existentes con `manager` explícito | — | **Quedan**: son correctas y el explícito gana donde ya está. Sacarlas agranda el diff sin ganancia |

Durante el barrido se auditan uno por uno los sitios con semántica deliberada de
fuera-de-transacción (lista en §1) para confirmar que quedan fuera de contexto.

### 4. Defensa en profundidad

- **Pool explícito + `connectionTimeoutMillis`** en `app.module.ts` (vía `extra` hacia
  `pg`). No arregla nada: convierte un futuro bug de doble toma en un **500 ruidoso con
  stack trace** en vez de una API muerta hasta reiniciar.
  ⚠️ **Spike previo obligatorio**: confirmar corriendo que TypeORM 1.0 pasa `extra` al pool
  de `pg`. No se afirma sin verlo.
- **Regla de lint** — `no-restricted-properties` sobre `dataSource.query`,
  `dataSource.transaction` y `dataSource.manager` fuera de `Db` y el seeder. Vive en el
  `lint:check` que ya corre en gate, pre-commit y CI: sin escáner nuevo que mantener.

### 5. Cambio de comportamiento asumido

Dentro de una transacción, los `Promise.all` de lecturas (p. ej. los catálogos del motor de
precios) pasan de "paralelos en N conexiones" a "encolados en una" (node-postgres serializa
por cliente). Es la semántica correcta — es lo que el `manager` explícito ya hace hoy donde
existe — y son queries de milisegundos (medición del 2026-08-11: ~1,8 ms por línea de
receta), pero es un cambio real y queda escrito acá y en el ADR.

---

## Tests

1. **Unit del mecanismo** (`TxContext`/`Db`/proxy): dentro de transacción resuelve el
   manager; fuera, el pool; anidada, reusa el manager; `sinTransaccion` escapa; el proxy
   reenvía propiedades no-método.
2. **E2E de ráfaga sobre el camino medido**: N ≥ tamaño del pool de `POST /ventas`
   simultáneas. Calcado del detector que ya existe
   (`test/rbac-y-contrasena.e2e-spec.ts:330`): armado de sesiones **en serie**, ráfaga por
   **HTTP real contra un puerto** (supertest levanta un listener por request y revienta con
   `ECONNRESET` antes de que el pool importe). Hoy ese test colgaría; con el fix pasa.
   Sinergia con §4: con `connectionTimeoutMillis` configurado, un mutante falla ruidoso en
   vez de colgar la suite.
3. **Mutante que revierte, no solo rompe**: desactivar la resolución ALS del proxy (volver
   al repo del pool) y verificar que la ráfaga lo caza. Después de revertir, verificar la
   hora del restart del watcher en los logs antes de dar el veredicto.
4. **Gate completo** con `reset-db.sh` antes del e2e y `--verificar` después. El e2e corre
   **entero**, no un subset.

## Documentación (mismo commit que el código)

| Doc | Qué |
|---|---|
| ADR nuevo + índice | La decisión: contexto propio con ALS; por qué no librería, por qué no cambio de ORM. Que quede escrito para no re-litigarlo |
| `docs/patterns/backend.md` | Regla nueva: transacciones vía `db.transaccion`, `dataSource` directo prohibido fuera de `Db`/seeder; cuándo usar `sinTransaccion` |
| `docs/agent/pendientes.md` → `resueltos.md` | La entrada del deadlock se muda **parcialmente**: cierra el pool; los ➕ de orden de locks quedan como pieza siguiente de la tanda. MikroORM se anota en §6 como candidato de ORM |
| `docs/ARCHITECTURE.md` | El contexto transaccional como pieza transversal |

## Criterio de éxito

- La ráfaga de N ≥ pool de ventas simultáneas responde completa y el backend sigue vivo.
- `pg_stat_activity` durante la ráfaga no muestra transacciones esperando `ClientRead` con
  el JS bloqueado en una segunda conexión.
- El lint rechaza un `this.dataSource.query` nuevo en un service.
- Gate completo en verde (backend: lint, typecheck, unit, e2e; frontend: build, test,
  typecheck:ratchet, design:check) — el frontend no se toca, pero el gate corre entero.
