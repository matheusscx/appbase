# Feature: Configuración de monedas por tenant (multi-moneda + tasa de cambio)

**Módulo:** Configuración — Monedas  
**Estado:** ✅ Implementado  
**Fecha:** 2026-06-22

## Qué hace

Permite al administrador de un tenant gestionar las monedas que su empresa acepta:
habilitar/deshabilitar las monedas disponibles para su país, marcar una como
**predeterminada** (preseleccionada en el UI de ventas) y definir la **tasa de
cambio del día** (`valor_del_dia`) usada para convertir a la moneda oficial.

La **moneda oficial** se deriva de `pais.moneda_oficial_id` (no la elige el tenant):
se muestra con un distintivo, está siempre habilitada y su tasa es fija en `1`.

## Reglas de negocio

- Solo se listan las monedas ligadas al país del tenant vía `pais_moneda`.
- La moneda oficial no se puede deshabilitar (garantiza ≥1 habilitada) ni editar su tasa.
- No se puede deshabilitar la moneda predeterminada (hay que cambiar el default primero).
- Para marcar una moneda como predeterminada debe estar habilitada.
- Al crear un tenant se habilita automáticamente su moneda oficial como predeterminada (tasa 1).

## Rutas backend

| Método | Ruta | Guard | Descripción |
|---|---|---|---|
| GET | /api/monedas | JwtAuth + Tenant | Lista las monedas del país del tenant con su estado |
| PATCH | /api/monedas/:monedaId | JwtAuth + Tenant + TenantAdmin | Habilita/deshabilita o actualiza la tasa (upsert) |
| PATCH | /api/monedas/:monedaId/default | JwtAuth + Tenant + TenantAdmin | Marca la moneda como predeterminada |

Respuesta de `GET /api/monedas` (por item):

```json
{
  "monedaId": "uuid",
  "nombre": "Dólar Estadounidense",
  "codigoIso": "USD",
  "simbolo": "$",
  "decimales": 2,
  "separadorDecimal": ".",
  "separadorMiles": ",",
  "locale": "en-US",
  "habilitada": true,
  "esDefault": false,
  "esOficial": false,
  "valorDelDia": "950.000000"
}
```

### Formato numérico por moneda

Cada registro del catálogo `moneda` define cómo presentar montos en el UI:

| Campo | Descripción | Ejemplo Chile (CLP) | Ejemplo México (MXN) |
|---|---|---|---|
| `locale` | BCP 47 para `Intl.NumberFormat` y maska | `es-CL` | `es-MX` |
| `separadorDecimal` | Carácter entre parte entera y decimal | `,` | `.` |
| `separadorMiles` | Carácter entre grupos de miles | `.` | `,` |

Ejemplos: Chile `$ 1.000,50` — México `$ 1,000.50`. Son datos de catálogo (no los edita el tenant); el frontend los consume vía `useMonedasStore` y `useFormatters().formatMonto`.

## Páginas frontend

- `/configuracion/monedas` — Lista con switch de habilitada, input de tasa,
  estrella de predeterminada y badge "Oficial". Updates optimistas con revert.
  Visible solo para admins del tenant.

## Backend

- **Módulo:** `src/modules/monedas/` (`MonedasModule`, `MonedasController`, `MonedasService`).
- **Entities:** `TenantMoneda` (PK compuesta `tenant_id`+`moneda_id`) y `PaisMoneda`
  (PK compuesta `pais_id`+`moneda_id`).
- **DTO:** `UpdateTenantMonedaDto` (`habilitada?`, `valorDelDia?`).
- **Seeding:** `seedPaisMonedas` y `seedTenantMonedas` en `seeder.service.ts`; alta de
  moneda oficial en `TenantsService.create()`.

## Tablas DB

- `pais_moneda` (nueva) — puente país ↔ monedas disponibles, soft delete.
- `tenant_moneda` — flags `es_default`/`habilitada` + `valor_del_dia`, soft delete.
- `moneda`, `pais` — solo lectura (catálogos). En `moneda`: `locale`, `separador_decimal` y
  `separador_miles` (configuración de presentación numérica).

## Decisiones de diseño

- `tenantId` siempre del JWT, nunca del body.
- `TenantAdminGuard` protege las mutaciones; GET solo requiere `TenantGuard`.
- La oficial se deriva de `pais.moneda_oficial_id`; `tenant_moneda` no tiene `es_oficial`.
- `valor_del_dia` con `Decimal.js`/`NUMERIC(18,6)` — nunca `number` nativo.
- Fuera de alcance: consumo de la tasa en el motor de cálculo de ventas y proveedor
  externo de tipos de cambio. Ver [ADR-005](../adr/005-pais-moneda-y-moneda-oficial.md).
