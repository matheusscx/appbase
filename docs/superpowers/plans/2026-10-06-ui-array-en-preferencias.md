# Plan: `PATCH /me/preferencias` con `ui` como array es un 400

**Status**: Done · **Date**: 2026-10-06 · **Owner**: sesión "ui array en preferencias"

## Context

Entrada de `docs/agent/pendientes.md` § 1, anotada por el frente que hizo 400 `ui: null`
(`resueltos.md`, 2026-10-06). `@ValidateNested()` acepta un array y valida cada elemento; el spread
de `mergeUsuarioPreferencias` mete la clave `"0"` y la normalización la descarta: un 200 que no
hizo lo que se le pidió. Lo medido en la entrada fue con `plainToInstance` + `validate`, no por
HTTP; lo primero es reproducirlo por el pipe real.

## Scope / Out of scope

- Dentro: el decorador de `ui` en `UpdatePreferenciasDto` y su e2e en el bloque D de
  `null-en-actualizaciones.e2e-spec.ts`.
- Barrido de `/me`: `UpdatePreferenciasDto` es el único DTO del módulo con `@ValidateNested()`.
- Fuera: los `@ValidateNested()` de otros módulos sin `@IsObject()`. Se anotan en `pendientes.md`,
  no se tocan.
- Frontend: `useUserPreferences.ts` nunca manda un array. No cambia.

## Backend

- [x] e2e en rojo: `ui: []` y `ui: [{ colorMode: 'light' }]` → 400 y no tocan lo guardado
- [x] `@IsObject()` en `ui`, debajo del `@ValidateIf`
- [x] El caso `ui: null` del bloque D y el "sin ui → 200 sin cambios" siguen igual
- [x] Mutante: sacar el `@IsObject()` pone rojo solo el caso array

## Verification

- [x] Gate completo de CLAUDE.md (backend y frontend, `test:e2e` entero con base nueva)
- [x] `verify-feature` con su recibo
- [x] Entrada movida de `pendientes.md` a `resueltos.md` en el mismo commit; hermanos anotados

## Decisions / Open questions

Ninguna: un body que pide un cambio y no lo hace es un 400, igual que el `null` (owner, 2026-10-04).
