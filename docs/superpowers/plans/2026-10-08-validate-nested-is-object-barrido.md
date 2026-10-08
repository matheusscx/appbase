# Plan: un array de objetos con `@ValidateNested({ each: true })` deja pasar `[[]]` — barrido

**Status**: Done · **Date**: 2026-10-08 · **Owner**: sesión del barrido `[[]]`, lanzada por
la orquestadora

## Context

Entrada de `docs/agent/pendientes.md` § 1. El precedente es `common/dto/personalizacion-receta.dto.ts`
(bf7d4511). El script de la entrada da hoy **40 de 45** (no 41 de 46). Los 16 `@ValidateNested()` sobre
un objeto suelto ya tienen `@IsObject()`: un array lo rechaza `IsObject` y un primitivo el propio
`ValidateNested`. No hay `@Type(() => XDto)` sin `ValidateNested`.

No toca el motor de cálculo ni una regla de plata: se cierra en el borde (DTO). Si la medición
destapa algo que sí los toca, se consulta a la orquestadora antes de seguir.

## Tareas

- [x] 1. Medir por HTTP, con el código sin tocar, qué contesta cada una de las 40 puertas con `[[]]`
  (400 que miente, 500, 2xx que escribe), con un control válido por sitio. Sondas e2e descartables,
  una por grupo de módulos, de a una contra la base del worktree. Incluye la venta **online** con
  `pagos: [[]]`.
- [x] 2. Clasificar a mano y quedarse con una **forma** de daño por e2e (el 500 de online sí o sí).
- [x] 3. Invariante `src/common/invariants/validate-nested-objeto.invariant.spec.ts` (metadata de
  class-validator, como `uuid-columns`): todo `@ValidateNested` con su `@IsObject` del mismo `each`.
  Rojo con los 40.
- [x] 4. e2e por forma, rojo sin el arreglo.
- [x] 5. `@IsObject({ each: true })` en los 40. Invariante y e2e en verde.
- [x] 6. Mutantes: sacar el `@IsObject` de cada sitio con e2e pone rojo su e2e y el invariante;
  sacarlo de uno sin e2e pone rojo el invariante.
- [x] 7. Docs: entrada a `resueltos.md` con lo medido, `docs/agent/README.md` (invariante
  automatizada), `patterns/backend.md` § 3.
- [x] 8. Gate completo + `verify-feature` con recibo. Commit en la rama, sin push.
