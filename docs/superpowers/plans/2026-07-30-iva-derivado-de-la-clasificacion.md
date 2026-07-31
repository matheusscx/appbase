# IVA derivado de la clasificación tributaria — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos
> usan checkbox (`- [ ]`).

**Goal:** Que un ítem `afecto` lleve el IVA siempre y uno `exento` nunca, derivándolo de
`clasificacion_tributaria` en el motor de cálculo en vez de almacenarlo en
`item_impuestos`.

**Architecture:** El IVA deja de guardarse. `resolverLinea` decide el IVA de cada línea a
partir de la clasificación del ítem: saca cualquier `tipo='iva'` que venga en la lista
—del ítem o pisada por la línea— y agrega el IVA del país solo si es `afecto`.
`item_impuestos` pasa a significar "impuestos adicionales". El IVA no se acepta por
payload en ningún endpoint.

**Tech Stack:** NestJS + TypeORM (queries SQL crudas vía `dataSource.query`), Jest +
supertest para e2e, Nuxt 4 + Nuxt UI en el frontend, Decimal.js para dinero.

**Spec:** `docs/superpowers/specs/2026-07-30-iva-automatico-clasificacion-tributaria-design.md`

## Global Constraints

- **Invariante 6:** el enforcement real va en el backend. Esconder el chip en la UI nunca
  sustituye al 400.
- **Dinero y porcentajes con Decimal.js**, nunca `number`. Porcentajes en decimal
  (`0.19` = 19%).
- **Soft delete en todo:** nunca `DELETE` de filas de negocio; toda `SELECT`/`JOIN` nueva
  filtra `eliminado_el IS NULL`. (Las tablas puente como `item_impuestos` no tienen
  `eliminado_el` y sí se borran físicamente — es el patrón ya existente del repo.)
- **Nunca una query por iteración (N+1).**
- **No hay datos productivos:** se cambia el esquema, se actualiza el seeder y se
  resiembra. Nada de backfills ni migraciones incrementales.
- **Mensaje de error único y textual** para el IVA por payload, en todos los endpoints:
  `'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria'`
- **Cada tarea cierra con su gate y su commit.** Backend:
  `npm run lint:check && npm run typecheck && npm test`, y si tocó rutas o esquema,
  `./scripts/reset-db.sh` **inmediatamente antes** de `npm run test:e2e`.
  Frontend: `npm run build && npx vitest run && npm run typecheck:ratchet && npm run design:check`.
- **Todo test lleva mutante verificado revirtiendo al código anterior**, no un `throw`.
- **Revisión independiente** (`domain-reviewer` sobre el diff staged) antes de cada commit,
  con su recibo:
  `git diff --cached | git hash-object --stdin > .git/verify-feature.receipt`

---

## File Structure

| Archivo | Responsabilidad tras el cambio |
|---|---|
| `backend/src/modules/calculo-precios/calculo-precios.service.ts` | **Corazón.** Deriva el IVA por línea y rechaza el IVA por payload en las líneas |
| `backend/src/modules/items/items.service.ts` | Rechaza el IVA en `impuestosIds`; persiste `NULL` para ingredientes |
| `backend/src/modules/items/entities/item.entity.ts` | `clasificacion_tributaria` pasa a nullable |
| `backend/src/modules/seeder/seeder.service.ts` | Deja de asociar el IVA; el remapeo borra en vez de reapuntar; ingredientes con `NULL` |
| `frontend/app/pages/configuracion/items.vue` | Chip fijo del IVA; esconde la clasificación para ingredientes |
| `docs/…` | ADR-018, `impuestos.md`, `PRODUCTO.md`, `ESTADO.md`, `pendientes.md` → `resueltos.md` |

---

### Task 1: El motor deriva el IVA

Es la tarea que arregla el bug. Después de ella el cálculo ya es correcto **incluso con
`item_impuestos` sucio**, porque el strip de `tipo='iva'` es defensa contra datos viejos.

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts`
- Test: `backend/src/modules/calculo-precios/calculo-precios.service.spec.ts`
- Test e2e: `backend/test/` (el spec de ventas/items que corresponda al camino de venta)

**Interfaces:**
- Consume: `impuestosService.findAll(tenantId)` → `{ id, nombre, porcentaje, tipo, origen }[]`,
  ya incluye las filas del sistema del país. `item.clasificacionTributaria` viene de
  `cargarBasePorIds` → `mapRow` (`items.service.ts:183`).
- Produce: `resolverLinea` pasa a recibir un parámetro nuevo
  `ivaDelPais: (ImpuestoResuelto & { tipo: string }) | null`, calculado una sola vez por
  `calcular()`.

- [ ] **Paso 1: Escribir los tests que fallan**

En `calculo-precios.service.spec.ts`, siguiendo el patrón de mocks que ya usa el archivo
(`ImpuestosService.findAll` mockeado devolviendo el catálogo):

```ts
// Catálogo: el IVA del país (sistema) + un adicional del tenant.
const IVA = { id: 'iva-cl', nombre: 'IVA', porcentaje: '0.19', tipo: 'iva' }
const OTRO = { id: 'otro-1', nombre: 'Impuesto verde', porcentaje: '0.05', tipo: 'otro' }

it('un ítem afecto sin impuestos asociados igual lleva el IVA', async () => {
  // item afecto, item_impuestos vacío — el camino por default de /items
  const res = await service.calcular(TENANT, { lineas: [{ itemId: ITEM, cantidad: '1' }] })
  expect(res.lineas[0].impuestos.map(i => i.id)).toEqual(['iva-cl'])
})

it('un ítem afecto con adicionales lleva los adicionales MÁS el IVA', async () => {
  // item_impuestos = [OTRO]
  const res = await service.calcular(TENANT, { lineas: [{ itemId: ITEM, cantidad: '1' }] })
  expect(res.lineas[0].impuestos.map(i => i.id)).toEqual(['otro-1', 'iva-cl'])
})

it('un ítem exento con adicionales lleva los adicionales SIN IVA', async () => {
  // item exento, item_impuestos = [OTRO]
  const res = await service.calcular(TENANT, { lineas: [{ itemId: ITEM, cantidad: '1' }] })
  expect(res.lineas[0].impuestos.map(i => i.id)).toEqual(['otro-1'])
})

it('una línea que pisa los impuestos con [] igual lleva el IVA si el ítem es afecto', async () => {
  // La segunda puerta: `linea.impuestoIds ?? reglas` prioriza la línea.
  const res = await service.calcular(TENANT, {
    lineas: [{ itemId: ITEM, cantidad: '1', impuestoIds: [] }],
  })
  expect(res.lineas[0].impuestos.map(i => i.id)).toEqual(['iva-cl'])
})

it('una clasificación null no deriva IVA', async () => {
  // Un ingrediente: no tiene tratamiento fiscal. Fija el `=== 'afecto'`
  // contra el `!== 'exento'`, que con null derivaría IVA.
  const res = await service.calcular(TENANT, { lineas: [{ itemId: ITEM_INGREDIENTE, cantidad: '1' }] })
  expect(res.lineas[0].impuestos).toEqual([])
})

it('un ítem afecto sin IVA en el país revienta en vez de vender sin IVA', async () => {
  // Catálogo sin ninguna fila tipo='iva'.
  await expect(
    service.calcular(TENANT, { lineas: [{ itemId: ITEM, cantidad: '1' }] }),
  ).rejects.toThrow(/afecto a IVA/)
})

it('un item_impuestos con el IVA viejo no lo cobra dos veces', async () => {
  // Defensa contra datos previos a este cambio: item_impuestos = [IVA, OTRO]
  const res = await service.calcular(TENANT, { lineas: [{ itemId: ITEM, cantidad: '1' }] })
  expect(res.lineas[0].impuestos.map(i => i.id)).toEqual(['otro-1', 'iva-cl'])
})
```

- [ ] **Paso 2: Correr y verificar que fallan**

```bash
cd backend && npx jest calculo-precios.service.spec --verbose
```

Esperado: FAIL. El primero y el cuarto dan `[]` (hoy no se deriva nada); el séptimo da el
IVA duplicado.

- [ ] **Paso 3: Calcular el IVA del país una sola vez en `calcular()`**

En `calculo-precios.service.ts`, justo después de armar `impuestoMap` (línea ~63):

```ts
    // El IVA del país del tenant. Hay a lo sumo uno visible: `impuestos.tipo`
    // tiene default 'otro' y no está expuesto en CreateImpuestoDto ni en
    // UpdateImpuestoDto, así que un tenant no puede crear otra fila 'iva'.
    // Se busca una vez por cálculo, no por línea. Ver ADR-018.
    const ivaDelPais = impuestos.find((i) => i.tipo === 'iva') ?? null;
```

Y se pasa a `resolverLinea` en la llamada del `.map()` (línea ~97), como argumento nuevo
después de `impuestoMap`.

- [ ] **Paso 4: Derivar en `resolverLinea`**

Agregar el parámetro a la firma:

```ts
    impuestoMap: Map<string, ImpuestoResuelto & { tipo: string }>,
    ivaDelPais: (ImpuestoResuelto & { tipo: string }) | null,
```

Y reemplazar el bloque `impuestos:` del `return` (hoy `calculo-precios.service.ts:184-191`)
por esto, **antes** del `return`:

```ts
    // El IVA de una línea lo decide la clasificación tributaria, NUNCA la lista
    // de impuestos: se saca cualquier 'iva' que venga —del ítem o pisado por la
    // línea— y se agrega el del país solo si es afecto. El mismo código cubre
    // las dos direcciones y no puede duplicar. Los 'otro' aplican siempre, en
    // afectos y exentos (DL 825 / IndExe del DTE).
    //
    // ⚠️ La condición es POSITIVA a propósito. `clasificacion_tributaria` es
    // nullable (los ingredientes no tienen tratamiento fiscal): un `!== 'exento'`
    // dejaría pasar el null y le cobraría IVA a un ingrediente.
    const impuestosLinea = impuestoIds
      .map((id) => this.requerir(impuestoMap, id, 'impuesto'))
      .filter((imp) => imp.tipo !== 'iva');

    if (item.clasificacionTributaria === 'afecto') {
      if (!ivaDelPais) {
        throw new BadRequestException(
          `El ítem "${item.nombre}" es afecto a IVA, pero el país del tenant no tiene un impuesto tipo 'iva' configurado`,
        );
      }
      impuestosLinea.push(ivaDelPais);
    }
```

Y en el `return`, `impuestos: impuestosLinea,`.

- [ ] **Paso 5: Correr los tests**

```bash
cd backend && npx jest calculo-precios.service.spec --verbose
```

Esperado: PASS los siete.

- [ ] **Paso 6: Verificar los mutantes**

Uno por uno, revirtiendo al código anterior (no un `throw`), y confirmando qué test se
pone en rojo:

1. Cambiar `=== 'afecto'` por `!== 'exento'` → tiene que romper *"una clasificación null
   no deriva IVA"*. Si no rompe, el test no está montando el ingrediente bien.
2. Sacar el `.filter((imp) => imp.tipo !== 'iva')` → tiene que romper *"no lo cobra dos
   veces"*.
3. Volver el bloque entero al código anterior (`impuestos: impuestoIds.map(...).filter(imp
   => item.clasificacionTributaria !== 'exento' || imp.tipo !== 'iva')`) → tienen que
   romper el primero, el cuarto y el séptimo.

Restaurar después de cada uno.

- [ ] **Paso 7: El e2e — el bug de punta a punta**

En `backend/test/ventas.e2e-spec.ts` (es el que ya tiene el flujo completo de venta):
crear un ítem `afecto` **sin mandar `impuestosIds`** —el camino por default— y venderlo. El
total tiene que traer el 19% y quedar la traza en `ventas_impuestos`. Es el caso que hoy
cobra de menos.

```bash
cd backend && ./scripts/reset-db.sh && npm run test:e2e
```

⚠️ El `reset-db.sh` va **inmediatamente antes** del e2e, sin lint ni unit en el medio: el
backend corre en watch mode y recompilar en el medio vuelve a disparar el seeder encima de
la suite.

⚠️ Correr el e2e **completo**, no un subset: un cambio en el motor toca todos los caminos
de venta.

- [ ] **Paso 8: Gate, revisión y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
git add -A
```

Revisión independiente (`domain-reviewer`) sobre el diff staged, recibo, y:

```bash
git commit -m "fix(precios): el IVA se deriva de la clasificación tributaria"
```

---

### Task 2: El IVA no entra por payload

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`validarImpuestos`, ~línea 3712)
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts` (`calcular`)
- Test: `backend/src/modules/items/items.service.spec.ts`,
  `backend/src/modules/calculo-precios/calculo-precios.service.spec.ts`

**Interfaces:**
- Consume: `validarImpuestos(manager, tenantId, ids)` ya existe y ya se llama desde
  `create` (`items.service.ts:769`) y `update` (`:1160`). No hay que agregar call sites.
- Produce: el mismo mensaje literal en los tres endpoints (ver Global Constraints).

- [ ] **Paso 1: Escribir los tests que fallan**

En `items.service.spec.ts`:

```ts
it('rechaza el IVA en impuestosIds al crear un ítem', async () => {
  await expect(
    service.create(TENANT, { ...itemBase, impuestosIds: ['iva-cl'] }),
  ).rejects.toThrow('El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria')
})

it('rechaza el IVA en impuestosIds al editar un ítem', async () => {
  await expect(
    service.update(TENANT, ITEM, { impuestosIds: ['iva-cl'] }),
  ).rejects.toThrow('El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria')
})

it('sigue aceptando impuestos adicionales', async () => {
  // El rechazo mira SOLO las filas tipo='iva': una lista de 'otro' es válida
  // en cualquier clasificación, y eso es la regla de negocio, no un detalle.
  await expect(
    service.create(TENANT, { ...itemBase, impuestosIds: ['otro-1'] }),
  ).resolves.toBeDefined()
})
```

En `calculo-precios.service.spec.ts`:

```ts
it('rechaza el IVA mandado explícito en una línea', async () => {
  await expect(
    service.calcular(TENANT, {
      lineas: [{ itemId: ITEM, cantidad: '1', impuestoIds: ['iva-cl'] }],
    }),
  ).rejects.toThrow('El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria')
})
```

- [ ] **Paso 2: Correr y verificar que fallan**

```bash
cd backend && npx jest items.service.spec calculo-precios.service.spec --verbose
```

Esperado: FAIL — hoy los cuatro pasan sin chistar (los tres primeros resuelven, el cuarto
no lanza).

- [ ] **Paso 3: Rechazar en `validarImpuestos`**

Reemplazar el cuerpo de `validarImpuestos` (`items.service.ts:3712-3733`). La query pasa de
`COUNT(*)` a devolver los tipos, que es el dato que hace falta:

```ts
  /**
   * Impuestos válidos: personalizados del tenant o del catálogo del sistema del
   * país del tenant. Y **nunca el IVA**: se deriva de `clasificacion_tributaria`,
   * no se asigna por ítem (ADR-018).
   */
  private async validarImpuestos(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    const rows: { impuesto_id: string; tipo: string }[] = await manager.query(
      `SELECT i.impuesto_id, i.tipo FROM impuestos i
        WHERE i.impuesto_id = ANY($1::uuid[]) AND i.eliminado_el IS NULL
          AND (i.tenant_id = $2
               OR i.pais_id = (SELECT p.pais_id
                                 FROM tenants t
                                 JOIN provincia p ON p.provincia_id = t.provincia_id
                                WHERE t.tenant_id = $2 AND t.eliminado_el IS NULL))`,
      [ids, tenantId],
    );
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        'Uno o más impuestos no están disponibles para este tenant',
      );
    }
    if (rows.some((r) => r.tipo === 'iva')) {
      throw new BadRequestException(
        'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria',
      );
    }
  }
```

- [ ] **Paso 4: Rechazar en las líneas del motor**

En `calcular()`, junto al loop que ya valida cantidades (`calculo-precios.service.ts:~86`),
y **después** de armar `impuestoMap`:

```ts
    // El IVA no entra por payload, mismo contrato que POST/PATCH /items. El
    // strip de `resolverLinea` es defensa contra `item_impuestos` viejo, no
    // contrato de la API: si el cliente lo manda explícito, se le dice.
    for (const l of dto.lineas) {
      if (l.impuestoIds?.some((id) => impuestoMap.get(id)?.tipo === 'iva')) {
        throw new BadRequestException(
          'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria',
        );
      }
    }
```

Cubre `POST /ventas` (que pasa `linea.impuestoIds`, `ventas.service.ts:318`) y el
simulador, en un solo lugar.

- [ ] **Paso 5: Correr los tests**

```bash
cd backend && npx jest items.service.spec calculo-precios.service.spec --verbose
```

Esperado: PASS.

- [ ] **Paso 6: Verificar los mutantes**

1. Sacar el `if (rows.some(...))` de `validarImpuestos` → rompen los dos primeros.
2. Sacar el loop de líneas → rompe el cuarto.
3. Cambiar `rows.length !== ids.length` por `rows.length < ids.length` → **no debería
   romper ninguno**. Si rompe, hay un test acoplado a la forma de la query y no al
   comportamiento; si no rompe, está bien y no hace falta test nuevo: la condición vieja
   ya estaba cubierta por los tests de pertenencia que existen.

- [ ] **Paso 7: Gate, revisión y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && npm run test:e2e
```

Revisión independiente, recibo, y:

```bash
git commit -m "feat(items,precios): el IVA no se acepta por payload"
```

---

### Task 3: `ingrediente` sin clasificación tributaria

**Files:**
- Modify: `backend/src/modules/items/entities/item.entity.ts:42-43`
- Modify: `backend/src/modules/items/items.service.ts` (`create` ~812, `update` ~1220)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consume: en `update()` ya existe la variable `tipo` con el tipo guardado del ítem.
  `update-item.dto.ts` **no expone `tipo`**, así que el tipo es inmutable y alcanza con
  mirar el guardado.
- Produce: `clasificacionTributaria: string | null` en la entidad y en `mapRow`.

- [ ] **Paso 1: Escribir los tests que fallan**

```ts
it('un ingrediente se guarda sin clasificación tributaria', async () => {
  await service.create(TENANT, { ...itemBase, tipo: 'ingrediente' })
  const insert = queryMock.mock.calls.find(([sql]) => sql.includes('INSERT INTO items'))
  expect(insert[1]).toContain(null) // clasificacion_tributaria
})

it('rechaza mandar clasificación tributaria en un ingrediente', async () => {
  await expect(
    service.create(TENANT, { ...itemBase, tipo: 'ingrediente', clasificacionTributaria: 'afecto' }),
  ).rejects.toThrow('Un ingrediente no tiene clasificación tributaria: no se vende')
})

it('rechaza editar la clasificación tributaria de un ingrediente', async () => {
  // El tipo es inmutable (update-item.dto.ts no lo expone), así que se
  // compara contra el tipo guardado.
  await expect(
    service.update(TENANT, ITEM_INGREDIENTE, { clasificacionTributaria: 'exento' }),
  ).rejects.toThrow('Un ingrediente no tiene clasificación tributaria: no se vende')
})

it('los demás tipos siguen guardando afecto por default', async () => {
  await service.create(TENANT, { ...itemBase, tipo: 'producto' })
  const insert = queryMock.mock.calls.find(([sql]) => sql.includes('INSERT INTO items'))
  expect(insert[1]).toContain('afecto')
})
```

- [ ] **Paso 2: Correr y verificar que fallan**

```bash
cd backend && npx jest items.service.spec --verbose
```

- [ ] **Paso 3: La columna pasa a nullable**

**Corregido por el owner en la ronda de fix 1/5 de Task 3 (2026-07-31): esta versión
original pedía sacar el `DEFAULT 'afecto'` junto con agregar `nullable`. Estaba mal — el
`DEFAULT` y `nullable` protegen cosas distintas y no se reemplazan entre sí.** `nullable` +
la condición positiva `=== 'afecto'` del motor de precios protegen la LECTURA (un `NULL`
existente nunca deriva IVA). El `DEFAULT 'afecto'` protege la ESCRITURA: sin él, cualquier
`INSERT` crudo que omita la columna (seed, scripts, futuras migraciones) produce un `NULL`
por accidente en vez de `'afecto'`. La implementación real lo probó: 4 de los 6 `INSERT
INTO items` del seeder no especificaban la columna y confiaban en el default; al sacarlo,
2 de esos 4 rompieron e2e ajenos con montos exactos (los otros 2 no tenían ningún test que
los cazara — se habrían quedado corrompidos en silencio). La columna va **nullable
conservando el default**:

En `item.entity.ts:42-43`:

```ts
  // Nullable a propósito: `tipo='ingrediente'` no tiene tratamiento fiscal
  // porque no se vende. NO es "afecto por defecto" — ver ADR-018 y el
  // `=== 'afecto'` de calculo-precios.service.ts.
  //
  // El DEFAULT se conserva a propósito, junto con `nullable`: son dos
  // protecciones distintas, no una redundancia (ver el porqué arriba en el
  // plan). Un ingrediente se inserta con NULL **explícito** (gana sobre el
  // default); el resto de los tipos sigue confiando en el default cuando el
  // payload no manda `clasificacionTributaria`.
  @Column({
    name: 'clasificacion_tributaria',
    type: 'text',
    nullable: true,
    default: 'afecto',
  })
  clasificacionTributaria: string | null; // 'afecto' | 'exento' | null
```

- [ ] **Paso 4: Persistir `NULL` y rechazar el campo**

En `create()`, donde hoy va `dto.clasificacionTributaria ?? 'afecto'`
(`items.service.ts:812`):

```ts
      if (dto.tipo === 'ingrediente' && dto.clasificacionTributaria !== undefined) {
        throw new BadRequestException(
          'Un ingrediente no tiene clasificación tributaria: no se vende',
        );
      }
```

y el valor pasa a:

```ts
        dto.tipo === 'ingrediente'
          ? null
          : (dto.clasificacionTributaria ?? 'afecto'),
```

Aplicar el mismo par en el segundo camino de creación (`items.service.ts:~1071`).

En `update()`, junto a los `setClauses` (`:1220`):

```ts
      if (dto.clasificacionTributaria !== undefined) {
        if (tipo === 'ingrediente') {
          throw new BadRequestException(
            'Un ingrediente no tiene clasificación tributaria: no se vende',
          );
        }
        setClauses.push(`clasificacion_tributaria = $${idx++}`);
        // … resto igual
      }
```

- [ ] **Paso 5: Correr los tests**

```bash
cd backend && npx jest items.service.spec --verbose
```

- [ ] **Paso 6: Verificar los mutantes**

1. Volver el valor a `dto.clasificacionTributaria ?? 'afecto'` → rompe el primero.
2. Sacar el `if` de `create` → rompe el segundo.
3. Sacar el `if (tipo === 'ingrediente')` de `update` → rompe el tercero.
4. Volver la columna a `default: 'afecto'` sin `nullable` → **el typecheck** tiene que
   romper por `string | null`. Si no rompe, `mapRow` está devolviendo `any` y hay que
   tiparlo.

- [ ] **Paso 7: Gate, revisión y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && npm run test:e2e
```

⚠️ Este es el que más chance tiene de romper e2e ajenos: cambia una columna. Correr la
suite **completa**.

```bash
git commit -m "feat(items): un ingrediente no tiene clasificación tributaria"
```

---

### Task 4: Seeder — dejar de asociar el IVA

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts:3043` (ítem demo),
  `:2369-2405` (`remapImpuestosOficialesDuplicados`), y los ingredientes del seed

**Interfaces:**
- Consume: nada nuevo.
- Produce: una BD sembrada sin ninguna fila `item_impuestos` que apunte a un `tipo='iva'`.

- [ ] **Paso 1: Sacar la asociación del ítem demo**

Borrar el `INSERT INTO item_impuestos (item_id, impuesto_id) VALUES ($1,$2)` con `IVA_19`
(`seeder.service.ts:3043-3046`). El ítem es `afecto`, así que deriva el mismo 19%: **el
comportamiento sembrado no cambia** y por eso los totales que el e2e ya afirma siguen
valiendo. Si alguno se rompe, es señal real.

- [ ] **Paso 2: El remapeo borra en vez de reapuntar**

En `remapImpuestosOficialesDuplicados`, el `INSERT … SELECT` que reapunta `item_impuestos`
al IVA oficial (`:2394-2398`) se reemplaza por el borrado de esas asociaciones. Actualizar
el docblock: la función ya no migra hacia el oficial, **desasocia**, porque el IVA se
deriva.

⚠️ Esta función existe porque un tenant puede crear un impuesto propio llamado "IVA" con
el mismo porcentaje. Como no puede ser `tipo='iva'`, entra como `'otro'` y **se sumaría al
IVA derivado: 38%**. El soft delete del duplicado se mantiene: es lo que evita la doble
tributación.

- [ ] **Paso 3: Los ingredientes del seed con `NULL`**

Buscar los `INSERT INTO items` con `'ingrediente'` y sacarles la clasificación tributaria
(o pasarla explícita en `NULL`), coherente con la Task 3.

- [ ] **Paso 4: Resembrar y verificar a mano**

```bash
cd .. && ./scripts/reset-db.sh
```

Y contra la BD sembrada, confirmar que no quedó ninguna asociación de IVA:

```sql
SELECT COUNT(*) FROM item_impuestos ii
  JOIN impuestos i ON i.impuesto_id = ii.impuesto_id
 WHERE i.tipo = 'iva';
-- esperado: 0
```

- [ ] **Paso 5: Gate, revisión y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && npm run test:e2e
git commit -m "refactor(seeder): el IVA ya no se asocia, se deriva"
```

---

### Task 5: Frontend — el chip fijo del IVA

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` (`:276` `impuestosOpts`,
  `:742` el fetch, `:773` el llenado, `:2004-2013` el `UFormField` de Impuestos)

**Interfaces:**
- Consume: `GET /impuestos` ya devuelve `tipo`, `porcentaje`, `activo` y `origen` — hoy el
  front pide `any[]` y los tira.
- Produce: `form.impuestosIds` **nunca** contiene el IVA.

✅ **Ya está hecho, no volver a hacerlo:** el bloque "Reglas asociadas" —que incluye la
clasificación tributaria y los impuestos— ya está envuelto en
`v-if="form.tipo !== 'ingrediente'"` (`items.vue:1985`), y el payload ya excluye
`clasificacionTributaria` para ingredientes (`:923-930`). O sea que el 400 de la Task 3 no
puede romper el alta desde la UI. Verificarlo y seguir.

- [ ] **Paso 1: Tipar `/impuestos` y separar el IVA**

Junto a los `ref` de opciones (`items.vue:~276`):

```ts
interface ImpuestoApi {
  id: string
  nombre: string
  porcentaje: string
  tipo: 'iva' | 'otro'
  activo: boolean
  origen: 'sistema' | 'personalizado'
}

// El IVA no se administra por ítem: sale de la clasificación tributaria
// (ADR-018), y el backend rechaza con 400 que venga en `impuestosIds`. Se
// aparta del selector para que no pueda entrar ahí ni por accidente.
const ivaDelPais = ref<ImpuestoApi | null>(null)
```

En el fetch (`:742`), `useApiFetch<any[]>` pasa a `useApiFetch<ImpuestoApi[]>`.

Y el llenado (`:773`) pasa a apartar el IVA antes de armar las opciones:

```ts
    ivaDelPais.value = impuestos.find(i => i.tipo === 'iva' && i.activo) ?? null

    impuestosOpts.value = impuestos
      .filter(i => i.activo && i.tipo !== 'iva')
      .map(i => ({
        label: i.origen === 'sistema' ? `${i.nombre} (Sistema)` : i.nombre,
        value: i.id,
      }))
```

- [ ] **Paso 2: El chip fijo, dentro de la lista de impuestos**

El porcentaje viaja en decimal (`'0.19'`), así que se rotula con Decimal —nunca con
`number`—. Junto a los demás `computed` del `<script setup>`:

```ts
const ivaLabel = computed(() =>
  ivaDelPais.value
    ? `${ivaDelPais.value.nombre} ${new Decimal(ivaDelPais.value.porcentaje).times(100)}%`
    : '',
)
```

Y el `UFormField` de Impuestos (`items.vue:2004-2013`) pasa a:

```vue
            <UFormField label="Impuestos">
              <div class="flex flex-wrap items-center gap-2">
                <!-- Sale de la clasificación, no de `impuestosIds`: por eso no
                     puede desincronizarse de lo que va a cobrar el motor. Sin
                     × a propósito — un ítem afecto lleva IVA sí o sí. -->
                <UBadge
                  v-if="form.clasificacionTributaria === 'afecto' && ivaDelPais"
                  :label="ivaLabel"
                  color="primary"
                  variant="subtle"
                />
                <USelectMenu
                  v-model="form.impuestosIds"
                  :items="impuestosOpts"
                  value-key="value"
                  multiple
                  placeholder="Sin impuestos adicionales"
                  class="flex-1 min-w-0"
                />
              </div>
            </UFormField>
```

Tokens semánticos de Nuxt UI, nada de Tailwind hardcodeado (`design:check` lo verifica).

- [ ] **Paso 3: Test**

Con `mountSuspended` sobre la página o un test del comportamiento del `computed`, según lo
que ya use el repo para esta pantalla: el chip aparece con `afecto`, desaparece con
`exento`, y ningún id de `impuestosOpts` tiene `tipo === 'iva'`.

Mutante: sacar el `&& i.tipo !== 'iva'` del filtro de `impuestosOpts` → el IVA vuelve a
aparecer como opción seleccionable y el test tiene que ponerse en rojo.

- [ ] **Paso 4: Gate, revisión y commit**

```bash
cd frontend && npm run build && npx vitest run && npm run typecheck:ratchet && npm run design:check
git commit -m "feat(frontend,items): chip fijo del IVA según la clasificación"
```

---

### Task 6: Documentación

**Files:**
- Create: `docs/adr/018-iva-derivado-de-la-clasificacion.md`
- Modify: `docs/adr/README.md`, `docs/features/impuestos.md`, `docs/PRODUCTO.md`,
  `docs/ESTADO.md`, `docs/agent/pendientes.md` → `docs/agent/resueltos.md`

- [ ] **Paso 1: ADR-018**

Verificar primero que 018 siga libre (`ls docs/adr/`). Registra: el IVA se deriva de la
clasificación y nunca se almacena; el porqué (dos fuentes de verdad vs una, y el modo de
fallar: escritura silenciosa vs lectura visible); y que se apoya en que `impuestos.tipo`
no se expone en la API de escritura — **si eso cambia, el ADR se revisa primero**.

- [ ] **Paso 2: `docs/features/impuestos.md`**

`item_impuestos` = adicionales; el IVA se deriva (§ motor y § tablas). Y corregir la línea
173-174, que hoy dice que los impuestos del sistema "entran automáticamente al cálculo
porque `ImpuestosService.findAll` ya los incluye en la unión": quedan **disponibles en el
mapa**, que no es lo mismo que aplicarse. Hoy no se aplican solos; a partir de esto el IVA
sí, y por otro mecanismo.

- [ ] **Paso 3: `PRODUCTO.md` y `ESTADO.md`**

La regla de negocio y la fila de la funcionalidad con su fecha.

- [ ] **Paso 4: Mover la entrada del backlog**

De `pendientes.md` a `resueltos.md`, con el texto del cierre: qué se hizo, por qué
derivar y no materializar, y qué mutantes lo fijan.

- [ ] **Paso 5: Commit**

```bash
git commit -m "docs: ADR-018 y documentación del IVA derivado"
```

---

## Notas de ejecución

- **Después de la Task 1 el bug ya está arreglado.** Las tareas 2-5 endurecen el contrato
  y limpian; ninguna es prerrequisito del cálculo correcto. Si hay que parar en el medio,
  parar después de un commit, nunca entre el test y su implementación.
- **La entrada del backlog no es fuente de verdad.** Las líneas que cita ya se movieron
  una vez. Verificar leyendo el código antes de aplicar cualquier paso que dependa de un
  número de línea.
- **Si un dato de este plan no cierra contra el código, parar y decirlo.** El plan se
  escribió leyendo el repo el 2026-07-30; si algo no coincide, gana el código.
