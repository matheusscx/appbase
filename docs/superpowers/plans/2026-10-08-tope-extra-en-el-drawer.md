# Plan: el drawer no deja pedir más unidades de un extra que las que acepta el backend

**Status**: Done
**Date**: 2026-10-08
**Owner**: orquestadora (encargo); dudas a la Sesión de esfuerzo máximo

## Context

`docs/agent/pendientes.md` § 1, "El drawer deja tipear más unidades de un extra que las que
acepta el backend". `PersonalizacionExtraInputDto.unidades` tiene `@Max(MAX_UNIDADES_POR_PLATO)`
(99, owner 2026-10-08); el `UInputNumber` de la cantidad del extra en
`ItemPersonalizacionDrawer.vue` tiene `:min="1"` y ningún `:max`. Con 100 el garzón ve el 400.

Medido en el fuente de `reka-ui` 2.9.9 (`NumberFieldRoot.js`, `applyInputValue →
clampInputValue`): con `max` puesto, lo tipeado se **clampa** al salir del campo (blur) o con
Enter; sin `max`, pasa tal cual.

## Scope / Out of scope

- Dentro: constante gemela en el front, `:max` en el input del extra, comentario cruzado en
  la constante del backend, spec unitario + Playwright, mover la entrada a `resueltos.md`.
- Barrido de otros armadores de `unidades` de extras: el drawer es el único (lo montan POS y
  salón); la tienda online no personaliza; `useSalones.personalizacionDesdeSnapshot` reenvía
  unidades que salen del backend.
- Fuera: el stepper de opciones de grupo (`ItemPersonalizacionGrupo.vue`). Su tope es
  `grupo.max` (≤ 99 por `ItemGrupoModificadorInputDto.max`), y el total por encima de `max`
  ya deja el grupo inválido y el botón deshabilitado: no llega un 400.

## Backend

- [x] Comentario en `MAX_UNIDADES_POR_PLATO` (`tope-unidades-venta.util.ts`) que nombre la
  gemela del front. Sin cambio de conducta.

## Frontend

- [x] `MAX_UNIDADES_POR_PLATO = 99` en `composables/useRecetaPersonalizacion.ts`, con
  comentario que nombre la del backend.
- [x] `:max="MAX_UNIDADES_POR_PLATO"` en el `UInputNumber` del extra.
- [x] Spec del drawer con el `UInputNumber` real: 100 tipeado queda en 99 al salir del campo y
  el `confirm` sale con 99; la constante es 99. Mutante: sacar el `:max` lo pone rojo.
- [x] Playwright (`e2e/ventas/`): receta con un extra sembrada por API; en el POS, personalizar,
  tipear 100 en el extra, agregar; el `POST /calculo-precios/calcular` lleva `unidades: 99`, el
  servidor contesta 201 y el carrito muestra el extra x99.

## Verification

- [x] Gate completo de CLAUDE.md (backend y frontend), `test:e2e` con base nueva, Playwright
  entero, con turno de la orquestadora para las suites pesadas.
- [x] `verify-feature` con su recibo.

## Decisions / Open questions

- No se clampa también en `setExtraCantidad`: sería un segundo dueño de la regla y dejaría
  vivo el mutante "sacar el `:max`". El clamp del componente es el que ve el garzón.
