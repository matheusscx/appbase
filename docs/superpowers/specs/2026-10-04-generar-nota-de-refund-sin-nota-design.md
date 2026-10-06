# Spec: "Generar nota" para un `REFUND` aprobado que quedó sin nota de crédito

**Status**: Done · **Date**: 2026-10-04 · **Owner**: Cesar Matheus
**Frente fiscal propio** (`CLAUDE.md`, ADR-010). Sale de `docs/agent/pendientes.md` § 3.

## 1. El problema

Desde el 2026-10-02 todo `REFUND` aprobado de una orden con venta deja su corrección, y el
vínculo `REFUND → corrección` se escribe dentro de la transacción de la nota. Si la nota falla
(tope global, tope por documento, país sin tipo NC, un error de base), el `REFUND` queda
**aprobado y sin `correccion_venta_id`**: la plata ya volvió por Webpay, el pago la cuenta una
vez (`corregibles` resta los `REFUND` sin corrección) y la boleta queda sin corregir. Hoy no hay
cómo repararlo: no hay endpoint, y volver a reembolsar saca la plata otra vez por el proveedor.

**Decidido (owner, 2026-10-02):** en el historial de la orden el reembolso sin nota aparece
**marcado**, con un botón **"Generar nota"** que emite la corrección por el monto de ese `REFUND`.
Descartados: dejarlo a soporte, y el reintento automático (la app no repite sola lo que falló).

## 2. Contrato

```
POST /api/pasarela/admin/ordenes/:id/reembolsos/:transaccionId/nota
Authorization: Bearer <JWT>        (Pasarelas:Reembolsar)
Idempotency-Key: <uuid por intento> (obligatoria; 400 sin ella)

Body:     { "devoluciones": [{ "itemId": "uuid", "cantidad": "1", "stock": "recupera" }] }   // [] o ausente = solo monto
Response: 201 { ...orden pública, "notaCreditoId": "uuid", "reembolso": {...}, "repetida"?: true }
```

- **El monto no viaja**: es el del `REFUND` (cuantizado con el criterio congelado de la venta,
  como en el hook). **Nunca llama al proveedor** (ni `reembolsar` ni `consultarEstado`).
- Solo por la ruta del admin: la API externa no tiene drawer ni el problema de UX que esto cierra.
- `devoluciones` es el mismo `DevolucionLineaDto` del reembolso (contrato `stock` de
  `reembolsos-nota-credito.md` § *¿Se recupera o se pierde?*), con el tope de 200 líneas.

| Escena | Respuesta |
|---|---|
| `REFUND` de otra orden, de otro tenant, o que no es `REFUND` | 404 |
| `REFUND` no aprobado (rechazado, sin confirmar) | 400 *"Solo un reembolso aprobado lleva nota de crédito"* |
| Orden sin venta | 400 *"La orden no tiene una venta: no hay documento que corregir"* |
| Primer clic, todo bien | 201 con `notaCreditoId`; el `REFUND` queda ligado |
| La nota no se puede emitir (tope global, por documento, país sin tipo NC) | El 400 de la nota tal cual; nada queda escrito y la clave se suelta |
| Error que no es de negocio | 500 genérico (el detalle, al log) |
| Misma clave, mismo pedido (el corte) | 201 con la nota que entró y `repetida: true` |
| Misma clave, otro pedido | 422 *"Esta nota ya se había generado con otros datos…"* con `ventaId` = la nota |
| Clave nueva y el `REFUND` ya ligado (otra pestaña, otro admin) | 409 *"Este reembolso ya tiene su nota de crédito"* con `notaCreditoId` |
| Línea con stock sin respuesta, cantidad de más, ítem ajeno | 400, como la nota manual (`'rechazar'`), antes de mover nada |

## 3. Diseño backend

### 3.1 Un solo camino: el del hook

`CobrosService.aplicarPostReembolso` se parte en dos:

- `corregirReembolso(ctx, extras)` arma el `ReembolsoAprobadoEvento` —con `ligarCorreccion`— y
  llama al handler. **Lanza.**
- `aplicarPostReembolso(publico, ctx)` = `corregirReembolso` envuelto en el `try/catch` que
  degrada a `warning` (sin cambios para el hook post-commit, el aclarado y el *Salió*).

"Generar nota" llama a `corregirReembolso` y deja subir el error: acá nada está consumado, así
que un rechazo se muestra como error y el admin puede reintentar.

### 3.2 Idempotencia (ADR-026, no ADR-029)

El efecto está entero en la base (la nota, el stock, el vínculo), así que es `ejecutar` y no
`ejecutarConEfectoExterno`. El evento gana un campo opcional `idempotencia`, que el handler le
pasa a `crearNotaCredito`: ahí `ejecutar` ya corre **adentro del loop de deadlock** y reclama la
clave como primera sentencia de la transacción de la nota. Operación `pasarela.generarNota`;
huella: `ordenId`, `transaccionId` y las `devoluciones` normalizadas y ordenadas (como la del
reembolso). Mensaje del 422 propio.

### 3.3 Lo que se chequea después del reclamo

ADR-026: el reclamo va antes de cualquier chequeo de estado, si no la reproducción rebota. Por
eso "ya ligado" y la validación de las líneas **no** se miran antes: corren en un callback nuevo
de `CrearNotaCreditoParams`, `alTomarLaVenta(manager)`, que la nota corre **justo después** del
`FOR UPDATE` de la venta. Lo arma `CobrosService` (dueño de `pasarela_transacciones`) y viaja en
el evento, igual que `ligarCorreccion`:

1. Relee el `REFUND` con el `manager`: si ya tiene `correccion_venta_id` → 409 con el id. Es
   confiable sin bloquear la orden porque todo escritor del vínculo tiene el lock de la venta.
2. Valida las `devoluciones` con la política `'rechazar'` (`handler.validarDevoluciones`, el
   mismo chequeo de tx0 del reembolso), antes de mover stock. Bajo el lock: lo devuelto por otra
   nota desde el `REFUND` ya cuenta.

Orden de locks: venta → fila del `REFUND`, el mismo del hook. La orden no se bloquea.

Lo que antes de reclamar sí se mira (no cambia nunca para un mismo `REFUND`): que exista, que sea
de la orden y del tenant, que esté `aprobada` y que la orden tenga venta.

### 3.4 Lo demás, como el hook

Lo que habría pasado si el hook no fallaba: vía `pasarela` (sin caja, anota el pago único),
comentario *"NC por reembolso orden X"*, el escalado no exige motivo, la porción agotada queda
fuera del documento con el stock volviendo igual. La fila de la nota no lleva usuario: lo que se
atribuye son sus movimientos de stock, a quien hizo la **declaración** —quien pidió el reembolso
(`refund.usuarioId`, ADR-029) si lo confirmado es lo que declaró, si no quien hizo clic—. Quien
apretó el botón queda siempre en el reclamo (`solicitudes_idempotentes.usuario_id`).

### 3.5 La lectura de la orden

`GET /pasarela/admin/ordenes/:id` agrega por transacción `correccionVentaId` y, en un `REFUND`,
`devoluciones` (lo que guardó su `metadata` en tx0, o `null` si no hay). Sin consultas nuevas: ya
vienen en la fila que `listarPorOrden` lee.

## 4. Diseño frontend

- `OrdenDetalleDrawer`: un `REFUND` `aprobada` sin `correccionVentaId`, en una orden con venta,
  lleva el badge **"Sin nota de crédito"** y, con `Pasarelas:Reembolsar`, el botón **"Generar
  nota"** en su fila.
- `GenerarNotaModal` (nuevo, en `components/ordenes/`): el monto del `REFUND` (fijo), la
  `DevolucionInventarioLista` **precargada** con lo que pidió el reembolso
  (`useDevolucionInventario` gana `precargar(devoluciones)`), editable, y Confirmar deshabilitado
  mientras falte una respuesta.
- Clave de `useIntentoCobro`, ámbito `gn:<transaccionId>`: sobrevive a cerrar y
  reabrir el modal; muere con el éxito (también reproducido), con el 422 y con el 409.
- Éxito → toast *"Nota de crédito generada"*; reproducido → *"Esta nota ya se había generado: no
  se emitió dos veces."*; 422 o 409 → toast con el mensaje, el modal se cierra y la orden se
  recarga (el patrón del gemelo: el aviso cierra el intento). Otro error → toast y la clave
  sigue viva.

## 5. Esquema

Ninguna columna nueva. `solicitudes_idempotentes.operacion` es texto: la operación nueva no
toca el esquema. Arranque sobre una base sembrada por `main`: se mide igual.

## 6. Bordes aceptados

- **Tope agotado:** si otras notas ya acreditaron toda la venta (dos pagos y una nota del POS por
  cada uno), el botón da 400 cada vez y el `REFUND` sigue marcado. El 400 nombra la causa —*"La
  venta ya está corregida entera por sus notas de crédito: no queda nada que acreditar."*— sin
  cifras ni número (una venta no tiene número), en todo camino con lo disponible en cero. Qué hacer
  con la marca es pregunta del owner si aparece en uso real (`pendientes.md` § 4).

## 7. Decisiones

Ver § *Decisiones* del plan (procedencia de cada una).
