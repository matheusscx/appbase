# Plan: Catálogo de items — productos y servicios (Punto 8)

**Status:** Done
**Date:** 2026-06-23
**Owner:** Cesar Matheus

## Context

El punto 8 de `docs/MIGRACION-FUNCIONALIDADES.md` implementa el catálogo de items vendibles del
tenant. Depende del punto 7 (catálogos financieros: categorías, impuestos, descuentos, recargos).
Los items son la entrada principal del motor de precios (punto 9) y del procesamiento de ventas
(punto 10).

## Decisiones tomadas

- **1 módulo `items`** con 3 entities: `Item` (tabla `items`), `ItemProducto` (extensión 1:1),
  `ItemServicio` (extensión 1:1). Sin entidades para las tablas N:M (raw SQL).
- **Tipo fijo al crear** (`tipo: 'producto' | 'servicio'`): no se permite cambiar post-creación.
- **N:M con reemplazo total** en `update`: si se pasa `impuestosIds`, se borran todas y se
  reinsertan. `undefined` = no tocar las relaciones existentes; `[]` = limpiar todo.
- **Validaciones de negocio**: moneda válida para el tenant (vía `pais_moneda` JOIN), categoría
  pertenece al tenant, reglas (impuestos/descuentos/recargos) pertenecen al tenant.
- **Ajuste de stock**: endpoint dedicado `PATCH /items/:id/stock` con `{ cantidad, tipo:
  'entrada'|'salida' }`. Usa Decimal.js; rechaza salida que llevaría stock negativo.
- **Soft delete**: `UPDATE items SET activo=false, eliminado_el=NOW()`. Las extensiones y
  relaciones N:M permanecen intactas.
- **Frontend**: modal grande con scroll; campos de extensión condicionales según `tipo`;
  3 `USelectMenu multiple` para reglas; modal separado para ajuste de stock.
- **Seed**: 2 items demo para tenant Paris (Smartphone S24 como producto con IVA 19%;
  Soporte técnico como servicio). IDs: `440116` y `440117`.

## Scope / Out of scope

**In:** CRUD completo de items con extensiones y reglas N:M, ajuste de stock, toggle activo
optimista, validaciones de pertenencia al tenant, 18 tests unitarios, tsc limpio, 0 errores lint.

**Out:** consultas especiales stock bajo / vencimiento próximo (para cuando ventas las consuma);
CRUD de extensiones por separado; historial de movimientos de stock.

## Backend

- **Entities**: `Item`, `ItemProducto`, `ItemServicio` en `modules/items/entities/`.
- **DTOs**: `CreateItemDto`, `UpdateItemDto` (manual, sin PartialType), `AjusteStockDto`.
- **Service** (`DataSource` + `EntityManager`): `findAll` (con filtros tipo/categoría),
  `findOne` (con N:M IDs), `create` (transacción), `update` (transacción, reemplazo N:M),
  `remove` (raw SQL soft delete + activo=false), `ajustarStock` (transacción con Decimal.js).
- **Controller**: 6 rutas; `JwtAuthGuard + TenantGuard` en clase, `TenantAdminGuard` en
  mutaciones; `PATCH :id/stock` con `TenantAdminGuard`.

## Frontend

- **`/configuracion/items`** — lista con badge tipo (Producto/Servicio en UBadge), precio,
  categoría, stock/duración; toggle activo optimista; modal crear/editar con campos condicionales
  por tipo; modal confirmar eliminar; modal ajuste de stock.
- **Nav**: "Items" con `i-heroicons-archive-box` en `configuracion.vue`.

## Verificación

- `npm test -- --no-coverage`: 86/86 ✅
- `npx tsc --noEmit`: 0 errores ✅
- `npm run lint`: 0 errores ✅
