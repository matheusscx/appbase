# Un cobro que se repite no se registra dos veces

**Fecha:** 2026-09-19 · **Tipo:** spec de diseño
**Frente:** entrada *Idempotencia en la creación de venta* (`docs/agent/pendientes.md` §
*Endurecimiento para producción*).
**Decisiones del owner:** las del brainstorm del 2026-09-19, en § 2.

---

## 1. El problema

El cajero cobra $12.000 con tarjeta, aprieta *Confirmar* y se corta internet. La pantalla dice
"no se pudo registrar", pero la venta **sí entró**. El cajero vuelve a confirmar y el sistema
crea **una segunda venta completa**: descuenta el stock otra vez y registra el pago otra vez. La
caja espera $24.000 cuando entraron $12.000.

Hoy ningún endpoint tiene clave de idempotencia. Deshabilitar el botón evita el doble clic, pero
no sirve ante un timeout: la pantalla no sabe si el primer intento entró. El `FOR UPDATE` de
inventario evita el stock negativo, pero no la venta duplicada.

La forma estaba decidida desde el 2026-07-27: el cliente genera una `Idempotency-Key` **por
intento de cobro** (no por carrito), una tabla guarda clave → respuesta, y el reintento
reproduce la respuesta original en vez de crear otra venta.
⛔ Deduplicar por hash del carrito está descartado: dos clientes que compran lo mismo con
segundos de diferencia son el caso de todos los días en un minimarket.

## 2. Las decisiones que lo sostienen

| Decisión (owner, 2026-09-19) | Por qué importa |
|---|---|
| **Si el reintento llega con otros datos, se frena y se avisa.** Nunca se crea una segunda venta: el cajero ve *"Este cobro ya se había registrado con otros datos"* y un link a la venta | Pasa cuando el cliente cambia tarjeta por efectivo después del corte. Mostrar la primera venta como si nada deja al cajero con efectivo en la mano y una venta con tarjeta en el sistema, y la caja no cuadra. Tratarlo como un cobro nuevo es exactamente el doble cobro que este frente cierra |
| **Si el reintento llega igual, se ve el éxito con un aviso** (*"Este cobro ya había entrado, no se registró dos veces"*) **y la boleta se imprime** | La primera respuesta se perdió, así que la boleta nunca salió. El aviso le dice al cajero que no hace falta volver a pasar la tarjeta por el posnet, un aparato que el sistema no ve |
| **El cobro en duda queda atado a ese carrito mientras exista**: hasta que un cobro sale bien o hasta que se vacía. No vence por tiempo | Un POS puede quedar abierto de un día para otro con el carrito del corte. Con un vencimiento (el estándar de las pasarelas es 24 h), el doble cobro vuelve justo en el caso más difícil de notar. Vaciar el carrito o cobrar con éxito empieza un intento nuevo, así que dos clientes que compran lo mismo nunca chocan |
| **El cobro de una mesa del salón entra en el frente** | El salón ya no cobra dos veces: la cuenta cerrada rechaza el segundo intento. Pero el garzón lee *"La cuenta no está abierta"* sobre una mesa que sí se cobró, y la boleta nunca se imprime. Con este frente ve el éxito con el mismo aviso |
| **El abono entra en el frente** | Un abono repetido baja la deuda dos veces y la caja espera plata que nunca entró. Es el mismo descuadre que una venta doble, y el mecanismo es el mismo |
| **La nota de crédito, no.** Va a un frente propio | Tiene el mismo problema, pero es fiscal, y lo fiscal va solo (`CLAUDE.md`, 2026-08-23). Queda anotada en el backlog |

## 3. Alcance

### 3.1 Qué cambia

| Endpoint | Operación | Pantalla que lo llama |
|---|---|---|
| `POST /ventas` | `venta.crear` | POS (`pages/ventas/pos.vue`) y pasarela simulada de la tienda (`pages/tienda/pasarela.vue`) |
| `POST /cuentas/:id/cerrar` | `cuenta.cerrar` | Salones (`composables/useSalones.ts`) |
| `POST /pagos` | `pago.abono` | Abono (`components/pagos/AbonoModal.vue`) |

### 3.2 Qué no cambia, y por qué

- **El callback de Webpay** (`OnlineCallbackHandler` → `VentasService.crear`) no pasa por HTTP.
  Tiene su propia idempotencia por orden (ADR-009). Llama al service **sin** clave, y el service
  la acepta opcional por eso.
- **Suscripciones** (`crearEnTransaccion` desde el cron): no hay un cliente que reintente.
- **Nota de crédito**: fiscal, frente propio (§ 2).
- **Anular una venta**: repetirla ya rebota solo, porque la venta ya no está `pendiente`, y no
  mueve plata dos veces.

## 4. Contrato HTTP

- Cabecera **`Idempotency-Key`** (nombre del borrador de la IETF), con valor **UUID**.
  **Obligatoria** en los tres endpoints: sin ella o con un valor que no es UUID, **400**.
  Obligatoria y no opcional porque el backend no puede depender de que cada pantalla se acuerde
  de mandarla (invariante 6 de `CLAUDE.md`, aplicada a la plata). Costo medido el 2026-09-19: 19 specs e2e con
  79 llamadas a `POST /api/ventas`, más las de `/cerrar` y `/pagos`, suman la cabecera.
- **Primer intento**: la respuesta de siempre, con el mismo status.
- **Reintento con los mismos datos**: la **respuesta guardada** del primer intento, con el mismo
  status y `repetida: true` agregado al body. No se crea nada.
- **Reintento con otros datos**: **422** con el mensaje *"Este cobro ya se había registrado con
  otros datos. Revisá la venta antes de cobrar de nuevo."* y `ventaId` en el body, para que la
  pantalla arme el link.
- **Primer intento rechazado** (sin stock, sin caja, 400 de validación, deadlock agotado): no
  deja rastro, y el reintento con la misma clave corre como uno nuevo. Es lo que permite
  corregir el carrito y volver a confirmar sin cambiar de clave.

## 5. Modelo de datos

Tabla nueva **`solicitudes_idempotentes`**:

| Columna | Tipo | Qué es |
|---|---|---|
| `solicitud_idempotente_id` | uuid PK | |
| `tenant_id` | uuid | del token |
| `usuario_id` | uuid | del token, quien hizo el request |
| `clave` | uuid | el valor de `Idempotency-Key` |
| `operacion` | varchar | `venta.crear` \| `cuenta.cerrar` \| `pago.abono` |
| `huella` | varchar(64) | SHA-256 hex de lo que el request pidió (§ 6.3) |
| `respuesta` | jsonb, nullable | lo que se devolvió; `null` solo dentro de la transacción que la está creando |
| `venta_id` | uuid, nullable | la venta creada o abonada, para el link del 422 |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | triada de siempre |

- **Índice único parcial** `(tenant_id, usuario_id, clave) WHERE eliminado_el IS NULL`. El
  `usuario_id` va en el índice para que la clave de otro usuario no reproduzca una respuesta
  ajena: una boleta trae pagos, vuelto y cajero, el mismo dato que el alcance por caja protege
  (`features/ventas.md` § *Quién ve qué*). Una clave que otro usuario ya usó se procesa como
  nueva. La colisión entre UUIDs v4 no es un caso real.
- **Sin `@ManyToOne`** a `ventas` ni a `usuarios`, con el mismo criterio que
  `caja_intentos_rechazados` y `movimientos_caja`: la fila se escribe dentro de transacciones que
  ya tienen `FOR UPDATE` sobre la venta (abono) y un FK agregaría `FOR KEY SHARE` a ese baile.
- **No vence y no se borra**, porque así lo decidió el owner (§ 2) y por la invariante 3. Crece
  una fila por venta, al mismo ritmo que `ventas`.

## 6. Mecánica

### 6.1 El reclamo va dentro de la transacción de la operación, y primero

1. Lo **primero** que hace la transacción es reclamar la clave:
   `INSERT … ON CONFLICT (tenant_id, usuario_id, clave) WHERE eliminado_el IS NULL DO NOTHING
   RETURNING solicitud_idempotente_id`.
2. **Si inserta**, la operación corre como siempre. Al final, **en la misma transacción**, se
   guarda la respuesta (`UPDATE … SET respuesta, venta_id`).
3. **Si no inserta**, la clave ya existe y está commiteada. Se lee la fila: si la huella
   coincide, se devuelve la respuesta con `repetida: true`; si no, 422. En este camino la
   transacción no escribe nada más.

Consecuencias que el diseño busca:

- **Atómico con la venta.** O existen las dos cosas o ninguna. No hay estado "en proceso", no
  hay 409, y no queda ninguna clave sin respuesta si el proceso se cae entre dos commits.
- **Un rechazo no deja rastro.** El rollback se lleva el reclamo (§ 4).
- **El duplicado concurrente espera, no se duplica.** Dos requests con la misma clave: el
  segundo `INSERT` se bloquea en el índice único hasta que el primero commitea (y entonces no
  inserta, así que reproduce) o hace rollback (y entonces inserta y corre). ⚠️ Eso supone que
  el `SELECT` posterior ve la fila recién commiteada, lo que vale en `READ COMMITTED` porque cada
  sentencia toma su propio snapshot. El plan lo verifica contra el nivel de aislamiento real de
  `db.transaccion`. No se asume.
- **Orden de bloqueo.** El reclamo toma un lock sobre una fila que ningún otro camino lockea,
  y lo toma antes que cualquier `FOR UPDATE` de la operación. Dos claves distintas nunca
  compiten, y la misma clave espera sin tener nada tomado. No se abre ningún ciclo nuevo
  (`patterns/backend.md` § 15).
- **El reintento por deadlock (`40P01`) de `VentasService.crear` vuelve a reclamar.** El
  rollback del intento fallido soltó el reclamo, así que el loop no cambia.

### 6.2 Dónde se engancha cada operación

- **`venta.crear`**: dentro del `db.transaccion` de `VentasService.crear`, antes de
  `crearEnTransaccion`. La respuesta guardada es la misma que hoy: `{ ...venta, boleta }`.
- **`cuenta.cerrar`**: dentro del `db.transaccion` de `SalonesService.cerrarCuenta`, **antes**
  del `FOR UPDATE` sobre la cuenta y de *"La cuenta no está abierta"*. Es lo que hace que el
  reintento reproduzca en vez de rebotar. La resolución del garzón y su PIN, y
  `assertSesionAbierta`, **siguen antes** de la transacción: un reintento vuelve a autenticar
  al garzón, y reproducir no es un atajo que saltee la credencial.
- **`pago.abono`**: dentro del `db.transaccion` de `PagosService.registrarAbono`, antes del
  `FOR UPDATE` sobre la venta.

Los guards de ruta (`JwtAuthGuard`, `TenantGuard`, `PermisosGuard`) corren antes que todo.
Reproducir exige el mismo permiso que crear.

### 6.3 La huella

- Es el SHA-256 (`node:crypto`, sin dependencia nueva) de un JSON **canónico**, con las claves
  ordenadas recursivamente, que contiene la **operación**, el **id de ruta** si lo hay
  (`cuentaId`) y el **DTO ya validado**.
- **Excluye el PIN del garzón** (`CredencialGarzonOpcionalDto.pin`). El hash de un PIN de pocos
  dígitos se revierte por fuerza bruta, y guardarlo sería guardar el PIN. El `garzonId` sí
  entra: que cobre otro garzón es "otros datos".
- Cada operación arma explícitamente el objeto que se hashea. La lista de exclusiones no vive
  en un helper genérico: un campo sensible nuevo en un DTO tiene que decidirse, no filtrarse por
  descuido.

### 6.4 La respuesta guardada es la que recibió el cliente

Hay un `ClassSerializerInterceptor` global (`main.ts`), así que lo que viaja por HTTP no es la
entidad tal cual. Se guarda `instanceToPlain(respuesta)`, lo mismo que habría serializado el
interceptor, y el reintento devuelve ese objeto plano.

⚠️ Reproducir es devolver **lo que se contestó entonces**, no el estado de hoy. Una venta
anulada después sigue reproduciéndose como pagada, porque ese es el cobro que el reintento está
preguntando. El aviso de "ya había entrado" es lo que dice que no es un cobro nuevo.

## 7. Frontend

### 7.1 La clave vive con el intento

Un composable **`useIntentoCobro`**, con cuatro usos (POS, pasarela, salón, abono). Guarda la
clave en memoria:

- **Nace** con el primer *Confirmar* (`crypto.randomUUID()`).
- **Se mantiene** ante cualquier error, incluido el 400 de negocio, y **ante cualquier cambio
  en el carrito o en los pagos**. Si se regenerara al editar, el cambio de tarjeta a efectivo
  crearía una segunda venta en vez del 422 que eligió el owner.
- **Muere** cuando el cobro sale bien (también cuando sale bien por reproducción) o cuando el
  carrito se vacía.

| Pantalla | "El carrito" es | Muere al |
|---|---|---|
| POS | el carrito | éxito, o carrito vacío por cualquier vía |
| Pasarela de la tienda | el checkout abierto en la página | éxito, o salir de la página |
| Salón | la cuenta que se cobra (una clave por `cuentaId`) | éxito de esa cuenta, o cuenta que deja de estar abierta (cancelada, fusionada) |
| Abono | la venta que se abona (una clave por `ventaId`) | éxito del abono a esa venta |

### 7.2 Lo que ve el cajero

- **`repetida: true`**: el flujo de éxito de siempre, boleta incluida, más un toast de aviso con
  *"Este cobro ya había entrado, no se registró dos veces"*. El texto vive una sola vez, en el
  composable.
- **422 de otros datos**: el mensaje del backend y una acción *Ver venta* que lleva a
  `/ventas?venta=<ventaId>`. No se limpia el carrito: la decisión es del cajero.

## 8. Costos asumidos

- **Vaciar el carrito después de un corte empieza un intento nuevo.** Si el cajero vacía y
  vuelve a armar lo mismo, eso es una venta nueva. Es lo que eligió el owner (§ 2).
- **La clave vive en la memoria de la pestaña.** Recargar la página la pierde:
  - en el POS se pierde también el carrito, que no se persiste, así que no hay nada que
    reintentar;
  - en el salón la cuenta ya está cerrada del lado del servidor, así que el reintento rebota
    como hoy y la boleta sale por *Reimprimir*;
  - en el abono, recargar después de un corte y volver a abonar **sí** puede duplicar si a la
    venta todavía le queda saldo. El listado recargado ya muestra el abono que entró, que es la
    pista que hoy no existe.
- **Dos pestañas del mismo POS** tienen claves distintas. Protegerlas exigiría deduplicar por
  contenido, que es lo descartado en § 1.

## 9. Verificación

**Backend (e2e, contra Postgres real):** para cada una de las tres operaciones,

- mismo request dos veces con la misma clave → una sola venta/abono en la base, la segunda
  respuesta igual a la primera más `repetida: true`;
- misma clave con otro body → 422 con `ventaId`, y nada nuevo en la base;
- sin cabecera o con un valor que no es UUID → 400;
- primer intento rechazado (sin stock, por ejemplo) → reintento con la misma clave y el carrito
  corregido → 201;
- misma clave, **otro usuario** → operación independiente;
- **dos requests concurrentes** con la misma clave → una sola venta (el caso que motiva el
  diseño de § 6.1).

Salón, además: reintento después del cierre → reproduce, no *"La cuenta no está abierta"*; y un
PIN equivocado en el reintento → rechazado igual.

**Unitario:** la huella es estable ante el orden de las claves y cambia con cualquier dato del
cobro; el PIN no la mueve.

**Frontend (Vitest):** la clave se mantiene ante error y ante edición, muere con el éxito y con
el carrito vacío; `repetida` dispara el aviso y la boleta; el 422 muestra *Ver venta* y no
limpia el carrito.

**Mutantes:** revertir el reclamo (quitar el `INSERT`) tiene que hacer fallar el e2e de doble
request, y revertir el orden en `cerrarCuenta` (el reclamo después del chequeo de estado) tiene
que hacer fallar el de reintento del salón. Revertir, no solo romper.

## 10. Documentación

ADR nuevo (`026`, mecanismo de idempotencia), `features/ventas.md`, `features/pagos.md`,
`features/salones-mesas.md`, `features/tienda-online.md`, `patterns/backend.md` (sección nueva:
operación idempotente), `patterns/frontend.md` (clave por intento), `ESTADO.md`, y la entrada del
backlog pasa a `resueltos.md` con la de la nota de crédito agregada a `pendientes.md`.
