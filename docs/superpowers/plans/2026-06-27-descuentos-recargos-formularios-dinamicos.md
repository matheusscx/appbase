# Plan: Formularios dinámicos por tipo — Descuentos y Recargos

**Status**: Done
**Date**: 2026-06-27
**Owner**: Cesar Matheus

## Context

Los formularios de descuentos y recargos eran estáticos: mostraban siempre los mismos campos
independientemente del `tipo_regla` seleccionado. El spec requería adaptar el formulario a cada
uno de los 10 tipos: algunos usan tramos (tabla de rangos), otros un multi-select de métodos de
pago, otros un entero de días de vencimiento, y los simples solo un `valor` fijo.

## Scope

- Backend: 10 tipos_regla en seeder, 4 nuevas entidades (tramos + bridges de método_pago),
  DTOs extendidos, servicio transaccional con reemplazo de hijos, endpoint nombre-disponible.
- Frontend: `reglas-form-config.ts` + formularios dinámicos en `descuentos.vue` y `recargos.vue`.
- Out of scope: evaluación de condiciones en el motor de precios, aplicación a ventas.

## What was built

- **B1**: `tipos_regla` seeder actualizado a 10 tipos (rango_fechas eliminado, 6 tipos nuevos agregados)
- **B2**: `valor` nullable en entidades `Descuento` y `Recargo`
- **B3**: 4 nuevas entidades — `DescuentoTramo`, `RecargoTramo`, `DescuentoMetodoPago`, `RecargoMetodoPago`
- **B4**: DTOs extendidos — `metodoPagoIds`, `tramos`, `diasVencimiento`, `fechas`
- **B5**: create/update transaccional con reemplazo completo de hijos; `findAll` enriquecido con tramos y métodos
- **B6**: `GET /descuentos|recargos/nombre-disponible` — validación de unicidad de nombre
- **B7**: TDD — 122/122 tests passing
- **F1–F5**: `utils/reglas-form-config.ts` + formularios dinámicos en `descuentos.vue` y `recargos.vue`

## Key decisions

- Tramos y bridges de métodos de pago se almacenan en tablas relacionales (no JSON).
- `condicion_tipo` se deriva server-side del `codigo` del tipo de regla.
- `condicion_valor` reutiliza la columna TEXT existente para `diasVencimiento` (entero escalar).
- Ver [ADR-006](../../adr/006-relational-tramos-and-metodos-pago.md) para la decisión de modelado.
