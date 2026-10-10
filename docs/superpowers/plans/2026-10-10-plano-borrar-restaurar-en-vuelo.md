# Plan: el plano no saca la mesa que esta pantalla borró y restauró con el guardado en vuelo

**Status**: Done
**Date**: 2026-10-10
**Owner**: orquestadora (encargo)

## Context

`docs/agent/pendientes.md` § 5, "Borrar y restaurar la misma mesa mientras viaja el guardado del
plano la saca del plano estando viva, hasta recargar". Diseño y decisión:
[`specs/2026-10-10-plano-borrar-restaurar-en-vuelo-design.md`](../specs/2026-10-10-plano-borrar-restaurar-en-vuelo-design.md).

## Scope / Out of scope

- Dentro: `frontend/app/pages/configuracion/salones.vue` y su spec; el gemelo por salón.
- Fuera: backend; la ventana de otra sesión que borra y restaura (sin polling no se cierra).

## Frontend

- [x] Reproducir con vitest (`PATCH` retenido): mesa borrada y restaurada; dos guardados en
  vuelo; salón borrado y restaurado. Con un caso de otra sesión en el mismo vuelo.
- [x] Un set por guardado en vuelo; borrar y restaurar mesa y salón marcan sus ids antes del
  `await`; `sacarMesasNoEscritas` no saca las marcadas.
- [x] Revisión independiente (H1): la ventana mientras viaja el `DELETE`. Casos con el `DELETE`
  retenido, y escenas propias para la marca de restaurar y el filtro de vivas.
- [x] Mutante: `salones.vue` de `HEAD` → rojos los casos nuevos, verdes los del 2026-10-08.
- [x] Mutantes acotados, uno por marca y por orden (tabla en `resueltos.md`): cada uno pone rojo
  un solo caso.

## Docs

- [x] `features/salones-mesas.md`: la regla en el párrafo del layout.
- [x] Mudar la entrada de `pendientes.md` § 5 a `resueltos.md`.

## Verification

- [x] Gate del frontend (`build`, `test`, `typecheck:ratchet`, `design:check`).
- [x] Playwright entero, por turno de la orquestadora, un solo stack: 114/114 (2026-10-10,
  RestartCount 0 y sin OOM antes y después).
- [x] `verify-feature` con revisión independiente y recibo del pre-commit.

## Decisions / Open questions

- Cierre elegido: marcar el borrado y la restauración, no serializar (por qué, en el spec).
