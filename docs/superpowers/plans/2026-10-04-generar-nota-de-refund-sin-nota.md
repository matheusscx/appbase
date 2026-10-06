# Plan: "Generar nota" para un `REFUND` aprobado que quedó sin nota de crédito

**Status**: Done · **Date**: 2026-10-04 · **Owner**: Cesar Matheus
Spec: [`2026-10-04-generar-nota-de-refund-sin-nota-design.md`](../specs/2026-10-04-generar-nota-de-refund-sin-nota-design.md).
Frente fiscal propio (`CLAUDE.md`, ADR-010).

## Context

`pendientes.md` § 3: un `REFUND` aprobado cuya nota falló no tiene cómo generarla. Botón decidido
por el owner (2026-10-02); el diseño lo decidió la Sesión de esfuerzo máximo (2026-10-04, abajo).

## Scope / Out of scope

- Dentro: endpoint del admin, el camino del hook partido en `corregirReembolso` / `aplicarPostReembolso`,
  idempotencia por intento, marca y modal en el drawer de la orden, docs.
- Fuera: la API externa (sin drawer); ligar el `REFUND` a una nota que ya existe o descartar la
  marca (pregunta al owner si aparece en uso real, anotada en `pendientes.md`); botón deshabilitado
  por tope agotado (el drawer no carga el disponible de la venta: alcanza el 400).

## Backend

- [x] Evento: `idempotencia?` y `alTomarLaVenta?`; el handler los pasa y devuelve `repetida`.
- [x] `CrearNotaCreditoParams.alTomarLaVenta`: corre justo después del `FOR UPDATE` de la venta.
- [x] `OperacionIdempotente`: `pasarela.generarNota`.
- [x] El tope global con lo disponible en cero nombra la causa (*"ya está corregida entera"*).
- [x] `CobrosService`: `corregirReembolso` (lanza) + `aplicarPostReembolso` (warning, sin cambios
  de conducta, con test que lo fija).
- [x] `CobrosService.generarNotaDeReembolso` + DTO `GenerarNotaReembolsoDto` + ruta
  `POST ordenes/:id/reembolsos/:transaccionId/nota` (`Pasarelas:Reembolsar`, `Idempotency-Key`).
- [x] `obtenerOrden`: `correccionVentaId` y `devoluciones` por transacción.
- [x] Unitarios (`cobros.service.spec.ts`, handler) y e2e (`pasarela-generar-nota.e2e-spec.ts`):
  nota + vínculo, sin proveedor, reproducción, 422, 409, concurrencia con claves distintas, línea
  sin respuesta, tope agotado con su mensaje, permisos con rol real (200 / 403), atribución del
  stock (igual a la metadata → quien pidió; editada → quien hizo clic), hook sin cambios.

## Frontend

- [x] `useDevolucionInventario.precargar(devoluciones)` + spec.
- [x] `useReembolsoPasarela`: `ambitoGenerarNota`, `refundSinNota`, aviso de reproducción, id del 409.
- [x] `GenerarNotaModal.vue` + spec; `OrdenDetalleDrawer`: badge "Sin nota de crédito" y botón.
- [x] Playwright: el admin genera la nota desde el drawer.

## Verification

Gate completo de `CLAUDE.md` (test:e2e entero con base nueva, frontend `npm test` entero,
Playwright entero en stack propio), mutantes que revierten, `verify-feature` con recibo. Arranque
sobre una base sembrada por `main` (sin columnas nuevas, igual se mide).

## Decisions

Decidido por la Sesión de esfuerzo máximo (2026-10-04), derivado de: el botón y su alcance
(owner, 2026-10-02), el contrato visible del gemelo "la nota que se reintenta" (owner, 2026-10-03)
y la atribución de ADR-029.

1. **Líneas:** se precargan de `metadata.devoluciones` del `REFUND` (ítems y respuestas),
   editables; vacío sin metadata; el servidor revalida con `'rechazar'` bajo el lock de la venta.
   La frase del backlog "no quedaron guardados" quedó vieja con ADR-029. Solo un `REFUND`
   **aprobado** y sin vínculo: el sin confirmar va por *Volver a consultar / Salió / No salió*.
2. **Segundo clic:** misma clave e igual pedido → 201 `repetida`; otro pedido → 422 que cierra y
   recarga; otra clave con el `REFUND` ya ligado → 409 con `notaCreditoId`, misma pantalla que el
   422 (reproducirlo como éxito le diría a otro admin que generó una nota que no generó).
3. **Errores:** `corregirReembolso` lanza; el hook sigue degradando a `warning`.
4. **Permiso:** `Pasarelas:Reembolsar`.
5. **Atribución:** la fila de la nota no tiene usuario; lo que se atribuye son los movimientos de
   stock, a quien hizo la **declaración** —quien pidió el `REFUND` si lo confirmado es igual a su
   `metadata.devoluciones` (misma normalización de la huella), si no quien hizo clic—. Quien hizo
   clic queda siempre en `solicitudes_idempotentes`.
6. **Tope agotado:** se acepta; el 400 nombra la causa sin cifras ni número de nota (una venta no
   tiene número).
