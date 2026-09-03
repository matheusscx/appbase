# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for significant technical choices in the project.

## What is an ADR?

An ADR documents an important architectural decision, including the context that led to it and the consequences of the choice. ADRs help future developers (including future you) understand the "why" behind decisions, not just the "what."

Format based on [Michael Nygard's ADR template](https://github.com/joelparkerhenderson/architecture_decision_record).

## ADR Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [001](./001-jwt-auth.md) | Use JWT for stateless authentication | Accepted | 2026-06-13 |
| [002](./002-google-oauth.md) | Support Google OAuth 2.0 for social login | Accepted | 2026-06-13 |
| [003](./003-jwt-decode-client.md) | Decodificar JWT en cliente sin librería + patrón híbrido JWT/store | Accepted | 2026-06-20 |
| [004](./004-uuid-column-types.md) | Declarar `type: 'uuid'` explícito en todas las columnas PK y FK de UUID en entidades TypeORM | Accepted | 2026-06-21 |
| [005](./005-pais-moneda-y-moneda-oficial.md) | Tabla `pais_moneda` y moneda oficial derivada del país | Accepted | 2026-06-22 |
| [006](./006-relational-tramos-and-metodos-pago.md) | Modelado relacional de tramos y métodos de pago en reglas de descuento/recargo | Accepted | 2026-06-27 |
| [007](./007-inventario-serie-lote.md) | Modelo de inventario serializado y por lote — eje `modo_inventario` | Accepted | 2026-06-28 |
| [008](./008-cifrado-credenciales-pasarela.md) | Cifrado de credenciales de la pasarela de pagos (AES-256-GCM app-level) | Accepted | 2026-07-08 |
| [009](./009-callback-pasarela-venta-por-callback.md) | Callback de pasarela — venta creada por callback (registry in-process vs HTTP), no por el navegador | Accepted | 2026-07-08 |
| [010](./010-preparacion-sii-datos-fiscales.md) | Preparación para SII — capturar y congelar el dato fiscal ahora, diferir la integración | Accepted | 2026-07-14 |
| [011](./011-catalogo-impuestos-sistema.md) | Catálogo de impuestos del sistema por país + semántica de "exento" (solo IVA) | Accepted | 2026-07-19 |
| [012](./012-combos-precio-propio-y-descuento-por-tipo.md) | Combos: precio propio fijo, una línea de venta, sin conocimiento de inventario | Accepted | 2026-07-20 |
| [013](./013-grupos-modificadores-reutilizables.md) | Grupos de modificadores reutilizables: sin tipo declarado (familia derivada), precio en el grupo sin override, min/max en unidades, opción siempre bloqueante | Accepted | 2026-07-20 |
| [014](./014-cantidades-consumo-por-item.md) | Cantidades de consumo por item: modelo híbrido default+override sobre grupos de modificadores (cantidad/precioExtra por receta), llave del override por UUIDs preservados, cero migración | Accepted | 2026-07-21 |
| [015](./015-grupos-anidados-combo-un-nivel.md) | Grupos anidados en combos: automático, por unidad, un nivel, cero tablas nuevas (reuso de `resolverGruposDeItem`/`venderOpcionesGrupos`); cambio global de selector en vez de radio buttons | Accepted | 2026-07-22 |
| [016](./016-costeo-promedio-ponderado-movil.md) | Costeo por promedio ponderado móvil (CPP), método fijo, de gestión — no FIFO, no elegible por tenant, no tributario | Accepted | 2026-07-26 |
| [017](./017-spa-sin-ssr.md) | La app es una SPA (`ssr: false`): toda ruta está detrás de `auth` y el servidor no puede autenticarse, así que el SSR renderizaba un menú vacío y rompía la hidratación | Accepted | 2026-07-30 |
| [018](./018-iva-derivado-de-la-clasificacion.md) | El IVA se deriva de `clasificacion_tributaria` en el motor de precios, nunca se materializa en `item_impuestos` | Accepted | 2026-07-31 |
| [019](./019-timestamptz-en-toda-columna-de-fecha.md) | Declarar `type: 'timestamptz'` explícito en toda columna de fecha (hermano de ADR-004) | Accepted | 2026-08-06 |
| [020](./020-contexto-transaccional-als.md) | Contexto transaccional con AsyncLocalStorage — la conexión de la transacción viaja sola | Accepted | 2026-08-18 |
| [021](./021-una-sola-moneda-oficial.md) | Una sola noción de moneda oficial — se elimina `tenant_moneda.es_default` | Accepted | 2026-08-21 |
| [022](./022-navegador-un-solo-origen.md) | El navegador habla con un solo origen — el frontend hace de proxy de `/api` | Accepted | 2026-08-23 |
| [023](./023-promociones-familia-propia-del-motor.md) | Promociones: evaluador puro afuera del motor, aplicación y conflicto adentro, familia propia de traza y congelado | Accepted | 2026-08-27 |
| [024](./024-decimales-redondeo-y-unidades-de-cuenta.md) | Decimales y redondeo: un criterio con el número puesto por la moneda, el nivel lo fija el país, la UF solo cotiza | Accepted | 2026-09-03 |
| [025](./025-decimales-estado-actual.md) | Estado actual de los decimales — línea base medida contra la que se mide ADR-024, con las cinco preguntas contestadas desde el código | Accepted | 2026-09-03 |

## Creating a New ADR

### Steps

1. **Increment the number**: Use the next available number (e.g., `003-feature-name.md`)
2. **Use this template**:

```markdown
# ADR-XXX: [Title]

**Status**: Proposed / Accepted / Deprecated / Superseded by ADR-YYY

**Date**: YYYY-MM-DD

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive

- Benefit 1
- Benefit 2

### Negative

- Trade-off 1
- Trade-off 2

### Neutral

- Side effect 1
```

3. **Add to index**: Update this file's index table
4. **Link from relevant docs**: Reference the ADR from feature docs or architecture guides

### When to Create an ADR

- Choosing between libraries or frameworks
- Database design decisions
- Authentication/authorization approach
- Architectural patterns (modules, layers, etc.)
- Performance optimizations with trade-offs
- Infrastructure choices (Docker, cloud provider, etc.)

### When NOT to Create an ADR

- Implementation details (local variable naming, function signature tweaks)
- Bug fixes
- Refactoring that doesn't change external behavior
- Small UI tweaks

## Reading an ADR

The **Status** field tells you:
- **Proposed**: Under discussion, not yet committed
- **Accepted**: Decision is made and implemented
- **Deprecated**: Was decided, but we're moving away from it
- **Superseded by ADR-XXX**: Replaced by a newer decision

The **Consequences** section is the most important — it explains both benefits and trade-offs, so you can judge whether the decision still fits your context.
