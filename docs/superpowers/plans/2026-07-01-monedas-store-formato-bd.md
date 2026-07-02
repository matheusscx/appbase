# Plan: Store de monedas + Intl (listas) + maska (inputs)

**Status:** Done  
**Date:** 2026-07-01  
**Owner:** agent

## Context

Centralizar configuración de moneda (`locale`, separadores, decimales) en BD + store Pinia.
Listas usan `Intl.NumberFormat`; inputs usan `MoneyInput` + maska con la misma config.

## Tareas

- [x] Backend: columna `locale` en `moneda`, seed, API `/monedas`
- [x] `MonedaDisplayConfig` + `currency-format.ts` + tests
- [x] `useMonedasStore` + tests
- [x] `useCurrency` + delegación en `useFormatters`
- [x] Lifecycle: dashboard, auth, tenant switch
- [x] `monedas.vue` / `items.vue` → store
- [x] Migrar display (catálogo, items, caja/ventas/pagos vía `formatOficial`)
- [x] Instalar maska + `MoneyInput.vue`
- [x] Migrar inputs monetarios (items, caja, cobro, abono)
- [x] `docs/patterns/frontend.md` §8

## Archivos clave

| Área | Archivos |
|------|----------|
| Backend | `moneda.entity.ts`, `monedas.service.ts`, `seeder.service.ts`, `startup-pos.sql` |
| Frontend store | `stores/monedas.ts`, `types/moneda.ts`, `utils/currency-format.ts` |
| Composables | `useCurrency.ts`, `useFormatters.ts` |
| Componente | `components/MoneyInput.vue` |

## Verificación

- `npm test` en frontend (89 tests) y backend monedas (9 tests)
- Manual: catálogo multi-moneda, inputs CLP/USD, una sola llamada `/monedas` por sesión
