# Plan: Módulo Tienda Online (catálogo + carrito + checkout dummy + suscripciones y tarjetas mock)

- **Status:** Done
- **Date:** 2026-07-05
- **Owner:** Cesar Matheus

## Context

Nuevo módulo contratable "Tienda Online": un usuario interno del tenant navega el catálogo, arma un carrito y "paga" a través de una pasarela dummy. Estrena el canal `'online'` de ventas (hoy diseñado pero no implementado: el DTO solo acepta `'fisico'`, el service hardcodea el canal y exige caja física abierta, y la caja virtual no existe en código). El catálogo/carrito se construye reutilizable para un futuro storefront público; suscripciones y tarjetas son siempre internas y por ahora solo frontend (mock).

**Decisiones validadas con el usuario:**
- "Pagar" **no persiste nada** (evitar ventas basura por intentos abandonados): el backend solo calcula con el motor de precios y devuelve totales + URL dummy.
- La venta se crea **recién al "Aprobar"** en la pasarela dummy: nace directamente `pagada` (regla existente para canal online), con pago inline sobre la **caja virtual**.
- Se implementa la **caja virtual** (deuda de arquitectura ya diseñada: una por tenant, siempre abierta).
- Módulo RBAC completo: `ModuloApp` "Tienda Online", contratado por los tenants de dev, entrada en sidebar filtrada por permiso.
- Suscripciones = compras recurrentes de items del catálogo; por ahora lista mock en localStorage.
- Tarjetas: solo frontend/localStorage; guardar únicamente marca + últimos 4 + vencimiento + titular (nunca PAN ni CVV).

## Scope / Out of scope

**In scope:** caja virtual (seed + lookup + uso en canal online), canal `'online'` en ventas, endpoint checkout sin persistencia, módulo RBAC "Tienda Online", páginas Tienda / Pasarela / Suscripciones / Medios de pago, docs vivas.

**Out of scope:** storefront público, auth de customer final, pasarela real, backend de suscripciones y tarjetas, cobro recurrente, guard granular `@RequiresPermiso` por endpoint (sigue el estándar actual: `JwtAuthGuard` + `TenantGuard`).

## Backend

### 1. Caja virtual
- [x] `caja.service.ts`: método `findVirtual(tenantId)` — caja `tipo='virtual'` del tenant (estado `abierta`, `eliminado_el IS NULL`). La entidad `Caja` ya soporta `tipo` (`backend/src/modules/caja/entities/caja.entity.ts:24`).
- [x] Seeder (`seeder.service.ts`): nuevo `seedCajasVirtuales()` — una caja virtual abierta por tenant de dev (Paris, Falabella) con UUIDs fijos desde `550e8400-...-446655440150` (verificar el siguiente libre al implementar).
- [x] Creación de tenant: donde hoy se siembran rol admin + fórmula de precio (`tenants.service`), agregar la caja virtual automática (decisión ya documentada en CLAUDE.md).

### 2. Canal `'online'` en ventas
- [x] `create-venta.dto.ts:124`: `@IsIn(['fisico', 'online'])`.
- [x] `ventas.service.ts` `crear()`: si `canal === 'online'` → usar `cajaService.findVirtual(tenantId)` en vez de `findActiva` (error de negocio claro si no existe); persistir `canal` del DTO (hoy hardcodeado `'fisico'` en L147); **exigir** `pagos` que cubran `totalFinal` (online llega directamente a `pagada`, sin cuenta por cobrar).
- [x] Tests unitarios del service para el branch online (caja virtual, pago completo obligatorio, estado final `pagada`).

### 3. Módulo `online` (checkout sin persistencia)
- [x] Nuevo `backend/src/modules/online/` (esqueleto de `docs/patterns/backend.md` §1, sin entities): `CheckoutDto` (líneas iguales a `LineaVentaDto` + descuentos/recargos de venta opcionales), `OnlineService.checkout()` que valida items del tenant, invoca `calculoPreciosService.calcular()` (ya funciona sin persistir) y devuelve `{ resultado, checkoutRef: uuid, checkoutUrl: '/tienda/pasarela?ref=<uuid>' }`. Controller `POST /online/checkout` con `JwtAuthGuard` + `TenantGuard`. Registrar en `app.module.ts`.
- [x] Test unitario del service (mock de `CalculoPreciosService`).

### 4. RBAC seed ("Tienda Online")
Patrón existente en `seeder.service.ts` (`seedModulosApp` L307, `seedModuloAppPermisos` L377, `seedTenantModulo` ~L1100):
- [x] `ModuloApp` "Tienda Online" (`url: '/tienda'`, UUID fijo libre) + pares módulo×permiso (Leer, Crear).
- [x] `TenantModulo` activo para Paris y Falabella. (El rol admin del tenant ve el módulo automáticamente vía `esAdmin`; wiring de roles no-admin queda fuera de alcance.)

## Frontend

Formato de permiso servido: `'Tienda Online:Leer'` (`rbac.service.ts` genera `Modulo:Permiso`). Usar `useApiFetch`, `useFormatters`, tokens semánticos del design system.

### 5. Navegación y estructura
- [x] `layouts/dashboard.vue`: entrada "Tienda Online" (`i-lucide-store`, `to: '/tienda'`) si `esAdmin || can('Tienda Online', 'Leer')`.
- [x] Sección con padre + tabs (patrón `configuracion.vue`): `pages/tienda.vue` (tabs: Tienda / Suscripciones / Medios de pago) + hijos `pages/tienda/index.vue`, `suscripciones.vue`, `medios-pago.vue`, `pasarela.vue` (sin tab propio).

### 6. Tienda: catálogo + carrito (`tienda/index.vue`)
- [x] Reusar `VentasCatalogoGrid` (props `items/loading`, emit `add`) y `descontarStockCatalogo`; cargar items con `useApiFetch('/items?...')` como en `pos.vue`.
- [x] Carrito online: composable `composables/useTiendaCarrito.ts` con `useState` (no Pinia — el estado debe sobrevivir la navegación a la pasarela, cosa que el `useVenta` por-página no hace). Reutiliza las funciones puras ya testeadas de `useVenta.ts` (`agregarLinea`, `quitarLinea`, `setCantidad`, `toCalcularInput`) y recalcula con `useCalculoPrecios`.
- [x] Nuevo componente `components/tienda/CarritoOnline.vue` (versión simplificada de `CarritoPanel`: sin caja, sin tipo de documento, sin customer form).
- [x] Botón **Pagar** → `POST /online/checkout` → guardar `{ ref, resultado }` en el store → `navigateTo(checkoutUrl)`.

### 7. Pasarela dummy (`tienda/pasarela.vue`)
- [x] Lee `ref` del query + snapshot del store (si no hay snapshot → redirect a `/tienda`). Muestra resumen de compra, totales y la tarjeta preferida del mock (o aviso si no hay tarjetas, con link a Medios de pago).
- [x] **Aprobar** → `POST /ventas` con `canal: 'online'`, líneas del snapshot, `pagos: [{ metodoPagoId, monto: totalFinal }]` (método de pago tipo tarjeta desde `/metodos-pago`), `customer: { nombre: usuario logueado }`. Éxito → limpiar carrito + snapshot, pantalla de confirmación con link al detalle de la venta (`/ventas/[id]`).
- [x] **Rechazar** → volver a `/tienda` sin crear nada; el carrito sigue intacto en el store.

### 8. Medios de pago mock (`tienda/medios-pago.vue`)
- [x] Composable `useTarjetas` con localStorage (`tienda:tarjetas:<tenantId>`): lista de `{ id, titular, marca, last4, vencimiento, preferida }`. Al agregar, detectar marca por primer dígito y descartar el número (solo last4).
- [x] UI: lista/tabla con agregar (modal UForm), eliminar (confirm) y **marcar preferida** con el patrón "estrella / solo una" de `docs/patterns/frontend.md` §4 (versión local, sin PATCH).

### 9. Suscripciones mock (`tienda/suscripciones.vue`)
- [x] Composable `useSuscripciones` con localStorage: `{ id, itemNombre, precio, frecuencia, proximoCobro, estado, tarjetaLast4 }`, con seed de 2–3 ejemplos si está vacío.
- [x] UI: lista con badge de estado y acciones pausar / reanudar / cancelar (solo mutan localStorage).

## Docs (documentación viva, mismo cambio)
- [x] `CLAUDE.md`: fila "Módulo Tienda Online" en Estado actual + actualizar la sección Ventas/Cajas (canal online y caja virtual ya implementados).
- [x] `docs/features/tienda-online.md` desde `TEMPLATE.md` + link en `docs/README.md`.
- [x] Si cambia una regla de negocio (venta online exige pago completo): reflejar en `docs/PRODUCTO.md`.

## Verification
1. **Unit:** `cd backend && npm test` (nuevos specs de `online.service` y branch online de `ventas.service`) y `npm run lint`.
2. **E2E manual** (`docker-compose up`, login en tenant Paris):
   - El sidebar muestra "Tienda Online"; en un tenant sin el módulo contratado, no aparece.
   - Agregar items al carrito → totales visibles coinciden con el POS para el mismo carrito.
   - Pagar → pasarela con resumen; **Rechazar** → no se crea venta y el carrito sigue; **Aprobar** → venta en historial con canal `online`, estado `pagada`, pago registrado y movimiento en caja virtual (verificable vía `mcp__postgres__query`).
   - Tarjetas: agregar/eliminar/preferida persisten tras recargar; nunca se guarda el número completo (inspeccionar localStorage).
   - Suscripciones: seed visible, pausar/cancelar persisten.
3. Verificación en navegador con chrome-devtools MCP (flujo completo tienda → pasarela → venta).

## Decisions / Open questions
- El precio se calcula dos veces (checkout para mostrar, creación de venta al aprobar) — aceptado: mismo motor, mismos datos, backend sin estado intermedio.
- `checkoutRef` es cosmético en esta fase (simula el token de la pasarela); no se valida en el backend al crear la venta.
- Carrito online implementado con `useState` (composable `useTiendaCarrito`, no Pinia/sessionStorage): más simple, sigue el patrón ya usado por `useVenta`, y sobrevive igual la navegación cliente a la pasarela (solo se pierde en un full reload, caso cubierto por el redirect a `/tienda` si no hay snapshot válido).
