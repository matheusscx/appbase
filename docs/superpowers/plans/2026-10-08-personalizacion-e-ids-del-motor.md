# Plan: la personalización y los ids que entran al motor

- **Status**: Done
- **Date**: 2026-10-08
- **Owner**: Cesar Matheus (frente lanzado por la orquestadora "Pendientes")

## Context

Tres piezas de `docs/agent/pendientes.md` § 2, todas en el borde del motor de cálculo:

1. "`personalizacion` como array…": `@ValidateNested()` deja pasar un array.
2. **B3** de "Entradas sin cota…": `extras[].unidades` sin máximo.
3. **La trampa del `@ArrayUnique`** de la misma entrada: los ids en mayúsculas.

### Medido por HTTP el 2026-10-08 (base nueva, entorno `db` del worktree)

| Caso | Hoy |
|---|---|
| `POST /ventas`, `personalizacion: [{ omitidos: [X] }]` o `[]` | 201, guarda `omitidos: []`, **descuenta X** |
| `/calcular`, `personalizacion: [{ extras: [Q] }]` | 201, previsualiza sin el extra ($4.000 en vez de $4.500) |
| `POST /cuentas/:id/lineas`, mismo array | 201, `cuenta_lineas.personalizacion.omitidos: []`; al cerrar, **descuenta X** |
| `extras[].unidades = 10^12`, extra de $500 | `/cuentas`: **500** (overflow de `cuenta_lineas.precio_unitario` NUMERIC(18,4)); `/ventas` con customer: **500**; `/calcular`: 201 con totales absurdos |
| `descuentosVentaIds: [D.toUpperCase()]` y `[D, D.toUpperCase()]` | 400 "descuento … no encontrado" en `/calcular` y `/ventas` (ídem recargos) |
| **`metodoPagoId` en mayúsculas**, ítem con recargo 3% por tarjeta | **cobra de menos en silencio**: `/calcular` 1190 en vez de 1226; `/ventas` calcula sin el recargo (`includes` exacto en el motor, `calculo-precios.engine.ts:577`) |
| Ids de la personalización en mayúsculas (`omitidos`, `extras[].ingredienteItemId`, `grupos[].grupoId`, `opciones[].itemId`, `componentes[].componenteItemId`) | 400 "no pertenece…" / "no permitido" / "no asociado" |
| `lineas[].itemId` de `/calcular` y `/ventas`, `cuentaId` en mayúsculas | andan (aliasado en `cargarBasePorIds`; `cuentaId` solo viaja a SQL) |
| `AddLineaDto.itemId` en mayúsculas (lo vio la revisión independiente) | 404 "Ítem … no encontrado" |
| `pagos[].metodoPagoId` en mayúsculas (fuera del motor) | 400 "Método de pago no habilitado" → se anota en pendientes, no se toca |

## Scope / Out of scope

**Dentro:** `@IsObject()` en las tres `personalizacion` (el checkout online hereda `LineaDto`);
minúsculas en el borde para todo id del body que el motor o sus resolvers comparan en TypeScript;
el tope de B3 cuando la Sesión de esfuerzo máximo lo decida.

**Fuera:** `pagos[].metodoPagoId` (no entra al motor; va a pendientes con la medición); B2, B4–B6 y
los repetidos de `CreateItemDto` (otro frente); el desborde general de plata con precios enormes.

## Backend

- [x] **T1 — decorador `IdEnMinusculas()`** en `common/decorators/`: `@Transform` que baja a minúsculas
  un string o cada string de un array y deja pasar cualquier otra cosa (la valida el decorador de
  tipo). Corre en `plainToInstance`, antes de `@ArrayUnique` y de `@IsUUID`.
- [x] **T2 — aplicarlo** a `descuentosVentaIds`, `recargosVentaIds`, `metodoPagoId` de
  `CalcularVentaDto` y `CreateVentaDto`, y a los cinco ids de `PersonalizacionRecetaDto` y sus hijos.
- [x] **T3 — `@IsObject()`** en `LineaVentaDto.personalizacion`, `LineaDto.personalizacion`,
  `AddLineaDto.personalizacion`.
- [x] **T4 — B3** (99 tentativo, `@Max` con mensaje propio; lo confirma el owner): la Sesión de
  esfuerzo máximo recomendó 99 por plato y se lo llevó al owner.
- [x] **T5 — e2e propio** `backend/test/motor-entrada.e2e-spec.ts` (la orquestadora pidió no tocar
  `topes-dto.e2e-spec.ts`, que editan otros dos frentes):
  - array en cada `personalizacion` → 400 nombrando el campo, y **nada escrito**: ni venta, ni línea
    de cuenta, ni movimiento de X; el control con objeto pasa.
  - `metodoPagoId` en mayúsculas: `/calcular` y `/ventas` cobran el recargo, con montos.
  - `[D, D.toUpperCase()]` → 400 por repetido (descuentos y recargos, `/calcular` y `/ventas`);
    un id solo en mayúsculas → 201.
  - cada id de la personalización en mayúsculas → mismo total que en minúsculas.
- [x] **T6 — mutantes**: sacar cada decorador (12 `IdEnMinusculas`, 3 `IsObject`, el tope de B3) pone
  rojo su test, leyendo el mensaje.

## Frontend

Nada: el front manda ids de la base (minúsculas) y la personalización como objeto.

## Verification

Gate completo de CLAUDE.md con base nueva (`reset`/`entorno.sh db` recreado), `verify-feature` con su
recibo `--full-index`. Suites pesadas con turno de la orquestadora. Sin Playwright (no se toca front).

## Decisions / Open questions

- **Forma de las minúsculas:** en el borde (DTO) y no a la entrada de cada función que compara,
  porque `@ArrayUnique` compara en el pipe, antes que cualquier service, y porque los mismos ids los
  leen tres resolvers en cuatro puertas. Se suma como tercera forma a `patterns/backend.md` § "Un UUID
  validado puede venir en mayúsculas".
- **B3:** 99 por plato, tentativo. Lo recomendó la Sesión de esfuerzo máximo y lo confirma el
  owner. El `:max` del drawer espera ese número (`pendientes.md` § 4).
