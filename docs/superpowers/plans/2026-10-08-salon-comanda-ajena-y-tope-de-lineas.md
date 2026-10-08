# Plan: la comanda ya no escribe líneas de otra cuenta, y la cuenta tiene tope de líneas

**Status**: Done · **Date**: 2026-10-08 · **Owner**: sesión "Salón: la comanda pisa líneas ajenas y la cuenta sin tope"

## Context

Dos entradas de `docs/agent/pendientes.md` § 2, las dos en `SalonesService`:

1. "`POST /cuentas/:id/comanda` escribe líneas de cualquier cuenta del tenant": leída, no corrida.
   Primero se reproduce por HTTP; si no se reproduce, se para y se reporta.
2. "Una cuenta de salón no tiene tope de líneas y la precuenta sí": la precuenta manda todas las
   líneas a `/calcular`, que corta en 500.

No abre diseño: el 500 ya existe (`CreateVentaDto.lineas`, `CalcularVentaDto.lineas`), y el tope
de la cuenta es ese número aplicado a lo que la precuenta manda. Por eso no se consultó a la Sesión
de esfuerzo máximo.

## Scope / Out of scope

- Dentro: el `where` de `confirmarComanda` (cuenta de la ruta + borrado), 404 para una línea que no
  es de la cuenta (lo que ya hacen `actualizarLinea`/`quitarLinea`/`anularLinea`), y el lock de la
  cuenta que toman las demás escrituras sobre sus líneas.
- Dentro: `MAX_LINEAS_POR_VENTA` como constante única y su uso en los tres DTOs que ya decían 500
  (venta, `/calcular`, confirmar comanda), más el tope en las dos puertas que suman líneas a una
  cuenta (`agregarLinea` en la rama que crea, `fusionarCuentas` después de mover).
- Fuera: las devoluciones de la NC (frente fiscal; va solo) y lo que el barrido encontró con otro
  mecanismo (anotado en el cierre de `resueltos.md`).

## Tasks

- [x] e2e de reproducción en `salones-comanda.e2e-spec.ts` contra el código sin tocar: 201 donde
      debería ser 404, y releída la base, la línea ajena con su `cantidad_enviada` pisada.
- [x] Arreglo de `confirmarComanda` + unitario. Mutantes: sin `cuentaId`, sin `eliminadoEl`.
- [x] Barrido de `SalonesService` por el mismo mecanismo.
- [x] `MAX_LINEAS_POR_VENTA` y `assertTopeLineasCuenta`, bajo el lock de la cuenta.
- [x] `salones-tope-lineas.e2e-spec.ts`, armado por API. Mutantes: sin el tope al agregar, sin el
      tope al fusionar, `>=` en vez de `>`, tope antes del merge.
- [x] Docs: `salones-mesas.md`, entradas a `resueltos.md`.
- [x] Gate completo y `verify-feature`.
