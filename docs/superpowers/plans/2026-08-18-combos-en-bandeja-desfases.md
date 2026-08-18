# Combos en la bandeja de desfases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft
**Date:** 2026-08-18
**Owner:** Cesar Matheus
**Spec:** [`2026-08-18-combos-en-bandeja-desfases-design.md`](../specs/2026-08-18-combos-en-bandeja-desfases-design.md)

**Goal:** Que un combo cuyo costo de componentes cambió aparezca en la misma bandeja de desfases que
las recetas, con aplicar y descartar, en vez de quedarse con un costo viejo que nadie avisa.

**Architecture:** La bandeja deja de hablar de recetas y habla de *items compuestos* (`tipo:
'receta' | 'combo'`). El costo propuesto de un combo es `Σ(costo_actual cacheado del componente ×
cantidad)` — la misma fórmula que ya usa el alta/edición—, así que un combo **no** se desfasa cuando
se mueve un ingrediente de una receta que contiene, sino cuando se aplica el desfase de esa receta.
Esa segunda pasada la resuelve el propio panel: aplicar devuelve los combos que quedaron desfasados
y los muestra como filas nuevas.

**Tech Stack:** NestJS + TypeORM (SQL raw para `item_combo` / `combo_componentes`), Decimal.js,
Jest + supertest, Nuxt 4 + Nuxt UI, Vitest.

## Global Constraints

- **`tenant_id` sale siempre del token**, nunca del body ni de la query.
- **Dinero con Decimal.js**, nunca `number`. Comparaciones a 4 decimales con el helper `eq4` ya
  existente.
- **Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`** en las tablas que la tienen
  (`items`, `combo_componentes`). `item_producto`, `item_receta` e `item_combo` son extensiones 1:1
  y **no** tienen esa columna: no inventar el filtro ahí.
- **Nunca una query por iteración.** Todo lo que este plan agrega se resuelve en queries batch con
  `WHERE ... = ANY($n::uuid[])`.
- **No tocar el motor de cálculo de precios** (`calculo-precios.engine.ts`) ni
  `movimientos_inventario`. Este trabajo no los necesita.
- **El pre-commit exige el recibo de la revisión independiente** (`verify-feature` paso 7) para
  cualquier diff que toque services de backend o `.vue` de `pages`/`components`. Las tareas 1 a 4
  tocan ambos: cada una corre esa revisión antes de commitear. No usar `--no-verify`.
- **Antes de cualquier `npm run test:e2e`: `./scripts/reset-db.sh`** (~30s). Y **no editar ningún
  `.ts` del backend con el e2e corriendo**: el compose recompila, reinicia y vuelve a sembrar, y
  salen decenas de fallos que no son regresiones.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/items/desfases.controller.ts` | Rutas `/desfases` (reemplaza a `recetas-desfases.controller.ts`) | 1 |
| `backend/src/modules/items/dto/query-desfases.dto.ts` | `insumoItemId` | 1 |
| `backend/src/modules/items/dto/aplicar-desfases.dto.ts` | `itemId` | 1 |
| `backend/src/modules/items/dto/descartar-desfases.dto.ts` | `itemIds` | 1 |
| `backend/src/modules/items/items.service.ts` | `DesfaseItemDto`, lectura, aplicar y descartar | 1, 2, 3 |
| `backend/src/modules/items/entities/item-combo.entity.ts` | Columna `costoPropuestoOmitido` | 2 |
| `startup-pos.sql` | Columna `costo_propuesto_omitido` en `item_combo` | 2 |
| `frontend/app/components/DesfasesPanel.vue` | Panel con columna Tipo (reemplaza a `RecetasDesfasesPanel.vue`) | 1, 4 |
| `frontend/app/composables/useSimuladorDesfases.ts` | Llamadas y segunda pasada | 1, 4 |
| `frontend/app/pages/desfases.vue` | Bandeja (reemplaza a `recetas-desfases.vue`) | 1, 4 |

---

## Task 1: Renombrar la bandeja de "recetas" a "items compuestos"

Renombre puro: al terminar, todo hace exactamente lo mismo que hoy con nombres nuevos. Ningún
combo entra todavía. Es lo que deja el terreno para las tareas 2 y 3 sin mezclar el renombre con la
lógica nueva.

**Files:**
- Rename: `backend/src/modules/items/recetas-desfases.controller.ts` → `desfases.controller.ts`
- Modify: `backend/src/modules/items/items.service.ts:85-102` (interfaces), `:3738` (`construirFilasDesfase`), `:3842` (`listarDesfases`), `:3849` (`recetasAfectadasPorIngrediente`), `:3863` (`aplicarDesfases`), `:3967` (`descartarDesfases`)
- Modify: `backend/src/modules/items/dto/query-desfases.dto.ts`, `dto/aplicar-desfases.dto.ts`, `dto/descartar-desfases.dto.ts`
- Modify: `backend/src/modules/items/items.controller.ts:36-41`
- Modify: `backend/src/modules/items/items.module.ts:40`
- Test: `backend/src/modules/items/items.service.spec.ts:4515-4847`
- Test: `backend/test/simulador-costos.e2e-spec.ts`
- Modify (frontend): `app/components/RecetasDesfasesPanel.vue`, `app/composables/useSimuladorDesfases.ts`, `app/pages/recetas-desfases.vue`, `app/pages/configuracion/items.vue:988`, `app/pages/inventario/index.vue`

**Interfaces:**
- Produces:
  - `export interface DesfaseItemDto { itemId: string; nombre: string; costoActual: string; costoPropuesto: string; deltaCosto: string; precioBase: string; margenPctActual: string | null; margenPctPropuesto: string | null; precioSugerido: string | null; afectados: DesfaseInsumoDto[] }`
  - `export interface DesfaseInsumoDto { itemId: string; nombre: string; costoActual: string | null }` (era `DesfaseIngredienteDto`)
  - `ItemsService.listarDesfases(tenantId: string, insumoItemId?: string): Promise<DesfaseItemDto[]>`
  - `ItemsService.itemsAfectadosPorInsumo(tenantId: string, insumoItemId: string): Promise<DesfaseItemDto[]>`
  - `ItemsService.aplicarDesfases(tenantId: string, items: { itemId: string; actualizarPrecio?: boolean; precioBase?: string }[]): Promise<{ aplicados: number }>`
  - `ItemsService.descartarDesfases(tenantId: string, itemIds: string[]): Promise<{ descartados: number }>`
  - Rutas: `GET /api/desfases?insumoItemId=`, `POST /api/desfases/aplicar`, `POST /api/desfases/descartar`, `GET /api/items/:id/afectados`

- [ ] **Step 1: Actualizar los tests unitarios a los nombres nuevos**

En `items.service.spec.ts`, dentro de `describe('desfases de costo de recetas', ...)` (línea 4515):
renombrar el describe a `'desfases de costo'` y reemplazar en todo el bloque `recetaItemId` por
`itemId` en las aserciones sobre las filas devueltas, `recetasAfectadasPorIngrediente(` por
`itemsAfectadosPorInsumo(`, `ingredientesAfectados` por `afectados`, y el argumento de
`aplicarDesfases` de `{ recetaItemId: RECETA_ID }` a `{ itemId: RECETA_ID }`.

Los mocks de `dataSource.query` **no cambian**: siguen devolviendo filas con `receta_item_id`,
porque las columnas de la base no se tocan en esta tarea.

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
cd backend && npm test -- items.service.spec.ts
```

Esperado: FAIL. Los que llaman `service.itemsAfectadosPorInsumo` fallan con
`service.itemsAfectadosPorInsumo is not a function`; los que afirman sobre `itemId` fallan con
`undefined`.

- [ ] **Step 3: Renombrar las interfaces del service**

En `items.service.ts`, reemplazar el bloque de las líneas 85-102 por:

```typescript
export interface DesfaseInsumoDto {
  itemId: string;
  nombre: string;
  costoActual: string | null;
}

export interface DesfaseItemDto {
  itemId: string;
  nombre: string;
  costoActual: string;
  costoPropuesto: string;
  deltaCosto: string;
  precioBase: string;
  margenPctActual: string | null;
  margenPctPropuesto: string | null;
  precioSugerido: string | null;
  afectados: DesfaseInsumoDto[];
}
```

Y en `construirFilasDesfase` (línea 3738) cambiar el tipo de retorno a `DesfaseItemDto[]`, el
parámetro `ingredienteItemId` a `insumoItemId`, y el objeto que se empuja a `out`:

```typescript
      out.push({
        itemId: cab.receta_item_id,
        nombre: cab.nombre,
        costoActual: cacheado,
        costoPropuesto: propuesto,
        deltaCosto: costoPropD.minus(costoActualD).toFixed(4),
        precioBase: precio.toFixed(4),
        margenPctActual: mAct?.toFixed(4) ?? null,
        margenPctPropuesto: mProp?.toFixed(4) ?? null,
        precioSugerido: sug?.toFixed(4) ?? null,
        afectados: lista.map((i) => ({
          itemId: i.ingrediente_item_id,
          nombre: i.ingrediente_nombre,
          costoActual: i.costo_actual,
        })),
      });
```

- [ ] **Step 4: Renombrar los métodos públicos del service**

`listarDesfases(tenantId, ingredienteItemId?)` → `listarDesfases(tenantId, insumoItemId?)`.

`recetasAfectadasPorIngrediente` → `itemsAfectadosPorInsumo`, con el mismo cuerpo (el guard de
`tipo = 'ingrediente'` se relaja recién en la Tarea 2).

En `aplicarDesfases`, cambiar la firma y todos los usos internos de `it.recetaItemId` a `it.itemId`:

```typescript
  async aplicarDesfases(
    tenantId: string,
    items: {
      itemId: string;
      actualizarPrecio?: boolean;
      precioBase?: string;
    }[],
  ): Promise<{ aplicados: number }> {
```

En `descartarDesfases`, `recetaItemIds: string[]` → `itemIds: string[]`, y adentro
`for (const itemId of itemIds)`.

Los mensajes de error mantienen la palabra "receta" (`Receta ${itemId} no encontrada`): en esta
tarea solo hay recetas. La Tarea 3 los generaliza.

- [ ] **Step 5: Renombrar los DTOs**

`dto/query-desfases.dto.ts`:

```typescript
import { IsOptional, IsUUID } from 'class-validator';

export class QueryDesfasesDto {
  @IsUUID()
  @IsOptional()
  insumoItemId?: string;
}
```

`dto/descartar-desfases.dto.ts`:

```typescript
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class DescartarDesfasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  itemIds: string[];
}
```

En `dto/aplicar-desfases.dto.ts`, `recetaItemId` → `itemId`. **El comentario de `precioBase` sobre
por qué es `>= 0` y no `> 0` se conserva tal cual**: sigue siendo cierto y explica una decisión que
no es obvia.

- [ ] **Step 6: Renombrar el controller y registrarlo**

`git mv backend/src/modules/items/recetas-desfases.controller.ts backend/src/modules/items/desfases.controller.ts`,
y adentro:

```typescript
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('desfases')
export class DesfasesController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @RequiresPermiso('Items', 'Leer')
  listar(@Req() req: Request, @Query() query: QueryDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.listarDesfases(tenantId, query.insumoItemId);
  }

  @Post('aplicar')
  @RequiresPermiso('Items', 'Actualizar')
  aplicar(@Req() req: Request, @Body() dto: AplicarDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.aplicarDesfases(tenantId, dto.items);
  }

  @Post('descartar')
  @RequiresPermiso('Items', 'Actualizar')
  descartar(@Req() req: Request, @Body() dto: DescartarDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.descartarDesfases(tenantId, dto.itemIds);
  }
}
```

En `items.module.ts:40`: `controllers: [ItemsController, DesfasesController]`, con el import
actualizado.

En `items.controller.ts:36-41`:

```typescript
  @Get(':id/afectados')
  @RequiresPermiso('Items', 'Leer')
  afectados(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.itemsAfectadosPorInsumo(tenantId, id);
  }
```

⚠️ Esta ruta tiene que seguir declarada **antes** de `@Get(':id')` (línea 43) o Nest resuelve
`/items/algo/afectados` por el comodín. No moverla de lugar.

El comentario de `:id/uso` que menciona `:id/recetas-afectadas` como "ruta hermana"
(`items.controller.ts:76`) se actualiza a `:id/afectados`.

- [ ] **Step 7: Correr los tests unitarios y verificar que pasan**

```bash
cd backend && npm test -- items.service.spec.ts && npm run lint:check && npm run typecheck
```

Esperado: PASS en los tres.

- [ ] **Step 8: Actualizar el e2e a las rutas nuevas**

En `backend/test/simulador-costos.e2e-spec.ts`: `interface DesfaseRecetaResponse` → `DesfaseItemResponse`
con `itemId` en vez de `recetaItemId`; `/api/items/${carneId}/recetas-afectadas` →
`/api/items/${carneId}/afectados`; `/api/recetas/desfases/aplicar` → `/api/desfases/aplicar` con
`items: [{ itemId: recetaId, ... }]`; `/api/recetas/desfases` → `/api/desfases`;
`/api/recetas/desfases/descartar` → `/api/desfases/descartar` con `{ itemIds: [...] }`.

- [ ] **Step 9: Correr el e2e**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

Esperado: PASS. La suite entera, no solo `simulador-costos`: el renombre de rutas puede pegarle a
cualquier spec que las use.

- [ ] **Step 10: Actualizar el frontend a los nombres nuevos**

Sin renombrar todavía archivos ni rutas de página — solo campos y endpoints, para que la app siga
funcionando:

- `components/RecetasDesfasesPanel.vue`: `DesfaseRecetaDto` → `DesfaseItemDto` con `itemId` y
  `afectados`; `AplicarDesfaseItem.recetaItemId` → `itemId`. Reemplazar `f.recetaItemId` por
  `f.itemId` en `initFromFilas`, `allSelected`, `someSelected`, `toggleAll`, `onAplicar`,
  `onDescartar` y el `:key` del `v-for`; `fila.ingredientesAfectados` por `fila.afectados` en
  `isHighlighted` y en el template. El emit pasa a ser `descartar: [itemIds: string[]]`.
- `composables/useSimuladorDesfases.ts`: `/items/${productoId}/recetas-afectadas` →
  `/items/${productoId}/afectados`; `/recetas/desfases/aplicar` → `/desfases/aplicar`;
  `/recetas/desfases/descartar` → `/desfases/descartar` con body `{ itemIds }`; el `byId` de
  `onAplicarDesfases` mapea por `a.itemId` y compara contra `fila.itemId`.
- `pages/recetas-desfases.vue`: los tres endpoints y el body de descartar.
- `pages/configuracion/items.vue:988` (`syncDesfaseEnLista`) y `pages/inventario/index.vue`: los
  campos renombrados.

- [ ] **Step 11: Verificar el frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Esperado: PASS en los cuatro.

- [ ] **Step 12: Revisión independiente y commit**

Correr el paso 7 del skill `verify-feature` (sub-agente `domain-reviewer` sobre el diff completo) —
el pre-commit lo exige porque el diff toca un service de backend y `.vue` de `pages`/`components`.

```bash
git add -A && git commit -m "refactor(desfases): la bandeja habla de items compuestos, no de recetas"
```

---

## Task 2: Un combo desfasado aparece en la bandeja

**Files:**
- Modify: `startup-pos.sql` (tabla `item_combo`, línea 640)
- Modify: `backend/src/modules/items/entities/item-combo.entity.ts`
- Modify: `backend/src/modules/items/items.service.ts` (`construirFilasDesfase`, `itemsAfectadosPorInsumo`)
- Test: `backend/src/modules/items/items.service.spec.ts`
- Test: `backend/test/simulador-costos.e2e-spec.ts`

**Interfaces:**
- Consumes: `DesfaseItemDto`, `DesfaseInsumoDto` (Tarea 1)
- Produces:
  - `DesfaseItemDto` gana `tipo: 'receta' | 'combo'`
  - `private costoPropuestoCombo(comps: { cantidad: string; costo_actual: string | null }[]): string`
  - `private filasDesfaseRecetas(tenantId: string, insumoItemId?: string): Promise<DesfaseItemDto[]>` (el cuerpo actual de `construirFilasDesfase`)
  - `private filasDesfaseCombos(runner: DataSource | EntityManager, tenantId: string, opts: { insumoItemId?: string; comboItemIds?: string[] }): Promise<DesfaseItemDto[]>`

- [ ] **Step 1: Escribir el test que falla — el combo aparece cuando sube un componente producto**

En `items.service.spec.ts`, dentro del describe `'desfases de costo'`, agregar:

```typescript
    const COMBO_ID = 'combo-1';
    const PAPAS_ID = 'papas-1';

    /** El combo del seed: 1 Hamburguesa (receta, $1.200) + 1 Papas (producto). */
    function mockComboConComponentes(opts: {
      costoCacheado: string;
      omitido: string | null;
      precioBase: string;
      costoPapas: string;
    }) {
      // 1) cabeceras de recetas: vacío, así el bloque de recetas no aporta filas
      dataSource.query.mockResolvedValueOnce([]);
      // 2) cabeceras de combos
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          nombre: 'Combo Clásico',
          costo_actual: opts.costoCacheado,
          costo_propuesto_omitido: opts.omitido,
          precio_base: opts.precioBase,
        },
      ]);
      // 3) componentes del combo
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          componente_item_id: RECETA_ID,
          componente_nombre: 'Hamburguesa',
          cantidad: '1',
          costo_actual: '1200.0000',
        },
        {
          combo_item_id: COMBO_ID,
          componente_item_id: PAPAS_ID,
          componente_nombre: 'Papas fritas',
          cantidad: '1',
          costo_actual: opts.costoPapas,
        },
      ]);
    }

    it('listarDesfases incluye el combo cuando sube un componente producto', async () => {
      mockComboConComponentes({
        costoCacheado: '1700.0000',
        omitido: null,
        precioBase: '4200.0000',
        costoPapas: '600.0000',
      });

      const rows = await service.listarDesfases(TENANT);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.itemId).toBe(COMBO_ID);
      expect(rows[0]!.tipo).toBe('combo');
      expect(rows[0]!.costoActual).toBe('1700.0000');
      expect(rows[0]!.costoPropuesto).toBe('1800.0000');
      expect(rows[0]!.deltaCosto).toBe('100.0000');
      expect(rows[0]!.afectados.map((a) => a.itemId)).toEqual([
        RECETA_ID,
        PAPAS_ID,
      ]);
    });

    it('listarDesfases NO incluye el combo mientras la receta que contiene sigue sin aplicarse', async () => {
      // La carne subió: la Hamburguesa propone 1350, pero su CACHEADO sigue en
      // 1200, así que la Σ del combo no se movió. Es la Decisión 1 del spec.
      mockComboConComponentes({
        costoCacheado: '1700.0000',
        omitido: null,
        precioBase: '4200.0000',
        costoPapas: '500.0000',
      });

      const rows = await service.listarDesfases(TENANT);

      expect(rows).toHaveLength(0);
    });

    it('listarDesfases omite el combo cuando propuesto == costo_propuesto_omitido', async () => {
      mockComboConComponentes({
        costoCacheado: '1700.0000',
        omitido: '1800.0000',
        precioBase: '4200.0000',
        costoPapas: '600.0000',
      });

      const rows = await service.listarDesfases(TENANT);

      expect(rows).toHaveLength(0);
    });

    it('un componente servicio aporta 0 y no rompe la fila', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          nombre: 'Combo con servicio',
          costo_actual: '500.0000',
          costo_propuesto_omitido: null,
          precio_base: '4200.0000',
        },
      ]);
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          componente_item_id: PAPAS_ID,
          componente_nombre: 'Papas fritas',
          cantidad: '1',
          costo_actual: '600.0000',
        },
        {
          combo_item_id: COMBO_ID,
          componente_item_id: 'servicio-1',
          componente_nombre: 'Delivery',
          cantidad: '1',
          costo_actual: null,
        },
      ]);

      const rows = await service.listarDesfases(TENANT);

      expect(rows[0]!.costoPropuesto).toBe('600.0000');
      expect(rows[0]!.afectados[1]!.costoActual).toBeNull();
    });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
cd backend && npm test -- items.service.spec.ts -t "combo"
```

Esperado: FAIL. `listarDesfases` devuelve `[]` porque hoy solo consulta recetas, y `tipo` no existe
en el DTO.

- [ ] **Step 3: Agregar la columna a la base y a la entidad**

En `startup-pos.sql`, la tabla `item_combo` (línea 640) queda:

```sql
CREATE TABLE "item_combo" (
  "item_id"      UUID PRIMARY KEY REFERENCES "items" ("item_id"),
  "costo_actual" NUMERIC(18,4),  -- Σ(costo componente × cantidad); cacheado, no se recalcula solo
  "costo_propuesto_omitido" NUMERIC(18,4)
  -- Snapshot del costo propuesto descartado por el usuario; NULL = sin omisión.
  -- Espejo de la columna homónima de `item_receta`: la bandeja oculta el combo
  -- mientras el propuesto actual == este valor.
);
```

En `entities/item-combo.entity.ts`, agregar debajo de `costoActual`:

```typescript
  @Column({
    name: 'costo_propuesto_omitido',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoPropuestoOmitido: string | null;
```

`ItemCombo` ya está registrada en el array `entities` de `app.module.ts:209` — no hay nada que
agregar ahí.

- [ ] **Step 4: Agregar `tipo` al DTO y partir `construirFilasDesfase` en dos**

En `items.service.ts`, agregar a `DesfaseItemDto` como primer campo después de `itemId`:

```typescript
  tipo: 'receta' | 'combo';
```

Renombrar el método `construirFilasDesfase` actual a `filasDesfaseRecetas` (mismo cuerpo, y en el
`out.push` agregar `tipo: 'receta',`), y crear el nuevo orquestador:

```typescript
  private async construirFilasDesfase(
    tenantId: string,
    insumoItemId?: string,
  ): Promise<DesfaseItemDto[]> {
    // Dos bloques de 2 queries cada uno, no una query por item: el costo de un
    // combo se arma con los costos YA cacheados de sus componentes, así que no
    // hace falta expandir nada.
    const recetas = await this.filasDesfaseRecetas(tenantId, insumoItemId);
    const combos = await this.filasDesfaseCombos(this.dataSource, tenantId, {
      insumoItemId,
    });
    return [...recetas, ...combos].sort((a, b) =>
      a.nombre.localeCompare(b.nombre),
    );
  }
```

- [ ] **Step 5: Implementar el costo propuesto de un combo**

```typescript
  /**
   * Costo propuesto de un combo: Σ(costo cacheado del componente × cantidad),
   * la misma fórmula de `validarYCostearComponentes`. A diferencia de
   * `costoPropuesto` (recetas) **nunca devuelve null**: no hay conversión de
   * unidades acá, así que el caso "sin costo proponible" no existe. Un
   * componente `servicio` no tiene costo y aporta 0, igual que al armar el combo.
   */
  private costoPropuestoCombo(
    comps: { cantidad: string; costo_actual: string | null }[],
  ): string {
    let total = new Decimal(0);
    for (const c of comps) {
      total = total.plus(new Decimal(c.costo_actual ?? '0').mul(c.cantidad));
    }
    return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  }
```

- [ ] **Step 6: Implementar `filasDesfaseCombos`**

```typescript
  /**
   * `runner` es el `DataSource` en la lectura y el `EntityManager` de la
   * transacción cuando `aplicarDesfases` necesita ver sus propias escrituras.
   */
  private async filasDesfaseCombos(
    runner: DataSource | EntityManager,
    tenantId: string,
    opts: { insumoItemId?: string; comboItemIds?: string[] },
  ): Promise<DesfaseItemDto[]> {
    const filtros: string[] = [];
    const params: unknown[] = [tenantId];
    let join = '';
    if (opts.insumoItemId) {
      join = `JOIN combo_componentes cc ON cc.combo_item_id = i.item_id
                AND cc.eliminado_el IS NULL`;
      params.push(opts.insumoItemId);
      filtros.push(`cc.componente_item_id = $${params.length}`);
    }
    if (opts.comboItemIds) {
      if (!opts.comboItemIds.length) return [];
      params.push(opts.comboItemIds);
      filtros.push(`i.item_id = ANY($${params.length}::uuid[])`);
    }

    const cabeceras: {
      combo_item_id: string;
      nombre: string;
      costo_actual: string | null;
      costo_propuesto_omitido: string | null;
      precio_base: string;
    }[] = await runner.query(
      `SELECT DISTINCT i.item_id AS combo_item_id, i.nombre,
              ic.costo_actual, ic.costo_propuesto_omitido, i.precio_base
         FROM items i
         JOIN item_combo ic ON ic.item_id = i.item_id
         ${join}
        WHERE i.tenant_id = $1 AND i.tipo = 'combo' AND i.eliminado_el IS NULL
          ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
        ORDER BY i.nombre`,
      params,
    );
    if (!cabeceras.length) return [];

    const ids = cabeceras.map((c) => c.combo_item_id);
    const comps: {
      combo_item_id: string;
      componente_item_id: string;
      componente_nombre: string;
      cantidad: string;
      costo_actual: string | null;
    }[] = await runner.query(
      `SELECT cc.combo_item_id, cc.componente_item_id,
              comp.nombre AS componente_nombre, cc.cantidad,
              COALESCE(ip.costo_actual, ir.costo_actual) AS costo_actual
         FROM combo_componentes cc
         JOIN items comp ON comp.item_id = cc.componente_item_id
          AND comp.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
         LEFT JOIN item_receta ir ON ir.item_id = cc.componente_item_id
        WHERE cc.tenant_id = $1 AND cc.eliminado_el IS NULL
          AND cc.combo_item_id = ANY($2::uuid[])`,
      [tenantId, ids],
    );

    const porCombo = new Map<string, typeof comps>();
    for (const row of comps) {
      const list = porCombo.get(row.combo_item_id) ?? [];
      list.push(row);
      porCombo.set(row.combo_item_id, list);
    }

    const out: DesfaseItemDto[] = [];
    for (const cab of cabeceras) {
      const lista = porCombo.get(cab.combo_item_id) ?? [];
      // Mismo guard que las recetas sin ingredientes: un combo sin componentes
      // vivos no tiene costo que proponer.
      if (!lista.length) continue;
      const propuesto = this.costoPropuestoCombo(lista);
      const cacheado = new Decimal(cab.costo_actual ?? '0').toFixed(4);
      if (this.eq4(propuesto, cacheado)) continue;
      if (
        cab.costo_propuesto_omitido != null &&
        this.eq4(propuesto, cab.costo_propuesto_omitido)
      ) {
        continue;
      }

      const precio = new Decimal(cab.precio_base);
      const costoActualD = new Decimal(cacheado);
      const costoPropD = new Decimal(propuesto);

      out.push({
        itemId: cab.combo_item_id,
        tipo: 'combo',
        nombre: cab.nombre,
        costoActual: cacheado,
        costoPropuesto: propuesto,
        deltaCosto: costoPropD.minus(costoActualD).toFixed(4),
        precioBase: precio.toFixed(4),
        margenPctActual: this.margenPct(precio, costoActualD)?.toFixed(4) ?? null,
        margenPctPropuesto: this.margenPct(precio, costoPropD)?.toFixed(4) ?? null,
        precioSugerido:
          this.precioSugerido(precio, costoActualD, costoPropD)?.toFixed(4) ??
          null,
        afectados: lista.map((c) => ({
          itemId: c.componente_item_id,
          nombre: c.componente_nombre,
          costoActual: c.costo_actual,
        })),
      });
    }
    return out;
  }
```

ℹ️ `validarYCostearComponentes` guarda el costo con `.toDecimalPlaces(4).toString()` y acá se
compara con `.toFixed(4)`; no hay falso desfase porque `eq4` compara Decimals y porque la columna
es `NUMERIC(18,4)`. **No "arreglar" ese formateo en esta tarea**: está fuera del alcance pedido.

- [ ] **Step 7: Relajar el guard de `itemsAfectadosPorInsumo`**

```typescript
  async itemsAfectadosPorInsumo(
    tenantId: string,
    insumoItemId: string,
  ): Promise<DesfaseItemDto[]> {
    // `ingrediente` y `producto` son tipos distintos y sus caminos no se cruzan:
    // una receta solo lleva ingredientes, y un componente de combo solo puede
    // ser producto, receta o servicio. Con el guard viejo (`= 'ingrediente'`)
    // comprar un producto devolvía 404 y el frontend se lo tragaba: ningún
    // modal se abría nunca para un componente de combo.
    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items
     WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       AND tipo IN ('ingrediente', 'producto')`,
      [insumoItemId, tenantId],
    );
    if (!exists.length) throw new NotFoundException('Item no encontrado');
    return this.construirFilasDesfase(tenantId, insumoItemId);
  }
```

- [ ] **Step 8: Correr los tests unitarios y verificar que pasan**

```bash
cd backend && npm test -- items.service.spec.ts && npm run lint:check && npm run typecheck
```

Esperado: PASS. Si los tests viejos de recetas fallan por el orden de los mocks, revisar que
`filasDesfaseRecetas` siga consumiendo sus 2 queries **antes** que las 2 de combos.

- [ ] **Step 9: Agregar el recorrido e2e de lectura**

En `backend/test/simulador-costos.e2e-spec.ts`, agregar un `it` que cree un producto y un combo
que lo contenga, mueva el costo del producto por compra, y verifique las dos puertas:

```typescript
  it('combo: sube un componente producto → aparece en afectados y en la bandeja', async () => {
    const sufijo = Date.now();
    const resProd = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Papas E2E ${sufijo}`,
        precioBase: '1500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'un',
        stock: '10',
        costo: '500',
      });
    expect(resProd.status).toBe(201);
    const papasId = resProd.body.id as string;

    const resCombo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo E2E ${sufijo}`,
        precioBase: '4200',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: papasId, cantidad: '1', bloqueante: true },
        ],
      });
    expect(resCombo.status).toBe(201);
    const comboId = resCombo.body.id as string;
    // costo cacheado = 500

    await request(app.getHttpServer())
      .patch(`/api/items/${papasId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '700',
      })
      .expect(200);

    // Antes de esta tarea este GET respondía 404: `papasId` es `tipo='producto'`.
    const afectados = await request(app.getHttpServer())
      .get(`/api/items/${papasId}/afectados`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const fila = (afectados.body as DesfaseItemResponse[]).find(
      (r) => r.itemId === comboId,
    );
    expect(fila).toBeDefined();
    expect(fila!.tipo).toBe('combo');

    const bandeja = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (bandeja.body as DesfaseItemResponse[]).some((r) => r.itemId === comboId),
    ).toBe(true);
  });
```

Agregar `tipo: 'receta' | 'combo'` a la interfaz `DesfaseItemResponse` del archivo.

⚠️ El costo propuesto **no** se hardcodea a `'700.0000'`: el CPP de la compra depende del stock
previo, y el test no debe afirmar sobre la fórmula del costeo. Lo que se afirma es que el combo
aparece; la aritmética exacta la cubre el unit test del Step 1.

- [ ] **Step 10: Correr el e2e**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

Esperado: PASS, la suite entera.

- [ ] **Step 11: Revisión independiente y commit**

Correr el paso 7 de `verify-feature` sobre el diff.

```bash
git add -A && git commit -m "feat(desfases): un combo con un componente más caro entra a la bandeja"
```

---

## Task 3: Aplicar y descartar un combo

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`aplicarDesfases`, `descartarDesfases`, `cabecerasReceta`)
- Test: `backend/src/modules/items/items.service.spec.ts`
- Test: `backend/test/simulador-costos.e2e-spec.ts`

**Interfaces:**
- Consumes: `filasDesfaseCombos`, `costoPropuestoCombo`, `DesfaseItemDto` (Tarea 2)
- Produces:
  - `ItemsService.aplicarDesfases(...): Promise<{ aplicados: number; omitidos: { itemId: string; nombre: string; motivo: string }[]; afectados: DesfaseItemDto[] }>`
  - `private cabecerasCompuestas(manager: EntityManager, tenantId: string, ids: string[]): Promise<Map<string, { tipo: 'receta' | 'combo'; nombre: string }>>` (reemplaza a `cabecerasReceta`)
  - `private componentesPorCombo(manager: EntityManager, tenantId: string, comboIds: string[]): Promise<Map<string, { componente_item_id: string; cantidad: string; costo_actual: string | null }[]>>`

- [ ] **Step 1: Escribir los tests que fallan**

En el describe `'aplicarDesfases / descartarDesfases'` (línea 4674), agregar los cuatro tests. Las
secuencias de `manager.query.mockResolvedValueOnce` de abajo son el orden exacto de queries que la
implementación del Step 4 tiene que producir: si al implementar el orden sale distinto, se corrige
el mock, **no la aserción**.

```typescript
      it('aplicar un combo escribe Σ de los costos cacheados de sus componentes', async () => {
        manager.query
          .mockResolvedValueOnce([]) // 1) lock item_receta
          .mockResolvedValueOnce([]) // 2) lock item_combo
          .mockResolvedValueOnce([   // 3) cabecerasCompuestas
            { item_id: COMBO_ID, tipo: 'combo', nombre: 'Combo Clásico' },
          ])
          // sin recetas en el lote: `ingredientesPorReceta` retorna sin consultar
          .mockResolvedValueOnce([   // 4) componentesPorCombo
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              cantidad: '2',
              costo_actual: '600.0000',
            },
          ])
          .mockResolvedValueOnce([]); // 5) UPDATE item_combo

        const result = await service.aplicarDesfases(TENANT, [
          { itemId: COMBO_ID },
        ]);

        expect(result.aplicados).toBe(1);
        const update = manager.query.mock.calls.find((c) =>
          String(c[0]).includes('UPDATE item_combo'),
        );
        expect(update).toBeDefined();
        expect(String(update![0])).toContain('costo_propuesto_omitido = NULL');
        expect((update![1] as unknown[])[0]).toBe('1200.0000');
        // Y no hubo consulta de afectados: no se aplicó ninguna receta.
        expect(result.afectados).toEqual([]);
      });

      it('el lote que mezcla una receta con el combo que la contiene omite el combo', async () => {
        manager.query
          .mockResolvedValueOnce([]) // 1) lock item_receta
          .mockResolvedValueOnce([]) // 2) lock item_combo
          .mockResolvedValueOnce([   // 3) cabecerasCompuestas
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
            { item_id: COMBO_ID, tipo: 'combo', nombre: 'Combo Clásico' },
          ])
          .mockResolvedValueOnce([   // 4) ingredientesPorReceta
            {
              receta_item_id: RECETA_ID,
              cantidad: '150',
              unidad_codigo: 'g',
              unidad_base: 'kg',
              costo_actual: '9000',
            },
          ])
          .mockResolvedValueOnce([]) // 5) UPDATE item_receta
          .mockResolvedValueOnce([   // 6) componentesPorCombo
            {
              combo_item_id: COMBO_ID,
              componente_item_id: RECETA_ID,
              cantidad: '1',
              costo_actual: '1200.0000',
            },
          ])
          .mockResolvedValueOnce([   // 7) combos candidatos de `afectados`
            { combo_item_id: COMBO_ID },
          ])
          .mockResolvedValueOnce([   // 8) filasDesfaseCombos: cabeceras
            {
              combo_item_id: COMBO_ID,
              nombre: 'Combo Clásico',
              costo_actual: '1700.0000',
              costo_propuesto_omitido: null,
              precio_base: '4200.0000',
            },
          ])
          .mockResolvedValueOnce([   // 9) filasDesfaseCombos: componentes
            {
              combo_item_id: COMBO_ID,
              componente_item_id: RECETA_ID,
              componente_nombre: 'Hamburguesa',
              cantidad: '1',
              costo_actual: '1350.0000',
            },
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              componente_nombre: 'Papas fritas',
              cantidad: '1',
              costo_actual: '500.0000',
            },
          ]);

        const result = await service.aplicarDesfases(TENANT, [
          { itemId: RECETA_ID },
          { itemId: COMBO_ID },
        ]);

        expect(result.aplicados).toBe(1);
        expect(result.omitidos).toHaveLength(1);
        expect(result.omitidos[0]!.itemId).toBe(COMBO_ID);
        expect(result.omitidos[0]!.nombre).toBe('Combo Clásico');
        expect(
          manager.query.mock.calls.some((c) =>
            String(c[0]).includes('UPDATE item_combo'),
          ),
        ).toBe(false);
        // El combo vuelve con el número correcto: 1350 + 500.
        expect(result.afectados).toHaveLength(1);
        expect(result.afectados[0]!.costoPropuesto).toBe('1850.0000');
      });

      it('aplicar una receta devuelve en afectados los combos que la contienen', async () => {
        manager.query
          .mockResolvedValueOnce([]) // 1) lock item_receta
          .mockResolvedValueOnce([]) // 2) lock item_combo
          .mockResolvedValueOnce([   // 3) cabecerasCompuestas
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
          ])
          .mockResolvedValueOnce([   // 4) ingredientesPorReceta
            {
              receta_item_id: RECETA_ID,
              cantidad: '150',
              unidad_codigo: 'g',
              unidad_base: 'kg',
              costo_actual: '9000',
            },
          ])
          .mockResolvedValueOnce([]) // 5) UPDATE item_receta
          // sin combos en el lote: `componentesPorCombo` retorna sin consultar
          .mockResolvedValueOnce([{ combo_item_id: COMBO_ID }]) // 6) candidatos
          .mockResolvedValueOnce([   // 7) filasDesfaseCombos: cabeceras
            {
              combo_item_id: COMBO_ID,
              nombre: 'Combo Clásico',
              costo_actual: '1700.0000',
              costo_propuesto_omitido: null,
              precio_base: '4200.0000',
            },
          ])
          .mockResolvedValueOnce([   // 8) filasDesfaseCombos: componentes
            {
              combo_item_id: COMBO_ID,
              componente_item_id: RECETA_ID,
              componente_nombre: 'Hamburguesa',
              cantidad: '1',
              costo_actual: '1350.0000',
            },
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              componente_nombre: 'Papas fritas',
              cantidad: '1',
              costo_actual: '500.0000',
            },
          ]);

        const result = await service.aplicarDesfases(TENANT, [
          { itemId: RECETA_ID },
        ]);

        expect(result.afectados.map((f) => f.itemId)).toContain(COMBO_ID);
        expect(result.afectados[0]!.tipo).toBe('combo');
      });

      it('descartar un combo guarda el propuesto en item_combo', async () => {
        manager.query
          .mockResolvedValueOnce([   // 1) cabecerasCompuestas
            { item_id: COMBO_ID, tipo: 'combo', nombre: 'Combo Clásico' },
          ])
          // sin recetas en el lote: `ingredientesPorReceta` retorna sin consultar
          .mockResolvedValueOnce([   // 2) componentesPorCombo
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              cantidad: '1',
              costo_actual: '600.0000',
            },
          ])
          .mockResolvedValueOnce([]); // 3) UPDATE item_combo

        const result = await service.descartarDesfases(TENANT, [COMBO_ID]);

        expect(result.descartados).toBe(1);
        const update = manager.query.mock.calls.find((c) =>
          String(c[0]).includes('UPDATE item_combo'),
        );
        expect(update).toBeDefined();
        expect(String(update![0])).toContain('costo_propuesto_omitido = $1');
        expect((update![1] as unknown[])[0]).toBe('600.0000');
      });
```

⚠️ El `toContain('UPDATE item_combo')` matchea el SQL **funcional**, no un comentario: las queries
de este service no llevan comentarios SQL embebidos. Si al implementar se agrega uno, acotar el
matcher a la cláusula.

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
cd backend && npm test -- items.service.spec.ts -t "combo"
```

Esperado: FAIL — `result.omitidos` y `result.afectados` son `undefined`, y no hay ningún
`UPDATE item_combo`.

- [ ] **Step 3: Generalizar los helpers de cabecera y agregar el de componentes**

Reemplazar `cabecerasReceta` (línea 3615) por:

```typescript
  /**
   * `item_id → { tipo, nombre }` de los items compuestos pedidos, en una query.
   * Ausente = no existe. El nombre viene de acá y no de una query aparte porque
   * lo necesita el motivo de `omitidos`.
   */
  private async cabecerasCompuestas(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, { tipo: 'receta' | 'combo'; nombre: string }>> {
    if (!ids.length) return new Map();
    const rows: { item_id: string; tipo: 'receta' | 'combo'; nombre: string }[] =
      await manager.query(
        `SELECT i.item_id, i.tipo, i.nombre
           FROM items i
          WHERE i.item_id = ANY($1::uuid[]) AND i.tenant_id = $2
            AND i.eliminado_el IS NULL
            AND i.tipo IN ('receta', 'combo')`,
        [ids, tenantId],
      );
    return new Map(rows.map((r) => [r.item_id, { tipo: r.tipo, nombre: r.nombre }]));
  }

  /** Componentes vivos de varios combos, agrupados por combo, en una query. */
  private async componentesPorCombo(
    manager: EntityManager,
    tenantId: string,
    comboIds: string[],
  ): Promise<
    Map<
      string,
      {
        componente_item_id: string;
        cantidad: string;
        costo_actual: string | null;
      }[]
    >
  > {
    const out = new Map<
      string,
      {
        componente_item_id: string;
        cantidad: string;
        costo_actual: string | null;
      }[]
    >();
    if (!comboIds.length) return out;
    const rows: {
      combo_item_id: string;
      componente_item_id: string;
      cantidad: string;
      costo_actual: string | null;
    }[] = await manager.query(
      `SELECT cc.combo_item_id, cc.componente_item_id, cc.cantidad,
              COALESCE(ip.costo_actual, ir.costo_actual) AS costo_actual
         FROM combo_componentes cc
         JOIN items comp ON comp.item_id = cc.componente_item_id
          AND comp.eliminado_el IS NULL
         LEFT JOIN item_producto ip ON ip.item_id = cc.componente_item_id
         LEFT JOIN item_receta ir ON ir.item_id = cc.componente_item_id
        WHERE cc.combo_item_id = ANY($1::uuid[]) AND cc.tenant_id = $2
          AND cc.eliminado_el IS NULL`,
      [comboIds, tenantId],
    );
    for (const r of rows) {
      const arr = out.get(r.combo_item_id) ?? [];
      arr.push(r);
      out.set(r.combo_item_id, arr);
    }
    return out;
  }
```

Actualizar las dos llamadas a `cabecerasReceta` en `aplicarDesfases` y `descartarDesfases`.

- [ ] **Step 4: Implementar aplicar con recetas primero, combos después**

Dentro de la transacción de `aplicarDesfases`, después de la validación de `precioBase` que ya
existe:

```typescript
      const ids = [...new Set(items.map((i) => i.itemId))];
      // Los locks van ANTES de leer, y SIEMPRE en el orden item_receta →
      // item_combo con `ORDER BY item_id`. Sin ese orden fijo, dos lotes con
      // filas en común se toman las tablas en órdenes distintos y se abrazan.
      await manager.query(
        `SELECT item_id FROM item_receta
          WHERE item_id = ANY($1) ORDER BY item_id FOR UPDATE`,
        [ids],
      );
      await manager.query(
        `SELECT item_id FROM item_combo
          WHERE item_id = ANY($1) ORDER BY item_id FOR UPDATE`,
        [ids],
      );

      const cabPorId = await this.cabecerasCompuestas(manager, tenantId, ids);
      for (const it of items) {
        if (!cabPorId.has(it.itemId)) {
          throw new NotFoundException(`Item ${it.itemId} no encontrado`);
        }
      }
      const recetasDelLote = items.filter(
        (i) => cabPorId.get(i.itemId)!.tipo === 'receta',
      );
      const combosDelLote = items.filter(
        (i) => cabPorId.get(i.itemId)!.tipo === 'combo',
      );
```

Después va el loop de recetas **tal como está hoy** (con `ingredientesPorReceta`, el
`costoPropuesto`, el `400` de unidad incompatible y el `UPDATE item_receta`), cambiando
`it.recetaItemId` por `it.itemId` y recorriendo `recetasDelLote`.

A continuación, los combos:

```typescript
      const compsPorCombo = await this.componentesPorCombo(
        manager,
        tenantId,
        combosDelLote.map((c) => c.itemId),
      );
      const recetasAplicadas = new Set(recetasDelLote.map((r) => r.itemId));
      const omitidos: { itemId: string; nombre: string; motivo: string }[] = [];

      for (const it of combosDelLote) {
        const comps = compsPorCombo.get(it.itemId) ?? [];
        if (!comps.length) {
          throw new BadRequestException(
            `El combo ${it.itemId} no tiene componentes`,
          );
        }
        // El lote que se pisa a sí mismo: si una receta de este mismo lote es
        // componente de este combo, aplicarlo lo escribiría con un costo
        // distinto del que el usuario aprobó, y con un precio calculado para el
        // número viejo. Se omite y vuelve en `afectados` con el costo nuevo.
        const dependiente = comps.find((c) =>
          recetasAplicadas.has(c.componente_item_id),
        );
        if (dependiente) {
          omitidos.push({
            itemId: it.itemId,
            nombre: cabPorId.get(it.itemId)!.nombre,
            motivo:
              'Depende de una receta de este mismo lote: se recalcula y vuelve a proponerse.',
          });
          continue;
        }

        const propuesto = this.costoPropuestoCombo(comps);
        await manager.query(
          `UPDATE item_combo
             SET costo_actual = $1, costo_propuesto_omitido = NULL
           WHERE item_id = $2`,
          [propuesto, it.itemId],
        );
        if (it.actualizarPrecio && it.precioBase) {
          const precio = new Decimal(it.precioBase)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            .toFixed(4);
          await manager.query(
            `UPDATE items SET precio_base = $1
             WHERE item_id = $2 AND tenant_id = $3 AND eliminado_el IS NULL`,
            [precio, it.itemId, tenantId],
          );
        }
        aplicados += 1;
      }
```

Dos detalles del orden de queries que los mocks de los tests dependen de que se respete:

- `ingredientesPorReceta` y `componentesPorCombo` **retornan sin consultar** cuando reciben una
  lista vacía (el `if (!ids.length) return out;` que ya tienen). Pasarles solo los ids de su tipo.
- La llamada a `this.catalogService.crearConversor()` se mueve **adentro** del bloque de recetas
  (`if (recetasDelLote.length)`): un lote de solo combos no necesita el catálogo de unidades.

- [ ] **Step 5: Implementar `afectados`**

Al final de la transacción, antes del `return`:

```typescript
      // Los combos que contienen alguna de las recetas recién aplicadas y que
      // quedaron desfasados. Se lee con `manager` —no con `dataSource`— para
      // ver las escrituras de esta misma transacción antes del commit.
      let afectados: DesfaseItemDto[] = [];
      if (recetasAplicadas.size) {
        const combosCandidatos: { combo_item_id: string }[] =
          await manager.query(
            `SELECT DISTINCT cc.combo_item_id
               FROM combo_componentes cc
              WHERE cc.tenant_id = $1 AND cc.eliminado_el IS NULL
                AND cc.componente_item_id = ANY($2::uuid[])`,
            [tenantId, [...recetasAplicadas]],
          );
        afectados = await this.filasDesfaseCombos(manager, tenantId, {
          comboItemIds: combosCandidatos.map((c) => c.combo_item_id),
        });
      }
      return { aplicados, omitidos, afectados };
```

El tipo de retorno del método pasa a
`Promise<{ aplicados: number; omitidos: { itemId: string; nombre: string; motivo: string }[]; afectados: DesfaseItemDto[] }>`.

- [ ] **Step 6: Implementar descartar para combos**

En `descartarDesfases`, después de `cabecerasCompuestas`, separar por tipo con el mismo criterio
que aplicar: `ingredientesPorReceta` recibe solo los ids de recetas, `componentesPorCombo` solo los
de combos, y `crearConversor()` se llama únicamente si hay recetas en el lote. Las recetas siguen
el camino actual (incluido el `400` de unidad incompatible) y los combos hacen:

```typescript
        const propuesto = this.costoPropuestoCombo(comps);
        await manager.query(
          `UPDATE item_combo SET costo_propuesto_omitido = $1 WHERE item_id = $2`,
          [propuesto, itemId],
        );
```

Sin caso de error propio: `costoPropuestoCombo` nunca devuelve `null`, así que el `400` que las
recetas necesitan no aplica acá.

- [ ] **Step 7: Correr los tests unitarios y verificar que pasan**

```bash
cd backend && npm test -- items.service.spec.ts && npm run lint:check && npm run typecheck
```

Esperado: PASS. Correr también el test de orden de locks de `update`
(`items.service.spec.ts:1915`), que afirma sobre el orden contra `aplicarDesfases`.

- [ ] **Step 8: Verificar que los tests nuevos cazan el bug — mutantes**

Para cada uno, revertir después de comprobar el rojo:

1. En el `UPDATE item_combo` de aplicar, cambiar `costo_propuesto_omitido = NULL` por dejar la
   columna intacta → el test de aplicar tiene que ponerse rojo.
2. Sacar el `continue` del combo dependiente → el test del lote mixto tiene que ponerse rojo.
3. Devolver `afectados: []` siempre → el test de la segunda pasada tiene que ponerse rojo.

⚠️ El mutante tiene que **revertir al código anterior**, no solo romper cualquier cosa: eso es lo
que prueba que el test habría cazado el bug real.

- [ ] **Step 9: Extender el e2e con aplicar y la segunda pasada**

Agregar un `it` que: cree ingrediente + receta + combo que contiene la receta; suba el costo del
ingrediente; verifique que la bandeja trae la receta y **no** el combo; aplique la receta y afirme
que la respuesta trae el combo en `afectados`; aplique el combo; y verifique con `GET /api/items/:id`
que `costoActual` del combo quedó en el `costoPropuesto` que devolvió la bandeja.

Afirmar contra el valor **esperado** que devolvió la propia bandeja, nunca con un
`not.toBe(<viejo>)`: ese patrón pasa con cualquier número mal recalculado. Es la misma corrección
que ya está comentada en `simulador-costos.e2e-spec.ts:160-168`.

- [ ] **Step 10: Correr el e2e**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

Esperado: PASS, la suite entera.

- [ ] **Step 11: Revisión independiente y commit**

Correr el paso 7 de `verify-feature` sobre el diff.

```bash
git add -A && git commit -m "feat(desfases): aplicar y descartar el costo de un combo"
```

---

## Task 4: La bandeja muestra combos y resuelve la segunda pasada

**Files:**
- Rename: `frontend/app/components/RecetasDesfasesPanel.vue` → `DesfasesPanel.vue`
- Rename: `frontend/app/components/RecetasDesfasesPanel.nuxt.spec.ts` → `DesfasesPanel.nuxt.spec.ts`
- Rename: `frontend/app/pages/recetas-desfases.vue` → `frontend/app/pages/desfases.vue`
- Modify: `frontend/app/composables/useSimuladorDesfases.ts`
- Modify: `frontend/app/layouts/dashboard.vue:136-141`
- Modify: `frontend/app/pages/configuracion/recetas-desfases.vue` (el shim)
- Modify: `frontend/app/pages/configuracion/items.vue:2615`, `frontend/app/pages/inventario/index.vue:391`

**Interfaces:**
- Consumes: `DesfaseItemDto` con `tipo` y `afectados` (Tareas 1 y 2); la respuesta
  `{ aplicados, omitidos, afectados }` de `POST /desfases/aplicar` (Tarea 3)

- [ ] **Step 1: Escribir el test que falla — la fila de un combo muestra su tipo**

En `DesfasesPanel.nuxt.spec.ts` (el archivo renombrado), agregar al final:

```typescript
describe('DesfasesPanel — columna Tipo', () => {
  it('una fila de combo se distingue de una de receta', async () => {
    const wrapper = await mountSuspended(DesfasesPanel, {
      props: {
        filas: [
          {
            itemId: 'combo-1',
            tipo: 'combo',
            nombre: 'Combo Clásico',
            costoActual: '1700.0000',
            costoPropuesto: '1800.0000',
            deltaCosto: '100.0000',
            precioBase: '4200.0000',
            margenPctActual: '0.5952',
            margenPctPropuesto: '0.5714',
            precioSugerido: '4447.0588',
            afectados: [
              { itemId: 'papas-1', nombre: 'Papas fritas', costoActual: '600.0000' },
            ],
          },
        ],
      },
    })

    expect(wrapper.text()).toContain('Combo')
  })
})
```

El resto del archivo (los cuatro tests del gate de permiso) se conserva, actualizando el import y
las props de `filas` a la forma nueva del DTO.

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd frontend && npm test -- DesfasesPanel
```

Esperado: FAIL — el archivo todavía se llama `RecetasDesfasesPanel` y no hay columna Tipo.

- [ ] **Step 3: Renombrar el panel y agregar la columna Tipo**

`git mv frontend/app/components/RecetasDesfasesPanel.vue frontend/app/components/DesfasesPanel.vue`
y su spec. En el template, agregar el `<th>` después del checkbox y antes de la columna de nombre:

```html
            <th class="px-3 py-2 font-medium">Tipo</th>
```

y la celda correspondiente en el `<tr>` del `v-for`, con tokens semánticos (nunca Tailwind
hardcodeado):

```html
            <td class="px-3 py-3 align-top">
              <UBadge
                :color="fila.tipo === 'combo' ? 'primary' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ fila.tipo === 'combo' ? 'Combo' : 'Receta' }}
              </UBadge>
            </td>
```

Cambiar el `<th>` de la columna de nombre de `Receta` a `Item`, los dos `colspan="5"` a
`colspan="6"`, y el texto vacío a `Sin costos desfasados.`. El párrafo de arriba pasa a:

```html
      Estos items tienen un costo distinto al registrado. Puedes aplicar el nuevo costo,
      descartar el aviso o revisar más tarde.
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
cd frontend && npm test -- DesfasesPanel
```

Esperado: PASS.

- [ ] **Step 5: Implementar la segunda pasada en el composable**

En `useSimuladorDesfases.ts`, tipar la respuesta y dejar el drawer abierto cuando vuelven combos:

```typescript
  interface AplicarResponse {
    aplicados: number
    omitidos: { itemId: string, nombre: string, motivo: string }[]
    afectados: DesfaseItemDto[]
  }
```

y dentro de `onAplicarDesfases`, reemplazar el `await useApiFetch(...)` y el
`desfasesOpen.value = false` por:

```typescript
      const res = await useApiFetch<AplicarResponse>(`${apiUrl}/desfases/aplicar`, {
        method: 'POST',
        body: { items: aplicados },
      })
      if (onAplicado) {
        const byId = new Map(aplicados.map(a => [a.itemId, a]))
        for (const fila of desfasesFilas.value) {
          const aplicado = byId.get(fila.itemId)
          if (aplicado) onAplicado(fila, aplicado)
        }
      }
      if (res.omitidos.length) {
        toast.add({
          title: `${res.omitidos.length} combo(s) se recalcularon y vuelven a proponerse`,
          color: 'warning',
        })
      }
      if (res.afectados.length) {
        // Segunda pasada: el costo de estos combos cambió porque se aplicaron
        // las recetas que contienen. Se resuelven acá mismo en vez de dejarlos
        // esperando en la bandeja.
        desfasesFilas.value = res.afectados
        toast.add({
          title: `${res.afectados.length} combo(s) quedaron desfasados por este cambio`,
          color: 'info',
        })
      }
      else {
        toast.add({ title: 'Costos actualizados', color: 'success' })
        desfasesOpen.value = false
      }
```

- [ ] **Step 6: Aplicar la misma segunda pasada en la bandeja**

`git mv frontend/app/pages/recetas-desfases.vue frontend/app/pages/desfases.vue`. En `onAplicar`,
si la respuesta trae `afectados`, mostrarlos en vez de recargar la lista entera; si no, `cargar()`
como hoy. Actualizar el título de la página y los textos de los toasts a "costos desfasados", y el
import del componente a `DesfasesPanel`.

- [ ] **Step 7: Repuntar la navegación y el shim**

En `layouts/dashboard.vue:138-140`: `label: 'Costos desfasados'` y `to: '/desfases'`.

En `pages/configuracion/recetas-desfases.vue`, el redirect apunta a `/desfases`:

```typescript
definePageMeta({
  middleware: () => navigateTo('/desfases', { replace: true }),
})
```

En `pages/configuracion/items.vue:2615` y `pages/inventario/index.vue:391`, cambiar
`<RecetasDesfasesPanel` por `<DesfasesPanel` (y el import de tipos de
`~/components/DesfasesPanel.vue`).

- [ ] **Step 8: Verificar el frontend entero**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Esperado: PASS en los cuatro. `design:check` es el que caza un token de Tailwind hardcodeado en el
`UBadge` nuevo.

- [ ] **Step 9: Smoke test en el navegador**

Con `docker-compose up` y la base recién reseteada, en Chrome (DevTools abierto, no Claude Browser):

1. Login en Demo Restaurante → Configuración → Items → subir el costo de "Papas fritas" por compra.
2. Verificar que se abre el modal y que aparece el **Combo Clásico** con badge "Combo".
3. Aplicar → verificar que el listado de items muestra el costo nuevo del combo.
4. Subir el costo de un ingrediente de "Hamburguesa Clásica" → aplicar la receta desde el modal →
   verificar que **el panel no se cierra** y muestra el Combo Clásico como fila nueva.
5. Ir a Costos desfasados desde el menú y verificar que la ruta `/desfases` carga.

El build y el typecheck no ven bugs de runtime (auto-imports de Nuxt, props que quedaron con el
nombre viejo): este paso no es opcional.

- [ ] **Step 10: Revisión independiente y commit**

Correr el paso 7 de `verify-feature` sobre el diff.

```bash
git add -A && git commit -m "feat(desfases): la bandeja muestra combos y resuelve la segunda pasada"
```

---

## Task 5: Documentación y cierre del backlog

La entrega no está terminada sin esto: `CLAUDE.md` pide la documentación viva actualizada, y la
entrada del backlog tiene que mudarse para que la lista siga siendo legible.

**Files:**
- Modify: `docs/features/simulador-impacto-costos.md`
- Modify: `docs/features/combos.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/agent/pendientes.md`, `docs/agent/resueltos.md`
- Delete: `docs/superpowers/plans/2026-08-18-combos-en-bandeja-desfases.md`, `docs/superpowers/specs/2026-08-18-combos-en-bandeja-desfases-design.md`

- [ ] **Step 1: Actualizar `simulador-impacto-costos.md`**

Alcance: combos incluidos. Endpoints y DTO nuevos (`/desfases`, `itemId`, `tipo`, `afectados`,
`/items/:id/afectados`). Sección nueva "Reglas de desfase de un combo" con la fórmula, la Decisión 1
(dos pasadas, con el ejemplo numérico $1.700 → $1.850) y la Decisión 2 (`afectados` en la respuesta
de aplicar y `omitidos` para el lote que se pisa). Sacar los combos de la lista de exclusiones.
Dejar escrito que en combos **no** existe el caso "sin costo proponible".

- [ ] **Step 2: Actualizar `combos.md`**

Sacar de "NOT included" la línea *"Recálculo silencioso de `costo_actual` cuando cambia el costo de
un componente"* y reemplazarla por un puntero a `simulador-impacto-costos.md`. Documentar la
columna `costo_propuesto_omitido` en la tabla de `item_combo`.

- [ ] **Step 3: Actualizar `ESTADO.md`**

Fila de la funcionalidad con la fecha 2026-08-18.

- [ ] **Step 4: Mudar la entrada del backlog**

Sacar de `docs/agent/pendientes.md` la entrada *"El costo de un combo se queda viejo y nadie avisa,
a diferencia de las recetas"* y mudarla a `docs/agent/resueltos.md` con el texto de cierre,
incluyendo el hallazgo que la entrada no nombraba: `itemsAfectadosPorInsumo` exigía
`tipo='ingrediente'`, así que comprar un producto devolvía `404` y el `catch` del composable se lo
tragaba — ningún modal se abría nunca para un componente de combo.

- [ ] **Step 5: Borrar el plan y el spec**

Los planes y specs de features ya implementadas se eliminan; la historia queda en git y el
conocimiento durable en `docs/features/`.

- [ ] **Step 6: Gate completo**

```bash
./scripts/reset-db.sh
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd ../frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Los seis comandos en verde, con el e2e **completo** y no un subconjunto. Verificar el exit code de
cada uno, no la última línea impresa.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "docs(desfases): los combos entran a la bandeja, y el 404 mudo del modal"
```

- [ ] **Step 8: Verificar el push**

Después de `git push`, revisar el CI **y** el deployment de Railway: el push toca una entidad
(`ItemCombo`), y `synchronize: true` aplica la columna nueva al arrancar.

---

## Decisiones tomadas y preguntas abiertas

**Decididas en el spec, no reabrir durante la ejecución:**

1. Un combo se desfasa contra el costo **cacheado** de sus componentes: dos pasadas cuando el que
   se mueve es un ingrediente.
2. La segunda pasada la resuelve el panel con `afectados` en la respuesta de aplicar.
3. Enfoque de generalización a "items compuestos", con el renombre de rutas, DTO, página y nav.
4. El lote que mezcla una receta con el combo que la contiene **omite el combo**, no falla con 409.

**Fuera de alcance, no construir:** combos anidados, cascada automática, badge con contador en la
navegación, historial de quién aplicó qué, cola persistente o snooze por fecha.
