# Plan: el filtro "Merma" del kardex separa los tres tipos de baja

**Status**: Done
**Date**: 2026-10-06
**Owner**: sesión del frente (worktree `heuristic-sanderson-949bf5`)
**Spec**: [`2026-10-06-kardex-filtro-por-tipo-de-baja-design.md`](../specs/2026-10-06-kardex-filtro-por-tipo-de-baja-design.md)

## Context

`motivo=merma` trae merma, cortesía y comida del personal (las tres escriben `motivo='merma'`).
Detalle y consumidores: spec § 1–2.

## Scope / Out of scope

- **Dentro:** `motivoBajaTipo` en `GET /inventario/movimientos` (DTO + filtro compartido por
  `COUNT` y página) y el desplegable de `/inventario`.
- **Fuera:** escribir en `movimientos_inventario`; cambiar el significado de `motivo`.

## Backend

- [x] **T1 — e2e rojo primero** (`backend/test/mermas.e2e-spec.ts`, junto al test del tipo de la
  baja): un `it` propio que monta las tres bajas sobre un plato propio y pide
  `motivoBajaTipo=merma|cortesia|consumo_personal` con `pageSize=1` → una fila del tipo y
  `meta.total = 1`; sin el parámetro, `total = 3`. Pipe: `no_elaborado`, `perdida`, vacío → 400 con la
  lista de valores (distingue del `should not exist` de antes).
- [x] **T2 — DTO**: `motivoBajaTipo?` con `@IsOptional() @IsIn(TIPOS_BAJA_DEL_KARDEX)`, derivado de
  `tipoMotivoBajaDescuenta`. Actualizar el comentario del gemelo del frontend.
- [x] **T3 — filtro**: en `buildMovimientosFilters`, `AND EXISTS (… motivo_baja … tipo = $n)` sin
  filtro de borrado, con el porqué en la consulta. Unit: el `EXISTS` y su `$n` en las dos consultas;
  control débil del texto sin `eliminado_el`.

## Frontend

- [x] **T4 — página**: la opción *"Merma"* pasa a ser cuatro: *Bajas (todas)* (`motivo=merma`
  solo) y Merma, Cortesía, Comida del personal (`motivo=merma` + `motivoBajaTipo`). Unit de
  página: cada opción pide lo suyo, y un motivo que no es baja no manda `motivoBajaTipo`.
- [x] **T5 — Playwright** (en `kardex-costo-de-baja.spec.ts`, reusa su merma y su comida del
  personal): *Comida del personal*, *Merma* y *Bajas (todas)* muestran lo suyo contra el backend
  real. La cortesía solo entra anulando en mesa: la cubre el e2e de API.

## Verification

- [x] Mutantes, todos revertidos: sacar la rama del filtro; filtro solo en la página (no en el
  `COUNT`); `AND mbf.eliminado_el IS NULL` en el `EXISTS`; whitelist con `no_elaborado`
  (`@IsEnum`); la opción *"Merma"* sin `motivoBajaTipo`.
- [x] Gate completo de CLAUDE.md (e2e de API entero con base nueva, Playwright entero), con turno
  de la orquestadora para las suites pesadas. Playwright entero en verde en la tercera corrida: la
  primera cazó el locator de mi test, y la segunda dio un intermitente ajeno (`items-moneda`, anotado
  en `pendientes.md` § 2).
- [x] `verify-feature` con su recibo: `domain-reviewer` y `api-security-reviewer` LIMPIO.
- [x] Docs en el mismo commit: `inventario-kardex.md`, `ESTADO.md`, entrada movida de
  `pendientes.md` (§ 3, no § 2 como decía el brief) a `resueltos.md`. Spec y plan quedan, como los
  del 2026-10-04: la feature y `resueltos.md` enlazan la spec.

## Decisions / Open questions

- Decisiones de forma en la spec § 3. La Sesión de esfuerzo máximo confirmó 1–3 y pidió *Bajas (todas)* (2026-10-06).
