# Feature: Pasarela de pagos multi-proveedor (v1 Oneclick)

**Status**: Complete (v1)
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-02

---

## Overview

### What is it?

Un módulo de pasarela de pagos **independiente** dentro del backend
(*"junto pero no revuelto"*): modela integraciones con proveedores de pago
de forma agnóstica y expone dos superficies de consumo:

- **Administración del tenant** (`/pasarela/admin/*`, JWT + RBAC): el admin
  configura qué pasarelas usa (Oneclick o Webpay Plus; a futuro Stripe…), en modo
  **MALL** (bajo el comercio de la plataforma) o **INDIVIDUAL** (con sus
  propias credenciales), genera/revoca **API keys** para sus apps externas, y
  puede reembolsar (total o parcial) órdenes `pagada` o `conciliada` desde Ventas ▸ Órdenes
  (`/ordenes`), gateado por el permiso dedicado `Pasarelas:Reembolsar`.
- **API máquina-a-máquina** (`/pasarela/api/*`, API key): las apps del tenant
  inscriben medios de pago, cobran, reembolsan y consultan estado — sin pasar
  por el login de usuarios. Un tenant puede contratar **solo** la pasarela.

Integra dos proveedores de Transbank contra su ambiente de integración real:
**Oneclick** (tokenización de tarjeta + cobro recurrente) y **Webpay Plus Mall**
(pago único con redirect: crear → redirigir → confirmar, sin tokenización).

### Why does it exist?

Habilita cobros reales (el checkout de la tienda por Webpay Plus y las
suscripciones por Oneclick ya usan la pasarela real; ver
`docs/features/tienda-online.md`) y abre la pasarela como servicio consumible
por apps externas del tenant, con el modelo de datos preparado para sumar
proveedores sin cambios estructurales.

### Scope

- **Incluido**: módulo `gateway` con Oneclick real y **Webpay Plus Mall**
  (pago único con redirect), API keys por tenant, cifrado de credenciales,
  historial inmutable de transacciones, pantallas de administración del tenant
  (config y API keys en Configuración; órdenes en Ventas).
- **NO incluido (fases futuras)**: job de cobro recurrente automático de los
  períodos siguientes de una suscripción, Stripe / MercadoPago, webhooks
  entrantes, failover por `prioridad`, y rotación de la clave de cifrado.
  (El alta de suscripción por cobro Oneclick real y el checkout Webpay ya están
  reconectados a la pasarela real — 2026-07-12.)

---

## API Endpoints

Prefijo global `/api`. Dos mundos de autenticación + un retorno público.

### Administración (JWT + TenantGuard + PermisosGuard, módulo RBAC "Pasarelas")

```
GET    /api/pasarela/admin/pasarelas-disponibles   # catálogo global (Leer)
GET    /api/pasarela/admin/config                  # config del tenant (Leer)
POST   /api/pasarela/admin/config                  # alta (Crear)
PATCH  /api/pasarela/admin/config/:id              # edición write-only (Actualizar)
DELETE /api/pasarela/admin/config/:id              # baja (Eliminar)
GET    /api/pasarela/admin/api-keys                # listar (Leer)
POST   /api/pasarela/admin/api-keys                # crear — key visible UNA vez (Crear)
DELETE /api/pasarela/admin/api-keys/:id            # revocar (Eliminar)
GET    /api/pasarela/admin/ordenes                 # listado paginado (Leer)
GET    /api/pasarela/admin/ordenes/:id             # detalle + transacciones (Leer)
POST   /api/pasarela/admin/ordenes/:id/reembolsos  # reembolso parcial/total (Reembolsar) — exige Idempotency-Key
POST   /api/pasarela/admin/ordenes/:id/reembolsos/aclarar                    # "Volver a consultar" un reembolso sin confirmar (Reembolsar)
POST   /api/pasarela/admin/ordenes/:id/reembolsos/:transaccionId/resolucion  # el admin marca "Salió" (con código) o "No salió" (Reembolsar)
```

Todo reembolso aprobado de una orden con `venta_id` deja su corrección en ventas
(2026-10-02): tras el commit del REFUND, un hook post-commit (registry
`ReembolsoCallbackRegistry` → handler del módulo ventas) crea la nota de crédito, y el
REFUND queda ligado a ella en `pasarela_transacciones.correccion_venta_id`. El reembolso
admin acepta además `devoluciones?: [{itemId, cantidad}]` (opcional, ítems que se acreditan
en esa nota). **`generarNotaCredito` ya no existe**: mandarlo da 400, por esta ruta y por la
de la API externa (mismo DTO). La respuesta puede traer `notaCreditoId` o `warning` (la
corrección falló: el reembolso NO se revierte y el REFUND queda sin `correccion_venta_id`). El
vínculo se escribe dentro de la transacción de la corrección: si no se puede ligar, la
corrección tampoco queda.
Una orden sin venta se reembolsa sin corrección y sin aviso. **Antes de llamar al proveedor**, un
reembolso de una orden con venta respeta el tope por pago de las notas de crédito (2026-10-02): lo que
el pago de la venta todavía puede devolver, descontadas las notas "por el pago" hechas desde el POS, los reembolsos aprobados que todavía no
tienen su corrección y, desde el 2026-10-04, los sin confirmar de la venta salvo el propio (que en
la re-verificación ya está en `iniciada` y se excluye por id);
si no alcanza, 400 sin cifras y la pasarela no se llama (con más de un pago en la venta no hay tope).
Ver
[reembolsos-nota-credito.md](./reembolsos-nota-credito.md).

### Un reembolso que se reintenta no sale dos veces (2026-10-04)

[ADR-029](../adr/029-reembolso-con-efecto-externo.md). Las dos rutas de reembolso exigen
`Idempotency-Key` (UUID, 400 sin ella); en la API externa la clave es **por llave de API**.
Transbank no acepta clave de idempotencia, así que el sistema garantiza **como mucho una**
llamada de reembolso por clave: el reclamo y el `REFUND` en `iniciada` se commitean **antes**
de llamar, y un reintento nunca vuelve a llamar a `reembolsar`.

| Escena (orden de $100.000, reembolso de $17.000) | Respuesta |
|---|---|
| Reintento igual | La respuesta original + `repetida: true` (y la corrección que el `REFUND` tiene hoy; sin ella, `correccionPendiente: true`) |
| Reintento con otros datos | 422 *"Este reembolso ya se había hecho con otros datos"* con el `ordenId` |
| Transbank no contestó (error de red, 5xx, 30 s) | 502 *"no sabemos si la plata salió"*; el `REFUND` queda **sin confirmar** (`iniciada`) |
| Reintento de un sin confirmar | Se consulta el saldo (`balance`): bajó en el monto → `aprobada` por saldo + `repetida: true`; no bajó → `reembolsoAprobado: false` con `motivo`; no cuadra o no se puede consultar → 409 al portal de Transbank |
| Otro reembolso de la orden con un sin confirmar | Primero lo aclara (igual que arriba); si no se puede, 409 sin llamar. El reintento de uno que ya salió reproduce igual |
| La consulta no lo aclara | El drawer de la orden ofrece *Volver a consultar* y, si sigue, *Salió* (con el código de autorización del portal) o *No salió*; queda `resolucion = 'manual'` con quién y cuándo |

Un `REFUND` en `iniciada` o `error` es **sin confirmar** (la pantalla dice "Sin confirmar"): no
es un rechazo, el proveedor pudo haber devuelto la plata. Por eso, hasta que se aclare, gasta el
tope por pago de la nota del POS, y el detalle de la venta dice *"$17.000 en un reembolso por
Transbank sin confirmar"* (decisión del owner, 2026-10-04; ver
[reembolsos-nota-credito.md](./reembolsos-nota-credito.md)). Las fallas nuevas quedan en `iniciada`;
`error` es de las filas de antes. Solo pasa una vez a `aprobada` o `rechazada` (`resolucion`:
`proveedor`, `saldo`, `manual`, `no_enviado`), con quién y cuándo, y los movimientos de stock de
la corrección se atribuyen a quien **pidió** el reembolso (`usuario_id`/`api_key_id` de la fila), no
a quien lo aclaró (la fila de la nota no lleva usuario). El historial del drawer de
la orden dice "Sin confirmar" también para una `AUTHORIZATION` en `error` (un cobro cuyo
proveedor no contestó), que es lo mismo: no se sabe si pasó.

En la pantalla (`ReembolsoModal`), el intento es por orden y por pestaña (`useIntentoCobro`,
ámbito `reembolso:<ordenId>`): sobrevive a cerrar y reabrir el modal, y termina con el éxito,
con la reproducción, con "no salió" o con el 422 de otros datos, que cierra el modal y recarga
la orden. Si Transbank no hizo el reembolso, el modal lo dice (antes decía "Reembolso
procesado" también en el rechazo).

### API m2m (ApiKeyGuard — `Authorization: Bearer pk_...`)

```
POST   /api/pasarela/api/inscripciones             # inicia tokenización → {inscripcionId, urlWebpay, token}
GET    /api/pasarela/api/inscripciones?pagadorRef= # inscripciones del pagador
GET    /api/pasarela/api/inscripciones/:id         # detalle (nunca expone tbkUser)
DELETE /api/pasarela/api/inscripciones/:id         # elimina en proveedor + soft delete
POST   /api/pasarela/api/cobros                     # (Oneclick) cobra con tarjeta guardada
POST   /api/pasarela/api/cobros/:ordenId/reembolsos # reembolso parcial/total — exige Idempotency-Key (por llave)
POST   /api/pasarela/api/pagos                      # (Webpay Plus) pago único → {ordenId, urlWebpay, token}
POST   /api/pasarela/api/ordenes/:id/verificar      # reconcilia una orden en_proceso
GET    /api/pasarela/api/ordenes/:id                # detalle de orden
```

**`POST /pagos` solicita 4 URLs** (generaliza el flujo redirect): `urlExito`
(req), `urlFracaso` (req), `urlPendiente` (opt, default = éxito) — retornos GET
del navegador — y `urlCallback` (opt, POST server-to-server). Al resolver la
orden la pasarela llama al callback con `{ordenId}`; la app externa consulta
`GET /ordenes/:id`, materializa su lado y al responder 2xx la orden queda
`conciliada`. Ver "Callback de resolución".

### Retornos de Webpay (públicos — la credencial es el token de un solo uso)

```
GET|POST /api/pasarela/retorno/inscripcion         # Oneclick: confirma inscripción y redirige 302
GET|POST /api/pasarela/retorno/pago                # Webpay Plus: confirma pago (token_ws) y redirige 302
```

El retorno de pago distingue el desenlace por los parámetros que envía Webpay:
`token_ws` → confirma (flujo normal); `TBK_TOKEN` (anulación del usuario o
timeout post-autorización, aunque venga `token_ws`) → **no confirma**, marca la
orden `fallida`; solo `TBK_ORDEN_COMPRA` (timeout en el formulario) → `fallida`.
En los tres casos redirige 302 a la URL de éxito/fracaso de la app.

Los campos se leen sueltos (`@Body('x')`/`@Query('x')`) y no con un DTO, porque Transbank
manda campos que no controlamos (`TBK_ID_SESION`, entre otros) y el pipe global los
rechazaría. El tipo lo valida un pipe de parámetro (`CampoDeRetornoPipe`, desde el
2026-10-08): un campo que no es texto, o que pasa de 255 caracteres, es 400 en JSON, igual que
el retorno sin token. La basura no redirige. Lo fija `test/pasarela-retorno.e2e-spec.ts`, que
recorre además los desenlaces reales (aprobado, abortado con y sin `token_ws`, timeout y doble
retorno) por GET, POST form y POST JSON.

### Ejemplo — cobro

```
POST /api/pasarela/api/cobros
Authorization: Bearer pk_<40 chars>

Request:
{
  "pagadorRef": "cliente-demo-1",
  "referenciaExterna": "venta-42",
  "monto": "5990",
  "descripcion": "Cobro de prueba"
}

Response (200):
{
  "ordenId": "uuid",
  "codigoOrden": "O...",
  "estado": "pagada",
  "monto": "5990",
  "moneda": "CLP",
  "codigoAutorizacion": "1213",
  "tipoPago": "VN"
}
```

### La moneda de una orden no es la del tenant

Toda orden va en **CLP** (`MONEDA_ORDEN_V1`, en `pasarela-orden.entity.ts`): es la
moneda en la que liquida Transbank, no la oficial del tenant.

**Por eso Oneclick y Webpay son solo para locales de Chile** (owner, 2026-09-13: todo
Transbank, no solo el checkout de la tienda). Un local cuya moneda oficial no es CLP no
los ve en `GET /pasarela/admin/pasarelas-disponibles`, y `POST /pasarela/admin/config`
los rechaza con 400. La demo queda para todos, porque no cobra. Antes una tienda de México
podía configurar Webpay, y el checkout mandaba su total en pesos mexicanos como monto de
una orden en pesos chilenos.

El corte va al **dar de alta y al editar** la config, no al cobrar: todo cobro exige una
config activa del tenant, un local no cambia de país (`TenantsService.assertMismoPais`) y por
la API la config nueva la escribe solo `TenantPasarelaService.crear`. El seeder solo le siembra
Transbank a Demo Restaurante, que es de Chile. **Editar entra por pedido del owner:** una config
de Transbank en un local de otro país solo existiría si viniera de antes de la regla, y tampoco
se tiene que poder prender. Lo fija `test/pasarela-solo-chile.e2e-spec.ts`.

⚠️ **De ahí sale la regla de escala, y es la trampa de este módulo:** el `monto` se
valida contra los decimales de **la moneda de la orden**
(`MonedasService.validarEscalaDeMoneda`), **no** con `@EsMontoCobrado()` +
`EscalaMonedaPipe`, que resuelven la moneda oficial desde el token. Colgar el pipe acá
—que es lo que parece faltar al mirar los DTOs— ataría la escala a la moneda del tenant
y no a la de la orden: hoy coinciden, pero la regla es de la orden. Los tres DTOs de plata
llevan el porqué escrito
al lado del campo.

La escala se valida **en el borde del service, antes de persistir**. Antes la miraba
solo `montoEntero` dentro del provider, y en `cobrar` eso pasaba *después* de guardar
la orden: un monto con decimales dejaba una orden `en_proceso` huérfana —sin
transacción y sin nada enviado a Transbank— por un error de formato del cliente.
`montoEntero` sigue existiendo como guardia de formato de la API de Transbank
(el `amount` viaja entero), que es otra cosa que la escala de la moneda.

---

## Backend

### Módulo y estructura

`src/modules/pasarela/` — regla de frontera: **no importa** módulos de
negocio (ventas/pagos/suscripciones/items); ellos importan `PasarelaModule`
e inyectan sus services públicos.

- **Controllers**: `pasarela-admin`, `pasarela-api`, `pasarela-retorno`.
- **Services**: `credenciales` (AES-256-GCM + resolución MALL/INDIVIDUAL),
  `api-keys` (SHA-256), `tenant-pasarela` (config write-only),
  `transacciones` (historial inmutable + redacción), `inscripciones`
  (tokenización), `cobros` (orden→authorize→estados, reembolso, verificar),
  `pagos-redirect` (Webpay Plus: iniciar pago + confirmar retorno),
  `callback-dispatcher` + `pago-callback.registry` (notifica a la app
  consumidora al resolver la orden y la marca `conciliada`; ver más abajo).
- **Providers**: interfaces por capacidad `ProviderReembolsable` (común:
  `reembolsar` + `consultarEstado`) + `ProviderTokenizado` (Oneclick) +
  `ProviderPagoRedirect` (Webpay Plus), resueltas por `ProviderFactory`
  (`getTokenizado()` / `getPagoRedirect()` / `getReembolsable()`).
  `OneclickProvider` y `WebpayPlusProvider` (HTTP con `fetch` nativo).
  **Reembolso y verificación son agnósticos del flujo**: resuelven el proveedor
  de la orden por la config con que se cobró (`resolverPorId`, vía la
  `AUTHORIZATION` original o `metadata`), no por la activa del tenant.
- **Guard**: `ApiKeyGuard` (resuelve `tenantId` desde la key).

### Tablas (7)

| Tabla | Rol |
|---|---|
| `pasarelas` | catálogo global de proveedores (seed); credenciales mall de la plataforma **cifradas**. Incluye la **pasarela demo** (`codigo: 'demo'`), que aprueba sin cobrar y no tiene credenciales |
| `tenant_pasarela` | qué pasarela usa el tenant, modo/ambiente, `configuracion` **cifrada** |
| `pasarela_api_keys` | keys m2m — solo `key_hash` (SHA-256) + `prefijo` |
| `pasarela_inscripciones` | inscripción del pagador; `identificador_externo` (tbkUser) **cifrado**; `pagador_ref` opaco |
| `pasarela_medios_pago` | tarjetas registradas (marca, últimos 4) |
| `pasarela_ordenes` | intención de pago; sin FK duras a ventas/pagos (`referencia_externa` opaca) |
| `pasarela_transacciones` | historial **inmutable**; `request`/`response` **redactados**; único parcial por idempotencia. Dos escrituras posteriores al registro, las dos una sola vez: `correccion_venta_id` del REFUND (la corrección que dejó en ventas, sin FK), puesta por el hook post-commit; y el cierre de un REFUND sin confirmar (`iniciada`/`error` → `aprobada`/`rechazada`, compare-and-set con `resolucion`, quién y cuándo, ADR-029) |

Convenciones del repo: UUID PK/FK `type:'uuid'`, soft delete `eliminado_el`,
`creado_el`/`actualizado_el`, `numeric` para dinero (Decimal.js).

### Máquinas de estado

- **Orden**: `creada → en_proceso → pagada | fallida | expirada` (+ `reembolsada`).
  En pago redirect, el retorno reclama `en_proceso → procesando` (claim atómico
  anti-doble-retorno) antes de confirmar; compensa a `en_proceso` si el commit falla.
  Tras `pagada`, el callback marca `conciliada` cuando la app materializó su lado.
  `pendiente` está modelado (pago con conciliación demorada) aunque Webpay Plus
  resuelve inmediato en v1.
- **Transacción**: `iniciada → aprobada | rechazada | error`. En un `REFUND`, `iniciada` y
  `error` son **sin confirmar** y pasan una sola vez a `aprobada` o `rechazada` (ADR-029); una
  falla de comunicación nueva deja la fila en `iniciada` (`error` queda como estado legado).
- **Inscripción**: `pendiente → procesando → activa | fallida | eliminada`
  (`procesando` es el claim atómico transitorio del retorno de Webpay).

### Preferida y ownership por pagador (2026-07-11)

- `pasarela_inscripciones.preferida` (boolean, default false): solo una por
  tenant+pagador; `marcarPreferida` desmarca las demás en transacción.
- `resolverParaCobro` sin `inscripcionId` explícito ordena por
  `preferida DESC, creadoEl DESC`.
- `eliminar` y `marcarPreferida` aceptan un `pagadorRef` opcional que se suma al
  `WHERE` (ownership). La API m2m sigue llamando sin él; la fachada interna de la
  tienda (`/online/medios-pago`, ver `docs/features/tienda-online.md`) lo pasa
  siempre con el `usuarioId` del token.

### Invariante crítico

Un **timeout / error de red** contra el proveedor NUNCA se interpreta como
rechazo: la transacción queda `error`, la orden **permanece `en_proceso`**, y
se responde `502` indicando verificar el estado con `.../verificar`. Solo un
`response_code != 0` explícito del proveedor marca `fallida`.

### Callback de resolución (la venta la crea la orden, no el navegador)

La transacción de pago (`pasarela_ordenes`) y la venta son **entidades
distintas**: la orden lleva en `metadata` el snapshot de lo que se paga y la
venta se materializa **cuando la orden vuelve aprobada**, disparada por un
callback — no por el retorno del navegador (robusto aunque el usuario cierre la
pestaña). `CallbackDispatcherService.dispatch(orden)` corre al resolver:

- **`interno`** (monolito, p. ej. Tienda Online): llama in-process al
  `PagoCallbackHandler` registrado en `PagoCallbackRegistry` y **espera**
  (`await`). Al volver OK la venta ya existe → orden `conciliada` antes del
  redirect. Evita acoplar `pasarela → online` sin depender de un event bus
  (`@nestjs/event-emitter` no está instalado); el consumidor se registra en su
  `onModuleInit`. Ver [ADR-009](../adr/009-callback-pasarela-venta-por-callback.md).
- **`http`** (apps externas): `POST urlCallback {ordenId}` **fire-and-forget**
  (no bloquea el redirect); al recibir 2xx marca `conciliada`.

Un error del callback nunca rompe el retorno: la orden queda `pagada` sin
conciliar y es reconciliable después. Las 4 URLs y el `callbackModo`
(`interno`/`http`) viven en `orden.metadata`.

### Detalle real del pago (Webpay)

El commit (`confirmarPago`) devuelve el detalle real de la transacción, que
`PagosRedirectService.confirmarRetorno` escribe en `orden.metadata.resultadoPago`
(`tipoPago`, `numeroCuotas`, `tarjetaUltimos4`, `codigoRespuesta`,
`codigoAutorizacion`) para que el callback y la app consumidora lo usen:

- **Tipo de pago** — `payment_type_code`: `VD`=débito RedCompra · `VN`=crédito
  1 cuota · `VC`=cuotas · `SI`/`S2`/`NC`=cuotas sin interés · `VP`=prepago. El
  consumidor elige el método real (Tienda Online: `VD` → "Tarjeta de débito",
  resto → "Tarjeta de crédito").
- **Cuotas** — `installments_number`.
- **Últimos 4 dígitos** — `card_detail.card_number` (solo los 4 finales, no el PAN).
- **Rechazo nivel 2** — `codigoRespuesta` se traduce a un motivo legible con
  `utils/codigos-respuesta.ts` (`descripcionCodigoRespuesta`, ej. `-7` → "Tarjeta
  bloqueada"). `obtenerResultado` lo expone como `motivoRechazo` cuando la orden
  quedó `fallida`.

---

## Frontend

### Pantallas

Desde el 2026-07-10 son dos, separadas por lo que hace cada una: la **configuración**
(qué pasarelas usa el local y las API keys de sus apps) vive en Configuración, y la
**operación** —las órdenes de cobro— en el menú lateral. Las dos son del módulo RBAC
Pasarelas: Órdenes no tiene módulo propio.

**Configuración ▸ Pasarelas** (`frontend/app/pages/configuracion/pasarelas.vue`), con
dos tabs:

1. **Mis pasarelas**: las configs del tenant (`tenant_pasarela`), con un drawer de
   alta/edición. Las credenciales son **write-only**: el listado solo dice si las hay,
   al editar los campos muestran `••••` y la configuración viaja solo si se tipeó algo.
   Como el backend reemplaza el JSON cifrado entero (no mergea), en modo individual,
   si se toca una credencial, el drawer exige las 3 juntas para no borrar las otras. Una
   credencial vacía o de solo espacios no se manda, en ninguno de los dos modos: es el gemelo
   del `/\S/` del backend.
   El selector de proveedor sale de `pasarelas-disponibles`: un local cuya moneda
   oficial no es CLP no ve Transbank (ver "La moneda de una orden no es la del tenant").
   La **pasarela demo** (`codigo: 'demo'`) es la excepción: no habla con ningún
   proveedor, así que el drawer no le pide credenciales ni modo de integración —lo
   fuerza a `individual`, porque no soporta mall—, avisa que aprueba sin cobrar, y la
   fila se marca "Solo pruebas" en vez de "Sin credenciales". Ver
   `docs/features/tienda-online.md`.
2. **API Keys**: lista, crear y revocar. La key completa se muestra **una sola vez**,
   en el modal que sigue a crearla, con botón copiar: en la base quedan su hash y un
   prefijo, no la key. Revocar no la borra —sigue en la lista como "Revocada"— y desde
   ese momento las apps que la usan reciben 401.

**Ventas ▸ Órdenes** (`frontend/app/pages/ordenes.vue`): en el grupo Ventas del menú
lateral desde el 2026-10-02, porque son los cobros de lo vendido (owner; ver
[patterns/frontend.md](../patterns/frontend.md) § 1). Listado paginado con buscador
(código, descripción, referencia externa o pagador) y filtros por estado, origen
—Interno: los cobros de la propia app, como la tienda online; API externa: los de una
app con API key— y rango de fechas, que se lee en días de negocio del local (si tiene
hora de corte, la pantalla lo avisa). Al elegir una orden se abre un drawer con su
detalle, el historial de transacciones y, si tiene venta, los links a la venta y a sus
pagos. Desde ahí se **reembolsa** (total o parcial) una orden `pagada` o `conciliada`
mientras le quede saldo; el modal y la nota de crédito que deja el reembolso están en
[reembolsos-nota-credito.md](./reembolsos-nota-credito.md).

### Permisos

El link a cada pantalla aparece para el admin o con `Pasarelas:Leer`, y cada botón que
escribe, con el permiso de su endpoint (`Crear`, `Actualizar` y `Eliminar` en
Configuración; `Reembolsar` en el drawer de Órdenes). Es UX: el candado es el
`@RequiresPermiso` de cada ruta (invariante 6).

---

## Seguridad

- **API keys**: formato `pk_<40 chars>`; en BD solo `key_hash` (SHA-256) +
  `prefijo`. El guard resuelve `tenantId` desde la key (la app externa jamás
  manda tenant_id).
- **Cifrado en reposo**: AES-256-GCM, clave `PASARELA_ENCRYPTION_KEY` (32
  bytes base64) en `.env`, blob `v1:iv:tag:data`. Cifra configuraciones,
  `identificador_externo` y `token_externo`. Verificado: el commerce code no
  aparece en claro en la BD.
- **Configuración del tenant** (2026-10-08): solo entran las claves que leen los providers
  (`commerceCodeHijo`, `mallCommerceCode`, `apiKeySecret`), como texto no vacío de hasta 255
  caracteres (`ConfiguracionPasarelaDto`). Cualquier otra clave es 400. Además
  `CredencialesService.resolver` no deja que lo guardado pise a la plataforma: `baseUrl` sale
  siempre del ambiente, y en MALL del tenant pasa solo `commerceCodeHijo`. Hasta esa fecha un
  `baseUrl` en la config de MALL mandaba el cobro, con el `Tbk-Api-Key-Secret` del mall de la
  plataforma en el header, al host que eligiera el tenant (medido con un receptor local). Lo
  fijan `test/pasarela-configuracion.e2e-spec.ts` y `credenciales.service.spec.ts`.
- **Redacción**: `request`/`response` de transacciones enmascaran
  credenciales/tokens (`tbk_user`, `Tbk-Api-Key-Secret`, `authorization`…)
  antes de persistir.

---

## Testing

### Unit (backend)

```bash
cd backend && npm test -- pasarela   # 42 tests, 7 suites
```

Cubren: cifrado round-trip, API keys (hash/prefijo/exposición única),
contrato del provider (rechazo ≠ error, CLP entero, timeout), config
write-only, redacción + inmutabilidad del historial, flujo de inscripción
(claim atómico, compensación), cobro/reembolso/verificar (timeout seguro,
saldo Decimal.js).

### E2E opt-in contra Transbank

```bash
cd backend && RUN_TRANSBANK_E2E=1 npx jest --config ./test/jest-e2e.json pasarela-oneclick
```

Golpea el ambiente de integración real (skipped en `npm test` normal).

El saldo con el que se aclara un reembolso sin confirmar (ADR-029) se mide con
[`scripts/qa/transbank-saldo-sandbox.mjs`](../../scripts/qa/transbank-saldo-sandbox.mjs):
opt-in (`RUN_TRANSBANK_SANDBOX=1`), solo contra el ambiente de integración y con las credenciales
por variables de entorno (las de integración del seed; el comando, en el encabezado del script).
Pide pasar una vez por el formulario de Webpay con la tarjeta de prueba, por producto; las
anulaciones y consultas las hace solo. Lo medido el 2026-10-04, en
[`resueltos.md`](../agent/resueltos.md#el-saldo-con-el-que-se-aclara-un-reembolso-medido-en-el-sandbox-de-transbank-cerrada-2026-10-04).

### Verificación manual de punta a punta

Con el stack arriba (`docker-compose up -d`):

1. Login admin (`admin.paris@paris.cl` / `admin`) → `switch-tenant` al tenant
   Paris → Configuración muestra "Pasarelas", y el menú lateral, Ventas ▸ "Órdenes".
2. Tab "Mis pasarelas": aparece Transbank Oneclick (Mall · Pruebas, sembrada).
3. Tab "API Keys": crear → la key `pk_...` se muestra una sola vez.
4. Inscripción vía API key (`POST /api/pasarela/api/inscripciones`) → abrir
   `urlWebpay`, ingresar la tarjeta de prueba **VISA 4051 8856 0044 6623**
   (CVV cualquiera, RUT `11.111.111-1`, clave `123`) → el backend redirige a
   la `urlRetorno` con `?inscripcionId=…&estado=activa`.
5. Cobro (`POST /api/pasarela/api/cobros`) → `estado: "pagada"`.
6. Reembolso (`POST /api/pasarela/api/cobros/:ordenId/reembolsos`).
7. Ventas ▸ "Órdenes" (`/ordenes`): la orden aparece con su estado y monto.
8. Revocar la API key → reintentar el cobro → 401.

---

## Risks & Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Timeout del proveedor malinterpretado como rechazo | Cobro perdido / doble cobro | Orden queda `en_proceso`; endpoint `.../verificar` reconcilia contra el proveedor |
| Doble retorno de Webpay (reintento) | Inscripción/medio duplicado | Claim atómico `pendiente→procesando`; compensación a `pendiente` si el provider falla |
| Reembolsos concurrentes exceden el total | Sobre-reembolso | `reembolsar()` corre dentro de una transacción con lock pesimista (`SELECT … FOR UPDATE`) de la fila de la orden: dos reembolsos sobre la misma orden se serializan; el segundo ve el REFUND del primero y no puede exceder el saldo. Con venta ligada, esa misma transacción toma después el `FOR UPDATE` de la venta para el tope por pago (orden → venta, el único orden: ningún camino toma la venta y luego la orden). El intento que no se confirmó se anota sobre su `REFUND` en `iniciada` **fuera** de la transacción (tras el rollback que libera el lock) |
| Reintento de un reembolso después de un corte | Doble devolución por el proveedor | `Idempotency-Key` con el reclamo commiteado **antes** de llamar y el `REFUND` write-ahead en `iniciada`; el reintento de uno sin confirmar se aclara por saldo y nunca vuelve a llamar ([ADR-029](../adr/029-reembolso-con-efecto-externo.md)) |
| Orden con timeout marcada `expirada` por reloj (deja de ser reconciliable) | Cobro real dado por perdido | `obtenerOrden()` y el cron `expirar-ordenes` no expiran órdenes con una transacción `AUTHORIZATION 'error'` (hubo intento), ni las escritas antes de cobrar (`solicitud_idempotente_id`, el alta de suscripción: ADR-029); `verificar()` además acepta órdenes `expirada`. Solo la reconciliación con el proveedor las cierra |
| Credenciales expuestas | Fraude | Cifrado AES-256-GCM en reposo, API keys hasheadas, redacción de logs |

---

## Related Features

- [Tienda Online](./tienda-online.md) — consumidor real: alta de suscripción por
  cobro Oneclick partido en preparar y efecto (`prepararCobro` / `efectuarCobro` /
  `aclararCobro`, un cobro por intento: ADR-029) y checkout por Webpay Plus. El cobro
  recurrente de períodos siguientes sigue siendo futuro.
- [ADR-008](../adr/008-cifrado-credenciales-pasarela.md) — cifrado de credenciales.

---

## Notes

- El módulo es extraíble a microservicio sin reescritura (regla de frontera).
- `pagador_ref` y `referencia_externa` son `varchar` opacos: la app
  consumidora correlaciona con lo que use (uuid, rut, folio); la pasarela no
  valida esa entidad.
