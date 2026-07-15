# Tipo de item `ingrediente` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status**: Done  
**Date**: 2026-07-15  
**Owner**: Cesar Matheus  
**Spec:** [`docs/superpowers/specs/2026-07-15-tipo-ingrediente-design.md`](../specs/2026-07-15-tipo-ingrediente-design.md)

**Goal:** Separar insumos no vendibles (`items.tipo = 'ingrediente'`) de productos de catálogo, reusando `item_producto`, para filtrarlos en CRUD, admitirlos solo en recetas/inventario/mermas, y rechazarlos en ventas.

**Architecture:** Sin tabla nueva. `ingrediente` comparte extensión `item_producto` con `producto`, pero con defaults forzados (`precio_base = 0`, `modo_inventario = 'cantidad'`, sin N:M de impuestos/recargos/descuentos ni serie/lote). `ItemsService.create`/`update` y helpers de stock amplían la rama inventariable a `producto | ingrediente`; `validarYCostearIngredientes` exige solo `ingrediente`; `VentasService` rechaza líneas de tipo `ingrediente`; `MermasService` acepta ambos.

**Tech Stack:** NestJS + TypeORM, Decimal.js, Jest, Nuxt 4 + Nuxt UI, `useApiFetch`.

## Global Constraints

- **Trabajar y commitear directamente sobre `main`.** No crear ramas ni PRs.
- **Decimal.js** para dinero, cantidades y porcentajes. Nunca `number` nativo.
- **`type: 'uuid'`** explícito en PK/FK (ADR-004).
- Soft delete; lecturas filtran `eliminado_el IS NULL`.
- **`tenant_id` del token**, nunca del body.
- **Design System:** tokens semánticos Nuxt UI; iconos Lucide.
- **No `PATCH` de `tipo`** (producto ↔ ingrediente). `UpdateItemDto` sigue sin campo `tipo`.
- **Sin API multi-tipo nueva:** inventario/mermas hacen `Promise.all` de `tipo=producto` + `tipo=ingrediente`.
- **Seed idempotente:** IDs fijos `550e8400-e29b-41d4-a716-446655440XXX` (rango demo receta ya usado: 0256–0265). Migrar en seed los tres insumos existentes a `ingrediente` + `precio_base = 0` aunque la hamburguesa ya exista.
- Tests unitarios junto al service (`*.service.spec.ts`); mocks de `manager.query` en secuencia con `mockResolvedValueOnce`.

## File Structure

**Backend — modificar:**
- `backend/src/modules/items/dto/create-item.dto.ts` — `@IsIn` incluye `'ingrediente'`.
- `backend/src/modules/items/dto/query-items.dto.ts` — ídem.
- `backend/src/modules/items/items.service.ts` — create/update/ajustarStock/validarYCostear/recetasAfectadas.
- `backend/src/modules/items/items.service.spec.ts` — tests nuevos + ajustar mocks de receta (insumo pasa a `tipo: 'ingrediente'`).
- `backend/src/modules/ventas/ventas.service.ts` — rechazo de líneas `ingrediente`.
- `backend/src/modules/ventas/ventas.service.spec.ts` — test del rechazo.
- `backend/src/modules/mermas/mermas.service.ts` — aceptar `producto | ingrediente`.
- `backend/src/modules/mermas/mermas.service.spec.ts` — test merma sobre ingrediente.
- `backend/src/modules/seeder/seeder.service.ts` — `seedRecetaDemo` + migración tipo.
- `startup-pos.sql` — comentarios de `items.tipo` / receta_ingredientes.

**Frontend — modificar:**
- `frontend/app/pages/configuracion/items.vue` — filtro, form, badge, selector de insumos (`?tipo=ingrediente`), desfases.
- `frontend/app/pages/configuracion/inventario.vue` — merge producto + ingrediente.
- `frontend/app/pages/configuracion/mermas.vue` — merge producto + ingrediente.

**Docs:**
- `docs/features/tipo-ingrediente.md` (nuevo), `docs/features/recetas.md` (insumo = `ingrediente`), `docs/README.md`, `docs/ESTADO.md`, spec → `Status: Done`.

---

### Task 1: DTOs + create `ingrediente` (rama inventariable compartida)

**Files:**
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`
- Modify: `backend/src/modules/items/dto/query-items.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`create`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `CreateItemDto` actual; `InventarioService.registrarMovimiento`.
- Produces:
  - `tipo: 'producto' | 'servicio' | 'suscripcion' | 'receta' | 'ingrediente'` en create/query.
  - `POST /items` con `tipo: 'ingrediente'` inserta `items` + `item_producto` (`modo_inventario='cantidad'`, `precio_base='0'`), stock inicial vía kardex como producto cantidad.

- [ ] **Step 1: Ampliar DTOs**

En `create-item.dto.ts` y `query-items.dto.ts`, agregar `'ingrediente'` a `@IsIn` / union type:

```typescript
@IsIn(['producto', 'servicio', 'suscripcion', 'receta', 'ingrediente'])
tipo: string;
```

```typescript
@IsOptional()
@IsIn(['producto', 'servicio', 'suscripcion', 'receta', 'ingrediente'])
tipo?: 'producto' | 'servicio' | 'suscripcion' | 'receta' | 'ingrediente';
```

- [ ] **Step 2: Tests que fallan — create ingrediente**

Añadir en `items.service.spec.ts` dentro de `describe('create')`:

```typescript
describe('ingrediente', () => {
  const dtoIng = {
    nombre: 'Carne molida',
    precioBase: '999',
    monedaId: MONEDA_ID,
    tipo: 'ingrediente',
    stock: '10',
    unidadMedida: 'kg',
    costo: '8000',
  };

  it('persiste precio_base = 0 aunque llegue precioBase distinto', async () => {
    managerMock.query
      .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda
      .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
      .mockResolvedValueOnce(undefined); // INSERT item_producto
    // registrarMovimiento mocked via inventarioService

    await service.create(TENANT, 'user-uuid', dtoIng as any);

    const insertItemsCall = managerMock.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('INSERT INTO items'),
    );
    expect(insertItemsCall[1][5]).toBe('0'); // precio_base
    expect(insertItemsCall[1][8]).toBe('ingrediente'); // tipo
  });

  it('rechaza modoInventario serie', async () => {
    await expect(
      service.create(TENANT, 'user-uuid', {
        ...dtoIng,
        modoInventario: 'serie',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza impuestosIds', async () => {
    await expect(
      service.create(TENANT, 'user-uuid', {
        ...dtoIng,
        impuestosIds: ['imp-1'],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
```

Ajustar mocks de `describe('receta')` happy path / lookups: `tipo: 'ingrediente'` en filas de insumo (después de Task 2; si se corre solo esta task, dejar temporalmente `producto` hasta Task 2 — idealmente Task 1+2 juntos si el runner es lineal).

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts -t "ingrediente" --no-coverage
```

Expected: FAIL (tipo no aceptado / rama inexistente / precio no forzado).

- [ ] **Step 4: Implementar validaciones + rama create**

Al inicio de `create` (junto a las validaciones de suscripción/receta):

```typescript
if (dto.tipo === 'ingrediente') {
  if (
    dto.impuestosIds?.length ||
    dto.recargosIds?.length ||
    dto.descuentosIds?.length
  ) {
    throw new BadRequestException(
      'Los ingredientes no admiten impuestos, recargos ni descuentos',
    );
  }
  if (dto.series?.length || dto.lote) {
    throw new BadRequestException(
      'Los ingredientes solo admiten modo de inventario "cantidad"',
    );
  }
  if (dto.modoInventario && dto.modoInventario !== 'cantidad') {
    throw new BadRequestException(
      'Los ingredientes solo admiten modo de inventario "cantidad"',
    );
  }
}
```

Reemplazar `if (dto.tipo === 'producto')` por rama compartida:

```typescript
const precioBasePersistido =
  dto.tipo === 'ingrediente' ? '0' : dto.precioBase;
// usar precioBasePersistido en el INSERT de items

if (dto.tipo === 'producto' || dto.tipo === 'ingrediente') {
  if (dto.unidadMedida !== undefined) {
    await this.validarUnidadMedida(dto.unidadMedida);
  }
  const modo =
    dto.tipo === 'ingrediente'
      ? 'cantidad'
      : (dto.modoInventario ?? 'cantidad');
  await manager.query(
    `INSERT INTO item_producto
       (item_id, stock, unidad_medida, fecha_elaboracion, fecha_vencimiento, modo_inventario, costo_actual)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      itemId,
      '0',
      dto.unidadMedida ?? 'unidad',
      dto.tipo === 'ingrediente' ? null : (dto.fechaElaboracion ?? null),
      dto.tipo === 'ingrediente' ? null : (dto.fechaVencimiento ?? null),
      modo,
      dto.costo ?? null,
    ],
  );

  if (modo === 'cantidad') {
    const stockInicial = new Decimal(dto.stock ?? '0');
    if (stockInicial.greaterThan(0)) {
      await this.inventarioService.registrarMovimiento(manager, {
        tenantId,
        itemId,
        usuarioId,
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        cantidad: stockInicial.toString(),
        comentario: 'Stock inicial',
      });
    }
  } else if (dto.tipo === 'producto' && modo === 'serie' && dto.series?.length) {
    // ... existing serie block ...
  } else if (dto.tipo === 'producto' && modo === 'lote' && dto.lote && dto.stock) {
    // ... existing lote block ...
  }
}
```

Para `ingrediente`, **no** llamar `insertarRelaciones` con arrays no vacíos (ya rechazados); se puede pasar `[], [], []` o saltar la llamada si los tres están vacíos (el código actual ya inserta 0 filas — OK).

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts -t "ingrediente" --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/items/dto/create-item.dto.ts \
  backend/src/modules/items/dto/query-items.dto.ts \
  backend/src/modules/items/items.service.ts \
  backend/src/modules/items/items.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(items): admitir tipo ingrediente en create y DTOs

EOF
)"
```

---

### Task 2: Update, stock, costeo de recetas y desfases

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`update`, `ajustarStock`, `validarYCostearIngredientes`, `recetasAfectadasPorIngrediente`)
- Modify: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `UpdateItemDto` (sin `tipo`); `AjusteStockDto`.
- Produces:
  - `update` trata `item_producto` para `producto | ingrediente`; fuerza `precio_base='0'` si llega `precioBase` en ingrediente; rechaza impuestos/recargos/descuentos y `modoInventario !== 'cantidad'` en ingrediente.
  - `ajustarStock` acepta `producto | ingrediente`.
  - `validarYCostearIngredientes` exige `tipo === 'ingrediente'` (mensaje: no es un ingrediente válido).
  - `recetasAfectadasPorIngrediente` filtra `tipo = 'ingrediente'`.

- [ ] **Step 1: Tests que fallan**

```typescript
it('validarYCostear rechaza insumo tipo producto', async () => {
  // vía create receta con lookup tipo producto → BadRequest
});

it('ajustarStock acepta ingrediente', async () => {
  managerMock.query.mockResolvedValueOnce([{ tipo: 'ingrediente' }]);
  // + mocks registrarMovimiento
  await expect(
    service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
      tipo: 'entrada',
      motivo: 'ajuste_manual',
      cantidad: '1',
    } as any),
  ).resolves.toEqual(expect.objectContaining({ stock: expect.anything() }));
});
```

Actualizar tests existentes de receta: lookups de ingredientes con `tipo: 'ingrediente'`; el test "rechaza un ingrediente que no es producto" → renombrar a "no es un ingrediente" y usar `tipo: 'producto'` como caso inválido (producto vendible ya no vale como insumo).

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts -t "receta|ajustarStock|ingrediente" --no-coverage
```

- [ ] **Step 3: Implementar**

`validarYCostearIngredientes` — cambiar chequeo:

```typescript
if (!rows.length || rows[0].tipo !== 'ingrediente') {
  throw new BadRequestException(
    `El ingrediente ${ing.ingredienteItemId} no es un item de tipo ingrediente válido`,
  );
}
if (rows[0].modo_inventario !== 'cantidad') {
  throw new BadRequestException(
    'Los insumos de receta solo admiten modo de inventario "cantidad"',
  );
}
```

`recetasAfectadasPorIngrediente`:

```sql
AND tipo = 'ingrediente'
```

`ajustarStock`:

```typescript
if (itemRows[0].tipo !== 'producto' && itemRows[0].tipo !== 'ingrediente') {
  throw new BadRequestException('El item no es inventariable');
}
```

`update` — al inicio de la rama de extensión (después de leer `tipo` del item existente):

```typescript
if (tipo === 'ingrediente') {
  if (
    dto.impuestosIds?.length ||
    dto.recargosIds?.length ||
    dto.descuentosIds?.length
  ) {
    throw new BadRequestException(
      'Los ingredientes no admiten impuestos, recargos ni descuentos',
    );
  }
  if (dto.modoInventario && dto.modoInventario !== 'cantidad') {
    throw new BadRequestException(
      'Los ingredientes solo admiten modo de inventario "cantidad"',
    );
  }
  if (dto.precioBase !== undefined) {
    // forzar 0 en el SET de items
  }
}
```

Cambiar `if (tipo === 'producto')` del update a `if (tipo === 'producto' || tipo === 'ingrediente')`, reutilizando el bloque `item_producto`. Para `ingrediente`, no permitir `modoInventario` distinto de `cantidad` (ya rechazado); fechas serie/lote no aplican.

Si `dto.precioBase !== undefined` y `tipo === 'ingrediente'`, pushear `precio_base = '0'` en el UPDATE de `items` (ignorar valor enviado).

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/items/items.service.ts \
  backend/src/modules/items/items.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(items): stock, update y costeo de recetas para tipo ingrediente

EOF
)"
```

---

### Task 3: Ventas rechazan; mermas aceptan

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (~línea 101–104, tras cargar items)
- Modify: `backend/src/modules/ventas/ventas.service.spec.ts`
- Modify: `backend/src/modules/mermas/mermas.service.ts` (~línea 88)
- Modify: `backend/src/modules/mermas/mermas.service.spec.ts`

**Interfaces:**
- Consumes: `itemsService.findOne` (ya expuesto).
- Produces: venta con línea `ingrediente` → `400`; merma sobre `ingrediente` → OK.

- [ ] **Step 1: Tests que fallan**

En `ventas.service.spec.ts`, dentro de `describe('crear()')`:

```typescript
it('rechaza línea con item tipo ingrediente', async () => {
  // mock findOne → { tipo: 'ingrediente', ... }
  await expect(
    service.crear(TENANT, USER, dtoConLinea, /* ... */),
  ).rejects.toThrow(
    new BadRequestException(
      'Los ingredientes no se pueden vender directamente',
    ),
  );
});
```

En `mermas.service.spec.ts`: caso feliz con item `tipo: 'ingrediente'` (mismo flujo que producto cantidad).

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx jest src/modules/ventas/ventas.service.spec.ts -t "ingrediente" --no-coverage
cd backend && npx jest src/modules/mermas/mermas.service.spec.ts -t "ingrediente" --no-coverage
```

- [ ] **Step 3: Implementar**

Tras el `Promise.all` de `findOne` en `ventas.service.ts`:

```typescript
for (const item of items) {
  if (item.tipo === 'ingrediente') {
    throw new BadRequestException(
      'Los ingredientes no se pueden vender directamente',
    );
  }
}
```

En `mermas.service.ts`:

```typescript
if (itemRows[0].tipo !== 'producto' && itemRows[0].tipo !== 'ingrediente') {
  throw new BadRequestException(
    'Solo se puede mermar un producto o un ingrediente',
  );
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npx jest src/modules/ventas/ventas.service.spec.ts src/modules/mermas/mermas.service.spec.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.ts \
  backend/src/modules/ventas/ventas.service.spec.ts \
  backend/src/modules/mermas/mermas.service.ts \
  backend/src/modules/mermas/mermas.service.spec.ts
git commit -m "$(cat <<'EOF'
feat: bloquear venta de ingredientes y permitir mermas

EOF
)"
```

---

### Task 4: Seed — insumos como `ingrediente`

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts` (`seedRecetaDemo`)
- Modify: `startup-pos.sql` (comentarios)

**Interfaces:**
- Produce: Carne molida / Pan / Queso con `tipo='ingrediente'`, `precio_base='0'`; hamburguesa sin cambios de IDs ni costeo.

- [ ] **Step 1: Cambiar INSERT y migración idempotente**

En el loop de ingredientes, INSERT con `'ingrediente'` y `precio_base = '0'` (no usar `ing.costo` como precio):

```typescript
`INSERT INTO items (..., precio_base, ..., tipo)
 VALUES ($1,$2,$3,$4,'0',$5,$6,'ingrediente')`
```

Antes del early-return `if (exists.length) return;`, o **después** del early-return con un bloque siempre ejecutado:

```typescript
// Migración soft: DBs ya sembradas con tipo=producto
await this.dataSource.query(
  `UPDATE items SET tipo = 'ingrediente', precio_base = '0', actualizado_el = NOW()
   WHERE item_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
  [[PAN_ID, CARNE_ID, QUESO_ID]],
);
```

Si la hamburguesa ya existe, hacer solo el `UPDATE` y `return` (no reinsertar). Si no existe, INSERT completo con tipo correcto y luego el UPDATE es no-op.

- [ ] **Step 2: Comentarios SQL**

`startup-pos.sql` línea de `items.tipo`:

```sql
"tipo" TEXT NOT NULL, -- 'producto' | 'servicio' | 'suscripcion' | 'receta' | 'ingrediente'
```

Comentar en `receta_ingredientes` que `ingrediente_item_id` referencia un item `tipo='ingrediente'` (extensión `item_producto`).

- [ ] **Step 3: Verificar (manual / query)**

Con stack arriba: reiniciar backend o `docker-compose restart backend`. SELECT en replica:

```sql
SELECT nombre, tipo, precio_base FROM items
WHERE item_id IN (
  '550e8400-e29b-41d4-a716-446655440256',
  '550e8400-e29b-41d4-a716-446655440257',
  '550e8400-e29b-41d4-a716-446655440258'
);
```

Expected: `tipo=ingrediente`, `precio_base=0`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seeder/seeder.service.ts startup-pos.sql
git commit -m "$(cat <<'EOF'
chore(seed): insumos de receta demo como tipo ingrediente

EOF
)"
```

---

### Task 5: Frontend — Configuración → Items

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`

**Interfaces:**
- Consumes: `GET /items?tipo=ingrediente`, create/update con `tipo: 'ingrediente'`.
- Produce: filtro/selector “Ingrediente”; form sin precio/modo/impuestos; badge; selector de insumos de receta solo ingredientes; desfases también al editar costo de ingrediente.

- [ ] **Step 1: Opciones y labels**

```typescript
const tiposOpts: Opt[] = [
  { label: 'Producto', value: 'producto' },
  { label: 'Ingrediente', value: 'ingrediente' },
  { label: 'Servicio', value: 'servicio' },
  { label: 'Suscripción', value: 'suscripcion' },
  { label: 'Receta', value: 'receta' },
]

const filtrosTipoOpts = [
  { label: 'Todos', value: 'todos' },
  { label: 'Productos', value: 'producto' },
  { label: 'Ingredientes', value: 'ingrediente' },
  { label: 'Servicios', value: 'servicio' },
  { label: 'Suscripciones', value: 'suscripcion' },
  { label: 'Recetas', value: 'receta' },
]

const tipoLabels: Record<string, string> = {
  producto: 'Producto',
  ingrediente: 'Ingrediente',
  servicio: 'Servicio',
  suscripcion: 'Suscripción',
  receta: 'Receta',
}
const tipoColors: Record<string, 'primary' | 'secondary' | 'info' | 'warning' | 'neutral'> = {
  producto: 'primary',
  ingrediente: 'warning',
  servicio: 'secondary',
  suscripcion: 'info',
  receta: 'neutral',
}
```

- [ ] **Step 2: Selector de insumos**

En `cargarCatalogos`, cambiar fetch de insumos:

```typescript
useApiFetch<PaginatedResponse<Item>>(`${apiUrl}/items?tipo=ingrediente&pageSize=100`),
```

(ya no hace falta filtrar `modoInventario === 'cantidad'` — modo fijo).

- [ ] **Step 3: Formulario create/edit**

- Condición de bloque inventariable: `form.tipo === 'producto' || form.tipo === 'ingrediente'`.
- Para `ingrediente`: mostrar nombre, descripción, moneda, categoría, unidad, costo, stock inicial (solo create), activo.
- Ocultar: precio base, modo inventario, serie/lote, impuestos/recargos/descuentos, fechas elaboración/vencimiento.
- En `guardar()`: rama `ingrediente` like producto cantidad, con `payload.precioBase = '0'`, sin `modoInventario` distinto, sin N:M.
- `chequearDesfases`: `form.tipo === 'producto' || form.tipo === 'ingrediente'`.

Listado: stock/costo también si `tipo === 'ingrediente'` (misma UX que producto cantidad). Para precio en listado de ingredientes mostrar `—` o `$0` (preferir `formatMonto` de `0`).

- [ ] **Step 4: Verificar manual UI**

1. Filtrar Ingrediente → aparecen Pan / Carne / Queso.
2. Crear ingrediente → sin precio; con costo/stock.
3. Editar receta → selector solo ingredientes.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "$(cat <<'EOF'
feat(ui): tipo ingrediente en CRUD de items y selector de recetas

EOF
)"
```

---

### Task 6: Frontend — Inventario y Mermas

**Files:**
- Modify: `frontend/app/pages/configuracion/inventario.vue`
- Modify: `frontend/app/pages/configuracion/mermas.vue`

**Interfaces:**
- Produce: selectores con productos **e** ingredientes (merge + sort por nombre).

- [ ] **Step 1: Helper de carga dual**

En ambos archivos, reemplazar el fetch único:

```typescript
const [prodRes, ingRes] = await Promise.all([
  useApiFetch<PaginatedResponse<{ id: string; nombre: string }>>(
    `${apiUrl}/items?tipo=producto&pageSize=100`,
  ),
  useApiFetch<PaginatedResponse<{ id: string; nombre: string }>>(
    `${apiUrl}/items?tipo=ingrediente&pageSize=100`,
  ),
])
const merged = [...prodRes.data, ...ingRes.data].sort((a, b) =>
  a.nombre.localeCompare(b.nombre, 'es'),
)
```

En inventario → `productosOpts` desde `merged`.  
En mermas → `productos.value` desde `merged` (mantener campos `unidadMedida`/`costoActual` del tipo `ProductoOpt`).

- [ ] **Step 2: Verificar manual**

Inventario y Mermas permiten elegir Carne molida / Pan / Queso.

POS / tienda **no** cambian (siguen `?tipo=producto` / `receta`).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pages/configuracion/inventario.vue \
  frontend/app/pages/configuracion/mermas.vue
git commit -m "$(cat <<'EOF'
feat(ui): listar ingredientes en inventario y mermas

EOF
)"
```

---

### Task 7: Docs + ESTADO + spec Done

**Files:**
- Create: `docs/features/tipo-ingrediente.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/features/recetas.md` — insumos = `tipo='ingrediente'` (no `producto`)
- Modify: `docs/README.md` — link
- Modify: `docs/ESTADO.md` — fila nueva ✅
- Modify: `docs/superpowers/specs/2026-07-15-tipo-ingrediente-design.md` — `Status: Done`

- [ ] **Step 1: Feature doc**

Resumen: modelo, reglas (precio 0, modo cantidad, no venta), endpoints afectados (`POST/PATCH/GET /items`, ventas, mermas), seed, UI.

- [ ] **Step 2: ESTADO**

Fila: `Tipo item ingrediente (insumos no vendibles) | ✅ Implementado (2026-07-15)`.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: tipificar item ingrediente y actualizar ESTADO

EOF
)"
```

---

## Verification

| Caso | Expectativa |
|---|---|
| Create `ingrediente` con `precioBase: "999"` | `precio_base = 0` |
| Create con `modoInventario: 'serie'` | 400 |
| Create con `impuestosIds` | 400 |
| Receta con insumo `producto` | 400 |
| Receta con insumo `ingrediente` | OK + costeo |
| Venta línea `ingrediente` | 400 |
| Merma sobre `ingrediente` | OK |
| `GET /items?tipo=ingrediente` | Solo insumos |
| Seed hamburguesa | Sigue costando/descontando stock |

**Manual:** puntos 1–6 de la spec § Verification manual.

**Suite:**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts src/modules/ventas/ventas.service.spec.ts src/modules/mermas/mermas.service.spec.ts --no-coverage
```

---

## Self-review (plan vs spec)

| Spec | Task |
|---|---|
| Nuevo `tipo=ingrediente` + `item_producto` | 1 |
| `precio_base=0`, modo cantidad, sin N:M/serie/lote | 1–2 |
| Recetas solo `ingrediente` | 2 |
| Ventas rechazan | 3 |
| Mermas + inventario inventariables | 3 + 6 |
| Seed Pan/Carne/Queso | 4 |
| Frontend filtro/form/selectores | 5–6 |
| Docs / SQL / ESTADO | 4 + 7 |
| Sin PATCH de tipo / sin API multi-tipo | Constraints |

Sin placeholders pendientes. Firmas alineadas entre tasks (`tipo === 'ingrediente'`, mensaje de venta fijo).
