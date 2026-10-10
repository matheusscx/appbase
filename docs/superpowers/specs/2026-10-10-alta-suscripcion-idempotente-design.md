# Spec: el alta de suscripción cobra una vez por intento

**Date**: 2026-10-10 · **Owner**: frente lanzado por la orquestadora · Cierra la entrada de
`pendientes.md` § 3 *"Dos `POST /suscripciones` iguales cobran dos veces"*. La decisión del owner
(2026-10-09) es **opción (a), la forma del reembolso** ([ADR-029](../../adr/029-reembolso-con-efecto-externo.md)).

## Problema

`SuscripcionesService.crear` cobra por Oneclick (HTTP, fuera de toda transacción) y después crea
venta y suscripción. No reclama ninguna clave: el reintento después de un corte cobra otra vez
(medido, `suscripcion-alta-doble.e2e-spec.ts`). ADR-026 tal cual no sirve: el efecto es la plata
que cobra Transbank, que no está en la base.

## Diseño — `ejecutarConEfectoExterno` con el cobro partido en preparar y efecto

| Paso | Dónde | Qué hace |
|---|---|---|
| **tx0** | `prepararAlta` → `CobrosService.prepararCobro` | Reclama la clave (actor = usuario). Corre los chequeos de hoy (ítem, día, Oneclick activo, tarjeta del usuario, precio, umbral SII, método). Escribe la `pasarela_orden` en `en_proceso` con `solicitud_idempotente_id` (write-ahead) y la configuración en `metadata`. Un 400 revierte todo: sin rastro |
| **tx1** | `CobrosService.efectuarCobro` + `materializarAlta` | Con el reclamo bloqueado, bloquea la orden. Si ya no está `en_proceso` no llama. Llama a `autorizarCobro` con tope de 30 s, registra la AUTHORIZATION y cierra la orden. Aprobado: venta, suscripción y conciliación de la orden en la misma tx, y se guarda la respuesta. Rechazado: la orden queda `fallida` y se **suelta** la clave (400 de hoy) |
| **Reintento** | `resolverSinConfirmar` → `CobrosService.aclararCobro` | El reclamo existe sin respuesta (tx1 murió, o 502). Bloquea la orden y consulta `consultarEstado`. **Nunca vuelve a llamar a `autorizarCobro`** |

**El aclarado**, para la orden `en_proceso`, `expirada` (como `/verificar`) o `fallida` que dejó otro lector (no se le cree: se vuelve a consultar):

- `pagada`: la orden pasa a `pagada` y se registra la AUTHORIZATION `aprobada`, sin código: se
  perdió con la respuesta, y sin ella la orden no se podría reembolsar. Se termina el alta sin
  cobrar y se responde como reproducción (`repetida: true`): *"ya estaba activa"*.
- `fallida` (`FAILED`, `REVERSED`, `NULLIFIED`, o un 404 pasados 5 minutos desde el intento sin
  respuesta: owner, 2026-10-10): la orden queda `fallida`, se suelta la clave y sale un 409 *"No
  se cobró… podés intentar de nuevo"*. El clic siguiente es un cobro nuevo. Un 404 dentro de esos
  5 minutos se trata como desconocido.
- Desconocido o sin respuesta: 409 *"No pudimos confirmar si se cobró. Esperá unos minutos y
  volvé a confirmar desde esta pantalla, sin recargarla: no se te va a cobrar dos veces"*. El
  reclamo queda igual, así que el reintento vuelve a consultar.

**502** (Transbank no contesta en tx1): tx1 hace rollback. La orden sigue `en_proceso` (es de tx0)
y la AUTHORIZATION `error` se anota fuera de la tx, como hoy `cobrar`. El reintento aclara.

**Orden de locks**: reclamo → orden → venta (ADR-029 y el comentario de `verificarReembolsable`).

**Huella** (`suscripcion.alta`): `itemId`, `diaMes`, `diaSemana`, `inscripcionId`, con nulos
normalizados. Con otros datos: 422 *"Esta suscripción ya se había pedido con otros datos"*.

**Cabecera obligatoria**: `@ClaveIdempotencia()` en `POST /suscripciones` (400 sin ella).

**Timeout**: `autorizarCobro` gana un `timeoutMs` opcional. Solo lo pasa el alta.
`POST /pasarela/api/cobros` (`cobrar`, el gemelo) queda idéntico.

**La expiración por reloj** (cron `expirar-ordenes` y la perezosa de `obtenerOrden`) ya no expira
una orden escrita antes de llamar (`solicitud_idempotente_id`). Pudo haberse cobrado y se cierra
consultando, como la que tiene una AUTHORIZATION `error`. De todos modos el aclarado consulta
también una `expirada`: expirar nunca suelta la clave.

## Frontend

`useSuscripciones.crear` manda la cabecera (`useIntentoCobro`, ámbito `suscripcion`, uno por
pestaña), que comparten el drawer y el retorno de la inscripción de tarjeta. La clave muere con
el éxito o con el 422; cualquier otro error la deja viva. Si la respuesta trae `repetida` sale
el aviso *"Esta suscripción ya estaba activa: el cobro se hizo una sola vez"*. El 422 cierra el
drawer y recarga la lista.

## Fuera de alcance

- El cargo que ya salió dos veces se devuelve con un reembolso (nota de crédito, fiscal, frente propio).
- El gemelo `POST /pasarela/api/cobros` (pasarela, prioridad baja).
- El marcado manual *"Salió / No salió"* de una orden de cobro `en_proceso`. Lo acordó la
  orquestadora el 2026-10-10 y va como entrada nueva de `pendientes.md`.
- Ninguna restricción única por persona e ítem: dos suscripciones iguales son legítimas (owner).
