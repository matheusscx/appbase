# Feature: Tienda Online

**Status**: Complete
**Owner**: —
**Last Updated**: 2026-07-05

---

## Overview

### What is it?

Módulo interno (usuario del tenant logueado) que permite navegar el catálogo de
productos, armar un carrito y "pagar" a través de una pasarela de pago
simulada (dummy). Incluye además dos secciones sin backend: suscripciones
(compras recurrentes de items) y medios de pago (tarjetas guardadas).

### Why does it exist?

Estrena el canal `'online'` de ventas (hasta ahora solo diseñado, no
implementado) y sienta la base de un futuro storefront público, reutilizando
el mismo carrito/catálogo.

### Scope

- Included in this version:
  - Checkout que solo calcula (motor de precios) y devuelve una URL dummy —
    no persiste nada hasta que el usuario aprueba en la pasarela.
  - Canal `'online'` en ventas: usa la caja virtual del tenant, exige pago
    completo (no admite cuenta por cobrar), nace directamente `pagada`.
  - Suscripciones y medios de pago: solo frontend, mock en `localStorage`.
  - Módulo RBAC "Tienda Online" (permisos Leer/Crear).
- NOT included (future):
  - Storefront público / auth de customer final.
  - Integración con pasarela real.
  - Backend de suscripciones (cobro recurrente real).
  - Guard granular `@RequiresPermiso` por endpoint (sigue el estándar actual:
    `JwtAuthGuard` + `TenantGuard`).

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

---

## Backend

### Module & Services

- **Module**: `backend/src/modules/online/online.module.ts`
- **Controller**: `backend/src/modules/online/online.controller.ts`
- **Service**: `backend/src/modules/online/online.service.ts` — delega en
  `CalculoPreciosService.calcular()` (sin persistir) y genera un
  `checkoutRef` + `checkoutUrl` dummy.

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

---

## Frontend

### Pages

Páginas de nivel superior (patrón `ventas/*.vue`: cada una con su propio
`definePageMeta` y `UDashboardPanel` + `AppNavbar`, sin layout padre
intermedio). Cada una aparece como entrada directa en el sidebar principal,
detrás del mismo permiso `Tienda Online:Leer`:

- `pages/tienda/index.vue` — catálogo + carrito (`/tienda`).
- `pages/tienda/suscripciones.vue` — lista mock de compras recurrentes
  (`/tienda/suscripciones`).
- `pages/tienda/medios-pago.vue` — tarjetas mock, agregar/eliminar/preferida
  (`/tienda/medios-pago`).
- `pages/tienda/pasarela.vue` — pasarela dummy (resumen, aprobar/rechazar);
  no tiene entrada propia en el sidebar, solo se llega desde el checkout.

### Components

- `components/tienda/CarritoOnline.vue` — versión simplificada de
  `VentasCarritoPanel` (sin caja, tipo de documento ni customer).
- Reutiliza `VentasCatalogoGrid` sin cambios.

### Composables (sin store Pinia — mismo enfoque que `useVenta`)

- `composables/useTiendaCarrito.ts` — carrito de la tienda. Usa `useState`
  (no un `ref` local) para sobrevivir la navegación `/tienda` →
  `/tienda/pasarela`. Reutiliza los helpers puros de `useVenta.ts`
  (`agregarLinea`, `quitarLinea`, `setCantidad`, `toCalcularInput`).
- `composables/useTarjetas.ts` — tarjetas en `localStorage`, scoped por
  tenant. Nunca guarda el número completo ni el CVV, solo marca + últimos 4.
- `composables/useSuscripciones.ts` — suscripciones en `localStorage`, scoped
  por tenant, con seed de ejemplos si está vacío.

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

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/online/online.service.spec.ts
npm test -- modules/ventas/ventas.service.spec.ts
npm test -- modules/caja/caja.service.spec.ts
```

### Manual Testing (Frontend)

1. `docker-compose up`, login como admin del tenant Paris.
2. Verificar que "Tienda Online" aparece en el sidebar.
3. Agregar ítems al carrito, click "Pagar" → revisar resumen en la pasarela.
4. "Rechazar" → no se crea venta, el carrito sigue intacto.
5. "Aprobar" → venta visible en `/ventas` con canal `online` y estado
   `pagada`.
6. Medios de pago: agregar/eliminar/marcar preferida, verificar que persiste
   tras recargar y que el número completo nunca queda en `localStorage`.
7. Suscripciones: ver seed de ejemplo, pausar/reanudar/cancelar.

---

## Acceptance Criteria

- [x] Endpoint de checkout sin persistencia implementado y testeado.
- [x] Canal `'online'` en ventas (caja virtual, pago completo obligatorio).
- [x] Frontend: catálogo, carrito, pasarela, suscripciones, medios de pago.
- [x] RBAC: módulo "Tienda Online" sembrado y filtrado en el sidebar.
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

Suscripciones y medios de pago son mocks (`localStorage`, scoped por
tenant) — no hay persistencia en backend en esta fase.
