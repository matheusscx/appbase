# Plan: ids en mayúsculas en grupos de modificadores

**Status**: Done · **Date**: 2026-10-06 · **Owner**: sesión "Overrides: un itemGrupoId en mayúsculas da un 400 que miente"

## Context

Entrada de `docs/agent/pendientes.md` § 2, leída y no corrida: un `itemGrupoId` en mayúsculas en
`PATCH /grupos-modificadores/:id/overrides` da 400 *"item_grupo_id no válido para este grupo"*.
Misma familia que el cierre del 2026-10-03 de los ids del ítem (`resueltos.md`), y misma forma de
arreglo: minúsculas a la entrada de la función que compara
([`patterns/backend.md`](../../patterns/backend.md#un-uuid-validado-puede-venir-en-mayúsculas-minúsculas-antes-de-compararlo-en-typescript-2026-10-03)).

## Scope / Out of scope

- Dentro: `GruposModificadoresService.aplicarOverrides` (`itemGrupoIds`) y, por el barrido del
  mismo service y sus DTOs, `validarYResolverOpciones` (`opciones[].itemId` del `POST`/`PATCH`
  del grupo), que compara contra filas de Postgres en `filaPorItem`, `vistos` y, en el `update`,
  `opcionIdPorItem`/`itemsEntrantes`. La orquestadora aprobó incluirlo.
- Fuera: `grupoOpcionId` y los `@Param('id')`, que solo van a SQL (leído).

## Backend

- [x] e2e en rojo, antes de tocar código: asociación en mayúsculas → 400 *"item_grupo_id no
  válido…"*; `[x, X]` → 400; ítem de opción en mayúsculas → 400 *"Opción no encontrada"*; el mismo
  ítem dos veces, una en mayúsculas → ese mismo 400 en vez del de repetido
- [x] Minúsculas a la entrada de `aplicarOverrides` y de `validarYResolverOpciones`
- [x] Mutantes: revertir todo, cada mitad, y los dos arreglos a medias (solo la búsqueda)

## Verification

- [x] Gate completo de CLAUDE.md (backend y frontend, `test:e2e` entero con base nueva)
- [x] `verify-feature` con su recibo
- [x] Entrada movida de `pendientes.md` a `resueltos.md` en el mismo commit

## Decisions / Open questions

Ninguna: la forma del arreglo ya la fijó el cierre del 2026-10-03.
