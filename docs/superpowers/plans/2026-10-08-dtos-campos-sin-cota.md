# Plan: los campos de los DTOs sin cota que dan 500, guardan un dato malo o cuestan trabajo lineal

**Status**: Done · **Date**: 2026-10-08 · **Owner**: sesión "DTOs: los campos sin cota que dan 500"

## Context

`docs/agent/pendientes.md` § 2, *"Entradas sin cota que dan 500 o trabajo lineal, y una trampa del
`@ArrayUnique`"*, leída y no corrida. La orquestadora asignó B2, B4/B5, B6 y "Repetidos que llegan a
la base". **B3** (`unidades` de los extras) y **la trampa del `@ArrayUnique`** van con el frente de
personalización del motor y quedan en la entrada.

Medido por HTTP antes de tocar código (2026-10-08, backend compilado contra la base del worktree):

- **500 por desborde de `int`** con 2147483648 (2147483647 da 201): `min`/`max`/`orden` de
  `gruposModificadores` (alta y edición de ítems), `duracionEstimada` (alta y edición),
  `opciones[].orden` de grupos de modificadores (alta y edición), `grupos[].orden` de la distribución
  de propinas, `numeroCuotas` (`POST /ventas`, `POST /pagos`), y dos gemelos que la entrada no
  nombraba: `prioridad` (`POST /pasarela/admin/config`) y `puerto` (`POST /impresoras`).
- **500 por `smallint`** con 32768 (32767 da 201): `cadaN` y `ScopePromoDto.cantidad`.
- **201 con un dato malo**: `numeroCuotas: -5` en `POST /pagos` se guarda -5; `puerto: 70000` se
  guarda; `diasVencimiento: 1e21` de un descuento de pronto pago se guarda `"1e+21"` y se lee 1.
- **Repetidos**: `ScopePromoDto.itemIds` `[x,x]` y `[x,X]` dan 500. Los de `CreateItemDto` no dan
  500: dan un 400 que miente ("no pertenecen a este tenant").
- **B2**: `/calcular` de un combo cuyo componente tiene cantidad 10^7 tarda ~11 s (10^6 → ~1 s).

## Scope / Out of scope

- Dentro: solo decoradores. El máximo sale de la columna (`int` 2147483647, `smallint` 32767,
  `varchar(N)`), del rango TCP (puerto 1-65535) o de una regla escrita, con el porqué al lado.
- Dentro: `@IdEnMinusculas() @ArrayUnique()` (el decorador del frente del motor) en los cuatro arrays
  de ids repetidos: así `[x, X]` también es 400.
- Fuera: B3 y la trampa del `@ArrayUnique` (frente de personalización); `CreateNotaCreditoDto`
  (fiscal va solo); `personalizacion-receta.dto.ts`.
- Regla de negocio no escrita → Sesión de esfuerzo máximo: tope de B2 (lo decidió el owner),
  `max` de grupo, máximo de negocio de `numeroCuotas` y tope de los strings `text`.

## Backend

- [x] Enteros: `@Max` de la columna (`MAX_INT`/`MAX_SMALLINT` en `common/constants/escalas.ts`) en los
  campos del censo de B4/B5 y sus ediciones.
- [x] `numeroCuotas`: `@Min(0)` (Webpay informa 0 cuotas en débito) + `@Max` del int, sin tope de
  negocio (Sesión de esfuerzo máximo, 2026-10-08).
- [x] `puerto`: `@Max(65535)`.
- [x] `diasVencimiento`: `@Max(9999)`, el `diasMax` del formulario (`reglas-form-config.ts:72`).
- [x] B6: `@MaxLength(N)` en los 18 `varchar(N)` de terceros e impresoras y en el restaurar de turnos
  (`RestaurarTurnoDto`, que repite `@IsString`/`@IsNotEmpty` de la base). `modo` de descuentos y
  recargos con `@IsEnum(ModoRegla)`. Los `text` sin tope (Sesión de esfuerzo máximo, 2026-10-08).
- [x] B2 (`ComboComponenteInputDto.cantidad`, `@IsDecimalHasta`): 99 (owner, 2026-10-08).
  `ItemGrupoModificadorInputDto.max`: 99, derivado del de los extras por la Sesión de esfuerzo
  máximo. Los dos con `MAX_UNIDADES_POR_PLATO` del frente del motor.
- [x] Repetidos: `@IdEnMinusculas() @ArrayUnique()` en `impuestosIds`/`recargosIds`/`descuentosIds`
  y `ScopePromoDto.itemIds`, con el decorador del frente del motor.

## Verification

- [x] Filas nuevas en `backend/test/topes-dto.e2e-spec.ts`: tope + 1 → 400 nombrando el campo;
  tope justo → sin ese mensaje (con `zz` para que el pedido muera en el pipe). Repetidos `[x,x]` y
  `[x,X]` → 400.
- [x] Mutantes: sacar cada decorador pone rojo solo sus filas (las del alta y la edición que lo
  hereda; detalle en `resueltos.md`).
- [ ] Gate completo de `CLAUDE.md`, `test:e2e` completo con base nueva, `verify-feature` con recibo.
- [x] `pendientes.md` y `resueltos.md` en el mismo commit (B3 y la trampa los cerró el frente del motor).
