# Plan: `PATCH /me/preferencias` con `ui: null` es un 400

**Status**: Done · **Date**: 2026-10-06 · **Owner**: sesión "ui: null en preferencias"

## Context

Entrada de `docs/agent/pendientes.md` § 1. `ui` sigue con `@IsOptional()`, que trata `null` como
ausente: el spread de `mergeUsuarioPreferencias` ignora el `null` y la ruta contesta 200 sin tocar
nada. Decisión del owner (2026-10-04): un `null` en las preferencias es un 400. Mismo patrón que el
frente del 2026-10-04 que cerró `ui.colorMode`/`ui.pageSize` (`resueltos.md`).

## Scope / Out of scope

- Dentro: el decorador de `ui` en `UpdatePreferenciasDto` y su e2e en el bloque D de
  `null-en-actualizaciones.e2e-spec.ts`.
- Fuera: cualquier otra clave. Barrido hecho de los DTOs de `/me`: `UpdatePerfilDto` no tiene
  claves anidadas (`apellido`/`telefono` siguen con `@IsOptional()` a propósito: columnas
  nullables) y `UpdateContrasenaDto` no tiene opcionales. Nada que anotar.
- Frontend: `useUserPreferences.ts` manda una sola clave de `ui` por PATCH, nunca `ui: null`. No
  cambia.

## Backend

- [x] e2e en rojo: `ui: null` → 400 nombrando `ui`, sin tocar lo guardado; `{}` → 200 sin cambios. El 400 lo da `@ValidateNested()` (`nested property ui must be either object or array`), que no empieza con `ui `: el test afirma ese mensaje y no usa `rechazaPor`
- [x] `@ValidateIf((_o, v) => v !== undefined)` en `ui`, en lugar de `@IsOptional()`
- [x] Mutante: volver a `@IsOptional()` pone rojo el e2e nuevo

## Verification

- [x] Gate completo de CLAUDE.md (backend y frontend, `test:e2e` entero con base nueva)
- [x] `verify-feature` con su recibo
- [x] Entrada movida de `pendientes.md` a `resueltos.md` en el mismo commit

## Decisions / Open questions

Ninguna: la decisión es del owner (2026-10-04).
