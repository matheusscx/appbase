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

### 🔴 `moneda.decimales` es el **minor unit**, no un dato de formato (2026-08-21)

**Es lo que la moneda puede deber y cobrar**, no cuántos decimales se dibujan. CLP vale 0
porque el peso chileno **no tiene centavos**: medio peso no existe, ni en la caja ni en la
boleta ni en el cable de la pasarela. La presentación **se deriva** de ese número; no al
revés.

La distinción no es académica: mientras se leyó como dato de UI, el redondeo final de una
venta lo terminó decidiendo el **cast de Postgres** al entrar a `NUMERIC(18,4)` —fuera de
la configuración del tenant— y el sistema persistió medio peso chileno en ventas y vueltos.
Esa lectura confundió a quien revisó la spec del arreglo, y lo que la indujo fue esta misma
página: las dos secciones de formato de abajo presentaban `decimales` entre los campos de
presentación.

Quién lo consume ahora, y en ese orden:

| Consumidor | Qué hace con `decimales` |
|---|---|
| Motor de precios (`ConfigCalculo.decimalesMoneda`) | **Cuantiza** cada monto que la venta persiste, con el `modo_redondeo` del tenant |
| Borde HTTP (`@EsMontoCobrado` + `EscalaMonedaPipe`) | **Rechaza con 400** la plata que no cabe en la moneda |
| `MoneyInput` (frontend) | **No deja tipear** más decimales de los que la moneda admite |
| `formatMonto` / `Intl.NumberFormat` | Presentación — el último de la fila, no el primero |

**`CHECK (decimales BETWEEN 0 AND 4)`** en la tabla `moneda`: es el único freno que impide
que un valor mayor que la escala de las columnas de plata (`NUMERIC(18,4)`) devuelva la
decisión al cast de Postgres sin que nadie se entere.

⚠️ **`decimales` no es la denominación mínima de efectivo.** CLDR las modela separadas y
son cosas distintas: en Chile el minor unit es 0 pero la moneda física más chica es \$10
(Ley 20.956). Ese redondeo es una diferencia de caja, no toca el documento tributario ni el
impuesto, y **no está implementado** — tiene entrada propia en
[`agent/pendientes.md`](../agent/pendientes.md). No usar `decimales` para resolverlo.

📌 El nombre es ambiguo y se sabe: renombrarlo toca frontend, propinas y seeder, así que
también quedó como entrada propia del backlog.

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

Estos tres campos del catálogo `moneda` **sí** son de presentación pura, a diferencia de
`decimales` (ver arriba: es el minor unit, y quien lo consume primero es el motor de
precios):

| Campo | Descripción | Ejemplo Chile (CLP) | Ejemplo México (MXN) |
|---|---|---|---|
| `locale` | BCP 47 para `Intl.NumberFormat` y maska | `es-CL` | `es-MX` |
| `separadorDecimal` | Carácter entre parte entera y decimal | `,` | `.` |
| `separadorMiles` | Carácter entre grupos de miles | `.` | `,` |

Ejemplos: Chile `$ 1.000,50` — México `$ 1,000.50`. Son datos de catálogo (no los edita el tenant); el frontend los consume vía `useMonedasStore` y `useFormatters().formatMonto`.

## Formato de precios en UI

El catálogo `moneda` define **cómo se muestran y editan** los montos: `locale` y los dos
separadores eligen la forma, y `decimales` **acota cuánto se puede escribir** porque acota
cuánto se puede cobrar. El tenant no configura separadores ni locale; solo habilita monedas
y define tasas de cambio.

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

- `codigoIso`, `simbolo`, `decimales` — el **minor unit** real de la moneda, no el que
  queda lindo. `CHECK (decimales BETWEEN 0 AND 4)`
- `separadorDecimal`, `separadorMiles`
- `locale` (BCP 47, ej. `es-CL`, `en-US`, `de-DE`)

El store y el formateo la tomarán automáticamente en el próximo `ensureLoaded()`.

⚠️ **Antes de que un tenant tenga una moneda de más de 0 decimales como oficial** (el seed
ya trae UF con 4 y USD con 2): `MoneyInput` tiene un bug de punto fijo con `v-model` y
`decimales > 0` —la primera tecla deja el campo en `x.00`— documentado en
[frontend.md §8](../patterns/frontend.md) y con entrada propia en
[`agent/pendientes.md`](../agent/pendientes.md). Hoy solo muerde en campos de costo; con
una de ésas como oficial caen **todas** las pantallas de plata.

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
  `separador_miles` (presentación numérica) y `decimales` (**minor unit**, con
  `CHECK (decimales BETWEEN 0 AND 4)` — no es presentación).

## Decisiones de diseño

- `tenantId` siempre del JWT, nunca del body.
- `TenantAdminGuard` protege las mutaciones; GET solo requiere `TenantGuard`.
- La oficial se deriva de `pais.moneda_oficial_id`; `tenant_moneda` no tiene `es_oficial`.
- `valor_del_dia` con `Decimal.js`/`NUMERIC(18,6)` — nunca `number` nativo.
- Fuera de alcance **de esta pantalla**: proveedor externo de tipos de cambio. Ver
  [ADR-005](../adr/005-pais-moneda-y-moneda-oficial.md). El consumo de la tasa por el motor
  de ventas **ya existe** (`CalculoPreciosService.convertirAMonedaOficial`, ver
  [motor-calculo-precios.md](./motor-calculo-precios.md)).
