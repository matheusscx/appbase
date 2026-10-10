# Spec: los 500 de montos que no caben (cortesía, monto suelto y rastro del tope)

**Date**: 2026-10-09 · **Owner**: frente lanzado por la orquestadora · Cierra dos entradas de
`pendientes.md` § 2: la cortesía al techo y los cuatro residuos del tope del esperado (`ce3ab9d8`).

## Problema

Un monto que no cabe en `NUMERIC(18,4)` (10^14 o más) termina en 500 en un `INSERT`:

1. **Cortesía.** `baldesDeCortesia` tasa la cantidad anulada. Dos unidades a 99.999.999.999.999
   dan una base de 199.999.999.999.998, que no entra en `cuenta_linea_anulaciones`.
2. **Monto suelto.** El DTO valida signo y escala, no el techo. Un pago o un movimiento de 10^14
   llega a la base: `pagos.monto`, `pagos_proveedor.monto` y el rastro de la salida sin saldo.
3. **El tope del esperado es un oráculo sin rastro.** El 400 de `assertEntradasCaben` deja acotar
   el esperado en modo ciego, y no queda nada escrito.

## Decisiones

- **Cortesía:** el rechazo va en `baldesDeCortesias`, antes de cualquier escritura de los dos
  llamadores. Se miran los tres baldes que se guardan, no la carta, que no se persiste. El
  criterio es el del guard del motor: rechazar solo lo que Postgres rechazaría. El cálculo no
  cambia.
- **Monto suelto:** un validador `IsMontoPersistible` en los DTO medidos. La orquestadora eligió
  la opción A (2026-10-09). El resto de los `@EsMontoCobrado` queda como entrada nueva, porque
  cada uno tiene su propio techo por columna.
- **Rastro** (el owner, 2026-10-09: *"Registrar los rechazos"*, sin límite ni bloqueo):
  - Error `EsperadoNoCabeError`, un 400 con el payload del intento.
  - `conRastroDeRechazo` lo reconoce y lo escribe por fuera de la transacción, como el 422.
  - Envuelve los cinco caminos por donde entra plata.
  - Motivo `esperado_no_cabe`. Tipos `ingreso`, `cobro` y `reversa_pago_proveedor`.
  - Lo pedido que solo ya no cabe no depende del esperado: es 400 sin rastro.
- **Texto:** el remedio del 400 depende del camino. La reversa de un pago a proveedor no habla de
  "cobrar con otro medio".

## Fuera

- El techo de los demás `@EsMontoCobrado`.
- Un límite de intentos o un bloqueo: el owner eligió solo el rastro.
