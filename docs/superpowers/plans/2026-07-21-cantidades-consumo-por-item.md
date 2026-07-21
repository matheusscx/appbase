# Cantidades de consumo por item (grupos de modificadores reutilizables) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft
**Date:** 2026-07-21
**Owner:** Cesar Matheus

**Goal:** Desacoplar la **cantidad/unidad de consumo** y el **precio extra** del catálogo de opciones de un grupo de modificadores, moviéndolos a un **override por asociación item↔grupo**. El grupo pasa a definir *defaults opcionales*; cada receta/combo define *cómo consume y cobra* cada opción vía `COALESCE(override, default)`.

**Architecture:** Modelo **híbrido**. `grupo_modificador_opciones` mantiene `cantidad`/`unidad_codigo`/`precio_extra` como **defaults** (con `cantidad` ahora nullable = "sin default"). Una tabla hija nueva `item_grupo_modificador_opciones` guarda el **override** por `(item_grupo_id, grupo_opcion_id)`. La cantidad efectiva es `COALESCE(override.cantidad, opcion.cantidad)`; si ambas son NULL la opción queda **pendiente** (no vendible en esa receta). Como el default se queda en el grupo, **no hay migración de datos ni cambia ninguna venta pasada** (el snapshot ya congela la cantidad al vender). Para que los overrides no se huérfanen, los dos flujos de *reemplazo total* existentes (`asociarGruposModificadores` y `GruposModificadoresService.update`) se reescriben a **upsert que preserva el UUID** de las filas cuyo negocio no cambió, con cascada de soft-delete a los overrides de opciones/asociaciones eliminadas.

**Tech Stack:** NestJS + TypeORM (SQL raw sobre `dataSource`/`EntityManager`), Decimal.js para dinero y cantidades, Nuxt 4 + Nuxt UI v4, Jest para tests.

## Global Constraints

- Aritmética de dinero y cantidades: **Decimal.js**, nunca `number` nativo. Costos/precios/cantidades con 4 decimales.
- **Soft delete** en todo: `eliminado_el TIMESTAMPTZ`; toda lectura filtra `eliminado_el IS NULL` (en cada JOIN).
- Toda columna PK/FK UUID declara `type: 'uuid'` explícito en la entidad (ADR-004).
- `tenant_id` siempre del token del usuario autenticado (`req.user.tenantId`), nunca del body.
- Esquema en dev lo crea TypeORM `synchronize:true` desde las entidades; **además** actualizar `startup-pos.sql` en el mismo commit, incluyendo el índice único parcial (que `synchronize` no crea sin `@Index`).
- Entidades nuevas se registran **en dos lugares**: `backend/src/app.module.ts` (array `entities`) y el `TypeOrmModule.forFeature` del módulo dueño.
- **No usar `npm run lint`** (reformatea todo el repo). Usar el binario acotado `./node_modules/.bin/eslint '<glob>'` y verificar `git status` antes de commitear.
- Frontend: `useApiFetch`/`$fetch` (no axios); formato vía `useFormatters`; tokens semánticos Nuxt UI (`text-muted`, `bg-default`, `divide-default`…), nunca Tailwind hardcodeado. Sin `cargar()` post-mutación: mergear la entidad/patch que devuelve el backend. Cargar el skill `nuxt-ui` antes de escribir markup nuevo.
- **Contrato de resolución (invariante central):** cantidad efectiva = `COALESCE(override.cantidad, opcion.cantidad)`; unidad efectiva = `COALESCE(override.unidad_codigo, opcion.unidad_codigo)`; precio efectivo = `COALESCE(override.precio_extra, opcion.precio_extra)`. `precio_extra` del grupo es `NOT NULL DEFAULT 0` ⇒ el precio efectivo **nunca** es null. La cantidad efectiva **sí** puede ser null ⇒ opción **pendiente**.
- **Opción pendiente** (cantidad efectiva null): no se ofrece en el POS/drawer de personalización para esa receta y `resolverGruposDeItem` la rechaza si llega elegida. El `min` del grupo se sigue midiendo sobre las opciones **elegibles** (no pendientes).
- **El snapshot de venta NO cambia de shape.** `SnapshotGrupo.opciones[].cantidad/unidadCodigo/precioExtra` se siguen congelando al vender; solo cambia **de dónde** los toma el resolver.

**Doc de diseño de referencia:** `refactorizacion.md` (raíz del repo) + `docs/superpowers/specs/2026-07-20-grupos-modificadores-design.md`.

**Decisiones tomadas (ver sección Decisions al final):**
1. Modelo **híbrido** (default opcional en grupo + override por receta), no puro.
2. `precio_extra` sigue la misma lógica híbrida que la cantidad.
3. Override diferible: opción sin cantidad efectiva = **pendiente**, no bloquea el guardado del grupo/receta.
4. Llave del override = UUIDs `item_grupo_id` + `grupo_opcion_id`, **preservados** vía upsert (no reemplazo total).

---

## File Structure

**Backend (crear):**
- `backend/src/modules/items/entities/item-grupo-modificador-opcion.entity.ts` — override item↔grupo↔opción.

**Backend (modificar):**
- `backend/src/modules/grupos-modificadores/entities/grupo-modificador-opcion.entity.ts` — `cantidad` → nullable.
- `backend/src/modules/grupos-modificadores/dto/create-grupo-modificador.dto.ts` — `cantidad` opcional en `GrupoOpcionInputDto`.
- `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts` — `validarYResolverOpciones` (cantidad opcional), `update` → upsert-preservando + cascada de overrides, endpoints `itemsUsando` / `aplicarOverrides`.
- `backend/src/modules/grupos-modificadores/grupos-modificadores.controller.ts` — `GET :id/items`, `PATCH :id/overrides`.
- `backend/src/modules/grupos-modificadores/dto/aplicar-overrides.dto.ts` (crear) — payload del aplicar-en-lote.
- `backend/src/modules/items/dto/create-item.dto.ts` — `opciones?` (overrides) en `ItemGrupoModificadorInputDto`.
- `backend/src/modules/items/items.service.ts` — `asociarGruposModificadores` → upsert-preservando + persistir overrides + cascada; `findOne` grupos con `COALESCE` + estado pendiente; `resolverGruposDeItem` con `COALESCE` + guard de pendiente.
- `backend/src/modules/items/items.module.ts`, `backend/src/app.module.ts` — registrar la entidad nueva.
- `startup-pos.sql` — `cantidad` nullable + tabla `item_grupo_modificador_opciones` + índice único parcial.
- Tests: `grupos-modificadores.service.spec.ts`, `items.service.spec.ts`.

**Backend (crear test):**
- `backend/test/grupos-modificadores-overrides.e2e-spec.ts` — grupo con default → 2 recetas con overrides distintos → vender cada una → movimientos con la cantidad correcta.

**Frontend (modificar):**
- `frontend/app/pages/configuracion/grupos-modificadores.vue` — `cantidad`/`unidad` opcionales en el form; drawer "usado en estas recetas" con selección múltiple + aplicar-en-lote (cantidad+unidad+precio).
- `frontend/app/pages/configuracion/items.vue` — tabla de overrides por opción al asociar un grupo (pre-llenada con defaults, editable, badge de pendiente).
- `frontend/app/composables/useRecetaPersonalizacion.ts` — tipos de opción con `esPendiente`.
- `frontend/app/components/ventas/ItemPersonalizacionDrawer.vue` — ocultar/deshabilitar opciones pendientes.

**Docs/seed (modificar):**
- `backend/src/modules/seeder/seeder.service.ts` — un grupo demo reusado por 2 recetas con overrides.
- `docs/features/grupos-modificadores.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`, `docs/patterns/backend.md`, nuevo ADR + índice.

---

## Task 1: Esquema — `cantidad` opcional en el grupo + tabla de override

**Files:**
- Modify: `backend/src/modules/grupos-modificadores/entities/grupo-modificador-opcion.entity.ts`
- Modify: `backend/src/modules/grupos-modificadores/dto/create-grupo-modificador.dto.ts`
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts` (`validarYResolverOpciones`)
- Create: `backend/src/modules/items/entities/item-grupo-modificador-opcion.entity.ts`
- Modify: `backend/src/modules/items/items.module.ts`, `backend/src/app.module.ts`
- Modify: `startup-pos.sql`
- Test: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts`

**Interfaces:**
- Consumes: entidades y servicio ya en `main`.
- Produces:
  - `class ItemGrupoModificadorOpcion { itemGrupoOpcionId, tenantId, itemGrupoId, grupoOpcionId, cantidad: string | null, unidadCodigo: string | null, precioExtra: string | null, creadoEl, actualizadoEl, eliminadoEl }`
  - `GrupoModificadorOpcion.cantidad: string | null`
  - `GrupoOpcionInputDto.cantidad?: string` (opcional; si viene, `> 0`)
  - `validarYResolverOpciones` acepta `cantidad` ausente (default no configurado); `OpcionResuelta.cantidad: string | null`.

- [ ] **Step 1: Escribir el test que falla**

En `grupos-modificadores.service.spec.ts`, añadir al `describe` de `create`:

```typescript
it('permite crear una opción sin cantidad default (queda null)', async () => {
  managerMock.query
    .mockResolvedValueOnce([]) // assertNombreLibre
    .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }]) // INSERT grupo
    .mockResolvedValueOnce([{ tipo: 'producto', nombre: 'Coca', modo_inventario: 'cantidad', unidad_medida: 'unidad' }])
    .mockResolvedValueOnce([{ grupo_opcion_id: 'O1' }]); // INSERT opción
  const res = await service.create(TENANT_ID, {
    nombre: 'Bebida',
    opciones: [{ itemId: ITEM_PROD, precioExtra: '0' }], // sin cantidad
  } as any);
  expect(res.opciones[0].cantidad).toBeNull();
});

it('rechaza cantidad default explícita <= 0', async () => {
  managerMock.query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
    .mockResolvedValueOnce([{ tipo: 'producto', nombre: 'Coca', modo_inventario: 'cantidad', unidad_medida: 'unidad' }]);
  await expect(
    service.create(TENANT_ID, {
      nombre: 'Bebida',
      opciones: [{ itemId: ITEM_PROD, cantidad: '0', precioExtra: '0' }],
    } as any),
  ).rejects.toThrow(/cantidad.*mayor a 0/i);
});
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts -t "cantidad"`
Expected: FAIL (hoy `cantidad` es obligatoria y `new Decimal(undefined)` revienta).

- [ ] **Step 3: Entidad del grupo — `cantidad` nullable**

En `grupo-modificador-opcion.entity.ts`, cambiar la columna `cantidad`:

```typescript
  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  cantidad: string | null;
```

- [ ] **Step 4: DTO — `cantidad` opcional**

En `create-grupo-modificador.dto.ts`, en `GrupoOpcionInputDto`, hacer `cantidad` opcional (dejar `precioExtra`, `unidadCodigo`, `orden` como están):

```typescript
  @IsOptional()
  @IsNumberString()
  cantidad?: string;
```

- [ ] **Step 5: `validarYResolverOpciones` acepta cantidad ausente**

En `grupos-modificadores.service.ts`:

1. `OpcionResuelta.cantidad` → `string | null` (interfaz en `:18`).
2. En el loop, reemplazar el bloque que valida `cantidad` (`:107`-`:111`) por:

```typescript
      if (op.cantidad !== undefined && op.cantidad !== null && op.cantidad !== '') {
        if (new Decimal(op.cantidad).lessThanOrEqualTo(0)) {
          throw new BadRequestException(
            'La cantidad de la opción debe ser mayor a 0',
          );
        }
      }
```

3. En el bloque `familiaOp === 'ingrediente'` (`:144`-`:162`), la validación de unidad/`convertirUnidad` solo aplica **si hay cantidad default**. Envolver:

```typescript
      let unidadCodigo: string | null = null;
      if (familiaOp === 'ingrediente') {
        if (modo_inventario !== 'cantidad') {
          throw new BadRequestException(
            'Las opciones ingrediente solo admiten modo de inventario "cantidad"',
          );
        }
        // Con default de cantidad, exigir y verificar la unidad. Sin default,
        // la unidad se define en el override por receta (Task 3).
        if (op.cantidad != null && op.cantidad !== '') {
          if (!op.unidadCodigo) {
            throw new BadRequestException(
              'Las opciones ingrediente con cantidad requieren unidad de medida',
            );
          }
          await this.catalogService.convertirUnidad(
            op.cantidad,
            op.unidadCodigo,
            unidad_medida!,
          );
          unidadCodigo = op.unidadCodigo;
        } else if (op.unidadCodigo) {
          unidadCodigo = op.unidadCodigo; // unidad default sin cantidad default: se permite
        }
      }
```

4. En la construcción de `resuelta` (`:165`-`:173`), normalizar cantidad vacía a `null`:

```typescript
      const resuelta: OpcionResuelta = {
        itemId: op.itemId,
        itemNombre: nombre,
        tipo,
        cantidad: op.cantidad != null && op.cantidad !== '' ? op.cantidad : null,
        unidadCodigo,
        precioExtra: op.precioExtra,
        orden,
      };
```

- [ ] **Step 6: Entidad del override**

`backend/src/modules/items/entities/item-grupo-modificador-opcion.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('item_grupo_modificador_opciones')
export class ItemGrupoModificadorOpcion {
  @PrimaryGeneratedColumn('uuid', { name: 'item_grupo_opcion_id' })
  itemGrupoOpcionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // FK a item_grupos_modificadores(item_grupo_id) — la asociación item↔grupo.
  @Column({ name: 'item_grupo_id', type: 'uuid' })
  itemGrupoId: string;

  // FK a grupo_modificador_opciones(grupo_opcion_id) — la opción reutilizable.
  @Column({ name: 'grupo_opcion_id', type: 'uuid' })
  grupoOpcionId: string;

  // Override; null = hereda el default del grupo. Si default también es null → pendiente.
  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  cantidad: string | null;

  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

  // Override del recargo; null = hereda el default (que nunca es null).
  @Column({ name: 'precio_extra', type: 'numeric', precision: 18, scale: 4, nullable: true })
  precioExtra: string | null;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

Registrar `ItemGrupoModificadorOpcion` en `items.module.ts` (`forFeature`) y en `app.module.ts` (`entities`).

- [ ] **Step 7: DDL en `startup-pos.sql`**

1. En la tabla `grupo_modificador_opciones`, cambiar `cantidad` a nullable:

```sql
  "cantidad"             NUMERIC(18,4),   -- default opcional; null = sin default (override por receta)
```

2. Tras `grupo_modificador_opciones`, añadir:

```sql
-- Override de consumo/recargo por asociación item↔grupo↔opción (modelo híbrido).
-- La cantidad/unidad/precio efectivos = COALESCE(override, default del grupo).
CREATE TABLE "item_grupo_modificador_opciones" (
  "item_grupo_opcion_id" UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            UUID          NOT NULL REFERENCES "tenants" ("tenant_id"),
  "item_grupo_id"       UUID          NOT NULL REFERENCES "item_grupos_modificadores" ("item_grupo_id"),
  "grupo_opcion_id"     UUID          NOT NULL REFERENCES "grupo_modificador_opciones" ("grupo_opcion_id"),
  "cantidad"            NUMERIC(18,4),  -- null = hereda default
  "unidad_codigo"       TEXT          REFERENCES "unidades_medida" ("codigo"),
  "precio_extra"        NUMERIC(18,4),  -- null = hereda default
  "creado_el"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "actualizado_el"      TIMESTAMPTZ,
  "eliminado_el"        TIMESTAMPTZ
);
CREATE UNIQUE INDEX "uq_item_grupo_opcion_vivo"
  ON "item_grupo_modificador_opciones" ("item_grupo_id", "grupo_opcion_id")
  WHERE "eliminado_el" IS NULL;
```

> Verificar el nombre real de la tabla de unidades en `startup-pos.sql` (`unidades_medida` vs `unidad_medida`) y usar el que exista, igual que en `grupo_modificador_opciones`.

- [ ] **Step 8: Correr hasta verde**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts`
Expected: PASS (todos, incluidos los 2 nuevos). Si algún test viejo asumía `cantidad` no-null en el shape resuelto, ajustarlo a `string | null`.

- [ ] **Step 9: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/grupos-modificadores/**/*.ts' 'src/modules/items/entities/item-grupo-modificador-opcion.entity.ts'
git add backend/src/modules/grupos-modificadores backend/src/modules/items/entities/item-grupo-modificador-opcion.entity.ts \
        backend/src/modules/items/items.module.ts backend/src/app.module.ts startup-pos.sql
git commit -m "feat(grupos-modificadores): cantidad default opcional + tabla de override item↔grupo↔opción"
```

---

## Task 2: `update` de grupo → upsert que preserva `grupo_opcion_id` + cascada de overrides

**Files:**
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts` (`update`)
- Test: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts`

**Interfaces:**
- Consumes: `validarYResolverOpciones`, `cargarGrupo` (Task 1).
- Produces: `update` preserva el `grupo_opcion_id` de las opciones cuyo `item_id` no cambió (UPDATE en vez de delete+insert); inserta las nuevas; soft-borra las que desaparecen **y** sus overrides en `item_grupo_modificador_opciones`.

**Por qué:** con la llave del override = `grupo_opcion_id`, el reemplazo-total actual (`:402`-`:429`) regenera ese UUID en cada edición y huérfana todos los overrides. El upsert-preservando mantiene el UUID estable mientras la opción (por `item_id`) siga viva.

- [ ] **Step 1: Escribir los tests que fallan**

En `grupos-modificadores.service.spec.ts`, `describe('update/remove grupo')`:

```typescript
it('preserva grupo_opcion_id de una opción que sigue viva (UPDATE, no delete+insert)', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ grupo_modificador_id: 'G1', nombre: 'Bebida' }]) // SELECT grupo vivo
    // SELECT opciones vivas actuales (map por item_id)
    .mockResolvedValueOnce([{ grupo_opcion_id: 'O-EXIST', item_id: ITEM_PROD }])
    // item lookup de la opción entrante (validarYResolverOpciones)
    .mockResolvedValueOnce([{ tipo: 'producto', nombre: 'Coca', modo_inventario: 'cantidad', unidad_medida: 'unidad' }])
    .mockResolvedValueOnce([]) // UPDATE de la opción existente
    .mockResolvedValueOnce([]); // (cargarGrupo al final — stubs en el helper existente)
  await service.update(TENANT_ID, 'G1', {
    nombre: 'Bebida',
    opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '900' }],
  } as any);
  const updateCall = managerMock.query.mock.calls.find(
    (c) => /UPDATE grupo_modificador_opciones SET/i.test(c[0]) && /precio_extra/i.test(c[0]),
  );
  expect(updateCall).toBeTruthy(); // hubo UPDATE de la opción, no un INSERT nuevo
});

it('soft-borra los overrides de una opción eliminada del grupo', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ grupo_modificador_id: 'G1', nombre: 'Bebida' }])
    .mockResolvedValueOnce([{ grupo_opcion_id: 'O-GONE', item_id: ITEM_PROD }]) // vivas actuales
    // opciones entrantes: vacío del lado de ITEM_PROD → O-GONE desaparece
    .mockResolvedValueOnce([{ tipo: 'producto', nombre: 'Fanta', modo_inventario: 'cantidad', unidad_medida: 'unidad' }]) // item de la nueva opción
    .mockResolvedValueOnce([{ grupo_opcion_id: 'O-NEW' }]) // INSERT nueva
    .mockResolvedValueOnce([]) // soft-delete opción O-GONE
    .mockResolvedValueOnce([]); // soft-delete overrides de O-GONE
  await service.update(TENANT_ID, 'G1', {
    opciones: [{ itemId: ITEM_PROD_2, cantidad: '1', precioExtra: '0' }],
  } as any);
  const ovrDelete = managerMock.query.mock.calls.find(
    (c) => /UPDATE item_grupo_modificador_opciones SET eliminado_el/i.test(c[0]),
  );
  expect(ovrDelete).toBeTruthy();
});
```

> Ajustar las constantes (`ITEM_PROD_2`) y el número/orden de mocks al arnés real del archivo. El objetivo es fijar el comportamiento: UPDATE para opciones que persisten, soft-delete de opción + overrides para las que desaparecen.

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts -t "update/remove grupo"`
Expected: FAIL (hoy es delete-all + insert).

- [ ] **Step 3: Reescribir el bloque de opciones en `update`**

En `update` (`:396`-`:431`), reemplazar el bloque `if (dto.opciones === undefined) {...}` + reemplazo-total por un upsert-preservando. La estrategia: cargar las opciones vivas actuales (map `item_id → grupo_opcion_id`), y por cada opción resuelta hacer UPDATE si el `item_id` existe o INSERT si es nueva; al final soft-borrar las que quedaron fuera y sus overrides.

```typescript
      if (dto.opciones === undefined) {
        return (await this.cargarGrupo(manager, tenantId, grupoId))!;
      }

      const vivas: { grupo_opcion_id: string; item_id: string }[] =
        await manager.query(
          `SELECT grupo_opcion_id, item_id FROM grupo_modificador_opciones
           WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
          [grupoId, tenantId],
        );
      const opcionIdPorItem = new Map(vivas.map((r) => [r.item_id, r.grupo_opcion_id]));
      const itemsEntrantes = new Set<string>();

      await this.validarYResolverOpciones(
        manager,
        tenantId,
        dto.opciones,
        async (op) => {
          itemsEntrantes.add(op.itemId);
          const existente = opcionIdPorItem.get(op.itemId);
          if (existente) {
            await manager.query(
              `UPDATE grupo_modificador_opciones
               SET cantidad = $1, unidad_codigo = $2, precio_extra = $3, orden = $4,
                   actualizado_el = NOW()
               WHERE grupo_opcion_id = $5`,
              [op.cantidad, op.unidadCodigo, op.precioExtra, op.orden, existente],
            );
          } else {
            await manager.query(
              `INSERT INTO grupo_modificador_opciones
                 (tenant_id, grupo_modificador_id, item_id, cantidad, unidad_codigo, precio_extra, orden)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [tenantId, grupoId, op.itemId, op.cantidad, op.unidadCodigo, op.precioExtra, op.orden],
            );
          }
        },
      );

      // Opciones que desaparecieron: soft-delete de la opción y de sus overrides.
      const eliminadas = vivas.filter((r) => !itemsEntrantes.has(r.item_id));
      if (eliminadas.length) {
        const idsEliminadas = eliminadas.map((r) => r.grupo_opcion_id);
        await manager.query(
          `UPDATE item_grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
           WHERE grupo_opcion_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
          [idsEliminadas],
        );
        await manager.query(
          `UPDATE grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
           WHERE grupo_opcion_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
          [idsEliminadas],
        );
      }

      return (await this.cargarGrupo(manager, tenantId, grupoId))!;
```

> Nota: `validarYResolverOpciones` sigue rechazando `item_id` duplicado dentro del mismo request (`vistos`), así que el map por `item_id` es seguro.

- [ ] **Step 4: Correr hasta verde**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/grupos-modificadores/**/*.ts'
git add backend/src/modules/grupos-modificadores
git commit -m "refactor(grupos-modificadores): update upsert-preservando grupo_opcion_id + cascada a overrides"
```

---

## Task 3: `asociarGruposModificadores` → upsert-preservando `item_grupo_id` + persistir overrides

**Files:**
- Modify: `backend/src/modules/items/dto/create-item.dto.ts` (`ItemGrupoModificadorInputDto`)
- Modify: `backend/src/modules/items/items.service.ts` (`asociarGruposModificadores`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: entidad y tabla de Task 1; upsert de opciones de Task 2 como referencia de patrón.
- Produces:
  - `class ItemGrupoOpcionOverrideInputDto { grupoOpcionId: string; cantidad?: string; unidadCodigo?: string; precioExtra?: string }`
  - `ItemGrupoModificadorInputDto` gana `opciones?: ItemGrupoOpcionOverrideInputDto[]`.
  - `asociarGruposModificadores` preserva `item_grupo_id` de las asociaciones cuyo `grupo_modificador_id` persiste; soft-borra las que desaparecen **y** sus overrides; hace upsert-preservando de los overrides por `(item_grupo_id, grupo_opcion_id)`; valida que cada `grupoOpcionId` pertenezca a ese grupo y que `cantidad`/`precioExtra` (si vienen) sean válidos.

- [ ] **Step 1: Escribir los tests que fallan**

En `items.service.spec.ts`, `describe('grupos modificadores en item')`:

```typescript
it('preserva item_grupo_id de una asociación que persiste (UPDATE min/max)', async () => {
  managerMock.query
    .mockResolvedValueOnce([{ item_grupo_id: 'IG-EXIST', grupo_modificador_id: GRUPO_ID }]) // asociaciones vivas
    .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe/pertenece
    .mockResolvedValueOnce([]); // UPDATE de la asociación
  await (service as any).asociarGruposModificadores(managerMock, TENANT_ID, ITEM_ID, [
    { grupoModificadorId: GRUPO_ID, min: 1, max: 2, opciones: [] },
  ]);
  const upd = managerMock.query.mock.calls.find(
    (c) => /UPDATE item_grupos_modificadores SET min/i.test(c[0]),
  );
  expect(upd).toBeTruthy();
});

it('persiste un override de cantidad para una opción del grupo asociado', async () => {
  managerMock.query
    .mockResolvedValueOnce([]) // sin asociaciones vivas
    .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe
    .mockResolvedValueOnce([{ item_grupo_id: 'IG-NEW' }]) // INSERT asociación RETURNING
    .mockResolvedValueOnce([{ grupo_opcion_id: OPCION_ID }]) // opción pertenece al grupo
    .mockResolvedValueOnce([]) // sin overrides vivos previos
    .mockResolvedValueOnce([]); // INSERT override
  await (service as any).asociarGruposModificadores(managerMock, TENANT_ID, ITEM_ID, [
    {
      grupoModificadorId: GRUPO_ID, min: 1, max: 1,
      opciones: [{ grupoOpcionId: OPCION_ID, cantidad: '250', unidadCodigo: 'g' }],
    },
  ]);
  const ins = managerMock.query.mock.calls.find(
    (c) => /INSERT INTO item_grupo_modificador_opciones/i.test(c[0]),
  );
  expect(ins).toBeTruthy();
});

it('rechaza un override cuya opción no pertenece al grupo', async () => {
  managerMock.query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }])
    .mockResolvedValueOnce([{ item_grupo_id: 'IG-NEW' }])
    .mockResolvedValueOnce([]); // opción NO pertenece
  await expect(
    (service as any).asociarGruposModificadores(managerMock, TENANT_ID, ITEM_ID, [
      { grupoModificadorId: GRUPO_ID, min: 1, max: 1, opciones: [{ grupoOpcionId: OPCION_AJENA, cantidad: '1' }] },
    ]),
  ).rejects.toThrow(/opción.*no pertenece al grupo/i);
});
```

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "grupos modificadores en item"`
Expected: FAIL.

- [ ] **Step 3: DTO — override por opción**

En `create-item.dto.ts`, antes de `ItemGrupoModificadorInputDto` (`:92`):

```typescript
export class ItemGrupoOpcionOverrideInputDto {
  @IsUUID()
  grupoOpcionId: string;

  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  @IsOptional()
  @IsNumberString()
  precioExtra?: string;
}
```

Y en `ItemGrupoModificadorInputDto`, añadir el campo (tras `orden?`):

```typescript
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoOpcionOverrideInputDto)
  opciones?: ItemGrupoOpcionOverrideInputDto[];
```

> Verificar que `IsArray`, `IsNotEmpty`, `IsString`, `ValidateNested`, `Type` ya estén importados en `create-item.dto.ts`; añadir los que falten. `update-item.dto.ts` reexporta `ItemGrupoModificadorInputDto`, así que el override queda disponible en update sin cambios extra.

- [ ] **Step 4: Reescribir `asociarGruposModificadores`**

Reemplazar el método (`:2903`-`:2952`) por un upsert-preservando con persistencia de overrides. Firma nueva del parámetro `grupos: ItemGrupoModificadorInputDto[]` (sin cambio de tipo — el DTO ya trae `opciones?`).

```typescript
  /**
   * Upsert de la asociación item↔grupo preservando `item_grupo_id` de los grupos
   * que persisten (para no huérfanar sus overrides), + upsert de los overrides de
   * consumo/recargo por opción. Soft-borra asociaciones y overrides que desaparecen.
   */
  private async asociarGruposModificadores(
    manager: EntityManager,
    tenantId: string,
    itemId: string,
    grupos: ItemGrupoModificadorInputDto[],
  ): Promise<void> {
    const vivas: { item_grupo_id: string; grupo_modificador_id: string }[] =
      await manager.query(
        `SELECT item_grupo_id, grupo_modificador_id FROM item_grupos_modificadores
         WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [itemId, tenantId],
      );
    const itemGrupoIdPorGrupo = new Map(
      vivas.map((r) => [r.grupo_modificador_id, r.item_grupo_id]),
    );

    const vistos = new Set<string>();
    const gruposEntrantes = new Set<string>();
    let orden = 0;
    for (const g of grupos) {
      if (vistos.has(g.grupoModificadorId)) {
        throw new BadRequestException(
          'Un grupo no puede asociarse dos veces al mismo item',
        );
      }
      vistos.add(g.grupoModificadorId);
      gruposEntrantes.add(g.grupoModificadorId);
      if (g.max < Math.max(g.min, 1)) {
        throw new BadRequestException(
          'El máximo del grupo debe ser mayor o igual a max(min, 1)',
        );
      }
      const grupoRows: { grupo_modificador_id: string }[] = await manager.query(
        `SELECT grupo_modificador_id FROM grupos_modificadores
         WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [g.grupoModificadorId, tenantId],
      );
      if (!grupoRows.length) {
        throw new BadRequestException(
          `Grupo de modificadores no encontrado: ${g.grupoModificadorId}`,
        );
      }

      let itemGrupoId = itemGrupoIdPorGrupo.get(g.grupoModificadorId);
      if (itemGrupoId) {
        await manager.query(
          `UPDATE item_grupos_modificadores
           SET min = $1, max = $2, orden = $3, actualizado_el = NOW()
           WHERE item_grupo_id = $4`,
          [g.min, g.max, g.orden ?? orden, itemGrupoId],
        );
      } else {
        const insRows: { item_grupo_id: string }[] = await manager.query(
          `INSERT INTO item_grupos_modificadores (tenant_id, item_id, grupo_modificador_id, min, max, orden)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING item_grupo_id`,
          [tenantId, itemId, g.grupoModificadorId, g.min, g.max, g.orden ?? orden],
        );
        itemGrupoId = insRows[0].item_grupo_id;
      }
      orden++;

      await this.upsertOverridesDeGrupo(
        manager,
        tenantId,
        itemGrupoId,
        g.grupoModificadorId,
        g.opciones ?? [],
      );
    }

    // Asociaciones que desaparecen: soft-delete de la asociación + sus overrides.
    const eliminadas = vivas.filter((r) => !gruposEntrantes.has(r.grupo_modificador_id));
    if (eliminadas.length) {
      const ids = eliminadas.map((r) => r.item_grupo_id);
      await manager.query(
        `UPDATE item_grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE item_grupo_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
        [ids],
      );
      await manager.query(
        `UPDATE item_grupos_modificadores SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE item_grupo_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
        [ids],
      );
    }
  }

  /** Upsert-preservando de los overrides de un grupo asociado (por grupo_opcion_id). */
  private async upsertOverridesDeGrupo(
    manager: EntityManager,
    tenantId: string,
    itemGrupoId: string,
    grupoModificadorId: string,
    opciones: { grupoOpcionId: string; cantidad?: string; unidadCodigo?: string; precioExtra?: string }[],
  ): Promise<void> {
    const vivos: { item_grupo_opcion_id: string; grupo_opcion_id: string }[] =
      await manager.query(
        `SELECT item_grupo_opcion_id, grupo_opcion_id FROM item_grupo_modificador_opciones
         WHERE item_grupo_id = $1 AND eliminado_el IS NULL`,
        [itemGrupoId],
      );
    const overrideIdPorOpcion = new Map(vivos.map((r) => [r.grupo_opcion_id, r.item_grupo_opcion_id]));
    const opcionesEntrantes = new Set<string>();

    for (const o of opciones) {
      opcionesEntrantes.add(o.grupoOpcionId);
      // La opción debe pertenecer a ESTE grupo (viva).
      const perteneceRows: { grupo_opcion_id: string }[] = await manager.query(
        `SELECT grupo_opcion_id FROM grupo_modificador_opciones
         WHERE grupo_opcion_id = $1 AND grupo_modificador_id = $2 AND tenant_id = $3
           AND eliminado_el IS NULL`,
        [o.grupoOpcionId, grupoModificadorId, tenantId],
      );
      if (!perteneceRows.length) {
        throw new BadRequestException(
          `La opción ${o.grupoOpcionId} no pertenece al grupo asociado`,
        );
      }
      if (o.cantidad != null && o.cantidad !== '' && new Decimal(o.cantidad).lessThanOrEqualTo(0)) {
        throw new BadRequestException('La cantidad del override debe ser mayor a 0');
      }
      if (o.precioExtra != null && o.precioExtra !== '' && new Decimal(o.precioExtra).lessThan(0)) {
        throw new BadRequestException('El precio extra del override debe ser mayor o igual a 0');
      }
      const cantidad = o.cantidad != null && o.cantidad !== '' ? o.cantidad : null;
      const unidad = o.unidadCodigo || null;
      const precio = o.precioExtra != null && o.precioExtra !== '' ? o.precioExtra : null;

      const existente = overrideIdPorOpcion.get(o.grupoOpcionId);
      if (existente) {
        await manager.query(
          `UPDATE item_grupo_modificador_opciones
           SET cantidad = $1, unidad_codigo = $2, precio_extra = $3, actualizado_el = NOW()
           WHERE item_grupo_opcion_id = $4`,
          [cantidad, unidad, precio, existente],
        );
      } else {
        await manager.query(
          `INSERT INTO item_grupo_modificador_opciones
             (tenant_id, item_grupo_id, grupo_opcion_id, cantidad, unidad_codigo, precio_extra)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, itemGrupoId, o.grupoOpcionId, cantidad, unidad, precio],
        );
      }
    }

    // Overrides que ya no vienen: soft-delete (vuelven a heredar el default).
    const aBorrar = vivos.filter((r) => !opcionesEntrantes.has(r.grupo_opcion_id));
    if (aBorrar.length) {
      await manager.query(
        `UPDATE item_grupo_modificador_opciones SET eliminado_el = NOW(), actualizado_el = NOW()
         WHERE item_grupo_opcion_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
        [aBorrar.map((r) => r.item_grupo_opcion_id)],
      );
    }
  }
```

> Importar `ItemGrupoOpcionOverrideInputDto` junto a `ItemGrupoModificadorInputDto` en el `import` de DTOs del service (`:12`-`:18`). `Decimal` ya está importado.

- [ ] **Step 5: Correr hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts -t "grupos modificadores en item"`
Expected: PASS.

- [ ] **Step 6: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/items/**/*.ts'
git add backend/src/modules/items/dto/create-item.dto.ts backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): asociación de grupos upsert-preservando + overrides de consumo/recargo por opción"
```

---

## Task 4: Resolución con `COALESCE` — `findOne` + `resolverGruposDeItem` + estado pendiente

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`findOne` grupos `:377`-`:433`, `resolverGruposDeItem` `:1637`-`:1737`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: tabla de override (Task 1), persistencia (Task 3).
- Produces:
  - `findOne(...).grupos[].opciones[]` gana: `cantidad: string | null` (efectiva), `cantidadDefault: string | null`, `precioExtra` (efectivo), `esPendiente: boolean`, y mantiene `unidadCodigo` (efectiva). El editor usa `cantidad`/`esPendiente` para pre-llenar y marcar.
  - `resolverGruposDeItem` toma cantidad/unidad/precio **efectivos** (`COALESCE(override, default)`); rechaza con `BadRequestException` una opción elegida con cantidad efectiva null (pendiente). El `SnapshotGrupo` se congela con los valores efectivos (shape idéntico).

- [ ] **Step 1: Escribir los tests que fallan**

En `items.service.spec.ts`:

```typescript
describe('resolución de grupos con override (COALESCE)', () => {
  it('resolverGruposDeItem usa el override de cantidad y precio sobre el default', async () => {
    // asociados: 1 grupo min0/max1 con item_grupo_id IG1
    // opciones (con COALESCE ya aplicado por la query): cantidad efectiva 250, precio 700
    jest.spyOn(managerMock, 'query')
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1', item_grupo_id: 'IG1', nombre: 'Proteína', min: 0, max: 1 }])
      .mockResolvedValueOnce([{ item_id: ITEM_OPCION, nombre: 'Carne', cantidad: '250', unidad_codigo: 'g', precio_extra: '700' }]);
    const res = await service.resolverGruposDeItem(managerMock, TENANT_ID, RECETA_ID, [
      { grupoId: 'G1', opciones: [{ itemId: ITEM_OPCION, unidades: 1 }] },
    ] as any);
    expect(res.grupos[0].opciones[0].cantidad).toBe('250');
    expect(res.grupos[0].opciones[0].precioExtra).toBe('700');
    expect(res.precioExtraTotal).toBe('700.0000');
  });

  it('rechaza elegir una opción pendiente (cantidad efectiva null)', async () => {
    jest.spyOn(managerMock, 'query')
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1', item_grupo_id: 'IG1', nombre: 'Proteína', min: 1, max: 1 }])
      .mockResolvedValueOnce([{ item_id: ITEM_OPCION, nombre: 'Carne', cantidad: null, unidad_codigo: null, precio_extra: '0' }]);
    await expect(
      service.resolverGruposDeItem(managerMock, TENANT_ID, RECETA_ID, [
        { grupoId: 'G1', opciones: [{ itemId: ITEM_OPCION, unidades: 1 }] },
      ] as any),
    ).rejects.toThrow(/sin cantidad configurada|pendiente/i);
  });
});
```

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- items.service.spec.ts -t "COALESCE"`
Expected: FAIL.

- [ ] **Step 3: `resolverGruposDeItem` — asociados con `item_grupo_id` + opciones con `COALESCE`**

1. En la query de `asociados` (`:1648`-`:1655`), añadir `igm.item_grupo_id`:

```typescript
    const asociados: {
      grupo_modificador_id: string;
      item_grupo_id: string;
      nombre: string;
      min: number;
      max: number;
    }[] = await manager.query(
      `SELECT igm.grupo_modificador_id, igm.item_grupo_id, g.nombre, igm.min, igm.max
       FROM item_grupos_modificadores igm
       JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE igm.item_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL`,
      [itemId, tenantId],
    );
```

2. En la query `opcionesCat` dentro del loop (`:1673`-`:1685`), aplicar `COALESCE` con LEFT JOIN al override de esta asociación:

```typescript
      const opcionesCat: {
        item_id: string;
        nombre: string;
        cantidad: string | null;
        unidad_codigo: string | null;
        precio_extra: string;
      }[] = await manager.query(
        `SELECT o.item_id, i.nombre,
                COALESCE(ovr.cantidad, o.cantidad) AS cantidad,
                COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
                COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra
         FROM grupo_modificador_opciones o
         JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
         LEFT JOIN item_grupo_modificador_opciones ovr
           ON ovr.grupo_opcion_id = o.grupo_opcion_id
          AND ovr.item_grupo_id = $3
          AND ovr.eliminado_el IS NULL
         WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL`,
        [asoc.grupo_modificador_id, tenantId, asoc.item_grupo_id],
      );
```

3. En el loop de opciones elegidas (`:1690`-`:1715`), tras encontrar `cat`, guardar contra pendiente:

```typescript
        const cat = opcionesCat.find((o) => o.item_id === el.itemId);
        if (!cat) {
          throw new BadRequestException(
            `La opción ${el.itemId} no pertenece al grupo ${asoc.nombre}`,
          );
        }
        if (cat.cantidad == null) {
          throw new BadRequestException(
            `La opción "${cat.nombre}" no tiene cantidad configurada para este item (pendiente)`,
          );
        }
```

El resto (`unidades`, `opcionesSnap.push`, `precioExtraTotal`) queda igual: `cat.cantidad` ya es la efectiva, `cat.precio_extra` el efectivo. `unidadCodigo: cat.unidad_codigo ?? undefined` se mantiene.

- [ ] **Step 4: `findOne` grupos — exponer efectiva + default + pendiente**

En el bloque de carga de grupos de `findOne` (`:377`-`:432`):

1. Cambiar la query `opRows` (`:404`-`:412`) para traer default y efectiva vía LEFT JOIN al override de esa asociación (necesitamos `igm.item_grupo_id`; ya está disponible como `gr` no lo trae — añadirlo a la query `grupoRows` de `:384`-`:391`):

En `grupoRows` añadir `igm.item_grupo_id`:

```typescript
      const grupoRows: {
        grupo_modificador_id: string;
        item_grupo_id: string;
        nombre: string;
        min: number;
        max: number;
        orden: number;
      }[] = await this.dataSource.query(
        `SELECT igm.grupo_modificador_id, igm.item_grupo_id, g.nombre, igm.min, igm.max, igm.orden
         FROM item_grupos_modificadores igm
         JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
           AND g.eliminado_el IS NULL
         WHERE igm.item_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
         ORDER BY igm.orden ASC`,
        [itemId, tenantId],
      );
```

Y la query `opRows`:

```typescript
        const opRows: {
          grupo_opcion_id: string;
          item_id: string;
          item_nombre: string;
          tipo: string;
          cantidad_efectiva: string | null;
          cantidad_default: string | null;
          unidad_codigo: string | null;
          precio_extra: string;
          orden: number;
          stock: string | null;
        }[] = await this.dataSource.query(
          `SELECT o.grupo_opcion_id, o.item_id, i.nombre AS item_nombre, i.tipo,
                  COALESCE(ovr.cantidad, o.cantidad) AS cantidad_efectiva,
                  o.cantidad AS cantidad_default,
                  COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
                  COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra,
                  o.orden, ip.stock
           FROM grupo_modificador_opciones o
           JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
           LEFT JOIN item_producto ip ON ip.item_id = o.item_id
           LEFT JOIN item_grupo_modificador_opciones ovr
             ON ovr.grupo_opcion_id = o.grupo_opcion_id
            AND ovr.item_grupo_id = $3
            AND ovr.eliminado_el IS NULL
           WHERE o.grupo_modificador_id = $1 AND o.tenant_id = $2 AND o.eliminado_el IS NULL
           ORDER BY o.orden ASC`,
          [gr.grupo_modificador_id, tenantId, gr.item_grupo_id],
        );
```

2. Actualizar el tipo `grupos[].opciones[]` (`:365`-`:375`) y el `map` (`:420`-`:430`):

```typescript
      opciones: {
        grupoOpcionId: string;
        itemId: string;
        itemNombre: string;
        tipo: string;
        cantidad: string | null;        // efectiva
        cantidadDefault: string | null; // default del grupo
        unidadCodigo: string | null;
        precioExtra: string;
        orden: number;
        stock: string | null;
        esPendiente: boolean;
      }[];
```

```typescript
          opciones: opRows.map((r) => ({
            grupoOpcionId: r.grupo_opcion_id,
            itemId: r.item_id,
            itemNombre: r.item_nombre,
            tipo: r.tipo,
            cantidad: r.cantidad_efectiva,
            cantidadDefault: r.cantidad_default,
            unidadCodigo: r.unidad_codigo,
            precioExtra: r.precio_extra,
            orden: r.orden,
            stock: r.stock,
            esPendiente: r.cantidad_efectiva == null,
          })),
```

- [ ] **Step 5: Correr hasta verde**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: PASS. Ajustar cualquier test viejo de `findOne`/`resolverGruposDeItem` cuyo mock de `opcionesCat` ya no calce el nuevo SELECT (añadir `item_grupo_id` a los asociados mockeados).

- [ ] **Step 6: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/items/**/*.ts'
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): resolución de grupos con COALESCE(override, default) + estado pendiente"
```

---

## Task 5: Endpoints grupo→recetas (drawer) + aplicar overrides en lote

**Files:**
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts` (`itemsUsando`, `aplicarOverrides`)
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.controller.ts`
- Create: `backend/src/modules/grupos-modificadores/dto/aplicar-overrides.dto.ts`
- Test: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts`

**Interfaces:**
- Consumes: tabla de override (Task 1); `upsertOverridesDeGrupo` es análogo pero vive en `items.service`; aquí se escribe por `item_grupo_id` resuelto desde `(item_id, grupo)`.
- Produces:
  - `GET /grupos-modificadores/:id/items` → `{ itemId, itemNombre, tipo, itemGrupoId, opciones: { grupoOpcionId, itemNombre, cantidad: string|null, cantidadDefault: string|null, unidadCodigo: string|null, precioExtra: string, esPendiente: boolean }[] }[]` — todas las recetas/combos vivos que usan el grupo, con el estado efectivo de cada opción.
  - `PATCH /grupos-modificadores/:id/overrides` con `AplicarOverridesDto { itemGrupoIds: string[]; grupoOpcionId: string; cantidad?: string; unidadCodigo?: string; precioExtra?: string }` → aplica el mismo override a las N asociaciones seleccionadas (upsert-preservando por `(item_grupo_id, grupo_opcion_id)`). Devuelve `{ actualizados: number }`.

- [ ] **Step 1: Escribir los tests que fallan**

En `grupos-modificadores.service.spec.ts`:

```typescript
describe('itemsUsando / aplicarOverrides', () => {
  it('aplicarOverrides hace upsert del mismo valor a varias asociaciones', async () => {
    managerMock.query
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }]) // grupo vivo
      .mockResolvedValueOnce([{ grupo_opcion_id: OPCION_ID }]) // opción pertenece al grupo
      .mockResolvedValueOnce([{ item_grupo_id: 'IG1' }, { item_grupo_id: 'IG2' }]) // asociaciones válidas del grupo
      .mockResolvedValueOnce([]) // overrides vivos de IG1
      .mockResolvedValueOnce([]) // INSERT override IG1
      .mockResolvedValueOnce([]) // overrides vivos de IG2
      .mockResolvedValueOnce([]); // INSERT override IG2
    const res = await service.aplicarOverrides(TENANT_ID, 'G1', {
      itemGrupoIds: ['IG1', 'IG2'], grupoOpcionId: OPCION_ID, cantidad: '150', unidadCodigo: 'g',
    } as any);
    expect(res.actualizados).toBe(2);
  });

  it('rechaza aplicar a un item_grupo_id que no pertenece al grupo', async () => {
    managerMock.query
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
      .mockResolvedValueOnce([{ grupo_opcion_id: OPCION_ID }])
      .mockResolvedValueOnce([{ item_grupo_id: 'IG1' }]); // solo IG1 es válido; IG9 no
    await expect(
      service.aplicarOverrides(TENANT_ID, 'G1', {
        itemGrupoIds: ['IG1', 'IG9'], grupoOpcionId: OPCION_ID, cantidad: '150',
      } as any),
    ).rejects.toThrow(/no pertenece|no válid/i);
  });
});
```

- [ ] **Step 2: Correr para verlos fallar**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts -t "itemsUsando / aplicarOverrides"`
Expected: FAIL.

- [ ] **Step 3: DTO**

`backend/src/modules/grupos-modificadores/dto/aplicar-overrides.dto.ts`:

```typescript
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class AplicarOverridesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  itemGrupoIds: string[];

  @IsUUID()
  grupoOpcionId: string;

  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  @IsOptional()
  @IsNumberString()
  precioExtra?: string;
}
```

- [ ] **Step 4: Servicio — `itemsUsando`**

En `grupos-modificadores.service.ts`:

```typescript
async itemsUsando(tenantId: string, grupoId: string) {
  const asociaciones: {
    item_grupo_id: string;
    item_id: string;
    item_nombre: string;
    tipo: string;
  }[] = await this.dataSource.query(
    `SELECT igm.item_grupo_id, i.item_id, i.nombre AS item_nombre, i.tipo
     FROM item_grupos_modificadores igm
     JOIN items i ON i.item_id = igm.item_id AND i.eliminado_el IS NULL
     WHERE igm.grupo_modificador_id = $1 AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
     ORDER BY i.nombre ASC`,
    [grupoId, tenantId],
  );
  if (!asociaciones.length) return [];

  const igIds = asociaciones.map((a) => a.item_grupo_id);
  const opRows: {
    item_grupo_id: string;
    grupo_opcion_id: string;
    item_nombre: string;
    cantidad_efectiva: string | null;
    cantidad_default: string | null;
    unidad_codigo: string | null;
    precio_extra: string;
    orden: number;
  }[] = await this.dataSource.query(
    `SELECT igm.item_grupo_id, o.grupo_opcion_id, i.nombre AS item_nombre,
            COALESCE(ovr.cantidad, o.cantidad) AS cantidad_efectiva,
            o.cantidad AS cantidad_default,
            COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
            COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra,
            o.orden
     FROM item_grupos_modificadores igm
     JOIN grupo_modificador_opciones o ON o.grupo_modificador_id = igm.grupo_modificador_id
       AND o.eliminado_el IS NULL
     JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
     LEFT JOIN item_grupo_modificador_opciones ovr
       ON ovr.grupo_opcion_id = o.grupo_opcion_id AND ovr.item_grupo_id = igm.item_grupo_id
      AND ovr.eliminado_el IS NULL
     WHERE igm.item_grupo_id = ANY($1::uuid[]) AND igm.tenant_id = $2
     ORDER BY o.orden ASC`,
    [igIds, tenantId],
  );

  const opsPorIg = new Map<string, typeof opRows>();
  for (const r of opRows) {
    const list = opsPorIg.get(r.item_grupo_id) ?? [];
    list.push(r);
    opsPorIg.set(r.item_grupo_id, list);
  }

  return asociaciones.map((a) => ({
    itemId: a.item_id,
    itemNombre: a.item_nombre,
    tipo: a.tipo,
    itemGrupoId: a.item_grupo_id,
    opciones: (opsPorIg.get(a.item_grupo_id) ?? []).map((r) => ({
      grupoOpcionId: r.grupo_opcion_id,
      itemNombre: r.item_nombre,
      cantidad: r.cantidad_efectiva,
      cantidadDefault: r.cantidad_default,
      unidadCodigo: r.unidad_codigo,
      precioExtra: r.precio_extra,
      esPendiente: r.cantidad_efectiva == null,
    })),
  }));
}
```

- [ ] **Step 5: Servicio — `aplicarOverrides`**

```typescript
async aplicarOverrides(tenantId: string, grupoId: string, dto: AplicarOverridesDto) {
  return this.dataSource.transaction(async (manager) => {
    const grupoRows: { grupo_modificador_id: string }[] = await manager.query(
      `SELECT grupo_modificador_id FROM grupos_modificadores
       WHERE grupo_modificador_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [grupoId, tenantId],
    );
    if (!grupoRows.length) throw new NotFoundException('Grupo de modificadores no encontrado');

    const opRows: { grupo_opcion_id: string }[] = await manager.query(
      `SELECT grupo_opcion_id FROM grupo_modificador_opciones
       WHERE grupo_opcion_id = $1 AND grupo_modificador_id = $2 AND tenant_id = $3
         AND eliminado_el IS NULL`,
      [dto.grupoOpcionId, grupoId, tenantId],
    );
    if (!opRows.length) throw new BadRequestException('La opción no pertenece al grupo');

    // item_grupo_ids válidos: asociaciones vivas de ESTE grupo en ESTE tenant.
    const validos: { item_grupo_id: string }[] = await manager.query(
      `SELECT item_grupo_id FROM item_grupos_modificadores
       WHERE item_grupo_id = ANY($1::uuid[]) AND grupo_modificador_id = $2
         AND tenant_id = $3 AND eliminado_el IS NULL`,
      [dto.itemGrupoIds, grupoId, tenantId],
    );
    const validSet = new Set(validos.map((r) => r.item_grupo_id));
    for (const ig of dto.itemGrupoIds) {
      if (!validSet.has(ig)) {
        throw new BadRequestException(`item_grupo_id no válido para este grupo: ${ig}`);
      }
    }

    if (dto.cantidad != null && dto.cantidad !== '' && new Decimal(dto.cantidad).lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }
    if (dto.precioExtra != null && dto.precioExtra !== '' && new Decimal(dto.precioExtra).lessThan(0)) {
      throw new BadRequestException('El precio extra debe ser mayor o igual a 0');
    }
    const cantidad = dto.cantidad != null && dto.cantidad !== '' ? dto.cantidad : null;
    const unidad = dto.unidadCodigo || null;
    const precio = dto.precioExtra != null && dto.precioExtra !== '' ? dto.precioExtra : null;

    let actualizados = 0;
    for (const itemGrupoId of dto.itemGrupoIds) {
      const vivos: { item_grupo_opcion_id: string }[] = await manager.query(
        `SELECT item_grupo_opcion_id FROM item_grupo_modificador_opciones
         WHERE item_grupo_id = $1 AND grupo_opcion_id = $2 AND eliminado_el IS NULL`,
        [itemGrupoId, dto.grupoOpcionId],
      );
      if (vivos.length) {
        await manager.query(
          `UPDATE item_grupo_modificador_opciones
           SET cantidad = $1, unidad_codigo = $2, precio_extra = $3, actualizado_el = NOW()
           WHERE item_grupo_opcion_id = $4`,
          [cantidad, unidad, precio, vivos[0].item_grupo_opcion_id],
        );
      } else {
        await manager.query(
          `INSERT INTO item_grupo_modificador_opciones
             (tenant_id, item_grupo_id, grupo_opcion_id, cantidad, unidad_codigo, precio_extra)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, itemGrupoId, dto.grupoOpcionId, cantidad, unidad, precio],
        );
      }
      actualizados++;
    }
    return { actualizados };
  });
}
```

> Importar `NotFoundException`, `BadRequestException`, `Decimal` y `AplicarOverridesDto` si falta alguno.

- [ ] **Step 6: Controller**

En `grupos-modificadores.controller.ts` añadir (importar `Body`, `Param`, `Patch` según falte, y `AplicarOverridesDto`):

```typescript
  @Get(':id/items')
  itemsUsando(@Req() req: any, @Param('id') id: string) {
    return this.service.itemsUsando((req.user as { tenantId: string }).tenantId, id);
  }

  @Patch(':id/overrides')
  @UseGuards(TenantAdminGuard)
  aplicarOverrides(@Req() req: any, @Param('id') id: string, @Body() dto: AplicarOverridesDto) {
    return this.service.aplicarOverrides((req.user as { tenantId: string }).tenantId, id, dto);
  }
```

- [ ] **Step 7: Correr hasta verde**

Run: `cd backend && npm test -- grupos-modificadores.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Lint acotado + commit**

```bash
cd backend && ./node_modules/.bin/eslint 'src/modules/grupos-modificadores/**/*.ts'
git add backend/src/modules/grupos-modificadores
git commit -m "feat(grupos-modificadores): endpoints items-usando + aplicar overrides en lote"
```

---

## Task 6: E2E — grupo reusado por 2 recetas con overrides distintos

**Files:**
- Create: `backend/test/grupos-modificadores-overrides.e2e-spec.ts`

**Interfaces:**
- Consumes: endpoints de items y grupos; venta con personalización.

- [ ] **Step 1: Escribir el E2E**

Seguir el arnés de los `*.e2e-spec.ts` existentes (montar `AppModule`, autenticar, abrir caja). Flujo:

```typescript
// 1. Crear un ingrediente "Carne" con stock alto (p.ej. 100000 g) y unidad base g.
// 2. POST /grupos-modificadores "Proteína" con opción Carne SIN cantidad default (o con 150 default).
// 3. Crear receta "Hamburguesa Clásica" asociando el grupo con opciones:[{ grupoOpcionId, cantidad:'150', unidadCodigo:'g' }].
// 4. Crear receta "Hamburguesa XL" asociando el mismo grupo con opciones:[{ grupoOpcionId, cantidad:'250', unidadCodigo:'g' }].
// 5. Vender 1 Clásica eligiendo Carne → movimiento salida de 150 g.
// 6. Vender 1 XL eligiendo Carne → movimiento salida de 250 g.
// 7. Assert de los dos movimientos por cantidad (150 y 250) sobre el MISMO ingrediente.
// 8. (Pendiente) Crear una 3ª receta que asocie el grupo SIN override y con default null:
//    GET /items/:id debe marcar esa opción esPendiente=true.
```

- [ ] **Step 2: Correr el E2E**

Run: `cd backend && npm run test:e2e -- grupos-modificadores-overrides`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/test/grupos-modificadores-overrides.e2e-spec.ts
git commit -m "test(grupos-modificadores): e2e override de consumo por receta"
```

---

## Task 7: Frontend — cantidad/unidad opcionales en el form del grupo + drawer "usado en recetas"

**Files:**
- Modify: `frontend/app/pages/configuracion/grupos-modificadores.vue`

**Interfaces:**
- Consumes: `POST/PATCH /grupos-modificadores` con `cantidad` opcional; `GET /grupos-modificadores/:id/items`; `PATCH /grupos-modificadores/:id/overrides`.
- Produces: form de grupo donde cantidad/unidad son opcionales (defaults); drawer con la lista de recetas que usan el grupo, con selección múltiple y aplicar-en-lote de cantidad+unidad+precio por opción.

- [ ] **Step 1: Cantidad/unidad opcionales en el form**

En `OpcionRow` (`:7`-`:12`) `cantidad` pasa a opcional (`cantidad?: string`). En `validarForm` (`:227`), no exigir cantidad; si viene, validar `> 0`. En el `guardar`, mandar `cantidad` solo si no está vacía. En el template (`:417`-`:419`), cambiar el placeholder/label a "Cantidad (opcional)" y aclarar con un `text-xs text-muted` que sin cantidad la opción se configura por receta.

> Cargar el skill `nuxt-ui` antes de tocar el markup. Mantener tokens semánticos.

- [ ] **Step 2: Estado del drawer de recetas**

Añadir refs y carga (junto a los refs de `:53`-`:60`):

```typescript
const recetasDrawerOpen = ref(false)
const recetasGrupoId = ref<string | null>(null)
const recetasUsando = ref<{
  itemId: string; itemNombre: string; tipo: string; itemGrupoId: string
  opciones: { grupoOpcionId: string; itemNombre: string; cantidad: string | null; cantidadDefault: string | null; unidadCodigo: string | null; precioExtra: string; esPendiente: boolean }[]
}[]>([])
const seleccionIg = ref<Set<string>>(new Set())
const loteCantidad = ref('')
const loteUnidad = ref<string | undefined>(undefined)
const lotePrecio = ref('')
const loteOpcionId = ref<string | null>(null)

async function abrirRecetas(grupo: Grupo) {
  recetasGrupoId.value = grupo.grupoModificadorId
  recetasUsando.value = await useApiFetch(`${apiUrl}/grupos-modificadores/${grupo.grupoModificadorId}/items`)
  seleccionIg.value = new Set()
  recetasDrawerOpen.value = true
}

async function aplicarLote() {
  if (!recetasGrupoId.value || !loteOpcionId.value || !seleccionIg.value.size) return
  await useApiFetch(`${apiUrl}/grupos-modificadores/${recetasGrupoId.value}/overrides`, {
    method: 'PATCH',
    body: {
      itemGrupoIds: [...seleccionIg.value],
      grupoOpcionId: loteOpcionId.value,
      cantidad: loteCantidad.value || undefined,
      unidadCodigo: loteUnidad.value || undefined,
      precioExtra: lotePrecio.value || undefined,
    },
  })
  // Re-cargar la lista del drawer para reflejar los nuevos efectivos (mutación local sobre el ref).
  recetasUsando.value = await useApiFetch(`${apiUrl}/grupos-modificadores/${recetasGrupoId.value}/items`)
  toast.add({ title: `Aplicado a ${seleccionIg.value.size} recetas`, color: 'success' })
}
```

> Excepción a "no `cargar()` post-mutación": el `PATCH /overrides` devuelve solo `{ actualizados }`, no el estado por opción; re-pedir la lista del drawer es la forma más simple de reflejar los efectivos recalculados. Documentarlo con un comentario (ya incluido) para no romper la convención sin querer.

- [ ] **Step 3: Botón "Usado en N recetas" en la tabla**

En la celda de uso de la `CrudTable` (`itemsUsandoCount`), envolver el número en un `UButton variant="link"` que llama `abrirRecetas(row.original)` cuando `itemsUsandoCount > 0`. Así el drawer se abre desde la fila del grupo.

- [ ] **Step 4: Drawer de recetas (template)**

Añadir un segundo `AppDrawer v-model:open="recetasDrawerOpen"` con:
- Un control de lote arriba: `USelectMenu` de opción (`loteOpcionId`, items = opciones del grupo), `UInput` cantidad (`loteCantidad`), `USelectMenu` unidad (`loteUnidad`, visible si la familia es ingrediente), `UInput` precio (`lotePrecio`), y `UButton` "Aplicar a seleccionadas (N)" → `aplicarLote()`.
- Una `UTable` con selección múltiple (`v-model:row-selection` mapeando a `seleccionIg`) de `recetasUsando`: columnas Receta, y por la opción activa (`loteOpcionId`) mostrar cantidad efectiva/unidad/precio con un `UBadge` "Pendiente" (color warning) cuando `esPendiente`. Cada fila editable inline es opcional; el flujo principal es seleccionar filas + aplicar en lote.

> Cargar el skill `nuxt-ui` para las props v4 de `UTable` (row selection) y `USelectMenu`. Usar tokens semánticos.

- [ ] **Step 5: Verificación manual**

Run: `cd frontend && npm run dev`, abrir `/configuracion/grupos-modificadores`.
Verificar: crear grupo sin cantidad; abrir "usado en N recetas"; seleccionar varias; aplicar 150 g; ver los efectivos actualizados y los pendientes desaparecer.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/pages/configuracion/grupos-modificadores.vue
git commit -m "feat(grupos-modificadores): cantidad opcional + drawer usado-en-recetas con aplicar en lote"
```

---

## Task 8: Frontend — overrides por opción en el editor de items + POS oculta pendientes

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue`
- Modify: `frontend/app/composables/useRecetaPersonalizacion.ts`
- Modify: `frontend/app/components/ventas/ItemPersonalizacionDrawer.vue`

**Interfaces:**
- Consumes: `GET /items/:id` con `grupos[].opciones[].{cantidad, cantidadDefault, esPendiente}`; `PATCH /items/:id` con `gruposModificadores[].opciones[]`.
- Produces: al asociar un grupo a una receta/combo, una tabla de sus opciones con cantidad/unidad/precio pre-llenados desde el default (editables = override); POS/drawer no ofrece opciones pendientes.

- [ ] **Step 1: Tipos del override en el form de items**

En `items.vue`, ampliar `GrupoAsocRow` (`:74`-`:78`) con `opciones` overrides:

```typescript
interface GrupoOpcionOverrideRow {
  grupoOpcionId: string
  itemNombre: string
  cantidad: string          // efectiva (pre-llenada con default; '' = pendiente)
  cantidadDefault: string | null
  unidadCodigo?: string
  precioExtra: string
  esPendiente: boolean
}
interface GrupoAsocRow {
  grupoModificadorId: string
  min: string
  max: string
  orden?: string
  opciones: GrupoOpcionOverrideRow[]
}
```

- [ ] **Step 2: Poblar overrides al elegir/editar un grupo**

- Al **editar** un item (mapeo de `detalle.grupos` en `:720`-`:723`), incluir las opciones:

```typescript
      gruposModificadores: (detalle.grupos ?? []).map(g => ({
        grupoModificadorId: g.grupoModificadorId,
        min: String(g.min),
        max: String(g.max),
        opciones: (g.opciones ?? []).map(o => ({
          grupoOpcionId: o.grupoOpcionId,
          itemNombre: o.itemNombre,
          cantidad: o.cantidad ?? '',
          cantidadDefault: o.cantidadDefault,
          unidadCodigo: o.unidadCodigo ?? undefined,
          precioExtra: o.precioExtra,
          esPendiente: o.esPendiente,
        })),
      })),
```

- Al **elegir** un grupo nuevo en el `USelectMenu` (`:1688`-`:1696`), cargar sus opciones desde `gruposCatalogo` (que ya trae `opciones`) pre-llenando `cantidad` con el default (si existe) — añadir un handler `onSelectGrupo(idx, grupoId)` que setea `form.gruposModificadores[idx].opciones` desde el catálogo. (Extender `gruposCatalogo` en `cargarGruposCatalogo` `:227`-`:231` para traer `grupoOpcionId`, `cantidad`/`cantidadDefault`, `unidadCodigo`, `precioExtra` por opción — el `GET /grupos-modificadores` ya los expone.)

- [ ] **Step 3: Payload en `guardar`**

En el `map` de `gruposModificadores` del payload (`:870`-`:873`), incluir las opciones override (mandar cantidad/unidad/precio solo si difieren del default o si el default es null; simplificación aceptable: mandar siempre lo editado no vacío):

```typescript
      payload.gruposModificadores = form.value.gruposModificadores.map(g => ({
        grupoModificadorId: g.grupoModificadorId,
        min: Number(g.min),
        max: Number(g.max),
        opciones: g.opciones
          .filter(o => o.cantidad !== '' || o.unidadCodigo || o.precioExtra !== (o.cantidadDefault === null ? '' : o.precioExtra))
          .map(o => ({
            grupoOpcionId: o.grupoOpcionId,
            cantidad: o.cantidad || undefined,
            unidadCodigo: o.unidadCodigo || undefined,
            precioExtra: o.precioExtra || undefined,
          })),
      }))
```

> Regla práctica: se manda un override cuando el usuario puso una cantidad (o unidad/precio). Si deja la fila igual al default, no hace falta override — pero mandar uno idéntico tampoco rompe nada (COALESCE da el mismo valor). Mantener el filtro simple.

- [ ] **Step 4: Tabla de opciones en el editor (template)**

Reemplazar el bloque "Opciones del grupo (solo lectura)" (`:1715`-`:1726`) por una tabla editable: por cada `op in form.gruposModificadores[idx].opciones`, un `UInput` de cantidad (placeholder = `cantidadDefault ?? 'pendiente'`), un `USelectMenu` de unidad si la familia es ingrediente, un `UInput` de precio (placeholder = default), y un `UBadge` "Pendiente" cuando `cantidad === '' && !cantidadDefault`. Encima, un texto `text-xs text-muted`: "Vacío = hereda el default del grupo. Sin default = opción pendiente (no vendible en este item)."

> Cargar el skill `nuxt-ui`. Tokens semánticos, sin Tailwind hardcodeado.

- [ ] **Step 5: POS/drawer oculta pendientes**

- En `useRecetaPersonalizacion.ts`, añadir `esPendiente?: boolean` a `GrupoOpcionPersonalizacion` (`:23`-`:34`).
- En `ItemPersonalizacionDrawer.vue`, filtrar/deshabilitar las opciones con `esPendiente` (no seleccionables) — análogo a cómo hoy trata `opcionSinStock`. Añadir un `title`/tooltip "No configurada para este item".
- Verificar que el `min` del grupo siga siendo alcanzable con las opciones elegibles; si todas las opciones de un grupo `min ≥ 1` están pendientes, el item no debería ofrecerse (mismo tratamiento que "sin stock"). Confirmar el criterio con el flujo existente de disponibilidad.

- [ ] **Step 6: Verificación manual**

Run: `cd frontend && npm run dev`.
Verificar: asociar un grupo a una receta pre-llena las cantidades con el default; cambiar una a 250 y guardar persiste el override; una opción sin default queda "Pendiente" y no aparece en el POS.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/pages/configuracion/items.vue frontend/app/composables/useRecetaPersonalizacion.ts \
        frontend/app/components/ventas/ItemPersonalizacionDrawer.vue
git commit -m "feat(items): overrides de consumo por opción en el editor + POS oculta pendientes"
```

---

## Task 9: Seed + documentación viva

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Modify: `docs/features/grupos-modificadores.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`, `docs/patterns/backend.md`
- Create: `docs/adr/0NN-cantidades-consumo-por-item.md` + fila en `docs/adr/README.md`

- [ ] **Step 1: Seed demo con override**

En `seeder.service.ts`, ajustar el seed de grupos/recetas para que un mismo grupo "Proteína" se use en dos recetas con cantidades distintas vía override (una Clásica 150 g, una XL 250 g). Insertar los overrides en `item_grupo_modificador_opciones`. Usar IDs `550e8400-e29b-41d4-a716-446655440XXX` con el siguiente número libre (verificar el máximo con `grep 44066550 seeder.service.ts`).

- [ ] **Step 2: Verificar el seed al arrancar**

Run: `docker-compose up backend` (o `cd backend && npm run start:dev`). Confirmar en logs que el seed corre sin error; `GET /items/:id` de ambas recetas muestra la opción con cantidad efectiva 150 y 250 respectivamente.

- [ ] **Step 3: Documentación**

- `docs/features/grupos-modificadores.md`: sección "Cantidades de consumo por item" — modelo híbrido, `COALESCE(override, default)`, tabla `item_grupo_modificador_opciones`, estado pendiente, upsert-preservando.
- `docs/patterns/backend.md`: patrón "upsert-preservando UUID por llave de negocio" (para no huérfanar hijos) — documentar con el ejemplo de opciones/asociaciones.
- `docs/ESTADO.md`: fila actualizada con fecha 2026-07-21.
- `docs/PRODUCTO.md`: regla de negocio — la cantidad/recargo de una opción de grupo se define por receta; el grupo es catálogo reutilizable.
- Nuevo ADR: decisión híbrido vs puro, llave del override por UUID preservado, cero migración.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/seeder/seeder.service.ts docs/
git commit -m "docs+seed(grupos-modificadores): cantidades de consumo por item (feature, ADR, ESTADO, PRODUCTO, patterns)"
```

---

## Decisions

1. **Híbrido, no puro.** El grupo mantiene `cantidad`/`unidad`/`precio_extra` como defaults opcionales; la receta overridea vía `item_grupo_modificador_opciones`. Motivo: cero migración de datos, cero impacto en ventas pasadas (el snapshot ya congela la cantidad), opciones nuevas vendibles desde el día 1 si el grupo tiene default, y el drawer de recetas se pre-llena en vez de exigir 40 formularios vacíos.
2. **`precio_extra` sigue la misma lógica** (default en grupo + override por receta). El default es `NOT NULL DEFAULT 0`, así que el precio efectivo nunca es null.
3. **Override diferible.** Una opción sin cantidad efectiva es *pendiente*: no se ofrece en el POS y `resolverGruposDeItem` la rechaza si llega elegida, pero **no** bloquea guardar el grupo ni la receta.
4. **Llave del override = UUIDs `item_grupo_id` + `grupo_opcion_id`, preservados.** En vez de la llave de negocio estable, se mantienen los UUIDs del doc y se reescriben los dos flujos de reemplazo-total a **upsert-preservando** (por `item_id` de la opción / `grupo_modificador_id` de la asociación), con cascada de soft-delete a los overrides de opciones/asociaciones eliminadas. Riesgo asumido: toca dos servicios ya en producción de dev; mitigado con tests de preservación y de cascada.

## Self-Review — cobertura vs. decisiones

- **Cantidad default opcional + tabla override + `cantidad` nullable** → Task 1. ✔
- **Upsert-preservando `grupo_opcion_id` + cascada** → Task 2. ✔
- **Upsert-preservando `item_grupo_id` + persistir overrides + cascada** → Task 3. ✔
- **`COALESCE(override, default)` en resolución + venta + estado pendiente (snapshot intacto)** → Task 4 (+ E2E Task 6). ✔
- **Endpoints drawer recetas + aplicar en lote** → Task 5. ✔
- **Frontend grupo (cantidad opcional + drawer selección múltiple)** → Task 7. ✔
- **Frontend item (overrides por opción) + POS oculta pendientes** → Task 8. ✔
- **Seed + docs + ADR + patterns** → Task 9. ✔
- **Cero migración de datos** → garantizado por el modelo híbrido (defaults se quedan en el grupo); ninguna task ejecuta backfill. ✔

**Type consistency:** `itemGrupoId`, `grupoOpcionId`, `cantidad: string | null`, `cantidadDefault`, `precioExtra`, `esPendiente` usados igual en Tasks 3-8; `AplicarOverridesDto`/`ItemGrupoOpcionOverrideInputDto` con las firmas declaradas en sus bloques Interfaces.
