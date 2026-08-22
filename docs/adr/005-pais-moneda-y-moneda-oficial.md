# ADR-005: Tabla `pais_moneda` y moneda oficial derivada del país

**Status**: Accepted  
**Date**: 2026-06-22

> ➕ **Extendido por [ADR-021](./021-una-sola-moneda-oficial.md) (2026-08-21).** Este ADR decidió
> que la moneda oficial se deriva del país y que el tenant no la elige, pero `tenant_moneda`
> conservaba un flag `es_default` que en los hechos competía por el mismo nombre y terminó
> decidiendo la escala de la plata en el camino de venta. ADR-021 elimina ese campo: hoy
> "oficial" nombra **una sola cosa**.

## Context

La funcionalidad "Configuración de monedas por tenant" (func. #6) requiere mostrar
las monedas que un tenant puede habilitar. El catálogo `moneda` es **global** (CLP,
UF, USD, …) y no existía ninguna relación que acotara qué monedas aplican a cada país.

Además, el sistema legacy modelaba un flag `es_oficial` editable en `cliente_moneda`,
pero la regla de negocio del nuevo sistema es que la moneda oficial proviene de
`pais.moneda_oficial_id` y **no la elige el tenant**. La tabla `tenant_moneda` ya
existía en el esquema sin columna `es_oficial`.

## Decision

1. Introducir una tabla puente **`pais_moneda`** (PK compuesta `pais_id` + `moneda_id`,
   con soft delete) que define el subconjunto del catálogo global disponible por país.
   La pantalla de monedas del tenant lista las monedas de `pais_moneda` para el país
   de su provincia, no todo el catálogo.

2. La **moneda oficial se deriva** de `pais.moneda_oficial_id`. En la API se expone
   como un flag calculado `esOficial`; la oficial está siempre habilitada y con
   `valor_del_dia = 1`. No se persiste `es_oficial` en `tenant_moneda`.

## Consequences

### Positive

- El conjunto de monedas por país queda acotado y es dato de catálogo (sembrable).
- Una sola fuente de verdad para la moneda oficial (`pais.moneda_oficial_id`), sin
  riesgo de inconsistencia entre tenants del mismo país.
- Garantiza "≥1 moneda habilitada" sin lógica adicional: la oficial nunca se deshabilita.

### Negative

- Alta de una nueva tabla y su seeding; al agregar un país hay que poblar `pais_moneda`.

### Neutral

- Gestionar qué monedas están disponibles por país (editar `pais_moneda`) será una
  función de superadmin en una fase futura; hoy se siembra.
