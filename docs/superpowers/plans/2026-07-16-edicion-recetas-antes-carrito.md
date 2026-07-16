# Edición de recetas antes del carrito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al seleccionar una receta en POS o Salones se abre un drawer para omitir ingredientes, agregar extras permitidos (con cargo) y dejar un comentario; al confirmar se agrega al carrito/cuenta y al vender se descuenta el snapshot (no la receta por defecto).

**Architecture:** Tabla `receta_extras_permitidos` (extras + `precio_extra` por receta). Snapshot `personalizacion` en memoria (POS), JSONB en `cuenta_lineas` (persistente) y `venta_detalles` (auditoría). El backend recalcula `precioBase + Σ precioExtra` y `venderIngredientesReceta` consume el snapshot. Drawer compartido `VentasRecetaPersonalizacionDrawer` intercepta el click en recetas.

**Tech Stack:** NestJS + TypeORM (`synchronize: true` en dev), PostgreSQL 15, Decimal.js, Jest, Nuxt 4 + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-16-edicion-recetas-antes-carrito-design.md`](../specs/2026-07-16-edicion-recetas-antes-carrito-design.md)

## Global Constraints

- **Trabajar y commitear directamente sobre `main`.** No crear ramas ni PRs.
- **Decimal.js** para dinero y cantidades; `precioExtra` viaja como **string** (`@IsNumberString`).
- **PK/FK UUID con `type: 'uuid'`** (ADR-004).
- **Soft delete** en `receta_extras_permitidos`; al reemplazar lista → soft-delete vivos + INSERT.
- **`tenant_id` del token**, nunca del body.
- **Design System:** tokens semánticos Nuxt UI; iconos Lucide.
- **Sin refetch tras mutación:** POST/PATCH devuelven entidad/patch mergeable.
- **POS carrito en memoria** (sin persistir). **Salones** persiste `personalizacion` en BD.
- **Omitir no rebaja precio.** Extras al vender = rama no bloqueante.
- **Seed IDs libres:** `550e8400-e29b-41d4-a716-446655440256` en adelante.
- Actualizar `docs/ESTADO.md` + feature doc en el mismo commit final de docs.

## File Structure

**Backend — crear:**
- `backend/src/modules/items/entities/receta-extra-permitido.entity.ts`
- `backend/src/modules/items/dto/receta-extra-input.dto.ts` (o anidar en `create-item.dto.ts`)
- `backend/src/common/dto/personalizacion-receta.dto.ts` (compartido ventas/salones)
- `backend/src/common/utils/personalizacion-receta.util.ts` (`hashPersonalizacion`, `textoComandaPersonalizacion`)

**Backend — modificar:**
- `startup-pos.sql` — `receta_extras_permitidos`; `cuenta_lineas.personalizacion`; `venta_detalles.personalizacion`
- `backend/src/app.module.ts` — registrar entity
- `backend/src/modules/items/items.module.ts` — `forFeature`
- `backend/src/modules/items/dto/create-item.dto.ts` / `update-item.dto.ts` — `extrasPermitidos?`
- `backend/src/modules/items/items.service.ts` — CRUD extras; `findOne` con stock; `venderIngredientesReceta(snapshot)`; helper precio extras
- `backend/src/modules/items/items.service.spec.ts`
- `backend/src/modules/ventas/dto/create-venta.dto.ts` — `personalizacion?` en `LineaVentaDto`
- `backend/src/modules/ventas/entities/venta-detalle.entity.ts` — columna JSONB
- `backend/src/modules/ventas/ventas.service.ts` — precio + snapshot + persistir personalizacion
- `backend/src/modules/ventas/ventas.service.spec.ts`
- `backend/src/modules/salones/entities/cuenta-linea.entity.ts` — JSONB
- `backend/src/modules/salones/dto/add-linea.dto.ts` — `personalizacion?`
- `backend/src/modules/salones/salones.service.ts` — merge por hash; cerrar; comanda
- `backend/src/modules/salones/salones.service.spec.ts`
- `backend/src/modules/seeder/seeder.service.ts` — extras demo en receta existente (si hay)

**Frontend — crear:**
- `frontend/app/composables/useRecetaPersonalizacion.ts` (+ `.spec.ts`) — helpers puros
- `frontend/app/components/ventas/RecetaPersonalizacionDrawer.vue`

**Frontend — modificar:**
- `frontend/app/pages/configuracion/items.vue` — UI extras permitidos
- `frontend/app/composables/useVenta.ts` (+ spec) — `CarritoLinea.personalizacion`; merge por personalización
- `frontend/app/components/ventas/CatalogoGrid.vue` — emitir distinto para receta (o `@select`)
- `frontend/app/components/ventas/CarritoPanel.vue` — resumen personalización
- `frontend/app/pages/ventas/pos.vue` — drawer + body con personalizacion
- `frontend/app/composables/useSalones.ts` — tipos + `agregarLinea` con personalizacion
- `frontend/app/pages/salones/index.vue` — drawer + UI líneas

**Docs:**
- `docs/features/personalizacion-recetas.md` (nuevo), `docs/README.md`, `docs/ESTADO.md`, spec → `Status: Done`

---

### Task 1: Schema + entity + DTOs de extras y personalización

**Files:**
- Create: `backend/src/modules/items/entities/receta-extra-permitido.entity.ts`
- Create: `backend/src/common/dto/personalizacion-receta.dto.ts`
- Create: `backend/src/common/utils/personalizacion-receta.util.ts`
- Modify: `startup-pos.sql`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/modules/items/items.module.ts`
- Modify: `backend/src/modules/items/dto/create-item.dto.ts`
- Modify: `backend/src/modules/items/dto/update-item.dto.ts`
- Modify: `backend/src/modules/ventas/entities/venta-detalle.entity.ts`
- Modify: `backend/src/modules/salones/entities/cuenta-linea.entity.ts`
- Test: `backend/src/common/utils/personalizacion-receta.util.spec.ts`

**Interfaces:**
- Produces:
  - `RecetaExtraInputDto { ingredienteItemId: string; cantidad: string; unidadCodigo: string; precioExtra: string }`
  - `PersonalizacionRecetaDto { omitidos?: string[]; extras?: { ingredienteItemId: string }[]; comentario?: string }` (input del cliente: extras solo por id; el server completa cantidad/unidad/precio)
  - `PersonalizacionRecetaSnapshot { omitidos: string[]; extras: { ingredienteItemId: string; cantidad: string; unidadCodigo: string; precioExtra: string }[]; comentario?: string }`
  - `hashPersonalizacion(p: PersonalizacionRecetaSnapshot | null | undefined): string`
  - `textoComandaPersonalizacion(p, nombres: Map<string,string>): string`

- [ ] **Step 1: Test util hash + texto comanda (RED)**

```typescript
// backend/src/common/utils/personalizacion-receta.util.spec.ts
import {
  hashPersonalizacion,
  textoComandaPersonalizacion,
} from './personalizacion-receta.util';

describe('personalizacion-receta.util', () => {
  it('hash estable sin importar orden de omitidos', () => {
    const a = hashPersonalizacion({
      omitidos: ['b', 'a'],
      extras: [],
    });
    const b = hashPersonalizacion({
      omitidos: ['a', 'b'],
      extras: [],
    });
    expect(a).toBe(b);
  });

  it('hash distinto si cambia comentario', () => {
    expect(
      hashPersonalizacion({ omitidos: [], extras: [], comentario: 'medio' }),
    ).not.toBe(
      hashPersonalizacion({ omitidos: [], extras: [], comentario: 'jugoso' }),
    );
  });

  it('textoComanda arma Sin / Extra / comentario', () => {
    const nombres = new Map([
      ['i1', 'Cebolla'],
      ['i2', 'Queso'],
    ]);
    expect(
      textoComandaPersonalizacion(
        {
          omitidos: ['i1'],
          extras: [
            {
              ingredienteItemId: 'i2',
              cantidad: '1',
              unidadCodigo: 'unidad',
              precioExtra: '800',
            },
          ],
          comentario: 'término medio',
        },
        nombres,
      ),
    ).toBe('Sin Cebolla · Extra Queso · término medio');
  });
});
```

- [ ] **Step 2: Run RED**

```bash
cd backend && npx jest src/common/utils/personalizacion-receta.util.spec.ts --no-coverage
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement util + entity + SQL + DTOs**

`receta-extra-permitido.entity.ts` — espejo de `RecetaIngrediente` + `precioExtra` numeric.

SQL en `startup-pos.sql` (después de `receta_ingredientes`):

```sql
CREATE TABLE "receta_extras_permitidos" (
  "receta_extra_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants" ("tenant_id"),
  "receta_item_id" UUID NOT NULL REFERENCES "items" ("item_id"),
  "ingrediente_item_id" UUID NOT NULL REFERENCES "items" ("item_id"),
  "cantidad" NUMERIC(18,4) NOT NULL,
  "unidad_codigo" TEXT NOT NULL REFERENCES "unidades_medida" ("codigo"),
  "precio_extra" NUMERIC(18,4) NOT NULL,
  "creado_el" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el" TIMESTAMPTZ,
  "eliminado_el" TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_receta_extra_vivo"
  ON "receta_extras_permitidos" ("receta_item_id", "ingrediente_item_id")
  WHERE "eliminado_el" IS NULL;

ALTER TABLE "cuenta_lineas"
  ADD COLUMN IF NOT EXISTS "personalizacion" JSONB;
ALTER TABLE "venta_detalles"
  ADD COLUMN IF NOT EXISTS "personalizacion" JSONB;
```

En entities TypeORM:

```typescript
@Column({ type: 'jsonb', nullable: true })
personalizacion: PersonalizacionRecetaSnapshot | null;
```

`CreateItemDto` / `UpdateItemDto`: campo `extrasPermitidos?: RecetaExtraInputDto[]` con `@ValidateNested` + `@Type`.

`PersonalizacionRecetaDto` (input API):

```typescript
export class PersonalizacionExtraInputDto {
  @IsUUID()
  ingredienteItemId: string;
}
export class PersonalizacionRecetaDto {
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  omitidos?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => PersonalizacionExtraInputDto)
  extras?: PersonalizacionExtraInputDto[];
  @IsOptional() @IsString() @MaxLength(200)
  comentario?: string;
}
```

Util: ordenar omitidos y extras por id antes de `JSON.stringify` para el hash.

- [ ] **Step 4: Run GREEN**

```bash
cd backend && npx jest src/common/utils/personalizacion-receta.util.spec.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add startup-pos.sql backend/src/modules/items/entities/receta-extra-permitido.entity.ts \
  backend/src/common/dto/personalizacion-receta.dto.ts \
  backend/src/common/utils/personalizacion-receta.util.ts \
  backend/src/common/utils/personalizacion-receta.util.spec.ts \
  backend/src/app.module.ts backend/src/modules/items/items.module.ts \
  backend/src/modules/items/dto/create-item.dto.ts \
  backend/src/modules/items/dto/update-item.dto.ts \
  backend/src/modules/ventas/entities/venta-detalle.entity.ts \
  backend/src/modules/salones/entities/cuenta-linea.entity.ts
git commit -m "$(cat <<'EOF'
feat(recetas): schema y DTOs de extras y personalización

EOF
)"
```

---

### Task 2: ItemsService — CRUD `extrasPermitidos` + stock en detalle

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `RecetaExtraInputDto`, `validarYCostearIngredientes` (patrón validación)
- Produces: `create`/`update`/`findOne` incluyen `extrasPermitidos: { ingredienteItemId, ingredienteNombre, cantidad, unidadCodigo, precioExtra, stock }[]`; ingredientes de `findOne` ganan `stock: string`

- [ ] **Step 1: Tests RED** — en `items.service.spec.ts`:

1. `create` receta con `extrasPermitidos` válidos persiste e incluye extras en respuesta.
2. `create` rechaza `precioExtra` negativo / no number-string (vía ValidationPipe en e2e opcional; en service validar Decimal ≥ 0).
3. `update` soft-deletea extras previos e inserta nuevos.
4. `findOne` receta incluye `stock` en ingredientes y extras.

- [ ] **Step 2: Run RED**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts --no-coverage -t "extrasPermitidos"
```

Expected: FAIL

- [ ] **Step 3: Implement**

En `create`/`update` rama `receta`, tras ingredientes:

```typescript
async validarExtrasPermitidos(manager, tenantId, extras: RecetaExtraInputDto[]) {
  // misma validación de item tipo=ingrediente + unidad que ingredientes
  // precioExtra >= 0 con Decimal
  // devolver detalle con nombres
}
```

INSERT/UPDATE soft-delete espejo de `receta_ingredientes`.

`findOne`: query ingredientes + `ip.stock`; query extras:

```sql
SELECT re.ingrediente_item_id, i.nombre, re.cantidad, re.unidad_codigo,
       re.precio_extra, ip.stock
FROM receta_extras_permitidos re
JOIN items i ON i.item_id = re.ingrediente_item_id AND i.eliminado_el IS NULL
JOIN item_producto ip ON ip.item_id = re.ingrediente_item_id
WHERE re.receta_item_id = $1 AND re.tenant_id = $2 AND re.eliminado_el IS NULL
```

- [ ] **Step 4: GREEN + Commit**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts --no-coverage
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(items): CRUD de extras permitidos en recetas

EOF
)"
```

---

### Task 3: Ventas — precio con extras + stock por snapshot

**Files:**
- Modify: `backend/src/modules/ventas/dto/create-venta.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`venderIngredientesReceta`, `resolverPersonalizacionReceta`)
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`, `backend/src/modules/ventas/ventas.service.spec.ts`

**Interfaces:**
- Produces:
  - `ItemsService.resolverPersonalizacionReceta(manager, tenantId, recetaItemId, dto?: PersonalizacionRecetaDto): Promise<{ snapshot: PersonalizacionRecetaSnapshot; precioExtraTotal: string }>`
  - `venderIngredientesReceta(..., snapshot?: PersonalizacionRecetaSnapshot)` — si no hay snapshot, comportamiento actual (toda la receta)
  - `LineaVentaDto.personalizacion?: PersonalizacionRecetaDto`

- [ ] **Step 1: Tests RED**

1. `resolverPersonalizacionReceta` suma precios de extras del catálogo; rechaza extra no permitido; rechaza omitido ajeno.
2. `venderIngredientesReceta` con omitidos no descuenta ese ingrediente; con extras sí descuenta el extra (rama no bloqueante).
3. Venta: `precioUnitario` efectivo = base + extras; `venta_detalles.personalizacion` persistido.

- [ ] **Step 2: Implement**

```typescript
async resolverPersonalizacionReceta(...) {
  const ings = await this.obtenerIngredientesReceta(...);
  const extrasCat = await this.obtenerExtrasPermitidos(...);
  for (const id of dto?.omitidos ?? []) {
    if (!ings.some(i => i.ingredienteItemId === id))
      throw new BadRequestException('Ingrediente omitido no pertenece a la receta');
  }
  const extrasResolved = [];
  let precioExtraTotal = new Decimal(0);
  for (const e of dto?.extras ?? []) {
    const cat = extrasCat.find(x => x.ingredienteItemId === e.ingredienteItemId);
    if (!cat) throw new BadRequestException('Extra no permitido para esta receta');
    extrasResolved.push({ ... });
    precioExtraTotal = precioExtraTotal.plus(cat.precioExtra);
  }
  return {
    snapshot: {
      omitidos: [...(dto?.omitidos ?? [])],
      extras: extrasResolved,
      comentario: dto?.comentario?.trim() || undefined,
    },
    precioExtraTotal: precioExtraTotal.toFixed(4),
  };
}
```

En `venderIngredientesReceta`: filtrar ingredientes por `!omitidos.includes`; append extras como `{ bloqueante: false, ... }`.

En `crearEnTransaccion`:
- Por cada línea receta, llamar `resolverPersonalizacionReceta`.
- Usar `precioOrigen = item.precioBase + precioExtraTotal` (Decimal) en vez de solo `precioBase` (salvo que `linea.precioUnitario` venga de otro canal — **ignorar precioUnitario del cliente para recetas con personalizacion**; siempre recalcular).
- Guardar `personalizacion: snapshot` en `VentaDetalle`.
- Pasar snapshot a `venderIngredientesReceta`.

- [ ] **Step 3: GREEN + Commit**

```bash
cd backend && npx jest src/modules/items/items.service.spec.ts src/modules/ventas/ventas.service.spec.ts --no-coverage
git commit -m "$(cat <<'EOF'
feat(ventas): personalización de receta en precio y stock

EOF
)"
```

---

### Task 4: Salones — persistir personalización, merge, comanda, cierre

**Files:**
- Modify: `backend/src/modules/salones/dto/add-linea.dto.ts`
- Modify: `backend/src/modules/salones/salones.service.ts`
- Test: `backend/src/modules/salones/salones.service.spec.ts`

**Interfaces:**
- `AddLineaDto { itemId, cantidad, personalizacion?: PersonalizacionRecetaDto }`
- `CuentaLineaDetalle` gana `personalizacion` + opcional `personalizacionTexto`
- Merge: mismo `itemId` + mismo `hashPersonalizacion`

- [ ] **Step 1: Tests RED**

1. `agregarLinea` con personalizacion guarda JSONB.
2. Segunda línea misma personalizacion suma cantidad; distinta crea línea nueva.
3. `cerrarCuenta` pasa `personalizacion` a `CreateVentaDto`.
4. `previewComanda` / `agruparEstacionesComanda` incluye texto de personalización en el nombre o campo `nota`.

- [ ] **Step 2: Implement**

```typescript
// agregarLinea
const snapshot = item.tipo === 'receta' && dto.personalizacion
  ? (await this.itemsService.resolverPersonalizacionReceta(...)).snapshot
  : dto.personalizacion ? throw BadRequest('solo recetas') : null;

const hash = hashPersonalizacion(snapshot);
const existentes = await this.cuentaLineaRepo.find({ where: { tenantId, cuentaId, itemId }});
const match = existentes.find(l => hashPersonalizacion(l.personalizacion) === hash);
```

Inyectar `ItemsService` en `SalonesService` si aún no está (via `ItemsModule` export).

Comanda SQL / mapeo: append `textoComandaPersonalizacion` al `nombre` del item (o campo `detalle` nuevo en `ComandaEstacion.items` — preferir campo `nota?: string` para no ensuciar el nombre del producto).

Cerrar:

```typescript
lineas: lineas.map(l => ({
  itemId: l.itemId,
  cantidad: l.cantidad,
  personalizacion: l.personalizacion
    ? {
        omitidos: l.personalizacion.omitidos,
        extras: l.personalizacion.extras.map(e => ({ ingredienteItemId: e.ingredienteItemId })),
        comentario: l.personalizacion.comentario,
      }
    : undefined,
})),
```

- [ ] **Step 3: GREEN + Commit**

```bash
cd backend && npx jest src/modules/salones/salones.service.spec.ts --no-coverage
git commit -m "$(cat <<'EOF'
feat(salones): personalización persistente en líneas de cuenta

EOF
)"
```

---

### Task 5: Frontend helpers + drawer de personalización

**Files:**
- Create: `frontend/app/composables/useRecetaPersonalizacion.ts`
- Create: `frontend/app/composables/useRecetaPersonalizacion.spec.ts`
- Create: `frontend/app/components/ventas/RecetaPersonalizacionDrawer.vue`

**Interfaces:**
```ts
export interface RecetaDetallePersonalizacion {
  id: string
  nombre: string
  precioBase: string
  monedaId: string
  ingredientes: { ingredienteItemId: string; ingredienteNombre: string; cantidad: string; unidadCodigo: string; bloqueante: boolean; stock: string }[]
  extrasPermitidos: { ingredienteItemId: string; ingredienteNombre: string; cantidad: string; unidadCodigo: string; precioExtra: string; stock: string }[]
}
export function sinStock(stock: string): boolean
export function precioConExtras(precioBase: string, extrasSeleccionados: { precioExtra: string }[]): string
export function buildPersonalizacionPayload(omitidos: string[], extrasIds: string[], comentario: string): PersonalizacionPayload
export function resumenPersonalizacion(...): string
```

- [ ] **Step 1: Tests Vitest RED**

```typescript
import { sinStock, precioConExtras, resumenPersonalizacion } from './useRecetaPersonalizacion'

it('sinStock true si 0', () => expect(sinStock('0')).toBe(true))
it('precioConExtras suma', () => expect(precioConExtras('5000', [{ precioExtra: '800' }])).toBe('5800'))
it('resumen', () => expect(resumenPersonalizacion(['Cebolla'], ['Queso'], 'medio')).toContain('Sin Cebolla'))
```

- [ ] **Step 2: Implement helpers + drawer**

Drawer con `AppDrawer`:
- Carga `GET /items/:id` al abrir (`v-model:open` + `itemId`).
- Lista ingredientes con `USwitch` “Incluir” (default on); si no bloqueante y `sinStock` → warning + switch disabled (forzar off o impedir on).
- Para bloqueantes sin stock: visibles; se pueden omitir; si quedan incluidos, el backend abortará al vender (comportamiento actual).
- Extras: checkbox; `sinStock` → warning + disabled.
- `UTextarea` comentario max 200.
- Footer: Cancelar | Agregar (muestra precio preview).
- Emit `confirm` con `{ omitidos, extras: [{ingredienteItemId}], comentario }` + no mutar catálogo.

Tokens: `text-warning`, `text-muted`, `border-default`.

- [ ] **Step 3: GREEN + Commit**

```bash
cd frontend && npm test -- --run app/composables/useRecetaPersonalizacion.spec.ts
git commit -m "$(cat <<'EOF'
feat(frontend): drawer y helpers de personalización de receta

EOF
)"
```

---

### Task 6: Configuración — extras permitidos en `items.vue`

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`

- [ ] **Step 1: Extender form**

`emptyForm` / `abrirEditar` / `guardar`: campo `extrasPermitidos: { ingredienteItemId, cantidad, unidadCodigo, precioExtra }[]`.

Template (bajo ingredientes): sección “Extras permitidos” con filas (SelectMenu ingrediente, cantidad, unidad, `MoneyInput` precioExtra) + add/remove.

Payload `extrasPermitidos` solo si `tipo === 'receta'`.

Merge respuesta en lista local (sin refetch).

- [ ] **Step 2: Verificación manual rápida** — crear/editar receta con un extra.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(items-ui): configurar extras permitidos en recetas

EOF
)"
```

---

### Task 7: Wire POS

**Files:**
- Modify: `frontend/app/composables/useVenta.ts` (+ spec)
- Modify: `frontend/app/components/ventas/CatalogoGrid.vue`
- Modify: `frontend/app/components/ventas/CarritoPanel.vue`
- Modify: `frontend/app/pages/ventas/pos.vue`

**Interfaces:**
- `CarritoLinea { item, cantidad, personalizacion?: PersonalizacionSnapshot }`
- `agregarLinea(lineas, item, personalizacion?)` — merge solo si mismo item **y** mismo hash de personalización
- CatalogoGrid: emitir `add` para producto; `customize` para receta (o siempre `select` y el padre decide)

- [ ] **Step 1: Tests useVenta RED/GREEN** — merge con distinta personalización no suma.

- [ ] **Step 2: Wire**

`pos.vue`:
```ts
const recetaDrawerOpen = ref(false)
const recetaItemId = ref<string | null>(null)
function onCatalogoAdd(item: ItemCatalogo) {
  if (item.tipo === 'receta') {
    recetaItemId.value = item.id
    recetaDrawerOpen.value = true
    return
  }
  add(item)
}
function onRecetaConfirm(payload) {
  const item = items.value.find(i => i.id === recetaItemId.value)
  if (!item) return
  add(item, payload) // extender useVenta.add
}
```

Body venta:
```ts
lineas: lineas.value.map(l => ({
  itemId: l.item.id,
  cantidad: l.cantidad,
  personalizacion: l.personalizacion
    ? { omitidos: l.personalizacion.omitidos, extras: l.personalizacion.extras.map(...), comentario: l.personalizacion.comentario }
    : undefined,
})),
```

CarritoPanel: bajo el nombre, `text-xs text-muted` con `resumenPersonalizacion`.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pos): drawer de personalización al agregar receta

EOF
)"
```

---

### Task 8: Wire Salones

**Files:**
- Modify: `frontend/app/composables/useSalones.ts`
- Modify: `frontend/app/pages/salones/index.vue`

- [ ] **Step 1:** Extender `CuentaLineaDetalle.personalizacion?` y `agregarLinea(cuentaId, itemId, cantidad, personalizacion?)`.

- [ ] **Step 2:** En `addProducto`, si `item.tipo === 'receta'` abrir mismo drawer; al confirmar llamar API con personalizacion. Mostrar resumen en lista de líneas.

- [ ] **Step 3:** Commit

```bash
git commit -m "$(cat <<'EOF'
feat(salones): personalización de recetas en cuentas de mesa

EOF
)"
```

---

### Task 9: Docs vivas + seed opcional

**Files:**
- Create: `docs/features/personalizacion-recetas.md` (desde TEMPLATE)
- Modify: `docs/README.md`, `docs/ESTADO.md`
- Modify: `docs/superpowers/specs/2026-07-16-edicion-recetas-antes-carrito-design.md` → `Status: Done`
- Optional: seed un extra en la receta demo (`0256`)

- [ ] **Step 1:** Documentar comportamiento, APIs, reglas de stock/precio.

- [ ] **Step 2:** Commit

```bash
git commit -m "$(cat <<'EOF'
docs: personalización de recetas antes del carrito

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Drawer al click receta POS+Salones | 5, 7, 8 |
| Productos click directo | 7, 8 |
| Config extras en create/edit receta | 2, 6 |
| Snapshot omitidos+extras+comentario | 1, 3, 4 |
| Precio base + extras | 3, 5 |
| Persistencia Salones / memoria POS | 4, 7 |
| Stock drawer warning+disabled | 5 |
| Bloqueantes lógica existente | 3 |
| Comanda texto | 4 |
| Merge por personalización | 4, 7 |
| Backend recalcula precio | 3 |
| Docs ESTADO | 9 |

## Verification manual final

1. Receta con extras → drawer en POS → omitir + extra + comentario → total con cargo → cobro OK y stock del snapshot.
2. Salones: mismo flujo → F5 → línea intacta → comanda con texto.
3. Extra sin stock: warning, no seleccionable.
4. Producto: un click agrega.
