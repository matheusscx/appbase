# Orden de bloqueo de filas en ítems compuestos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que los cuatro caminos que escriben `item_receta`, `item_combo` e `items` tomen esas filas siempre en el mismo orden, para que dos usuarios del mismo tenant no puedan abrazarse en un deadlock de fila (`40P01`).

**Architecture:** un solo orden declarado —`item_receta` → `item_combo` → `items`— que cada camino respeta o saltea, nunca invierte. Tres cambios de código en `items.service.ts` (un lock nuevo en `update()` de combo, dos pasadas en `descartarDesfases`, y subir la validación de tenant por encima de los locks en `aplicarDesfases`), más cuatro tests de orden y un reproductor de concurrencia real.

**Tech Stack:** NestJS + TypeORM 1.0 sobre PostgreSQL 15, Jest (unit con mock del `EntityManager`, e2e con supertest), Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-08-19-orden-de-locks-desfases-design.md`](../specs/2026-08-19-orden-de-locks-desfases-design.md)

## Global Constraints

- **Commitear directo sobre `main`.** Nada de ramas, PRs ni worktrees: `docker-compose` no ve los archivos de un worktree y el e2e daría verde sin probar nada.
- **`./scripts/reset-db.sh` ANTES de cada `npm run test:e2e`**, y `./scripts/reset-db.sh --verificar` después si algo falla raro. El e2e corre **entero**, nunca un subset.
- **El e2e corre SOLO.** Ni el gate del frontend ni ningún subagente editando archivos en paralelo: el compose bind-montea el fuente, cualquier `.ts` que cambie recompila y re-siembra a mitad de suite, y el reproductor de concurrencia es sensible al tiempo por diseño.
- **Comprobar exit codes, nunca la última línea de un pipe.** En zsh el array es `$pipestatus` (minúscula), no `$PIPESTATUS`.
- **Commits intermedios con `git commit --no-verify`** (el pre-commit exige el recibo de revisión que la tarea todavía no tiene); los de solo-docs sin él.
- **Invariantes del proyecto** (`CLAUDE.md`): `tenant_id` sale siempre del token; dinero y porcentajes con `Decimal.js`; soft delete en todo y toda lectura filtra `eliminado_el IS NULL`; nunca una query por iteración (N+1).
- **No tocar el motor de cálculo de precios** ni la semántica de `movimientos_inventario`. Este trabajo mueve **el orden en que se piden filas**, no qué se calcula.
- El orden declarado es: **`item_receta` → `item_combo` → `items`**. Un camino puede saltear tablas; no puede invertirlas.

---

### Task 1: Spike — decidir el mecanismo del reproductor y dejarlo en ROJO

El spec deja este mecanismo **sin fijar a propósito**: un interleaving determinista que además ejercite el service real es la parte con riesgo técnico. Esta tarea lo decide midiendo, no opinando.

**Files:**
- Create: `backend/test/orden-locks-desfases.e2e-spec.ts`
- Read (no modificar): `backend/test/concurrencia-pool.e2e-spec.ts` (patrón de ráfaga por HTTP real contra un puerto bindeado, login + `switch-tenant`, `afterAll` que acumula fallos y afirma después de `app.close()`)

**Interfaces:**
- Produces: un spec e2e con un `it` que hoy **falla** por `40P01` (o por 500 del endpoint) y que la Task 2 pondrá en verde. El nombre del `it` y el archivo los usan las tareas siguientes.

**Contexto que el implementador necesita:**

`descartarDesfases` (`backend/src/modules/items/items.service.ts:4284`) no toma ningún lock y recorre `itemIds` en el orden que manda el cliente. Sus `UPDATE` toman lock de fila igual que un `FOR UPDATE`. Entonces `descartar([combo, receta])` contra `descartar([receta, combo])` puede abrazarse.

Endpoints (ver `backend/src/modules/items/desfases.controller.ts`): el descarte es un `POST` con el body que ese controller declara — **leelo, no lo adivines**.

- [x] **Step 1: Montar el escenario y confirmar que hay desfase pendiente**

Creá en el tenant de París (`550e8400-e29b-41d4-a716-446655440007`) una receta y un combo propios, con un desfase pendiente cada uno (o sea: `listarDesfases` los devuelve). Hacelo **en serie**, con el patrón de login + `POST /auth/switch-tenant` de `concurrencia-pool.e2e-spec.ts` — el token multi-tenant sale con `tenant_id: null` y sin el switch cualquier ruta con permisos da 403.

Verificá con un `GET` de la bandeja que los dos aparecen. Si no aparecen, **parate**: sin desfase pendiente el `descartar` no escribe nada y el reproductor no puede abrazar nada.

- [x] **Step 2: Probar el mecanismo A — interleaving forzado con un cliente crudo**

Hipótesis: con un cliente `pg` aparte sosteniendo una de las dos filas se puede ordenar quién llega primero.

Escribilo, corrilo, y **medí si el deadlock aparece de forma determinista** (5 corridas seguidas). Postgres concede los locks en cola FIFO, así que es muy posible que el primer esperador gane siempre y **no haya ciclo**. Si pasa eso, escribilo como resultado: es información, no un fracaso.

- [x] **Step 3: Probar el mecanismo B — ráfaga de pares en orden opuesto**

N pares concurrentes de `descartar([receta, combo])` contra `descartar([combo, receta])`, por HTTP real contra un puerto bindeado (supertest levanta un listener efímero por request y revienta con `ECONNRESET`; ver el comentario de `concurrencia-pool.e2e-spec.ts`). Medí en 5 corridas **con qué frecuencia** aparece el 500 / el `40P01`.

- [x] **Step 4: Elegir, y declarar qué prueba y qué no**

Criterio de aceptación del spec, en orden:
1. da **rojo** contra el código de hoy y verde después del fix;
2. ejercita el service de verdad, no una réplica a mano de su SQL;
3. si las dos juntas no son factibles, **decilo con evidencia** y caé al mecanismo más fuerte que sí lo sea, declarando en un comentario del propio spec qué prueba y qué no.

Si elegís el mecanismo B (probabilístico), el comentario tiene que decir la tasa medida y por qué N alcanza. Un test que a veces no reproduce es honesto si lo dice; uno que se presenta como determinista sin serlo, no.

- [x] **Step 5: Dejarlo en ROJO y commitear**

Corré `./scripts/reset-db.sh` y después **solo este spec** (acá sí, es el spike: `npx jest --config test/jest-e2e.json test/orden-locks-desfases.e2e-spec.ts`). Guardá la salida del rojo: es la evidencia del RED que la Task 2 tiene que dar vuelta.

```bash
cd backend && npm run lint:check && npm run typecheck
git add backend/test/orden-locks-desfases.e2e-spec.ts
git commit --no-verify -m "test(e2e): reproductor del ciclo item_receta ↔ item_combo (ROJO)"
```

**Reportá:** qué mecanismo elegiste, la evidencia de los dos que probaste, la tasa de reproducción medida, y el texto exacto del comentario donde declarás qué prueba y qué no.

---

### Task 2: `descartarDesfases` procesa recetas antes que combos

**Files:**
- Modify: `backend/src/modules/items/items.service.ts:4316-4358` (el loop de `descartarDesfases`)
- Test: `backend/src/modules/items/items.service.spec.ts` (dentro del `describe('aplicarDesfases / descartarDesfases')`, que arranca en `:4853`)

**Interfaces:**
- Consumes: el spec e2e de la Task 1, que debe pasar de rojo a verde sin editarlo.
- Produces: nada que otra tarea consuma.

- [x] **Step 1: Escribir el test de orden que falla**

Va al lado de los otros de ese `describe`. El patrón —posiciones relativas de SQL sobre el mock— es el de `items.service.spec.ts:1925`.

```typescript
it('descartar escribe `item_receta` ANTES que `item_combo` aunque el lote venga al revés', async () => {
  // Orden de bloqueo declarado: item_receta → item_combo → items. Los UPDATE
  // toman lock de fila igual que un FOR UPDATE, así que recorrer el lote en el
  // orden del cliente dejaba que `descartar([combo, receta])` y
  // `descartar([receta, combo])` se abrazaran (40P01). `aplicarDesfases` ya
  // ordena receta → combo.
  managerMock.query
    .mockResolvedValueOnce([
      { item_id: 'combo-x', tipo: 'combo', nombre: 'Combo X' },
      { item_id: 'receta-y', tipo: 'receta', nombre: 'Receta Y' },
    ])
    .mockResolvedValueOnce([
      {
        receta_item_id: 'receta-y',
        cantidad: '1',
        unidad_codigo: 'kg',
        unidad_base: 'kg',
        costo_actual: '200',
      },
    ])
    .mockResolvedValueOnce([
      {
        combo_item_id: 'combo-x',
        componente_item_id: 'ingrediente-z',
        cantidad: '1',
        costo_actual: '100',
      },
    ])
    .mockResolvedValue([]);

  // El lote viene combo PRIMERO: es el orden que hoy se respeta y que abraza.
  await service.descartarDesfases(TENANT, ['combo-x', 'receta-y']);

  const sqls = managerMock.query.mock.calls.map((c: unknown[]) => c[0] as string);
  const updReceta = sqls.findIndex((s) => s.includes('UPDATE item_receta'));
  const updCombo = sqls.findIndex((s) => s.includes('UPDATE item_combo'));
  expect(updReceta).toBeGreaterThan(-1);
  expect(updCombo).toBeGreaterThan(-1);
  expect(updReceta).toBeLessThan(updCombo);
});
```

⚠️ Los `mockResolvedValueOnce` de arriba asumen el orden de lecturas que hace `descartarDesfases` hoy: cabeceras, después ingredientes de las recetas, después componentes de los combos. **Verificalo leyendo `:4288-4315` antes de correr** — si el orden real difiere, ajustá el mock, no el service.

- [x] **Step 2: Correr el test y verlo fallar**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts -t "ANTES que" 2>&1 | tail -20
```
Esperado: FAIL — hoy `updCombo` es menor que `updReceta`.

- [x] **Step 3: Implementar las dos pasadas**

En `descartarDesfases`, reemplazá el `for (const itemId of itemIds)` por dos pasadas. **Conservá `itemIds` (no `ids`)** en los filtros: el lote puede traer duplicados y `descartados` los cuenta.

```typescript
      // Orden de bloqueo declarado (`docs/patterns/backend.md`): item_receta →
      // item_combo → items. Los UPDATE de acá abajo toman lock de fila igual
      // que un FOR UPDATE, así que recorrer el lote en el orden que manda el
      // cliente dejaba que dos `descartar` con las mismas filas en orden
      // distinto se abrazaran (40P01). `aplicarDesfases` ya ordena receta →
      // combo; esto alinea los dos caminos de la bandeja.
      //
      // Efecto observable asumido: en un lote mixto con errores en los dos
      // tipos, ahora falla primero el de la receta. Es la misma precedencia
      // que ya tenía `aplicarDesfases`.
      const recetasDelLote = itemIds.filter(
        (id) => cabPorId.get(id)!.tipo === 'receta',
      );
      const combosDelLote = itemIds.filter(
        (id) => cabPorId.get(id)!.tipo === 'combo',
      );

      for (const itemId of recetasDelLote) {
        // ... cuerpo de receta, TAL CUAL está hoy, sin el `continue` del combo
      }

      for (const itemId of combosDelLote) {
        // ... cuerpo de combo, TAL CUAL está hoy, sin el `continue`
      }
```

No cambies ni un carácter de los dos cuerpos: mismos mensajes de error, mismas queries, mismo `descartados += 1`.

- [x] **Step 4: Correr los tests y verlos pasar**

```bash
cd backend && npm test 2>&1 | tail -8
```
Esperado: PASS, 1931 tests. Si algún test viejo de `descartarDesfases` se rompe por la precedencia de errores en lotes mixtos, **ese test estaba fijando la conducta vieja**: actualizalo y decilo en el reporte, no lo borres.

- [x] **Step 5: Poner el reproductor en VERDE**

```bash
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npx jest --config test/jest-e2e.json test/orden-locks-desfases.e2e-spec.ts 2>&1 | tail -20
```
Esperado: PASS. Si el mecanismo elegido en la Task 1 era probabilístico, corrélo **5 veces** y reportá las 5.

- [x] **Step 6: Commit**

```bash
cd backend && npm run lint:check && npm run typecheck
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit --no-verify -m "fix(items): descartar desfases toma las filas en el orden declarado"
```

---

### Task 3: `update()` de un combo toma `item_combo` antes de `items`

**Files:**
- Modify: `backend/src/modules/items/items.service.ts:1336-1341` (agregar la rama de combo al lado del lock de receta)
- Test: `backend/src/modules/items/items.service.spec.ts` (al lado de `:1925`)

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces: nada que otra tarea consuma.

**Contexto:** hoy `update()` de un combo va `UPDATE items` (`:1343-1352`) → `UPDATE item_combo` (`:1699`), y `aplicarDesfases` va `item_combo FOR UPDATE` (`:4133`) → `UPDATE items SET precio_base`. Ciclo A→B / B→A. El guard del branch que escribe `item_combo` ya existe y es `tipo === 'combo' && dto.componentes !== undefined` (`:1662`) — el lock usa **esa misma condición**.

- [x] **Step 1: Escribir el test que falla**

```typescript
it('toma `item_combo` ANTES del UPDATE items — orden de locks contra aplicarDesfases', async () => {
  // Gemelo del test de recetas de más arriba, por el otro ciclo:
  // `aplicarDesfases` bloquea `item_combo` y después escribe `items` (precio).
  // Si el PATCH de combo los toma al revés, las dos se abrazan (40P01) con un
  // "editar combo" corriendo contra un "aplicar desfase con actualizar precio".
  managerMock.query
    .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'combo' }])
    .mockResolvedValue([]);

  await service.update(TENANT, USUARIO, ITEM_ID, {
    nombre: 'Combo renombrado',
    componentes: [{ componenteItemId: 'ingrediente-queso', cantidad: '1' }],
  });

  const sqls = managerMock.query.mock.calls.map((c: unknown[]) => c[0] as string);
  const lockCombo = sqls.findIndex((sql) =>
    sql.includes('FROM item_combo WHERE item_id = $1 FOR UPDATE'),
  );
  const updateItems = sqls.findIndex((sql) => sql.includes('UPDATE items SET'));
  expect(lockCombo).toBeGreaterThan(-1);
  expect(updateItems).toBeGreaterThan(-1);
  expect(lockCombo).toBeLessThan(updateItems);
});
```

⚠️ El `dto` de arriba tiene que ser un `UpdateItemDto` válido para un combo. **Leé `backend/src/modules/items/dto/update-item.dto.ts` y los tests de combo que ya existen** y copiá la forma real de `componentes` — si el mock del costeo necesita más `mockResolvedValueOnce`, agregalos. No inventes campos.

- [x] **Step 2: Correr el test y verlo fallar**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts -t "item_combo` ANTES" 2>&1 | tail -20
```
Esperado: FAIL con `lockCombo` en `-1` (hoy no existe ese lock).

- [x] **Step 3: Implementar el lock**

Justo después del `if` de receta de `:1336-1341`, como rama alternativa:

```typescript
      } else if (tipo === 'combo' && dto.componentes !== undefined) {
        // Gemelo del lock de arriba, por el otro ciclo: `aplicarDesfases`
        // bloquea `item_combo` y después escribe `items` (el precio). El
        // `UPDATE items` que sigue toma lock sobre `items`, así que sin este
        // lock los dos caminos se toman las filas en orden inverso y se
        // abrazan (40P01) — con un PATCH de combo (nombre + componentes)
        // corriendo contra un "aplicar desfase con actualizar precio".
        await manager.query(
          `SELECT item_id FROM item_combo WHERE item_id = $1 FOR UPDATE`,
          [itemId],
        );
      }
```

- [x] **Step 4: Correr los tests y verlos pasar**

```bash
cd backend && npm test 2>&1 | tail -8
```
Esperado: PASS. **Se espera que se rompan los tests posicionales de `update`/`remove` de combo**: el lock nuevo mete una query y los índices se corren. Arreglá los índices; no toques lo que esos tests afirman.

- [x] **Step 5: Commit**

```bash
cd backend && npm run lint:check && npm run typecheck
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit --no-verify -m "fix(items): el PATCH de un combo bloquea item_combo antes de items"
```

---

### Task 4: `aplicarDesfases` valida el tenant antes de tomar los locks

**Files:**
- Modify: `backend/src/modules/items/items.service.ts:4115-4144`
- Test: `backend/src/modules/items/items.service.spec.ts` (el `describe` de `:4853`; **además** hay que reordenar el mock de `:4962`)

**Contexto:** los dos `FOR UPDATE` se toman en `:4128-4137` y `cabecerasCompuestas` —que es quien filtra `tenant_id`— corre recién en `:4139`. Un usuario autenticado que mande ids de otro tenant bloquea esas filas hasta el rollback del 404. No hay fuga de datos: el 404 sale igual y no devuelve nada del otro tenant.

- [x] **Step 1: Escribir el test que falla**

```typescript
it('valida el tenant ANTES de tomar los locks', async () => {
  // Con los locks primero, un id de otro tenant bloquea filas ajenas hasta el
  // rollback del 404. La lectura de cabeceras es la que filtra tenant_id.
  managerMock.query.mockResolvedValueOnce([]).mockResolvedValue([]);

  await expect(
    service.aplicarDesfases(TENANT, [{ itemId: 'de-otro-tenant' }]),
  ).rejects.toThrow(NotFoundException);

  const sqls = managerMock.query.mock.calls.map((c: unknown[]) => c[0] as string);
  expect(sqls.some((s) => s.includes('FOR UPDATE'))).toBe(false);
});
```

- [x] **Step 2: Correr el test y verlo fallar**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts -t "ANTES de tomar los locks" 2>&1 | tail -20
```
Esperado: FAIL — hoy los dos `FOR UPDATE` salen antes del 404.

- [x] **Step 3: Subir la validación y lockear solo lo validado**

Movés el bloque de `cabecerasCompuestas` + el loop de `NotFoundException` (`:4139-4144`) **arriba** de los dos `await manager.query(... FOR UPDATE)`, y los locks pasan a usar los ids validados:

```typescript
      const ids = [...new Set(items.map((i) => i.itemId))];

      // La validación de tenant va ANTES de los locks: `cabecerasCompuestas`
      // es quien filtra `tenant_id`, y con los locks primero un id ajeno
      // bloqueaba filas de otro tenant hasta el rollback del 404. Lee `items`
      // sin lock, así que subirla no toma nada por adelantado.
      const cabPorId = await this.cabecerasCompuestas(manager, tenantId, ids);
      for (const it of items) {
        if (!cabPorId.has(it.itemId)) {
          throw new NotFoundException(`Item ${it.itemId} no encontrado`);
        }
      }
      const idsValidados = ids.filter((id) => cabPorId.has(id));

      // (acá el comentario de :4116-4127 TAL CUAL: los locks antes de leer los
      //  ingredientes, el ORDER BY, y el orden entre tablas)
      await manager.query(
        `SELECT item_id FROM item_receta
          WHERE item_id = ANY($1) ORDER BY item_id FOR UPDATE`,
        [idsValidados],
      );
      await manager.query(
        `SELECT item_id FROM item_combo
          WHERE item_id = ANY($1) ORDER BY item_id FOR UPDATE`,
        [idsValidados],
      );
```

**El comentario de `:4116-4127` se conserva íntegro** y se mueve con los locks: sigue siendo cierto y explica el `ORDER BY` y el orden entre tablas. El invariante que declara —los locks antes de leer los ingredientes— se mantiene, porque `ingredientesPorReceta` y `componentesPorCombo` siguen después.

- [x] **Step 4: Arreglar el mock del test de lecturas constantes**

`items.service.spec.ts:4962` encadena `mockResolvedValueOnce` en el orden viejo (los dos locks, después las cabeceras). Ahora las cabeceras van primero. Reordenalo. **No toques ninguna de sus aserciones**: siguen siendo válidas y son las que fijan que hay 5 SELECT y 2 locks en el orden `item_receta` → `item_combo`.

- [x] **Step 5: Correr los tests y verlos pasar**

```bash
cd backend && npm test 2>&1 | tail -8
```
Esperado: PASS.

- [x] **Step 6: Commit**

```bash
cd backend && npm run lint:check && npm run typecheck
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit --no-verify -m "fix(items): aplicar desfases valida el tenant antes de bloquear filas"
```

---

### Task 5: Test de lecturas constantes para N combos

**Files:**
- Test: `backend/src/modules/items/items.service.spec.ts` (al lado del gemelo de recetas de `:4962`)

**Contexto:** el de recetas es fuerte (5 SELECT fijos para el lote entero). La rama de combos solo se ejercita con **un** combo, así que un N+1 futuro ahí no lo caza nadie.

- [x] **Step 1: Escribir el test**

Copiá la forma del de recetas y adaptala a combos. **El número es 4**, contado sobre el código (no copiado de una corrida): cabeceras, lock de `item_receta`, lock de `item_combo`, y `componentesPorCombo`. `ingredientesPorReceta` corta en seco con lista vacía (`if (!recetaItemIds.length) return out`), el catálogo de unidades no se carga porque `:4161` lo condiciona a que haya recetas, y el bloque de `afectados` (`:4262-4279`) se saltea entero porque `recetasAplicadas.size` es 0.

Verificá ese 4 vos mismo antes de escribirlo. Si te da otro número, **el plan está mal y hay que decirlo** — no ajustes el número a lo que salga sin explicar de dónde sale la diferencia.

```typescript
it('aplicar sobre N combos hace lecturas CONSTANTES, no por combo', async () => {
  const IDS = ['combo-a', 'combo-b', 'combo-c'];
  // ... mocks en el orden real de lecturas (ojo: la Task 4 movió las cabeceras
  //     ARRIBA de los dos locks)
  const result = await service.aplicarDesfases(TENANT, IDS.map((id) => ({ itemId: id })));

  expect(result.aplicados).toBe(3);
  const sqls = managerMock.query.mock.calls.map((c: unknown[]) => c[0] as string);
  // El número exacto sale de contar sobre el código, no de correr y copiar lo
  // que dé: si lo copiás de la corrida, el test fija el N+1 en vez de cazarlo.
  // 4 lecturas para el lote entero: cabeceras, los 2 locks y los componentes.
  // Fijo a propósito: con 3 combos, si alguien vuelve a leer o a bloquear POR
  // COMBO, los SELECT se multiplican y este número lo caza.
  expect(sqls.filter((s) => s.trim().startsWith('SELECT'))).toHaveLength(4);
  expect(sqls.filter((s) => s.includes('UPDATE item_combo'))).toHaveLength(3);
  expect(catalogServiceMock.crearConversor).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Verificar que caza el mutante**

Meté un N+1 a mano en la rama de combos (una lectura por combo dentro del loop), confirmá que el test falla, y **revertilo verificando `git status --porcelain` vacío**. Un test de lecturas constantes que no falla con un N+1 no sirve.

- [x] **Step 3: Correr los tests y commitear**

```bash
cd backend && npm test 2>&1 | tail -8 && npm run lint:check && npm run typecheck
git add backend/src/modules/items/items.service.spec.ts
git commit --no-verify -m "test(items): lecturas constantes para N combos"
```

---

### Task 6: Documentación

**Files:**
- Modify: `docs/patterns/backend.md`
- Modify: `docs/agent/pendientes.md`
- Modify: `docs/agent/resueltos.md`
- Modify: `docs/ESTADO.md` (solo si alguna fila cambia de estado; si no, no lo toques)

- [x] **Step 1: La regla, donde se lee antes de romperla**

En `docs/patterns/backend.md`, sección de backend, una entrada corta: el orden `item_receta → item_combo → items`, por qué existe (dos transacciones que piden las mismas filas al revés se abrazan y Postgres mata una con `40P01`), que un camino puede saltear tablas pero no invertirlas, y el puntero a los tests que lo fijan. Sin repetir el código.

- [x] **Step 2: Cerrar la entrada del backlog**

La entrada *"Dos ciclos de orden de lock en la bandeja de desfases de combos…"* se muda **entera** de `pendientes.md` a `resueltos.md`, con el texto de su cierre: qué se arregló, con qué evidencia, y qué reportó el spike de la Task 1 sobre el reproductor.

Actualizá también la tabla de la sección 🔴 (*"Qué agrupa"*): la fila "Conexiones / deadlock" queda **cerrada del todo**; siguen abiertas rendimiento y redondeo de plata.

- [x] **Step 3: Abrir la entrada de la carrera que NO se arregló**

Entrada nueva en `pendientes.md` (sección 2, "Medir primero"): `descartarDesfases` lee cabeceras, ingredientes y componentes, calcula el costo propuesto y recién ahí escribe `costo_propuesto_omitido`, **sin lock**. Un `aplicar` concurrente puede mover el costo en el medio, y descartar archivaría como "omitido" un número que ya no es el propuesto. Decisión del owner 2026-08-19: se anota, no se arregla en esta pasada. Poné el `archivo:línea` medido.

- [x] **Step 4: `anti-patterns.md`, solo si hace falta**

Únicamente si el spike de la Task 1 descubrió una forma de romper el orden que la regla no cubre. Si no descubrió ninguna, **no inventes una entrada**: el archivo es de errores reales ya cometidos acá.

- [x] **Step 5: Commit (sin `--no-verify`: son solo docs)**

```bash
git add docs/
git commit -m "docs(items): el orden de bloqueo de filas, y la carrera que queda abierta"
```

---

### Task 7: Gate completo + revisión independiente

- [ ] **Step 1: Backend, en serie**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```
Los tres en verde, **exit code comprobado**.

- [ ] **Step 2: E2E entero, y SOLO el e2e**

```bash
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npm run test:e2e
```
Nada más corriendo: ni el gate del frontend, ni un subagente editando. Después: `./scripts/reset-db.sh --verificar`.

- [ ] **Step 3: Frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

- [ ] **Step 4: Mutantes de reversión**

Por cada uno de los tres cambios de código, revertilo a su forma vieja y confirmá que **su** test lo caza. Después de cada revert, verificá `git status --porcelain` vacío **y la hora del restart del contenedor en los logs** — el fuente limpio no prueba que el proceso lo esté.

- [ ] **Step 5: Verificar el criterio de éxito del spec por grep**

*"Ningún camino del repo adquiere las tres tablas en un orden distinto al declarado."* Los escritores son un solo archivo, así que es barato y hay que hacerlo:

```bash
cd backend && grep -n "item_receta\|item_combo\|UPDATE items" src/modules/items/items.service.ts
```

Recorré cada camino que toque más de una de las tres tablas y confirmá el orden `item_receta → item_combo → items`. Reportá la lista de caminos revisados, no solo la conclusión. Confirmá también que fuera de `items.service.ts` el único que las escribe sigue siendo el seeder:

```bash
grep -rn --include='*.ts' "UPDATE item_combo\|UPDATE item_receta\|INSERT INTO item_combo\|INSERT INTO item_receta" src | grep -v "items.service.ts" | grep -v "\.spec\.ts"
```

- [ ] **Step 6: Revisión independiente**

`domain-reviewer` sobre el diff completo de la rama. Es el paso 7 de `verify-feature` y lo que el pre-commit exige para levantar el bloqueo sobre services de backend.

- [ ] **Step 7: Push**

Recién con todo lo anterior en verde. El push **despliega en Railway**: revisar el deployment además del CI (`railway deployment list --service backend --json` → `SUCCESS` para el commit exacto) y correr `./scripts/smoke-produccion.sh`.
