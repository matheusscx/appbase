# Feature: Tienda Online

**Status**: Complete
**Owner**: —
**Last Updated**: 2026-07-05

---

## Overview

### What is it?

Módulo interno (usuario del tenant logueado) que permite navegar el catálogo de
productos, armar un carrito y pagar. La compra del carrito cobra por **Webpay
Plus real** (redirect) cuando el tenant lo tiene activo, cayendo a la pasarela
simulada (dummy) como fallback si no. Incluye además suscripciones (alta de
compras recurrentes, con backend real y primer cobro inmediato) y medios de
pago (tarjetas inscritas vía Oneclick, ver sección "Mis medios de pago
(inscripción Oneclick)").

### Why does it exist?

Estrena el canal `'online'` de ventas (hasta ahora solo diseñado, no
implementado) y sienta la base de un futuro storefront público, reutilizando
el mismo carrito/catálogo.

### Scope

- Included in this version:
  - **Pago del carrito por Webpay Plus real** (`POST /online/pagar`): calcula el
    total y abre una **orden de pasarela** con el snapshot del carrito en
    `metadata`; el front hace redirect real al formulario de Transbank. La venta
    se crea recién al volver aprobada, vía **callback in-process** que la
    materializa `canal:'online'` y deja `referencia_externa = venta.id` (la orden
    queda `conciliada`). Idempotente. Ver [ADR-009](../adr/009-callback-pasarela-venta-por-callback.md)
    y `docs/features/pasarela-pagos.md`.
  - **Fallback simulado**: si el tenant no tiene `webpay_plus` activo, `pagar`
    devuelve `modo:'simulado'` y se mantiene la página `/tienda/pasarela` (dummy),
    que solo calcula y no persiste nada hasta que el usuario aprueba.
  - Canal `'online'` en ventas: usa la caja virtual del tenant, exige pago
    completo (no admite cuenta por cobrar), nace directamente `pagada`.
  - Suscripciones: backend real (`item_suscripcion` + tabla `suscripciones`,
    endpoints `POST/GET/PATCH /suscripciones`). El admin da de alta un item
    suscribible en Configuración → Items (sin cobro en ese momento); el
    customer se suscribe eligiendo día de cobro y tarjeta, y el primer
    período se cobra de inmediato vía la pasarela dummy, en la misma
    transacción que crea la venta.
  - Medios de pago: inscripción real vía Oneclick (Transbank), fachada JWT
    `/online/medios-pago` (ver sección "Mis medios de pago (inscripción
    Oneclick)").
  - Módulo RBAC "Tienda Online" (permisos Leer/Crear), enforcement real con
    `PermisosGuard` + `@RequiresPermiso('Tienda Online', 'Crear')` en el checkout
    (2026-07-06).
- NOT included (future):
  - Storefront público / auth de customer final.
  - Integración con pasarela real.
  - Cobro recurrente automático (job/cron) de los períodos siguientes al
    primero — hoy solo se persiste `proximo_cobro`, sin ejecutor.

---

## API Endpoints

### Checkout (sin persistencia)

```
POST /online/checkout

Authorization: Bearer <token>

Request:
{
  "lineas": [{ "itemId": "uuid", "cantidad": "2" }]
}

Response (201):
{
  "resultado": { "totales": { "totalFinal": "19980.0000", ... }, "lineas": [...] },
  "checkoutRef": "uuid",
  "checkoutUrl": "/tienda/pasarela?ref=uuid"
}
```

### Aprobar pago (crea la venta)

```
POST /ventas

Request:
{
  "canal": "online",
  "lineas": [{ "itemId": "uuid", "cantidad": "2" }],
  "pagos": [{ "metodoPagoId": "uuid", "monto": "19980.0000" }],
  "customer": { "nombre": "Cliente online" }
}

Response (201): venta en estado "pagada" (canal online exige pago completo).
```

### Suscripciones

```
POST /suscripciones

Authorization: Bearer <token>

Request:
{
  "itemId": "uuid",           // item tipo 'suscripcion'
  "diaMes": 15,                // mensual: 1-28 · quincenal: 1-13 (cobra también en diaMes+15)
  "diaSemana": 3,              // semanal: 0-6 (0 = domingo)
  "metodoPagoId": "uuid",
  "tarjeta": { "marca": "Visa", "last4": "4242" }   // opcional, snapshot informativo
}

Response (201):
{ "id": "uuid", "ventaInicialId": "uuid", "proximoCobro": "2026-08-15", "estado": "activa" }
```

```
GET /suscripciones

Response (200): suscripciones del usuario autenticado (join con items para
nombre/precio/moneda).
```

```
PATCH /suscripciones/:id

Request:
{ "accion": "pausar" | "reanudar" | "cancelar" }

Response (200): { "id": "uuid", "estado": "pausada", "activaHasta": null }
```

### Administración (módulo RBAC "Suscripciones")

Endpoints para el admin del tenant, protegidos con `PermisosGuard` +
`@RequiresPermiso('Suscripciones', ...)` — el rol admin fijo pasa por el
short-circuit `es_fijo`:

```
GET    /suscripciones/admin        → Leer       — todas las suscripciones del
                                     tenant (join usuarios: nombre + correo)
PATCH  /suscripciones/admin/:id    → Actualizar — pausar/reanudar/cancelar
                                     cualquier suscripción del tenant
DELETE /suscripciones/admin/:id    → Eliminar   — soft delete, SOLO canceladas
```

**Vigencia tras cancelar:** al `cancelar` (cliente o admin) se fija
`activa_hasta = proximo_cobro` vigente — el período ya cobrado queda usable
hasta el día anterior y "se cancela ese día a primera hora". El PATCH devuelve
`activaHasta` para que el frontend actualice la fila sin recargar.

`POST /suscripciones` valida que el item sea `tipo = 'suscripcion'` y esté
activo, calcula el total del primer período con el mismo motor de precios que
usa una venta normal, y crea la venta inicial (canal `online`, pago completo)
y la fila de `suscripciones` en **una sola transacción** — si el pago es
rechazado por la pasarela, no se crea ni venta ni suscripción (mismo patrón
todo-o-nada que el checkout normal). `frecuencia` se copia al momento del
alta como snapshot: si el admin cambia la frecuencia del item catálogo
después, las suscripciones ya activas no se ven afectadas.

---

## Backend

### Module & Services

- **Module**: `backend/src/modules/online/online.module.ts`
- **Controller**: `backend/src/modules/online/online.controller.ts`
- **Service**: `backend/src/modules/online/online.service.ts` — delega en
  `CalculoPreciosService.calcular()` (sin persistir) y genera un
  `checkoutRef` + `checkoutUrl` dummy.

### Suscripciones

- **Module**: `backend/src/modules/suscripciones/suscripciones.module.ts`
- **Controller**: `backend/src/modules/suscripciones/suscripciones.controller.ts`
  — rutas cliente `POST /`, `GET /`, `PATCH /:id` con `JwtAuthGuard` +
  `TenantGuard` (mismo estándar que `/online/checkout`), y rutas admin
  `GET/PATCH/DELETE /admin[...]` con `@RequiresPermiso('Suscripciones', ...)`
  (el `PermisosGuard` de clase solo actúa donde hay decorador).
- **Service**: `backend/src/modules/suscripciones/suscripciones.service.ts`:
  - `crear()`: valida item + reglas cruzadas de día según `frecuencia`
    (`mensual` requiere `diaMes` 1-28, `quincenal` requiere `diaMes` 1-13,
    `semanal` requiere `diaSemana`), calcula el total del primer período con
    `CalculoPreciosService`, y en una `dataSource.transaction()` llama a
    `VentasService.crearEnTransaccion()` (reutiliza la lógica de venta
    normal, canal `online`) seguido de `manager.save(Suscripcion, ...)`.
  - `findMias()`: `GET` con SQL raw, filtra por `tenant_id` + `usuario_id` del
    token, join con `items` para nombre/precio/moneda. Las columnas `DATE` se
    castean a `::text` para que la API devuelva `YYYY-MM-DD` plano (el driver
    pg las serializa como timestamps UTC y corre la fecha un día en TZ
    negativas).
  - `findTodas()`: variante admin sin filtro de usuario, con join adicional a
    `usuarios` (nombre + correo del cliente).
  - `cambiarEstado(tenantId, usuarioId | null, ...)`: aplica la máquina de
    estados validando la transición; `usuarioId = null` es el scope admin
    (opera sobre cualquier suscripción del tenant). Al `cancelar` fija
    `activaHasta = proximoCobro`.
  - `eliminar()`: soft delete (`softRemove`), rechaza suscripciones no
    canceladas.
- **Entity**: `backend/src/modules/suscripciones/entities/suscripcion.entity.ts`
  — tabla `suscripciones`, guarda `frecuencia`, `diaMes`/`diaSemana`,
  `estado`, `proximoCobro`, `activaHasta` (fin del período pagado al
  cancelar), snapshot de tarjeta (`tarjetaMarca`/`tarjetaLast4`, solo marca +
  últimos 4) y `ventaInicialId`.
- **Util**: `backend/src/modules/suscripciones/utils/proximo-cobro.util.ts`
  — `calcularProximoCobro()`, función pura que calcula la próxima fecha de
  cobro según frecuencia y ancla (día de mes o de semana).

### Cambios en items

- Nuevo tipo `'suscripcion'` en `items.tipo`, con extensión 1:1
  `item_suscripcion` (`frecuencia: 'semanal' | 'quincenal' | 'mensual'`) —
  mismo patrón que `item_producto`/`item_servicio`. No participa del
  tracking de stock/inventario (solo `producto` lo hace).

### Cambios en ventas

- `backend/src/modules/ventas/dto/create-venta.dto.ts`: `canal` acepta
  `'fisico' | 'online'`.
- `backend/src/modules/ventas/ventas.service.ts` `crear()`: para
  `canal === 'online'` usa `CajaService.findVirtual(tenantId)` en vez de la
  caja física del usuario, y exige que los pagos cubran el `totalFinal`
  (online no admite cuenta por cobrar).

### Caja virtual

- `backend/src/modules/caja/caja.service.ts`: nuevo `findVirtual(tenantId)`.
- La caja virtual ya se creaba automáticamente al dar de alta un tenant
  (`tenants.service.ts` paso 6); el seeder ahora también la siembra para los
  tenants de desarrollo (`seedCajasVirtuales()`).

### RBAC

- Nuevo `ModuloApp` "Tienda Online" (`url: '/tienda'`) con permisos Leer y
  Crear, contratado (`TenantModulo`) por los tenants Paris y Falabella.
  Sembrado en `seeder.service.ts`.
- Las rutas cliente de `/suscripciones` reutilizan este mismo nivel de acceso
  (`JwtAuthGuard` + `TenantGuard`, precedente de `/online/checkout`).
- **Módulo RBAC "Suscripciones"** (2026-07-06): `ModuloApp` propio
  (`url: '/suscripciones'`) con permisos **Leer / Actualizar / Eliminar**,
  contratado por Paris y Falabella. Protege los endpoints admin con
  enforcement real (`@RequiresPermiso`); es el primer módulo de negocio que
  estrena el guard granular fuera de Caja/Test.

### Seed

- `seeder.service.ts` → `seedItemsSuscripcion()`: siembra 3 items suscribibles
  de ejemplo para el tenant Paris — "Mensualidad Gimnasio" (mensual, 30000
  CLP), "Clase semanal de yoga" (semanal, 8000 CLP), "Plan quincenal de
  limpieza" (quincenal, 15000 CLP).

---

## Frontend

### Pages

Páginas de nivel superior (patrón `ventas/*.vue`: cada una con su propio
`definePageMeta` y `UDashboardPanel` + `AppNavbar`, sin layout padre
intermedio). Cada una aparece como entrada directa en el sidebar principal,
detrás del mismo permiso `Tienda Online:Leer`:

- `pages/tienda/index.vue` — catálogo + carrito (`/tienda`).
- `pages/tienda/suscripciones.vue` — **"Mis suscripciones"**: lista de
  suscripciones del usuario (API-backed), drawer "Nueva suscripción" para
  elegir item suscribible, día de cobro y tarjeta preferida, y acciones
  pausar/reanudar/cancelar. Cancelar abre un **modal informativo** con la
  vigencia (activa hasta el día anterior a `proximo_cobro`, se cancela ese
  día a primera hora) antes de confirmar (`/tienda/suscripciones`).
- `pages/suscripciones.vue` — **administración (admin)**: todas las
  suscripciones del tenant con cliente (nombre + email), estado, vigencia y
  filtro por estado; acciones pausar/reanudar/cancelar (mismo modal, en
  tercera persona) y eliminar (solo canceladas, con confirmación). Entrada
  propia "Suscripciones" en el sidebar, gated
  `esAdmin || can('Suscripciones', 'Leer')`; los botones se gatean por
  `Actualizar`/`Eliminar` (`/suscripciones`).
- `pages/tienda/medios-pago.vue` — tarjetas inscritas vía Oneclick,
  agregar/eliminar/preferida (ver sección "Mis medios de pago (inscripción
  Oneclick)") (`/tienda/medios-pago`).
- `pages/tienda/pasarela.vue` — pasarela dummy (resumen, aprobar/rechazar).
  No tiene entrada propia en el sidebar, solo se llega desde el checkout de
  compra normal o desde el drawer de alta de suscripción
  (`?ref=...&modo=suscripcion`). En modo suscripción, "Aprobar" llama a
  `POST /suscripciones` en vez de `POST /ventas` directamente.

### Components

- `components/tienda/CarritoOnline.vue` — versión simplificada de
  `VentasCarritoPanel` (sin caja, tipo de documento ni customer).
- Reutiliza `VentasCatalogoGrid` sin cambios.

### Composables (sin store Pinia — mismo enfoque que `useVenta`)

- `composables/useTiendaCarrito.ts` — carrito de la tienda. Usa `useState`
  (no un `ref` local) para sobrevivir la navegación `/tienda` →
  `/tienda/pasarela`. Reutiliza los helpers puros de `useVenta.ts`
  (`agregarLinea`, `quitarLinea`, `setCantidad`, `toCalcularInput`).
- `composables/useTarjetas.ts` — **API-backed** (`GET/POST /online/medios-pago`,
  `DELETE /online/medios-pago/:id`, `PATCH /online/medios-pago/:id/preferida`),
  reemplaza el mock anterior en `localStorage`. Nunca viaja el número completo
  ni el CVV, solo marca + últimos 4 que devuelve Transbank.
- `composables/useSuscripciones.ts` — **API-backed** (`GET`/`PATCH
  /suscripciones`), reemplaza el mock anterior en `localStorage`. Expone
  `suscripciones`, `loading`, `cargar()` y `pausar()`/`reanudar()`/
  `cancelar()` con update optimista (revierte el estado local si el `PATCH`
  falla). Exporta además los helpers compartidos `frecuenciaLabel`,
  `detalleDia()` y `diaAnterior()` (usados por ambas páginas de
  suscripciones).
- `composables/useSuscripcionesAdmin.ts` — mismo patrón optimista pero contra
  `GET/PATCH/DELETE /suscripciones/admin[...]`; agrega `usuarioNombre`/
  `usuarioEmail` a la interface y `eliminar()` con remoción optimista de la
  fila.
- `composables/useSuscripcionCheckout.ts` — intención de alta de suscripción
  en tránsito. Mismo patrón `useState` que `useTiendaCarrito` (no un `ref`
  local): sobrevive la navegación de `/tienda/suscripciones` a
  `/tienda/pasarela` (páginas distintas, no la misma instancia de
  componente). Guarda el `checkout` calculado, el item, la frecuencia, el día
  elegido y la tarjeta; la pasarela lo consume para completar el `POST
  /suscripciones` tras "Aprobar".

---

## Data Flow

### Compra online

```
[Usuario agrega ítems al carrito en /tienda]
  ↓ useTiendaCarrito().add(item)
[Click "Pagar"]
  ↓ POST /online/checkout (solo calcula, no persiste)
[navigateTo(checkoutUrl) → /tienda/pasarela?ref=...]
  ↓
[Usuario "Aprueba" en la pasarela dummy]
  ↓ POST /ventas { canal: 'online', pagos: [...] }
[VentasService.crear(): caja virtual, pago completo obligatorio]
  ↓
[Venta nace en estado 'pagada']
  ↓
[Carrito se limpia; link al detalle de la venta]
```

Si el usuario **rechaza** o abandona antes de aprobar, no se crea ningún
registro — evita ventas huérfanas por intentos incompletos.

### Alta de suscripción

```
[Admin crea item tipo 'suscripcion' en Configuración → Items]
  ↓ sin cobro en este paso — solo queda disponible en el catálogo
[Customer entra a /tienda/suscripciones → "Nueva suscripción"]
  ↓ elige item, día de cobro (dia_mes o dia_semana según frecuencia) y tarjeta
  ↓ useSuscripcionCheckout().value = { checkout, itemId, frecuencia, dia..., tarjeta }
[navigateTo('/tienda/pasarela?ref=...&modo=suscripcion')]
  ↓
[Usuario "Aprueba" en la pasarela dummy]
  ↓ POST /suscripciones { itemId, diaMes|diaSemana, metodoPagoId, tarjeta }
[SuscripcionesService.crear(): valida item + reglas de día, calcula el
 primer período con CalculoPreciosService, y en UNA transacción crea la
 venta inicial (canal online, pago completo) + la fila de suscripciones]
  ↓
[Suscripción nace en estado 'activa', con proximo_cobro calculado]
  ↓
[useSuscripcionCheckout se limpia; redirect a /tienda/suscripciones]
```

Si el pago es **rechazado** en la pasarela, no se llama a `POST
/suscripciones` — no se crea ni venta ni suscripción (mismo patrón
todo-o-nada). Cobros de períodos siguientes al primero no están
automatizados en esta fase (no hay job/cron); solo se persiste la fecha en
`proximo_cobro`.

---

## Mis medios de pago (inscripción Oneclick)

`/tienda/medios-pago` gestiona las tarjetas reales del usuario, tokenizadas en
Transbank vía Oneclick (sin mock: el localStorage anterior murió).

- **Fachada JWT**: `GET/POST /online/medios-pago`, `DELETE /online/medios-pago/:id`,
  `PATCH /online/medios-pago/:id/preferida` (permisos `Tienda Online`). El
  `pagadorRef` de la inscripción es el `usuarioId` del token: cada usuario ve y
  gestiona solo sus tarjetas dentro del tenant.
- **Alta**: `POST` inicia la inscripción y el navegador sale a Webpay
  (`urlWebpay` con `TBK_TOKEN` embebido). El retorno cae en
  `/pasarela/retorno/inscripcion` y redirige a la página con
  `?inscripcionId=…&estado=activa|fallida` (toast + refetch).
- **Sin Oneclick activo**: la página muestra un aviso y deshabilita el alta
  (`oneclickDisponible` en el GET).
- **Preferida**: persistida en `pasarela_inscripciones.preferida`; al cobrar sin
  inscripción explícita gana la preferida y luego la más reciente.
- Nunca viaja un PAN/CVV por nuestra app: solo marca + últimos 4 que devuelve
  Transbank.

> Pendiente: verificación manual contra integración Transbank (tarjeta de
> prueba 4051 8856 0044 6623); el redirect usa GET con TBK_TOKEN — si el
> ambiente real lo rechaza, cambiar a form POST.

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/online/online.service.spec.ts
npm test -- modules/ventas/ventas.service.spec.ts
npm test -- modules/caja/caja.service.spec.ts
npm test -- modules/suscripciones/suscripciones.service.spec.ts
npm test -- modules/online/medios-pago-online.service.spec.ts
```

### Manual Testing (Frontend)

1. `docker-compose up`, login como admin del tenant Paris.
2. Verificar que "Tienda Online" aparece en el sidebar.
3. Agregar ítems al carrito, click "Pagar" → revisar resumen en la pasarela.
4. "Rechazar" → no se crea venta, el carrito sigue intacto.
5. "Aprobar" → venta visible en `/ventas` con canal `online` y estado
   `pagada`.
6. Medios de pago: agregar tarjeta desde `/tienda/medios-pago` → redirect a
   Webpay (integración) → volver con toast y tarjeta listada. Verificar
   también eliminar/marcar preferida y que persiste tras recargar.
7. Suscripciones: ver los 3 items de ejemplo sembrados, dar de alta una
   nueva (elegir día + tarjeta), "Rechazar" en la pasarela → no se crea
   suscripción ni venta; "Aprobar" → suscripción `activa` con
   `proximo_cobro` calculado y venta inicial visible en `/ventas`. Probar
   pausar/reanudar/cancelar y verificar que las transiciones inválidas
   fallan.

---

## Acceptance Criteria

- [x] Endpoint de checkout sin persistencia implementado y testeado.
- [x] Canal `'online'` en ventas (caja virtual, pago completo obligatorio).
- [x] Frontend: catálogo, carrito, pasarela, suscripciones, medios de pago.
- [x] RBAC: módulo "Tienda Online" sembrado y filtrado en el sidebar.
- [x] Suscripciones: tipo de item `item_suscripcion`, endpoints
  `POST/GET/PATCH /suscripciones`, alta atómica con primer cobro, máquina de
  estados `activa`/`pausada`/`cancelada`.
- [x] Administración de suscripciones: módulo RBAC "Suscripciones" propio,
  endpoints admin (`GET/PATCH/DELETE /suscripciones/admin`), página
  `/suscripciones`, vigencia `activa_hasta` al cancelar y modales de
  confirmación informativos (cliente y admin).
- [x] Unit tests backend en verde.
- [x] Verificación manual end-to-end en navegador.

---

## Related Features

- [Ventas](ventas.md)
- [Gestión de cajas](gestion-cajas.md)
- [Motor de cálculo de precios](motor-calculo-precios.md)
- [Roles y permisos](roles-permisos.md)

---

## Notes

Medios de pago pasó de mock (`localStorage`, scoped por tenant) a inscripción
real vía Oneclick desde 2026-07-11 (ver sección "Mis medios de pago
(inscripción Oneclick)") — ya no hay tarjetas simuladas.

Suscripciones **sí tiene backend real** desde 2026-07-05 (ver secciones
arriba). El mock anterior en `localStorage` (clave
`tienda:suscripciones:<tenantId>`) queda huérfano — solo contenía datos de
ejemplo, no requiere migración.

El cobro recurrente de los períodos siguientes al primero no está
automatizado: no hay job/cron que ejecute `proximo_cobro`. Queda fuera de
alcance para una fase futura.

### Detalle real del pago Webpay (2026-07-10)

Cuando el checkout cobra por **Webpay Plus real**, la venta refleja el detalle
que devuelve Transbank (no un método fijo):

- El callback (`OnlineCallbackHandler`) elige el método según el
  `payment_type_code`: `VD` → **"Tarjeta de débito"** (si el tenant lo tiene
  habilitado), cualquier otro → **"Tarjeta de crédito"** (fallback seguro).
- El pago guarda `numero_cuotas`, `tipo_pago` y `tarjeta_ultimos4` (solo los 4
  finales). Se muestran en el **listado de Pagos** (`/pagos`) y en la **página de
  retorno** (`/tienda/retorno`).
- En **rechazo**, `/tienda/retorno` muestra el motivo nivel 2 traducido desde el
  `response_code` (ver `pasarela/utils/codigos-respuesta.ts`).

Detalle del mecanismo en [pasarela-pagos.md](pasarela-pagos.md).
