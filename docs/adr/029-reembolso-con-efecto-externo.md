# ADR-029: Reembolso de pasarela — at-most-once contra el proveedor, con el reclamo commiteado antes de llamar

**Status**: Accepted

**Date**: 2026-10-04

## Context

El admin reembolsa $17.000 de una orden de $100.000 pagada con tarjeta, aprieta *Confirmar*, se
corta internet y la pantalla dice error, pero Transbank **sí** devolvió la plata. Hasta este ADR,
volver a confirmar llamaba a Transbank de nuevo: dos `REFUND` aprobados, dos correcciones y
$34.000 devueltos por un intento de $17.000 (medido el 2026-10-03 y el 2026-10-04 con dos `POST`
iguales, por la ruta del admin y por la de la llave de API).

[ADR-026](026-idempotencia-de-cobros.md) ya resolvía el doble cobro: una `Idempotency-Key` por
intento, reclamada como **primera sentencia de la transacción** del cobro, así que reclamo y
efecto commitean juntos o ninguno. Eso es *exactly-once* cuando el efecto está en la base. Acá
el efecto es **la plata que devuelve Transbank**, que no está en la transacción: si el proceso
cae —o la red corta— entre "Transbank aprobó" y el `COMMIT`, el rollback se lleva el reclamo y
el reintento vuelve a llamar. Copiar ADR-026 daba *at-least-once*, que con plata que sale es el
mismo bug con otra ventana.

Transbank (API REST v1.2, Webpay Plus y Oneclick Mall; verificado en la referencia y en los seis
SDK oficiales) **no acepta clave de idempotencia**: una parcial repetida con saldo suficiente se
aplica otra vez. Su `GET` de estado sí trae `balance` —lo que queda sin anular—, por transacción
en Webpay Plus y por detalle en los Mall, sin la lista de reembolsos. **Medido en el sandbox de
integración el 2026-10-04**, en Webpay Plus Mall y en Oneclick Mall: sin anulaciones el detalle
no trae `balance`; tras cada anulación parcial trae lo que queda (`PARTIALLY_NULLIFIED`); anulado
entero trae `0` (`NULLIFIED`); una anulación total inmediata es reversa (`REVERSED`) y no trae
`balance`. El `GET` de Oneclick Mall va con el `buy_order` del **padre** (con el del hijo da 422).
Las respuestas, en [`resueltos.md`](../agent/resueltos.md#el-saldo-con-el-que-se-aclara-un-reembolso-medido-en-el-sandbox-de-transbank-cerrada-2026-10-04).

## Decision

**`POST /pasarela/admin/ordenes/:id/reembolsos` y `POST /pasarela/api/cobros/:id/reembolsos`
exigen `Idempotency-Key`** (400 sin ella) y corren dentro de
`IdempotenciaService.ejecutarConEfectoExterno`, una variante de `ejecutar` que da
**at-most-once**:

1. **tx0** reclama la clave, hace los chequeos que pueden rebotar (estado, disponible, tope por
   pago, ningún otro reembolso sin confirmar) y escribe el `REFUND` en **`iniciada`**
   (write-ahead, `solicitud_idempotente_id` lo liga al reclamo). Commitea. Un 400 acá revierte
   todo: sin rastro, como en ADR-026.
2. **tx1** bloquea la fila del reclamo (`FOR UPDATE`), bloquea la orden, **relee su `REFUND`**
   (si otro camino ya lo cerró, no llama), re-verifica, llama a Transbank y cierra el `REFUND`
   en `aprobada` o `rechazada`. Guarda la respuesta y commitea. Si la re-verificación rebota,
   el `REFUND` se cierra *"no se envió"* y el reclamo se suelta.
3. **El reintento** bloquea la misma fila del reclamo. Si tx1 sigue viva, espera y reproduce lo
   que ella guardó. Si murió, Postgres soltó el lock con la conexión: el reclamo no tiene
   respuesta y **nunca se vuelve a llamar a `reembolsar`**; se aclara por saldo. Así "en curso"
   y "abandonado" se distinguen sin relojes. Orden de locks: reclamo → orden.

**El aclarado por saldo**, bajo el `FOR UPDATE` de la orden: `esperado = monto − Σ aprobados`.
`balance = esperado − monto del intento` → salió (`aprobada`, `resolucion = 'saldo'`, sin código
de autorización: se perdió con la respuesta). `balance = esperado` → no salió (`rechazada`, con
el motivo). Otra cosa, o la consulta falla → no se puede aclarar: 409 al portal de Transbank.
Consultar no es reintentar: si no salió, el sistema lo dice y la persona decide con otro clic.

**Un solo `REFUND` sin confirmar por orden.** Otro reembolso de la misma orden, con una clave
nueva, primero aclara el pendiente (en su propia transacción, antes de reclamar); si no se puede,
409. Es lo que hace determinista el saldo: con dos en duda ya no dice cuál salió. El 409 lo da
`preparar`, después del reclamo, y no el aclarado: así el reintento de un reembolso **que ya
salió** reproduce aunque la orden tenga otro sin confirmar (el reclamo va primero, como en
ADR-026).

**La clave es por actor**: el usuario del JWT, o la llave de API (que no tiene usuario).
`solicitudes_idempotentes` tiene `usuario_id` **o** `api_key_id` (`CHECK`), con un índice único
parcial por cada uno; el de usuario no cambió de nombre ni de definición.

**Si la consulta no lo aclara, lo marca el admin.** El drawer de la orden ofrece primero
*Volver a consultar* (`POST /pasarela/admin/ordenes/:id/reembolsos/aclarar`); si sigue sin
aclararse, el admin revisa el portal de Transbank y marca *Salió* —con el código de autorización
que muestra el portal— o *No salió*
(`POST /pasarela/admin/ordenes/:id/reembolsos/:transaccionId/resolucion`, permiso Reembolsar).
*Salió* lo aprueba y deja su corrección como cualquier reembolso aprobado; *No salió* lo rechaza y
destraba la orden.

**El historial deja de ser solo-INSERT en un caso más.** `TransaccionesService.resolverReembolso`
cierra un `REFUND` `iniciada`/`error` en `aprobada`/`rechazada` como **compare-and-set**: un solo
`UPDATE` cuyo `WHERE` exige el estado de origen, acotado a tenant, mirando que afectó una fila.
Si afectó cero, otro ya la resolvió: el llamador relee y responde eso, nunca pisa un final. Deja
`resolucion` (`proveedor` | `saldo` | `manual` | `no_enviado`), `resuelta_por` y `resuelta_el`.
Es la segunda excepción, al lado de `vincularCorreccion`. Mientras no es final, la fila guarda el
`request`/`response` del último intento fallido.

**La fila sabe quién pidió el reembolso** (`usuario_id` o `api_key_id`, exactamente uno si tiene
reclamo), y la corrección se le atribuye a esa persona aunque lo aclare o lo marque otra: quien
devolvió la plata es quien la pidió, y el que aclaró solo descubrió que había salido. **Dónde
queda escrito** (corrección del 2026-10-04 a esta decisión de la Sesión de esfuerzo máximo, que se
leía como si la fila de la nota guardara un usuario): la fila de la corrección en `ventas` **no
lleva usuario**; lo atribuido son sus **movimientos de stock** (`movimientos_inventario.usuario_id`,
nulo por la llave de API). La vía `pasarela` nunca mueve caja; en la nota manual, por la vía
`pago` en efectivo, el usuario queda también en la salida de caja. Desde "Generar nota" (abajo,
*Consequences*), los movimientos son de quien hizo la **declaración** de las líneas.

**Timeout de 30 s** (`AbortSignal.timeout`) en `reembolsar` y `consultarEstado` de los dos
proveedores. Vencerlo es comunicación, no rechazo: "sin confirmar". Alcanza también a
`/verificar` de una orden en proceso, que usa la misma consulta: antes esperaba sin tope.

## Decisiones del owner (2026-10-04)

| Escena (orden de $100.000, reembolso de $17.000) | Qué pasa |
|---|---|
| El reintento llega **igual** | Se ve hecho, con *"Este reembolso ya se había hecho: al cliente le vuelven $17.000 una sola vez"* |
| El reintento llega con **otros datos** ($20.000) | 422 *"ya se había hecho con otros datos"*: el modal se cierra y la orden se recarga |
| **Transbank no contestó** y se reintenta | Se consulta el saldo: salió → se registra; no salió → *"no salió, podés reembolsar de nuevo"*; no cuadra → al portal |
| **Otro reembolso** mientras uno está sin confirmar | Primero se aclara el pendiente; si no se puede, se frena |
| La consulta **no lo puede aclarar** | *Volver a consultar*; si sigue, el admin revisa el portal y marca *Salió* (con el código) o *No salió*. Elegida por sobre "lo resuelve soporte" y "se deja pasar el nuevo" |

## Alternatives Considered

- **ADR-026 tal cual** (reclamo dentro de la transacción del efecto). Exactly-once en la base,
  at-least-once contra el proveedor. Lo caza el e2e *"el proceso falla DESPUÉS de que el
  proveedor aprobó"*: con el reclamo adentro, el reintento llama dos veces.
- **Reclamo commiteado + 409 "en proceso" sin aclarado.** Es la alternativa que ADR-026 descartó
  para los cobros, y acá se elige por la razón inversa (el efecto no está en la transacción),
  pero sola deja al admin sin salida: el `/verificar` de las órdenes rechaza una orden pagada, así
  que nada registraba un reembolso que sí salió.
- **Clave de idempotencia del proveedor.** Transbank no la tiene.
- **Índice único sobre `COALESCE(usuario_id, api_key_id)`.** El `@Index` de TypeORM no expresa un
  índice de expresión (quedaría solo en el `.sql`, que no manda) y mezcla dos dominios de id.
- **La llamada fuera de la transacción, con un *lease*** (`iniciada` con vencimiento). Libera el
  pool durante la llamada, pero exige no aclarar algo en vuelo por reloj. Hoy no paga.
- **Solo-INSERT con una fila de resolución que apunte a la incierta.** Más columnas y una
  consulta de pendientes más frágil que la transición monótona.

## Consequences

- **El `FOR UPDATE` de la orden se sostiene durante la llamada (hasta 30 s), a propósito**: es lo
  que hace esperar al reembolso con clave nueva mientras uno está en vuelo, y al reintento con la
  misma clave en el lock del reclamo. **Lo que lo daría vuelta**: integradores por API con
  volumen. N reembolsos simultáneos con Transbank lento sostienen N conexiones de un pool de 10
  (`DB_POOL_SIZE`) hasta 30 s cada una; ahí toca el *lease*.
- ⚠️ **Un `idle_in_transaction_session_timeout` o `statement_timeout` de Postgres menor que 30 s
  rompe este camino** a mitad de la llamada. Hoy no hay ninguno configurado.
- **Queda una ventana entre el commit de tx0 y el lock de tx1** en la que otro request —un
  reembolso con clave nueva, o el reintento con la misma clave que ganó el lock del reclamo—
  puede aclarar el `iniciada` como "no salió". tx1 relee su fila y no llama, así que la plata no
  sale dos veces y no se pierde nada. Es **comportamiento esperado, no un bug**: ese primer clic
  responde "no salió" sin haberlo intentado, la persona ve que no salió y decide. La ventana es
  de milisegundos.
- **Un admin puede marcar mal** *Salió* o *No salió*. Queda registrado quién, cuándo y, con
  *Salió*, el código de autorización que dijo ver.
- **Reproducir no escribe** (ADR-026): devuelve la respuesta guardada más la corrección que el
  `REFUND` tiene hoy; sin corrección ligada lo dice (`correccionPendiente`) y no la crea.
- **Una `REFUND` aclarada "salió" (o marcada a mano) deja su corrección** como cualquier
  aprobada, con las devoluciones que pidió el intento (guardadas en su `metadata` al escribirla)
  y sus movimientos de stock atribuidos a quien lo pidió (por llave de API, sin usuario).
- **Si la corrección de una `REFUND` aprobada falla, la repara "Generar nota"** (2026-10-04,
  [`reembolsos-nota-credito.md`](../features/reembolsos-nota-credito.md#generar-nota-un-refund-aprobado-que-quedó-sin-nota-2026-10-04)):
  emite por el monto del `REFUND` sin llamar al proveedor, y como su efecto está entero en la base
  usa `ejecutar` (ADR-026), no `ejecutarConEfectoExterno`. Los movimientos de stock son de quien
  pidió el reembolso si se confirma lo que declaró, y de quien hizo clic si lo cambió.
- **Una `REFUND` aclarada por saldo no tiene código de autorización**: Transbank no lo da en la
  consulta.
- **Webpay Plus deja consultar 7 días** (según su documentación; la referencia dice "en cualquier
  momento"): un reembolso que quedó sin confirmar y se reintenta después cae al portal. Es lo
  único de este ADR que no se midió en el sandbox: hace falta un pago de más de 7 días
  ([`pendientes.md`](../agent/pendientes.md) § 2).
- **Un sin confirmar gasta el tope por pago de la nota del POS mientras no se aclare**
  (2026-10-04, decisión del owner): pudo haber devuelto la plata y nada lo aclara solo. El detalle
  de la venta ofrece lo que queda y explica lo descontado; "no salió" lo libera. La re-verificación
  de tx1 excluye **por id** su propio `iniciada` de esa cuenta. El "Cobrado/Devuelto" no lo cuenta
  hasta que se aclara. Detalle en
  [`reembolsos-nota-credito.md`](../features/reembolsos-nota-credito.md) ("Tope por pago").
- **Las fallas nuevas quedan en `iniciada`, no en `error`**: `error` es el estado de las filas de
  antes y cuenta igual como sin confirmar. Ninguna pantalla trataba aparte un `REFUND` en
  `error` (medido el 2026-10-04); las dos que muestran reembolsos dicen "Sin confirmar".
- **El cambio de esquema es seguro sobre una base con datos** (medido el 2026-10-04 con 33
  reclamos de `main`): `synchronize` recrea el índice de usuario porque cambia la nulabilidad de
  su columna, pero lo hace en una transacción con lock exclusivo sobre la tabla, así que no hay
  instante sin unicidad: un `INSERT` concurrente espera el commit.
