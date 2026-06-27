# ADR-006: Modelado relacional de tramos y métodos de pago en reglas de descuento/recargo

**Date**: 2026-06-27
**Status**: Accepted

## Context

El spec de descuentos/recargos introdujo tres nuevas formas de datos:

- **Tramos** para los tipos `POR_MAYOR` y `POR_MONTO_VENTA`: tabla de rangos (minimo, maximo, valor)
- **Multi-select de métodos de pago** para tipos `METODO_PAGO` y `RECARGO_METODO_PAGO`
- **Un entero escalar** (días de vencimiento) para tipos `PRONTO_PAGO` y `MORA`

Se evaluaron dos opciones de persistencia: tablas relacionales vs. JSON en la columna TEXT
`condicion_valor` ya existente.

## Decision

Almacenar tramos y asociaciones de métodos de pago en **tablas relacionales**
(`descuento_tramos`, `recargo_tramos`, `descuento_metodo_pago`, `recargo_metodo_pago`),
no como JSON en la columna `condicion_valor`.

Almacenar días de vencimiento en la columna TEXT `condicion_valor` existente (como string
de entero) — es un escalar simple, no una colección.

## Reasoning

- **Alineado con el principio del proyecto**: CLAUDE.md establece "condiciones modeladas en BD,
  lógica de evaluación en fase posterior". El modelado relacional respeta este principio desde
  el inicio.
- **Preparación para el motor de precios**: los tramos requieren `JOIN ... ORDER BY minimo`
  en el camino crítico de cada venta. Almacenarlos como JSON exigiría parsing en memoria en
  cada cálculo.
- **Integridad**: FKs a `metodos_pago` con soft delete consistente; `numeric(18,4)` en los
  valores de tramos en lugar de strings dentro de JSON.
- **JSON solo tiene sentido** para prototipos o datos que nunca se consultan individualmente —
  ninguno de los dos casos aplica aquí.

## Consequences

### Positive

- Consultas eficientes de tramos ordenados por `JOIN`
- Integridad referencial a `metodos_pago`
- Consistencia con el patrón de soft delete del proyecto
- Motor de precios puede consumir tramos directamente con SQL

### Negative

- 4 tablas adicionales (`descuento_tramos`, `recargo_tramos`, `descuento_metodo_pago`,
  `recargo_metodo_pago`)
- create/update son operaciones transaccionales (padre + reemplazo total de hijos)

### Neutral

- `valor` pasa a ser nullable en `descuentos` y `recargos` (los tipos con tramos no tienen
  un único valor)
- `condicion_valor` sigue usándose para el escalar `diasVencimiento` (string integer)
