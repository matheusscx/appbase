# Diseño: Vaciar todo el POS para iniciar una nueva venta desde cero

- **Status:** Approved
- **Date:** 2026-07-06
- **Owner:** Cesar Matheus

## Contexto

Hoy, para abandonar una venta en curso en `frontend/app/pages/ventas/pos.vue`
(carrito con ítems + datos de cliente cargados + tipo de documento
seleccionado) y empezar una nueva desde cero, la única forma es recargar la
página. El único reset existente es el que corre automáticamente tras una
venta exitosa (`pos.vue:152-157`): limpia carrito y datos de cliente, pero
no toca el tipo de documento seleccionado.

Se agrega una opción manual, "Vaciar todo", que deja el POS en el mismo
estado que justo después de abrir la página, sin necesidad de recargar.

## Decisiones validadas con el usuario

1. **Ubicación:** botón en el header de `CarritoPanel.vue`, junto al
   `USelect` de tipo de documento.
2. **Confirmación:** sí, mediante el componente reusable `CrudModal.vue`
   (mismo patrón usado en `terceros.vue`, `categorias.vue`, `items.vue`)
   antes de ejecutar el reset.
3. **Tipo de documento:** SÍ se resetea al primer tipo de la lista
   (`props.tiposDocumento[0]?.id`) — a diferencia del reset post-venta
   existente, que no lo toca. El usuario prefirió fidelidad literal a
   "empezar desde cero" sobre la consistencia con el flujo post-venta.

## Componentes

### `CarritoPanel.vue`

- Nuevo botón en `#header`, después del `USelect`:
  - Icon-only, `icon="i-lucide-eraser"`, `variant="ghost"`,
    `color="neutral"`, `size="sm"`, envuelto en `UTooltip` con texto
    "Vaciar todo".
  - `:disabled` cuando no hay nada que limpiar:
    `!lineas.length && !hasCustomerData && tipoDocumentoId === props.tiposDocumento[0]?.id`.
  - `@click` abre `vaciarModalOpen = true`.
- Nuevo `<CrudModal>` montado como sibling (junto al `VentasClienteDrawer`
  existente):
  ```vue
  <CrudModal
    v-model:open="vaciarModalOpen"
    title="Vaciar venta actual"
    message="¿Estás seguro de que quieres vaciar el carrito, los datos del cliente y el tipo de documento? Esta acción no se puede deshacer."
    confirm-label="Vaciar todo"
    confirm-color="error"
    @confirm="confirmarVaciarTodo"
  />
  ```
- Nueva función `confirmarVaciarTodo()`:
  ```ts
  function confirmarVaciarTodo() {
    customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
    customerExpandido.value = false
    clienteDrawerOpen.value = false
    tipoDocumentoId.value = props.tiposDocumento[0]?.id
    vaciarModalOpen.value = false
    emit('limpiar-todo')
  }
  ```
- Nuevo emit `'limpiar-todo': []` agregado a `defineEmits`.

### `pos.vue`

- `<VentasCarritoPanel ... @limpiar-todo="limpiar" ... />` — reusa la
  función `limpiar()` ya expuesta por `useVenta()` (`useVenta.ts:231-234`),
  sin necesidad de una función nueva en `pos.vue`.

## Casos borde

- Botón deshabilitado si el carrito ya está vacío, sin datos de cliente y
  con el tipo de documento por defecto ya seleccionado — evita abrir el
  modal de confirmación para un no-op.
- Si el `ClienteDrawer` está abierto al momento de confirmar, se cierra
  como parte del reset (`clienteDrawerOpen.value = false`).
- No afecta el estado de caja (`cajaStore`) ni cierra `cobroOpen` — esos
  flujos no se solapan con este botón (el modal de cobro bloquea la
  interacción con el carrito mientras está abierto).

## Fuera de alcance

- No se agrega confirmación adicional para el caso trivial (carrito vacío
  sin cliente) — el botón simplemente queda deshabilitado en ese caso.
- No se modifica el reset post-venta existente (`pos.vue:152-157`), que
  sigue sin tocar `tipoDocumentoId` — son dos flujos distintos e
  intencionalmente inconsistentes entre sí, según lo decidido con el
  usuario.
