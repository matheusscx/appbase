# Plan: el motivo del 400 del motor en la previsualización, y dónde van los avisos

**Status**: Done · **Date**: 2026-10-08 · **Owner**: sesión de UI lanzada por la orquestadora
(dudas técnicas a ella; lo del owner, por ella)

## Context

Dos entradas de `docs/agent/pendientes.md`, que tocan la misma capa:

- § 1 *"La previsualización no muestra el motivo de un 400 del motor"*: `useResultadoCalculado`
  tragaba el error de `/calcular` (`catch` vacío) y el POS, la tienda y el salón decían
  *"Intentá de nuevo"*, que con un 400 miente.
- § 3 *"En la cuenta del salón, los avisos tapan los botones de la primera línea"*: decidido
  mover el toaster abajo a la derecha en toda la app (owner, 2026-10-08).

## Scope / Out of scope

- **Dentro:** el motivo del fallo en el composable y en las tres pantallas; la medición de las
  posiciones del toaster; tests y docs.
- **Fuera:** `tienda/suscripciones.vue`, que usa el composable pero no avisa ningún fallo; el
  aviso del techo de 10 s del salón, que es una espera y no un error del motor.

## § 1 — el motivo del 400

- [x] T1. `useResultadoCalculado` guarda el error del cálculo fallido **atado a la clave del
  carrito que lo produjo**, igual que el resultado: `error` es `null` si el que falló era otro
  carrito, y se borra con un cálculo exitoso, con `limpiar()` y con el carrito vacío. Una
  respuesta obsoleta no lo escribe (token).
- [x] T2. `avisoCalculoFallido(e, titulo)` en el mismo archivo: 4xx con mensaje → título + el
  motivo del servidor (`apiErrorMsg` sin detalle local); red, 5xx o 4xx sin mensaje → el
  "Intentá de nuevo" de siempre. Sin reintento automático.
- [x] T3. POS (`abrirCobro`), tienda (`irAPagar`) y salón (cobro y precuenta) usan el helper.
- [x] T4. Unitarios del composable y del helper; specs de pantalla de las tres (400 → motivo,
  red → reintento); Playwright del POS con un ítem al tope de `numeric(18,4)`.
- [x] T5. Mutantes: el `catch` vacío de antes y cada pantalla en su versión anterior, más uno
  por guarda del composable y del helper.

## § 3 — los avisos

- [x] T6. Medir con una sonda de Playwright, con 1 y 2 avisos, en POS, tienda y salón, a
  1280×720 y 375×812, qué controles quedan debajo de cada posición.
- [x] T7. **Resultado: abajo a la derecha tapa Cobrar y la barra del salón.** Se frenó y se
  llevó a la orquestadora con las cinco posiciones medidas. El owner eligió **dejar los avisos
  arriba a la derecha** (2026-10-08). No se toca `app.vue`. La tabla queda en `resueltos.md`.

## Cierre

- [x] T8. Las dos entradas pasan de `pendientes.md` a `resueltos.md`; `patterns/frontend.md`
  § 10.1 suma el motivo del fallo.
- [x] T9. Gate completo de `CLAUDE.md`, Playwright entero sobre base reseteada, y
  `verify-feature` con su recibo.
