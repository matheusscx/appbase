# Cantidad con unidad de presentación — Implementation Plan

**Status:** Done · **Date:** 2026-07-16

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Controles − / input / + en carritos POS, Salones y Online, con selector de unidad de la misma magnitud, persistiendo presentación (`500 g`) y calculando/stockeando en cantidad canónica (`0.5` kg).

**Architecture:** Dos representaciones por línea — `cantidad` (unidad base del ítem) para precio/stock/inventario/comanda enviada; `cantidadPresentacion` + `unidadCodigoPresentacion` para UI, tickets y auditoría. Backend recalcula canónica con `CatalogService.convertirUnidad`. Front convierte antes de `calcular`. Componente compartido `AppCantidadInput`.

**Tech Stack:** NestJS + TypeORM (`synchronize: true` en dev), PostgreSQL 15, Decimal.js, Jest, Nuxt 4 + Nuxt UI (`UInputNumber`), Vitest, Pinia `useUnidadesMedidaStore`.

**Spec:** [`docs/superpowers/specs/2026-07-16-cantidad-unidad-presentacion-carrito-design.md`](../specs/2026-07-16-cantidad-unidad-presentacion-carrito-design.md)

## Global Constraints

- **Trabajar y commitear directamente sobre `main`.** No crear ramas ni PRs.
- **Decimal.js** / strings numéricos; `@IsNumberString` en DTOs.
- **PK/FK UUID con `type: 'uuid'`** (ADR-004). Soft delete sin cambio.
- **`tenant_id` del token**, nunca del body.
- **Motor de precios** recibe **solo** `cantidad` canónica.
- **Sin refetch** tras mutación: respuesta mergeable.
- **Design System:** tokens semánticos Nuxt UI; Lucide.
- **Papelera** elimina; el botón − nunca borra la línea.
- Actualizar `docs/ESTADO.md` + features en el commit de docs.

## File Structure

**Backend — crear:**
- `backend/src/common/utils/cantidad-presentacion.util.ts` (+ `.spec.ts`)
  - `resolverCantidadDesdePresentacion(...)`
  - `assertPresentacionPareada(...)`

**Backend — modificar:**
- `startup-pos.sql` — columnas en `cuenta_lineas` y `venta_detalles`
- `backend/src/modules/salones/entities/cuenta-linea.entity.ts`
- `backend/src/modules/ventas/entities/venta-detalle.entity.ts`
- `backend/src/modules/ventas/dto/create-venta.dto.ts` — `LineaVentaDto`
- `backend/src/modules/salones/dto/add-linea.dto.ts`
- `backend/src/modules/salones/dto/update-linea.dto.ts`
- `backend/src/modules/ventas/ventas.service.ts` (+ spec)
- `backend/src/modules/salones/salones.service.ts` (+ spec)
- `backend/src/modules/online/online.service.ts` — `CheckoutSnapshot.lineas`
- `backend/src/modules/online/online-callback.handler.ts`

**Frontend — crear:**
- `frontend/app/utils/cantidad-presentacion.ts` (+ `.spec.ts`)
- `frontend/app/components/AppCantidadInput.vue`

**Frontend — modificar:**
- `frontend/app/composables/useVenta.ts` (+ spec)
- `frontend/app/components/ventas/CarritoPanel.vue`
- `frontend/app/pages/ventas/pos.vue`
- `frontend/app/composables/useTiendaCarrito.ts`
- `frontend/app/components/tienda/CarritoOnline.vue`
- `frontend/app/composables/useSalones.ts`
- `frontend/app/pages/salones/index.vue`
- `frontend/app/utils/ticket-builder.ts` (+ spec)
- `frontend/app/components/ventas/VentaDetalleDrawer.vue`

**Docs:** ventas, salones/tienda/impresión, `docs/ESTADO.md`, spec → Done

---

### Task 1: Schema + entities + DTO fields

**Files:**
- Modify: `startup-pos.sql`
- Modify: `backend/src/modules/salones/entities/cuenta-linea.entity.ts`
- Modify: `backend/src/modules/ventas/entities/venta-detalle.entity.ts`
- Modify: `backend/src/modules/ventas/dto/create-venta.dto.ts`
- Modify: `backend/src/modules/salones/dto/add-linea.dto.ts`
- Modify: `backend/src/modules/salones/dto/update-linea.dto.ts`

**Interfaces:**
- Produces on DTOs (optional, paired): `cantidadPresentacion?: string`, `unidadCodigoPresentacion?: string`

- [ ] **Step 1: Columnas en `startup-pos.sql`**

En `cuenta_lineas` y `venta_detalles`:

```sql
"cantidad_presentacion" NUMERIC(18,4),
"unidad_codigo_presentacion" TEXT REFERENCES "unidades_medida" ("codigo"),
```

- [ ] **Step 2: Entities**

```typescript
@Column({
  name: 'cantidad_presentacion',
  type: 'numeric',
  precision: 18,
  scale: 4,
  nullable: true,
})
cantidadPresentacion: string | null;

@Column({ name: 'unidad_codigo_presentacion', type: 'text', nullable: true })
unidadCodigoPresentacion: string | null;
```

- [ ] **Step 3: DTOs** — `LineaVentaDto`, `AddLineaDto`, `UpdateLineaDto`:

```typescript
@IsOptional()
@IsNumberString()
cantidadPresentacion?: string;

@IsOptional()
@IsString()
unidadCodigoPresentacion?: string;
```

En `UpdateLineaDto` mantener `cantidad`; si llega presentación, el service recalcula canónica.

- [ ] **Step 4: Commit**

```bash
git add startup-pos.sql \
  backend/src/modules/salones/entities/cuenta-linea.entity.ts \
  backend/src/modules/ventas/entities/venta-detalle.entity.ts \
  backend/src/modules/ventas/dto/create-venta.dto.ts \
  backend/src/modules/salones/dto/add-linea.dto.ts \
  backend/src/modules/salones/dto/update-linea.dto.ts
git commit -m "$(cat <<'EOF'
feat: columnas y DTOs de cantidad de presentación en líneas

EOF
)"
```

---

### Task 2: Util backend `resolverCantidadDesdePresentacion` (TDD)

**Files:**
- Create: `backend/src/common/utils/cantidad-presentacion.util.ts`
- Create: `backend/src/common/utils/cantidad-presentacion.util.spec.ts`

**Interfaces:**
```typescript
export type UnidadCat = { codigo: string; magnitud: string; factorBase: string };

export function assertPresentacionPareada(
  cantidadPresentacion?: string | null,
  unidadCodigoPresentacion?: string | null,
): void;

export function resolverCantidadDesdePresentacion(params: {
  cantidadPresentacion: string;
  unidadCodigoPresentacion: string;
  unidadBaseCodigo: string;
  catalogo: UnidadCat[];
  forzarConteo?: boolean;
}): {
  cantidadCanonica: string;
  cantidadPresentacion: string;
  unidadCodigoPresentacion: string;
};
```

Fórmula = `CatalogService.convertirUnidad`: `cantidad * factorDesde / factorHacia`, 4 decimales HALF_UP. Si canónica ≈ 0 con presentación > 0 → BadRequest.

- [ ] **Step 1: Spec RED**

```typescript
import { BadRequestException } from '@nestjs/common';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
} from './cantidad-presentacion.util';

const CAT = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
  { codigo: 'ml', magnitud: 'volumen', factorBase: '1' },
  { codigo: 'l', magnitud: 'volumen', factorBase: '1000' },
];

describe('cantidad-presentacion.util', () => {
  it('500 g → 0.5 kg', () => {
    const r = resolverCantidadDesdePresentacion({
      cantidadPresentacion: '500',
      unidadCodigoPresentacion: 'g',
      unidadBaseCodigo: 'kg',
      catalogo: CAT,
    });
    expect(r.cantidadCanonica).toBe('0.5');
  });

  it('rechaza cross-magnitud', () => {
    expect(() =>
      resolverCantidadDesdePresentacion({
        cantidadPresentacion: '1',
        unidadCodigoPresentacion: 'l',
        unidadBaseCodigo: 'kg',
        catalogo: CAT,
      }),
    ).toThrow(BadRequestException);
  });

  it('conteo rechaza decimal', () => {
    expect(() =>
      resolverCantidadDesdePresentacion({
        cantidadPresentacion: '0.5',
        unidadCodigoPresentacion: 'unidad',
        unidadBaseCodigo: 'unidad',
        catalogo: CAT,
        forzarConteo: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('assertPresentacionPareada exige ambos o ninguno', () => {
    expect(() => assertPresentacionPareada('1', undefined)).toThrow(BadRequestException);
    expect(() => assertPresentacionPareada(undefined, 'g')).toThrow(BadRequestException);
    expect(() => assertPresentacionPareada(undefined, undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run RED**

```bash
cd backend && npx jest src/common/utils/cantidad-presentacion.util.spec.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement GREEN** — Decimal.js, mensajes en español.

- [ ] **Step 4: Run GREEN**

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/utils/cantidad-presentacion.util.ts \
  backend/src/common/utils/cantidad-presentacion.util.spec.ts
git commit -m "$(cat <<'EOF'
feat: util resolver cantidad canónica desde presentación

EOF
)"
```

---

### Task 3: VentasService — persistir presentación

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Modify: `backend/src/modules/ventas/ventas.service.spec.ts`

**Interfaces:**
- Consumes util Task 2 + catálogo unidades
- Por línea con presentación: canónica antes de calcular/stock; columnas en `venta_detalles`

- [ ] **Step 1: Spec RED**

```typescript
it('persiste presentación y usa canónica para precio/stock', async () => {
  // item producto unidadMedida 'kg'
  // dto: cantidad '999', cantidadPresentacion '500', unidadCodigoPresentacion 'g'
  // expect calcular con cantidad '0.5'
  // expect detalle.cantidadPresentacion === '500'
  // expect detalle.unidadCodigoPresentacion === 'g'
});
```

- [ ] **Step 2: Implement en `crearEnTransaccion`:**
  1. Cargar catálogo una vez.
  2. `assertPresentacionPareada`; resolver canónica (`receta` → `forzarConteo`, base `unidad`).
  3. Usar canónica en cálculo y movimientos.
  4. Guardar presentación en `VentaDetalle` (o null).

- [ ] **Step 3: GREEN + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: ventas persisten y validan cantidad de presentación

EOF
)"
```

---

### Task 4: SalonesService — agregar/actualizar/armarDetalle/cerrar

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts`
- Modify: `backend/src/modules/salones/salones.service.spec.ts`

**Interfaces:**
- `CuentaLineaDetalle` + `cantidadPresentacion` / `unidadCodigoPresentacion`
- `agregarLinea` / `actualizarLinea` resuelven canónica
- `cerrarCuenta` mapea a `CreateVentaDto.lineas`
- `cantidad_enviada` permanece en canónica

- [ ] **Step 1: Spec RED** — 500 g sobre item kg → cantidad BD `0.5`; detalle expone presentación.

- [ ] **Step 2: Implement** — inyectar `CatalogService` si falta en módulo.

- [ ] **Step 3: UpdateLinea** — con presentación recalcula; solo `cantidad` (legado) = canónica y sync presentación a base.

- [ ] **Step 4: GREEN + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: salones resuelven y exponen cantidad de presentación

EOF
)"
```

---

### Task 5: Online checkout snapshot

**Files:**
- Modify: `backend/src/modules/online/online.service.ts`
- Modify: `backend/src/modules/online/online-callback.handler.ts` (+ specs)

**Interfaces:**
```typescript
lineas: {
  itemId: string;
  cantidad: string;
  cantidadPresentacion?: string;
  unidadCodigoPresentacion?: string;
}[];
```

- [ ] **Step 1:** Extender snapshot; resolver presentación server-side si viene en body (alineado a ventas).

- [ ] **Step 2:** Callback pasa campos a `CreateVentaDto`.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: online conserva presentación en snapshot de checkout

EOF
)"
```

---

### Task 6: Helpers FE `cantidad-presentacion` (TDD)

**Files:**
- Create: `frontend/app/utils/cantidad-presentacion.ts`
- Create: `frontend/app/utils/cantidad-presentacion.spec.ts`

**Interfaces:**
```typescript
export type UnidadCat = { codigo: string; magnitud: string; factorBase: string }

export function opcionesMismaMagnitud(unidadBase: string, catalogo: UnidadCat[]): UnidadCat[]
export function convertirPresentacion(cantidad: string, desde: string, hacia: string, catalogo: UnidadCat[]): string
export function aCantidadCanonica(presentacion: string, unidadPres: string, unidadBase: string, catalogo: UnidadCat[]): string
export function desdeCantidadCanonica(canonica: string, unidadBase: string, unidadPres: string, catalogo: UnidadCat[]): string
export function puedeDecrementar(presentacion: string, unidadPres: string, catalogo: UnidadCat[]): boolean
export function esConteo(unidadCodigo: string, catalogo: UnidadCat[]): boolean
export function formatCantidadTicket(cantidad: string, unidadCodigo?: string | null): string
```

- [ ] **Step 1: Spec RED** — kg↔g; conteo `puedeDecrementar('1')===false`; continua no baja a ≤0.

- [ ] **Step 2: Implement GREEN**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: helpers FE de cantidad de presentación

EOF
)"
```

---

### Task 7: Componente `AppCantidadInput`

**Files:**
- Create: `frontend/app/components/AppCantidadInput.vue`

**Interfaces:**
```typescript
props: {
  modelValue: string | number
  unidadCodigo: string
  unidadBaseCodigo: string
  disabled?: boolean
}
emits: {
  'update:modelValue': [string]
  'update:unidadCodigo': [string]
  change: [{ presentacion: string; unidadCodigo: string; cantidadCanonica: string }]
}
```

- [ ] **Step 1: UI**

```vue
<div class="flex items-center gap-1">
  <UInputNumber
    :model-value="Number(modelValue)"
    :min="esConteoLocal ? 1 : undefined"
    :step="1"
    :step-snapping="esConteoLocal"
    :disabled="disabled"
    :decrement-disabled="!puedeDec"
    size="sm"
    class="w-28"
    @update:model-value="onNumber"
  />
  <USelect
    v-if="opciones.length > 1"
    :model-value="unidadCodigo"
    :items="opciones.map(u => ({ label: u.codigo, value: u.codigo }))"
    size="sm"
    class="w-20"
    :disabled="disabled"
    @update:model-value="onUnidad"
  />
  <span v-else class="text-xs text-muted">{{ unidadCodigo }}</span>
</div>
```

Al cambiar unidad: `convertirPresentacion` y emitir. `onMounted` → `useUnidadesMedidaStore().ensureLoaded()`.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: AppCantidadInput con stepper y selector de unidad

EOF
)"
```

---

### Task 8: POS — useVenta + CarritoPanel + body

**Files:**
- Modify: `frontend/app/composables/useVenta.ts` (+ spec)
- Modify: `frontend/app/components/ventas/CarritoPanel.vue`
- Modify: `frontend/app/pages/ventas/pos.vue`

**Interfaces:**
```typescript
export interface CarritoLinea {
  item: ItemCatalogo
  cantidad: string
  cantidadPresentacion?: string
  unidadCodigoPresentacion?: string
  // personalizacion existente...
}
```

- [ ] **Step 1: Spec RED** — `agregarLinea` inicia `1` + unidad base; re-agregar: `500 g` + 1 kg → `1500 g`.

- [ ] **Step 2: Implement** — `toCalcularInput` solo canónica.

- [ ] **Step 3: CarritoPanel** — `AppCantidadInput`; precio c/u en unidad base.

- [ ] **Step 4: pos.vue POST** — enviar presentación cuando exista; `ensureLoaded` unidades.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: POS usa cantidad con unidad de presentación

EOF
)"
```

---

### Task 9: Online — CarritoOnline + pagar

**Files:**
- Modify: `frontend/app/components/tienda/CarritoOnline.vue`
- Modify: `frontend/app/composables/useTiendaCarrito.ts`
- Modify: DTO/body online (campos opcionales en líneas, opción A del spec)

- [ ] **Step 1:** Mismo `AppCantidadInput`.

- [ ] **Step 2:** Body de `pagar` incluye presentación (extender DTO online, no solo `CalcularVentaDto` crudo).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: tienda online cantidad con unidad de presentación

EOF
)"
```

---

### Task 10: Salones UI + debounce por línea

**Files:**
- Modify: `frontend/app/composables/useSalones.ts`
- Modify: `frontend/app/pages/salones/index.vue`

- [ ] **Step 1:** Tipos + body API con presentación.

- [ ] **Step 2:** `AppCantidadInput` en lista de líneas.

- [ ] **Step 3: Debounce**

```typescript
const pendingByLinea = new Map<string, ReturnType<typeof setTimeout>>()
const inflight = ref(new Set<string>())

function onCantidadChange(
  linea: CuentaLineaDetalle,
  presentacion: string,
  unidad: string,
  canonica: string,
) {
  // 1. patch optimista en activeCuenta.lineas
  // 2. clearTimeout previo
  // 3. setTimeout 300ms → PATCH
  // 4. inflight; error → syncCuenta restore + toast
}

async function flushPendientes() {
  // await PATCHes antes de cobrar/comanda
}
```

Llamar `flushPendientes` en `enviarComanda` y `confirmarCobro`.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: salones cantidad presentación con debounce seguro

EOF
)"
```

---

### Task 11: Tickets + historial venta

**Files:**
- Modify: `frontend/app/utils/ticket-builder.ts` (+ spec)
- Modify: `frontend/app/components/ventas/VentaDetalleDrawer.vue`
- Modify: call sites `TicketItem` (pos / salones / useImpresoras)

- [ ] **Step 1: Spec** — cantidad `500 g` en línea de ticket.

- [ ] **Step 2:** `formatCantidadTicket` en builders o preformatear al armar items.

- [ ] **Step 3:** Drawer historial muestra presentación.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: tickets e historial muestran unidad de presentación

EOF
)"
```

---

### Task 12: Docs + ESTADO + spec Done

**Files:**
- `docs/features/ventas.md` (+ salones / tienda / impresion-termica)
- `docs/ESTADO.md`
- Spec → `Status: Done`

- [ ] **Step 1:** Documentar modelo, API, UI.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: cantidad de presentación en carrito POS/Salones/Online

EOF
)"
```

---

## Verification

```bash
cd backend && npx jest src/common/utils/cantidad-presentacion.util.spec.ts \
  src/modules/ventas/ventas.service.spec.ts \
  src/modules/salones/salones.service.spec.ts

cd frontend && npx vitest run \
  app/utils/cantidad-presentacion.spec.ts \
  app/composables/useVenta.spec.ts \
  app/utils/ticket-builder.spec.ts
```

Manual:
1. POS kg → 500 g → total mitad; boleta `500 g`.
2. POS unidad → sin selector; − en 1 no elimina.
3. Salones clics rápidos estables; comanda con g.
4. Online materializa presentación en venta.

## Spec coverage

| Spec | Task |
|------|------|
| Schema/DTOs | 1 |
| Validación BE | 2–4 |
| Online | 5, 9 |
| Helpers FE | 6 |
| AppCantidadInput | 7 |
| POS/Online/Salones | 8–10 |
| Debounce | 10 |
| Tickets | 11 |
| Docs | 12 |
| Precio base c/u | 8–10 |
| cantidad_enviada canónica | 4 |
| Recetas conteo | 2–3, 7–8 |
