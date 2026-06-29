# Spec: Pantalla POS (crear venta) — frontend punto 10

Status: Approved
Date: 2026-06-29
Owner: Cesar Matheus

## Context

El backend de ventas (punto 10) ya está implementado: `POST /api/ventas` (canal
`fisico`), `GET /api/ventas`, `GET /api/ventas/:id`, y el motor de precios
`POST /calculo-precios/calcular` envuelto en el composable `useCalculoPrecios()`.
Falta la cara de usuario: una **pantalla de punto de venta** para registrar ventas.

Esta fase entrega **solo la creación de venta (POS)**. El historial/listado, el
detalle expandido y el comprobante imprimible quedan documentados como pendientes.

Insight de UX que guía el diseño: la fricción la maneja el **tipo de documento**.
Una compra simple (boleta) no debe pedir nada del cliente — carrito, pago, listo.
Una factura sí requiere datos del cliente.

## Scope / Out of scope

**In scope**
- Pantalla POS para venta de canal `fisico`: catálogo (buscador + grilla) → carrito
  (solo cantidad, reglas automáticas del motor) → cobro con múltiples pagos y vuelto.
- Documento por defecto Boleta sin fricción; Factura revela datos del cliente obligatorios.
- Adición mínima de backend: flag `requiere_customer` en `tipos_documento_tributario`
  + endpoint de lectura `GET /tipos-documento`.

**Out of scope** (documentado como pendiente / fase futura)
- Listado / historial de ventas, detalle expandido (`GET /ventas`, `GET /ventas/:id`) — punto 11.
- Comprobante / recibo imprimible.
- Descuentos/recargos manuales por línea o a nivel de venta (el motor aplica solo las
  reglas por defecto del ítem; sin override de UI en esta fase).
- Canal `online` / caja virtual.
- Notas de crédito / devoluciones.
- Selección de método de pago para el motor de precios (`metodoPagoId` de cálculo): se
  omite porque es ambiguo con múltiples pagos; se podría sumar después.

## Decisiones tomadas (brainstorming)

| Tema | Decisión |
|---|---|
| Alcance | Solo crear venta (POS). Historial/detalle/impresión → pendiente. |
| Selección de ítems | Buscador + grilla de cards (ambos). |
| Control de precios | Solo cantidad; reglas automáticas del motor. Desglose visible, no editable. |
| Pagos | Múltiples métodos por venta + cálculo de vuelto. |
| Fricción documento | Boleta por defecto, sin pedir cliente. Factura → datos de cliente obligatorios. |
| Flag documento | Columna `requiere_customer` en BD (la regla vive en datos, no en código). |

## Backend (adición mínima)

1. **Entity + schema:** columna `requiere_customer BOOLEAN NOT NULL DEFAULT false` en
   `tipos_documento_tributario` (entity `tipo-documento-tributario.entity.ts` +
   `startup-pos.sql`). Columna nueva, sin migración formal en esta fase de desarrollo
   (se recrea el volumen). Mapear como `requiereCustomer: boolean`.
2. **Seeder** (`seeder.service.ts`): Boleta → `requiere_customer = false`,
   Factura → `requiere_customer = true`.
3. **Endpoint** `GET /tipos-documento`: lista los `tipos_documento_tributario`
   `activo = true` y `eliminado_el IS NULL` del **país del tenant** autenticado.
   Guards `JwtAuthGuard + TenantGuard`. Resuelve el país desde el tenant.
   Respuesta: `[{ id, nombre, codigo, requiereCustomer }]`.
   - Ubicación: reusar el módulo `ventas` (controller/service) o un módulo chico
     `tipos-documento`. Decisión de implementación en el plan; preferible `ventas`
     para no multiplicar módulos.
4. `POST /api/ventas` **no cambia**.

## Frontend

### Ruta y navegación
- Página `app/pages/ventas/index.vue` con
  `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`.
- Ítem de nav "Punto de venta" (`i-heroicons-shopping-cart`) en `dashboard.vue`,
  visible si `permissionsStore.esAdmin || permissionsStore.can('Ventas', 'Crear')`.
  (El backend aún no aplica permiso granular en `POST /ventas` — TODO RBAC documentado.)

### Layout — dos paneles dentro de `UDashboardPanel`
- **Izquierda (catálogo):** buscador (`UInput`) + grilla de cards de ítems
  (`GET /items`, filtrado client-side por nombre/código). Click en una card agrega
  o incrementa la línea en el carrito.
- **Derecha (carrito):** líneas con cantidad editable (+/− y quitar), selector de
  tipo de documento, sección de cliente condicional, desglose de totales (del motor),
  botón **Cobrar**.

### Componentes (`app/components/ventas/`)
| Componente | Rol |
|---|---|
| `CatalogoGrid.vue` | Buscador + grilla; emite `add(item)`. |
| `CarritoPanel.vue` | Líneas, cantidades, selector de documento, desglose de totales, botón Cobrar. |
| `ClienteForm.vue` | Campos del cliente (nombre, rut, dirección, teléfono, email); visible solo si el documento `requiereCustomer`. |
| `CobroModal.vue` | Lista de pagos (método desde `GET /metodos-pago` + monto), suma/restante/vuelto, confirma → `POST /api/ventas`. |

### Composable `app/composables/useVenta.ts`
- Estado del carrito: `lineas` (cada una `{ item, cantidad }`), con add / remove /
  cambiar cantidad usando **arrays inmutables** (patrón frontend §9).
- Recálculo: ante cada cambio del carrito llama `useCalculoPrecios().calcular({ lineas })`
  con **debounce**; expone `resultado` (desglose neto → descuentos → recargos →
  impuestos → total) y `loadingCalculo`.
- **Dinero como string end-to-end** (patrón frontend §7): cantidades y montos son string,
  `UInput` con `inputmode="decimal"`, nunca `type="number"`.

### Flujo de datos
1. `onMounted`: en paralelo `cajaStore.cargarActiva()`, `GET /items`,
   `GET /metodos-pago`, `GET /tipos-documento`.
2. Cada cambio de carrito → `calcular({ lineas: [{ itemId, cantidad }] })` (debounced)
   → se muestra el desglose y el total.
3. **Cobrar** abre `CobroModal`: el cajero agrega uno o más pagos (método + monto string).
   El modal muestra `sumaPagos`, `restante` y `vuelto` (cuando la suma excede el total y
   al menos un método `permite_vuelto`). Confirmar arma el `CreateVentaDto`:
   `{ lineas: [{ itemId, cantidad }], pagos: [{ metodoPagoId, monto, referencia? }],
   customer?, tipoDocumentoId, comentario? }` y hace `POST /api/ventas` vía `useApiFetch`.
4. Éxito → toast con el estado resultante (`pagada` / `pendiente`) y el vuelto; reset del
   carrito. Errores de negocio del backend (sin caja, excedente sin vuelto, stock
   insuficiente) se muestran vía `e.data.message` en un `useToast`.

### Gate de caja
Si `cajaStore.activa` es null tras cargar: panel bloqueante con mensaje
"Necesitás una caja abierta para vender" y botón a `/caja`. El botón Cobrar queda
deshabilitado mientras no haya caja activa.

### Fricción por documento
- Documento por defecto = Boleta (`requiereCustomer = false`) → cobrar sin pedir cliente.
- Si se elige Factura (`requiereCustomer = true`) → `ClienteForm` visible y `nombre`
  obligatorio antes de habilitar Cobrar.

## Verification

- **Unit** (`useVenta.spec.ts`, Vitest — patrón de `stores/*.spec.ts`): add / remove /
  cambio de cantidad; integración con `calcular` mockeado; reglas del gate
  ("no cobrar sin caja", "factura requiere nombre de cliente").
- **Manual:** login → abrir caja → vender boleta con efectivo que excede (verificar
  vuelto) → vender factura completando cliente → confirmar baja de stock y movimiento de
  caja. Probar el bloqueo sin caja abierta.

## Documentación viva (mismo cambio)
- `docs/features/ventas.md`: agregar sección Frontend (POS) y endpoint `GET /tipos-documento`.
- `docs/README.md` / `CLAUDE.md`: nota de que el POS (crear venta) tiene UI; historial pendiente.
- `docs/patterns/frontend.md`: si aporta, patrón de pantalla POS dos paneles + carrito con
  recálculo debounced.

## Pendiente para fases futuras (documentado)
- Listado / historial de ventas + detalle expandido (punto 11).
- Comprobante / recibo imprimible.
- Descuentos/recargos manuales por línea y a nivel de venta.
- Canal online, notas de crédito.
