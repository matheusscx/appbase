# Plan: el salón — ids en mayúsculas, layout con mesa borrada, y el confirmar legado de la comanda

**Status**: Done · **Date**: 2026-10-08 · **Owner**: sesión "Salón: transferencia a sí mismo, layout borrado y comanda"

## Context

Tres entradas de `docs/agent/pendientes.md` (§ 1 transferir-admin/fusionar en mayúsculas, § 2
layout con mesa borrada, § 2 `cantidadEnviada`). Lo medido y el diseño:
[`specs/2026-10-08-salon-ids-layout-comanda-design.md`](../specs/2026-10-08-salon-ids-layout-comanda-design.md).

## Scope / Out of scope

- Dentro: los dos DTOs del § 1, `SalonesService.guardarLayout`, el retiro de
  `POST /cuentas/:id/comanda` (owner), un e2e por arreglo con su mutante, docs vivas y el traslado a
  `resueltos.md`.
- Fuera: la pantalla del plano (no cambia; lo que no se entera de la borrada va a `pendientes.md` § 2).

## Backend

- [x] e2e `backend/test/salones-entrada.e2e-spec.ts`: transferir-admin con el responsable en
  mayúsculas es 400 y no agrega tramo; fusionar `[X, x]` da el mensaje de "al menos dos"; control
  en minúsculas al lado. Rojo sin el arreglo.
- [x] `@IdEnMinusculas()` en `TransferirCuentaAdminDto.garzonId` y `FusionarCuentasDto.cuentaIds`.
  Mutante: sacar cada decorador.
- [x] e2e del layout con mesa borrada según la decisión de la orquestadora; arreglo en
  `guardarLayout`; mutante que vuelve al `where` anterior.
- [x] e2e de `cantidadEnviada` y validación en `confirmarComanda` (piso en lo despachado), reemplazados
  por el retiro de la ruta cuando el owner lo decidió.
- [x] Listar los llamadores del método y del path en todo el repo (solo controller y tests); retirar
  ruta, método, DTO y unitario; mover a `reclamar` los e2e de "solo líneas de ESA cuenta"; e2e de la
  ruta retirada (404). Mutantes: la ruta de `HEAD`, el `WHERE` de `sqlLineasComanda` sin cuenta y sin
  borrado.
- [x] Unitarios de `salones.service.spec.ts` que cubran lo nuevo del service.

## Frontend

Sin cambios.

## Verification

- [x] Gate completo de `CLAUDE.md` (backend y frontend), `test:e2e` entero con base nueva, con turno
  de la orquestadora.
- [x] `verify-feature` con su recibo sobre `git diff --cached --full-index`.
- [x] Entradas cerradas a `resueltos.md`; lo abierto reescrito con lo medido.

## Decisions / Open questions

- Layout: la mesa borrada se saltea y el resto se guarda; una que no es del salón sigue en 404
  (orquestadora, 2026-10-08; la Sesión de esfuerzo máximo se cerró sin contestar).
- `POST /cuentas/:id/comanda`: se retira en vez de validarse (owner, 2026-10-08, vía la orquestadora).
