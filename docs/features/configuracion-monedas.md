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

## Formato de precios en UI

El catálogo `moneda` define **cómo se muestran y editan** los montos. El tenant no
configura separadores ni locale; solo habilita monedas y define tasas de cambio.

### Arquitectura frontend

```
GET /monedas
    ↓
useMonedasStore (monedasById[uuid])
    ↓
┌─────────────────────────┬──────────────────────────┐
│  Solo lectura (listas)  │  Edición (formularios)   │
│  formatMonto()          │  <MoneyInput>            │
│  Intl.NumberFormat      │  maska + parse           │
└─────────────────────────┴──────────────────────────┘
         ↑ misma MonedaDisplayConfig ↑
```

Carga del store: una vez al entrar al layout `dashboard` (`ensureLoaded`). Se
invalida al cambiar de tenant o cerrar sesión.

### Mostrar precios (listas, tablas, cards)

Usar **`useFormatters().formatMonto(value, monedaId?)`** — nunca definir
formateo local en un `.vue`.

| Contexto | Llamada | Moneda usada |
|----------|---------|--------------|
| Precio de ítem en catálogo / items | `formatMonto(precio, item.monedaId)` | Moneda del ítem |
| Total venta, saldo caja, pago | `formatMonto(total)` | Moneda **oficial** del tenant |
| Línea de carrito POS | `formatMonto(precio, item.monedaId)` | Moneda del ítem |

**Motor de formateo** (`app/utils/currency-format.ts`):

- Monedas ISO 4217 (CLP, USD, …) → `Intl.NumberFormat(locale, { style: 'currency', … })`.
- Códigos no ISO (UF) → formato manual con `prefix` + separadores de BD.

### Editar precios / montos (inputs)

Usar **`<MoneyInput v-model="..." />`** — dependencia [maska](https://github.com/beholdr/maska).

| Pantalla | Campo | Prop de moneda |
|----------|-------|----------------|
| Configuración → Items | `precioBase` | `:moneda-id="form.monedaId"` |
| Caja → Apertura | `saldoInicial` | `oficial` |
| Caja → Cierre | `montoContado` | `oficial` |
| Caja → Movimiento | `monto` | `oficial` |
| POS → Cobro | `pago.monto` | `oficial` |
| Pagos → Abono | `pago.monto` | `oficial` |

**Contrato `v-model`:** siempre `string` limpio (`"1500000"`, `"99.5"`), compatible
con `@IsNumberString` del backend. El usuario ve el monto formateado; maska parsea
al valor numérico string en cada keystroke.

**No usar `MoneyInput` para:** `valorDelDia` (tasa de cambio), stock, cantidades,
porcentajes de impuestos/descuentos — ahí va `UInput inputmode="decimal"` sin máscara
de moneda.

### Agregar una moneda nueva al catálogo

En el seeder (`seeder.service.ts` → `seedMonedas`), definir en un solo lugar:

- `codigoIso`, `simbolo`, `decimales`
- `separadorDecimal`, `separadorMiles`
- `locale` (BCP 47, ej. `es-CL`, `en-US`, `de-DE`)

El store y el formateo la tomarán automáticamente en el próximo `ensureLoaded()`.

### Documentación técnica detallada

Patrones de implementación, archivos y tests: [frontend.md §8](../patterns/frontend.md).

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
