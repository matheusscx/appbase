# Costo por producto + congelado en kardex — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada producto un `costo_actual` (último costo) y congelar el costo del momento (`costo_unitario`) en cada movimiento del kardex.

**Architecture:** `costo_actual` es una columna materializada en `item_producto` (espeja el patrón de `stock`); el kardex (`movimientos_inventario`) congela `costo_unitario` en cada movimiento. En una entrada con costo (compra) el valor sobrescribe `costo_actual`; en cualquier otro movimiento se congela el `costo_actual` vigente. Toda la lógica vive dentro de `InventarioService.registrarMovimiento`, en la transacción existente, por lo que los callers (ventas, ajuste, alta de item) no cambian su contrato salvo para *pasar* el costo cuando lo tienen.

**Tech Stack:** NestJS + TypeORM (raw SQL en los services), PostgreSQL, Decimal.js, Jest. Frontend Nuxt 4 + Nuxt UI.

## Global Constraints

- **Dinero y porcentajes con Decimal.js**, nunca `number` nativo. Los montos viajan como `string` (numeric ↦ string).
- **Precisión `NUMERIC(18,4)`** para costos (consistente con `stock` e `item_lote`).
- **`tenant_id` siempre del token**, nunca del body.
- **Soft delete** en todo; toda lectura filtra `eliminado_el IS NULL`.
- **Columnas PK/FK UUID declaran `type: 'uuid'`** en las entidades ([ADR-004]).
- **Esquema en dev**: TypeORM `synchronize: true` crea columnas nuevas al reiniciar el backend a partir de las entidades (no hay migración manual en dev).
- **Costo en la moneda del item** (`monedaId`), igual que `precioBase`. Sin conversión de moneda (trabajo posterior).
- **Commits en español**, estilo conventional (`feat(...)`, `test(...)`, `docs(...)`), terminando con la línea `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec de referencia: `docs/superpowers/specs/2026-07-14-costo-producto-kardex-design.md`.

---

## File Structure

- `backend/src/modules/items/entities/item-producto.entity.ts` — + columna `costoActual`.
- `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts` — + columna `costoUnitario`.
- `backend/src/modules/inventario/inventario.service.ts` — lógica de congelado + actualización de `costo_actual`; exposición en lecturas.
- `backend/src/modules/inventario/inventario.service.spec.ts` — tests de costo.
- `backend/src/modules/items/dto/create-item.dto.ts` — + `costo`.
- `backend/src/modules/items/dto/update-item.dto.ts` — + `costo`.
- `backend/src/modules/items/dto/ajuste-stock.dto.ts` — + `costoUnitario`.
- `backend/src/modules/items/items.service.ts` — persistir/leer `costo_actual`; reenviar `costoUnitario` en ajuste.
- `backend/src/modules/items/items.service.spec.ts` — tests de costo en create/update/ajuste.
- `frontend/app/pages/configuracion/items.vue` (+ componentes de ajuste) — campos de costo y visualización.
- `startup-pos.sql`, `docs/features/inventario-kardex.md`, `docs/ESTADO.md` — docs vivos.
- `backend/test/inventario.e2e-spec.ts` (o el e2e existente de inventario) — flujo end-to-end.

---

## Task 1: Congelar `costo_unitario` en el kardex y actualizar `costo_actual`

**Files:**
- Modify: `backend/src/modules/items/entities/item-producto.entity.ts`
- Modify: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`RegistrarMovimientoParams` ~27-42; `registrarMovimiento` ~60-139)
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`

**Interfaces:**
- Produces: `RegistrarMovimientoParams.costoUnitario?: string | null`. Semántica: si viene y `tipo === 'entrada'`, congela ese costo en el movimiento **y** sobrescribe `item_producto.costo_actual`; si no viene, congela el `costo_actual` vigente sin modificarlo.
- Consumes: nada nuevo (usa el `EntityManager` y el patrón de raw SQL existentes).

- [ ] **Step 1: Escribir los tests que fallan (describe "costo")**

Agregar al final de `inventario.service.spec.ts`, dentro del `describe('InventarioService', ...)`:

```typescript
describe('registrarMovimiento — costo', () => {
  it('entrada con costoUnitario: congela el costo y actualiza costo_actual', async () => {
    managerMock.query
      .mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
      ]) // SELECT FOR UPDATE
      .mockResolvedValueOnce(undefined) // UPDATE item_producto stock
      .mockResolvedValueOnce([{ movimiento_id: 'mov-c1' }]) // INSERT movimiento
      .mockResolvedValueOnce(undefined); // UPDATE costo_actual

    await service.registrarMovimiento(
      managerMock as unknown as EntityManager,
      {
        tenantId: TENANT,
        itemId: ITEM_ID,
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '5',
        usuarioId: USER_ID,
        costoUnitario: '4500',
      },
    );

    // El INSERT del movimiento (3ª llamada) incluye costo_unitario = 4500
    const insertCall = managerMock.query.mock.calls[2];
    expect(insertCall[0]).toContain('costo_unitario');
    expect(insertCall[1]).toContain('4500');
    // La 4ª llamada actualiza costo_actual = 4500
    expect(managerMock.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('costo_actual'),
      ['4500', ITEM_ID],
    );
  });

  it('salida sin costoUnitario: congela el costo_actual vigente y no lo modifica', async () => {
    managerMock.query
      .mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '4200' },
      ]) // SELECT FOR UPDATE
      .mockResolvedValueOnce(undefined) // UPDATE stock
      .mockResolvedValueOnce([{ movimiento_id: 'mov-c2' }]); // INSERT movimiento

    await service.registrarMovimiento(
      managerMock as unknown as EntityManager,
      {
        tenantId: TENANT,
        itemId: ITEM_ID,
        tipo: 'salida',
        motivo: 'venta',
        cantidad: '3',
        usuarioId: USER_ID,
      },
    );

    // El INSERT congeló el costo vigente (4200) y no hubo UPDATE de costo_actual
    const insertCall = managerMock.query.mock.calls[2];
    expect(insertCall[1]).toContain('4200');
    expect(managerMock.query).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && npm test -- inventario.service.spec --no-coverage`
Expected: FAIL — los dos tests nuevos fallan (el INSERT aún no contiene `costo_unitario`; no hay 4ª llamada).

- [ ] **Step 3: Agregar la columna `costoActual` en la entidad de producto**

En `item-producto.entity.ts`, tras la propiedad `stock`:

```typescript
  @Column({
    name: 'costo_actual',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoActual: string | null;
```

- [ ] **Step 4: Agregar la columna `costoUnitario` en la entidad de movimiento**

En `movimiento-inventario.entity.ts`, tras `comentario`:

```typescript
  @Column({
    name: 'costo_unitario',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoUnitario: string | null;
```

- [ ] **Step 5: Extender `RegistrarMovimientoParams`**

En `inventario.service.ts`, dentro de `RegistrarMovimientoParams` (tras `comentario?`):

```typescript
  // Costo (último costo): si viene en una entrada, congela y actualiza costo_actual;
  // si no viene, se congela el costo_actual vigente.
  costoUnitario?: string | null;
```

- [ ] **Step 6: Leer `costo_actual` y calcular el costo a congelar**

En `registrarMovimiento`, cambiar el SELECT FOR UPDATE para traer `costo_actual`:

```typescript
    const productoRows: {
      stock: string;
      modo_inventario: string;
      costo_actual: string | null;
    }[] = await manager.query(
      `SELECT stock, modo_inventario, costo_actual FROM item_producto WHERE item_id = $1 FOR UPDATE`,
      [params.itemId],
    );
```

Justo antes del `let result: MoverResult;`, calcular el costo:

```typescript
    const costoActualPrevio = productoRows[0].costo_actual ?? null;
    const aplicaCostoNuevo =
      params.costoUnitario != null && params.tipo === 'entrada';
    const costoUnitarioCongelado = aplicaCostoNuevo
      ? params.costoUnitario!
      : costoActualPrevio;
```

- [ ] **Step 7: Congelar el costo en el INSERT del movimiento**

Reemplazar el INSERT en `movimientos_inventario` para incluir `costo_unitario`:

```typescript
    const insertRows: { movimiento_id: string }[] = await manager.query(
      `INSERT INTO movimientos_inventario
         (tenant_id, item_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, venta_id, usuario_id, comentario, costo_unitario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING movimiento_id`,
      [
        params.tenantId,
        params.itemId,
        params.tipo,
        params.motivo,
        cantidad.toString(),
        stockAnterior.toString(),
        stockResultante.toString(),
        params.ventaId ?? null,
        params.usuarioId,
        params.comentario ?? null,
        costoUnitarioCongelado,
      ],
    );
```

- [ ] **Step 8: Actualizar `costo_actual` cuando la entrada trae costo**

Tras `insertarDetalleMovimiento(...)` y antes del `return`, agregar:

```typescript
    if (aplicaCostoNuevo) {
      await manager.query(
        `UPDATE item_producto SET costo_actual = $1 WHERE item_id = $2`,
        [params.costoUnitario, params.itemId],
      );
    }
```

- [ ] **Step 9: Correr los tests y verificar que pasan**

Run: `cd backend && npm test -- inventario.service.spec --no-coverage`
Expected: PASS — incluidos los dos tests nuevos y todos los previos (el INSERT no era aserido por params en los tests viejos; la 4ª query solo existe con `costoUnitario`).

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/items/entities/item-producto.entity.ts \
        backend/src/modules/inventario/entities/movimiento-inventario.entity.ts \
        backend/src/modules/inventario/inventario.service.ts \
        backend/src/modules/inventario/inventario.service.spec.ts
git commit -m "feat(inventario): congela costo_unitario en el kardex y materializa costo_actual

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Exponer `costo_unitario` en las lecturas del kardex

**Files:**
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`findMovimientos` SELECT ~527-542; `MovimientoListItem` ~596-609; `MovimientoRow` ~611-624; `mapMovimientoRow` ~578-593)
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`

**Interfaces:**
- Produces: `MovimientoListItem.costoUnitario: string | null` en la respuesta de `GET /inventario/movimientos`.

- [ ] **Step 1: Escribir el test que falla (mapeo de costoUnitario)**

Agregar dentro del `describe` de `findMovimientos` (o crear uno si no existe) en `inventario.service.spec.ts`:

```typescript
it('findMovimientos expone costoUnitario', async () => {
  dataSource.query
    .mockResolvedValueOnce([{ total: 1 }]) // COUNT
    .mockResolvedValueOnce([
      {
        movimiento_id: 'mov-1',
        item_id: ITEM_ID,
        item_nombre: 'Carne molida',
        tipo: 'salida',
        motivo: 'venta',
        cantidad: '1',
        stock_anterior: '10',
        stock_resultante: '9',
        usuario_id: USER_ID,
        usuario_nombre: 'Cajero',
        comentario: null,
        creado_el: new Date('2026-07-14T00:00:00Z'),
        costo_unitario: '4200',
      },
    ]); // list

  const res = await service.findMovimientos(TENANT, {} as never);

  expect(res.data[0].costoUnitario).toBe('4200');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm test -- inventario.service.spec --no-coverage`
Expected: FAIL — `costoUnitario` es `undefined` (no está en el SELECT ni en el mapeo).

- [ ] **Step 3: Agregar `costo_unitario` al SELECT de `findMovimientos`**

En el SELECT de la lista, agregar el campo tras `mv.comentario, mv.creado_el`:

```sql
         mv.comentario, mv.creado_el, mv.costo_unitario
```

- [ ] **Step 4: Agregar el campo a los tipos y al mapeo**

En `interface MovimientoRow` agregar:

```typescript
  costo_unitario: string | null;
```

En `interface MovimientoListItem` agregar:

```typescript
  costoUnitario: string | null;
```

En `mapMovimientoRow`, tras `creadoEl: r.creado_el,`:

```typescript
      costoUnitario: r.costo_unitario,
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd backend && npm test -- inventario.service.spec --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventario/inventario.service.ts \
        backend/src/modules/inventario/inventario.service.spec.ts
git commit -m "feat(inventario): expone costo_unitario en GET /inventario/movimientos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `costo` en creación, edición y lectura de items

**Files:**
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`
- Modify: `backend/src/modules/items/dto/update-item.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`BASE_QUERY` ~61-78; `ItemRow` ~29-45; `mapRow` ~80-104; create INSERT item_producto ~258-270; update `prodClauses` ~445-467)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: nada de tasks previas.
- Produces: `CreateItemDto.costo?`, `UpdateItemDto.costo?` (string numérico); campo `costoActual` en la respuesta de items.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `items.service.spec.ts`. Test de creación con costo (dentro del `describe` de `create`):

```typescript
it('create producto persiste costo_actual', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
    .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
    .mockResolvedValueOnce([]); // INSERT item_producto

  await service.create(
    TENANT,
    USER_ID,
    {
      nombre: 'Carne molida',
      precioBase: '6000',
      monedaId: 'moneda-uuid',
      tipo: 'producto',
      costo: '4000',
    } as never,
  );

  const insertProducto = managerMock.query.mock.calls.find(
    (c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO item_producto'),
  );
  expect(insertProducto?.[0]).toContain('costo_actual');
  expect(insertProducto?.[1]).toContain('4000');
});
```

Test de edición del costo (dentro del `describe` de `update`):

```typescript
it('update producto cambia costo_actual sin crear movimiento', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
    .mockResolvedValueOnce(undefined); // UPDATE item_producto

  await service.update(TENANT, ITEM_ID, { costo: '4300' } as never);

  const updateProducto = managerMock.query.mock.calls.find(
    (c: unknown[]) =>
      typeof c[0] === 'string' &&
      c[0].includes('UPDATE item_producto') &&
      c[0].includes('costo_actual'),
  );
  expect(updateProducto).toBeDefined();
  expect(updateProducto?.[1]).toContain('4300');
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && npm test -- items.service.spec --no-coverage`
Expected: FAIL — `costo_actual` no está en el INSERT ni en el UPDATE.

- [ ] **Step 3: Agregar `costo` a los DTOs**

En `create-item.dto.ts`, dentro de `CreateItemDto` (sección "Extensión producto", tras `unidadMedida`):

```typescript
  @IsNumberString()
  @IsOptional()
  costo?: string;
```

En `update-item.dto.ts`, agregar la misma propiedad (verificar que `IsNumberString` e `IsOptional` estén importados; si no, agregarlos al import de `class-validator`):

```typescript
  @IsNumberString()
  @IsOptional()
  costo?: string;
```

- [ ] **Step 4: Persistir `costo_actual` en el create**

En `items.service.ts`, en el INSERT de `item_producto` del método `create`:

```typescript
        await manager.query(
          `INSERT INTO item_producto
             (item_id, stock, unidad_medida, fecha_elaboracion, fecha_vencimiento, modo_inventario, costo_actual)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            itemId,
            '0',
            dto.unidadMedida ?? 'unidad',
            dto.fechaElaboracion ?? null,
            dto.fechaVencimiento ?? null,
            modo,
            dto.costo ?? null,
          ],
        );
```

- [ ] **Step 5: Persistir `costo_actual` en el update**

En el bloque `if (tipo === 'producto')` de `update`, junto a las demás `prodClauses` (tras el bloque de `unidadMedida`):

```typescript
        if (dto.costo !== undefined) {
          prodClauses.push(`costo_actual = $${pidx++}`);
          prodParams.push(dto.costo);
        }
```

- [ ] **Step 6: Exponer `costo_actual` en las lecturas**

En `BASE_QUERY`, agregar el campo en la línea de `ip.`:

```sql
      ip.stock, ip.unidad_medida, ip.fecha_elaboracion, ip.fecha_vencimiento,
      ip.modo_inventario, ip.costo_actual,
```

En `interface ItemRow`, tras `modo_inventario: string | null;`:

```typescript
  costo_actual: string | null;
```

En `mapRow`, tras `modoInventario: r.modo_inventario,`:

```typescript
      costoActual: r.costo_actual,
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `cd backend && npm test -- items.service.spec --no-coverage`
Expected: PASS (nuevos y previos).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/items/dto/create-item.dto.ts \
        backend/src/modules/items/dto/update-item.dto.ts \
        backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): costo_actual en creación, edición y lectura de productos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Capturar el costo en el ajuste de stock (entrada por compra)

**Files:**
- Modify: `backend/src/modules/items/dto/ajuste-stock.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`ajustarStock` ~553-587)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `RegistrarMovimientoParams.costoUnitario` (Task 1).
- Produces: `AjusteStockDto.costoUnitario?: string`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `items.service.spec.ts`. El módulo de test ya provee `inventarioServiceMock = { registrarMovimiento: jest.fn() }` (usado en los tests de `create`), así que se reutiliza directamente:

```typescript
it('ajustarStock reenvía costoUnitario a registrarMovimiento', async () => {
  inventarioServiceMock.registrarMovimiento.mockResolvedValue({
    movimientoId: 'mov-x',
    stockAnterior: '0',
    stockResultante: '5',
  });

  managerMock.query.mockResolvedValueOnce([{ tipo: 'producto' }]); // SELECT tipo

  await service.ajustarStock(TENANT, USER_ID, ITEM_ID, {
    cantidad: 5,
    tipo: 'entrada',
    motivo: 'compra',
    costoUnitario: '4500',
  } as never);

  expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
    managerMock,
    expect.objectContaining({ costoUnitario: '4500' }),
  );
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm test -- items.service.spec --no-coverage`
Expected: FAIL — `costoUnitario` no se reenvía (es `undefined` en el objeto pasado).

- [ ] **Step 3: Agregar `costoUnitario` al DTO de ajuste**

En `ajuste-stock.dto.ts`, dentro de `AjusteStockDto` (tras `comentario`). Verificar que `IsNumberString` esté importado de `class-validator`; si no, agregarlo al import:

```typescript
  // Costo pagado en la entrada por compra (actualiza costo_actual + congela en el kardex)
  @IsNumberString()
  @IsOptional()
  costoUnitario?: string;
```

- [ ] **Step 4: Reenviar el costo desde `ajustarStock`**

En la llamada a `registrarMovimiento` dentro de `ajustarStock`, agregar el campo:

```typescript
          loteId: dto.loteId,
          costoUnitario: dto.costoUnitario ?? null,
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd backend && npm test -- items.service.spec --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/items/dto/ajuste-stock.dto.ts \
        backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): captura costoUnitario en el ajuste de stock por compra

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — campo de costo y visualización

**REQUIRED:** Invocar la skill `nuxt-ui` antes de editar cualquier `.vue` (memoria del usuario: usar componentes Nuxt UI, tokens semánticos, formatos vía `useFormatters`).

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` (form de item + lista + modal de ajuste; verificar si el modal de ajuste vive en un componente aparte y editarlo ahí)

**Interfaces:**
- Consumes: campo `costoActual` en la respuesta de items (Task 3); `costo` en el payload de create/update (Task 3); `costoUnitario` en el payload de ajuste (Task 4); `costoUnitario` en los movimientos (Task 2).

- [ ] **Step 1: Campo "Costo" en el form de producto**

En el form de creación/edición de items, visible solo cuando `tipo === 'producto'`, agregar un `UFormField` con `UInput` numérico ligado a `form.costo` (en la moneda del item). Enviar `costo` en el payload de `POST`/`PATCH` de items. Usar `formatMonto` de `useFormatters` para cualquier despliegue de montos.

- [ ] **Step 2: Campo "Costo unitario" en el modal de ajuste (entrada por compra)**

En el modal de ajuste de stock, mostrar un `UFormField` "Costo unitario" cuando `tipo === 'entrada'` y `motivo === 'compra'`; enviar `costoUnitario` en el `PATCH /items/:id/stock`.

- [ ] **Step 3: Mostrar el costo en lista e historial**

En la tabla de items mostrar `costoActual` (formateado, "—" si es `null`). En el historial/kardex mostrar `costoUnitario` por movimiento.

- [ ] **Step 4: Verificación manual**

Run: `docker-compose up`
Verificar en el navegador:
1. Crear producto con Costo → aparece `costoActual` en la lista.
2. Ajustar stock (entrada, motivo compra) con Costo unitario distinto → `costoActual` se actualiza; el movimiento del kardex muestra ese costo.
3. Registrar una venta del producto → el movimiento de salida muestra el `costoActual` vigente congelado.
4. Editar el costo del producto a mano → `costoActual` cambia sin nuevo movimiento en el kardex.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): UI de costo en form, ajuste de stock e historial

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: E2E del flujo de costo

**Files:**
- Modify/Create: el e2e de inventario del backend (`backend/test/inventario.e2e-spec.ts` o el existente equivalente; seguir el patrón de los demás `*.e2e-spec.ts`)

- [ ] **Step 1: Escribir el escenario e2e**

Autenticarse como en los demás e2e; luego:
1. `POST /items` con `tipo: 'producto'`, `costo: '4000'` → guardar `itemId`; `GET /items` → `costoActual === '4000'`.
2. `PATCH /items/:id/stock` `{ tipo:'entrada', motivo:'compra', cantidad:10, costoUnitario:'4500' }` → `GET /items` → `costoActual === '4500'`.
3. `GET /inventario/movimientos?itemId=:id` → el movimiento de compra tiene `costoUnitario === '4500'`.
4. `PATCH /items/:id` `{ costo: '4300' }` → `costoActual === '4300'`; el número de movimientos no aumentó.
5. `PATCH /items/:id/stock` `{ tipo:'salida', motivo:'merma', cantidad:1 }` → el movimiento de salida tiene `costoUnitario === '4300'` (costo vigente congelado).

- [ ] **Step 2: Correr el e2e**

Run: `cd backend && npm run test:e2e -- inventario`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/test/inventario.e2e-spec.ts
git commit -m "test(inventario): e2e del flujo de costo (compra, edición, congelado en venta/merma)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Documentación viva y esquema

**Files:**
- Modify: `startup-pos.sql` (columnas `item_producto.costo_actual`, `movimientos_inventario.costo_unitario`)
- Modify: `docs/features/inventario-kardex.md`
- Modify: `docs/ESTADO.md`

- [ ] **Step 1: Reflejar las columnas en `startup-pos.sql`**

En la definición de `item_producto` agregar `costo_actual NUMERIC(18,4)`; en `movimientos_inventario` agregar `costo_unitario NUMERIC(18,4)`. (Es documentación de esquema; en dev la columna la crea `synchronize`.)

- [ ] **Step 2: Actualizar el doc del kardex**

En `docs/features/inventario-kardex.md`: agregar `costo_unitario` a la tabla de columnas de `movimientos_inventario` (congela el costo del momento) y una nota de la regla: entrada con costo → actualiza `item_producto.costo_actual`; otro movimiento → congela el `costo_actual` vigente.

- [ ] **Step 3: Actualizar `ESTADO.md`**

Agregar la fila: `| Costo por producto (último costo) + congelado en kardex | ✅ Implementado (2026-07-14) |`.

- [ ] **Step 4: Commit**

```bash
git add startup-pos.sql docs/features/inventario-kardex.md docs/ESTADO.md
git commit -m "docs(inventario): documenta costo_actual y costo_unitario (pieza 1 cluster recetas)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verificación final

- [ ] `cd backend && npm test -- --no-coverage` → todo verde.
- [ ] `cd backend && npm run test:e2e -- inventario` → verde.
- [ ] `cd backend && npm run lint` → sin errores.
- [ ] Reinicio del backend (`docker-compose up --build`) crea las columnas vía `synchronize` sin error.
- [ ] Flujo manual del Task 5 Step 4 confirmado en el navegador.
