# Diseño: Migrar datos del cliente en el POS a un drawer

- **Status:** Approved
- **Date:** 2026-07-06
- **Owner:** Cesar Matheus

## Contexto

Hoy, en `frontend/app/pages/ventas/pos.vue`, los datos del cliente
("datos del cliente" — `CustomerForm`: nombre, rut, dirección, teléfono,
email, terceroId) se capturan en un bloque **inline** dentro de
`CarritoPanel.vue` (líneas 94-122): un botón "Agregar datos del cliente"
expande el formulario `ClienteForm.vue` directamente sobre la misma
`UCard` del carrito, empujando el listado de líneas hacia abajo.

El proyecto ya tiene un patrón establecido de drawer (`AppDrawer.vue`,
envoltorio de `UDrawer` de Nuxt UI) usado en `CajaMovimientoDrawer.vue`,
`CajaCierreDrawer.vue` y `VentaDetalleDrawer.vue`. Esta migración mueve el
formulario de cliente a ese mismo patrón, liberando espacio vertical en el
carrito y dejando solo un resumen compacto cuando ya hay datos cargados.

## Estado actual (referencia)

- `pos.vue:31-32` — refs locales `customer: CustomerForm` y
  `customerExpandido: boolean`.
- `pos.vue:84-87` — reset de `customer`/`customerExpandido` al cambiar el
  tipo de documento.
- `pos.vue:121-147` — `incluirCustomer = docSel?.customerRequerido ||
  customerExpandido.value` decide si el customer va en el POST de la venta.
- `pos.vue:156-157` — reset tras venta exitosa.
- `pos.vue:198-211` — `<VentasCarritoPanel v-model:customer="customer"
  v-model:customer-expandido="customerExpandido" ... />`.
- `CarritoPanel.vue:94-122` — bloque inline: si
  `customerRequerido || customerExpandido`, muestra `<VentasClienteForm
  v-model="customer" />` + botón "Quitar datos del cliente"; si no, muestra
  el botón "Agregar datos del cliente".
- `ClienteForm.vue` — formulario con autocompletar de `terceros`
  (`GET /terceros`), `v-model` directo sobre `CustomerForm` (sin submit
  propio).
- `useVenta.ts` — no maneja estado de cliente; `puedeCobrar()` recibe
  `customerRequerido`, `customerExpandido`, `customerNombre` como
  argumentos para bloquear el cobro si faltan datos requeridos.

## Decisiones validadas con el usuario

1. **Drawer + resumen en el carrito.** Se reemplaza el bloque inline por
   un `AppDrawer` (mismo patrón que `CajaMovimientoDrawer.vue`). Cuando ya
   hay datos cargados, el carrito muestra un resumen compacto en vez del
   formulario completo.
2. **Auto-abrir el drawer cuando el cliente es requerido.** Si el tipo de
   documento seleccionado exige datos de cliente (`customerRequerido`) y
   todavía no hay datos, el drawer se abre solo. El usuario puede cerrarlo
   sin completar; el cobro sigue bloqueado por la validación existente de
   `puedeCobrar()` hasta que los datos estén.
3. **Footer del drawer: solo botón "Listo".** No hay guardar/cancelar
   separado — `ClienteForm` sigue con `v-model` directo sobre el mismo
   `customer` real, así que escribir en el form ya persiste el dato. El
   botón "Listo" solo cierra el drawer.
4. **Resumen: nombre + RUT en una línea.** Ej. `Juan Pérez · 12345678-9`,
   con ícono de editar (reabre el drawer) y de quitar (limpia `customer` a
   un `CustomerForm` vacío, pone `customerExpandido = false` y cierra el
   drawer si estaba abierto).

## Componentes

### Nuevo: `app/components/ventas/ClienteDrawer.vue`

Envuelve `AppDrawer` + `ClienteForm`, siguiendo la receta de
`CajaMovimientoDrawer.vue`:

- Prop/model: `open: boolean` (v-model), `customer: CustomerForm`
  (v-model, delega directo a `ClienteForm`).
- `<AppDrawer v-model:open="open" width="md">` con:
  - `#header`: título "Datos del cliente".
  - `#body`: `<VentasClienteForm v-model="customer" />`.
  - `#actions`: un solo `<UButton>Listo</UButton>` que pone `open = false`.

### `CarritoPanel.vue`

- Se elimina el bloque inline (líneas 94-122).
- Nuevo ref local `clienteDrawerOpen = ref(false)`.
- Render condicional según si `customer` tiene datos
  (`customer.nombre` o `customer.terceroId` no vacíos):
  - **Sin datos:** botón "Agregar datos del cliente" (mismo ícono
    `i-lucide-user-plus` que hoy) → `customerExpandido = true;
    clienteDrawerOpen = true`.
  - **Con datos:** línea de resumen `{{ customer.nombre }} ·
    {{ customer.rut }}` con:
    - ícono editar (`i-lucide-pencil`) → `clienteDrawerOpen = true`.
    - ícono quitar (`i-lucide-x`) → resetea `customer` a `CustomerForm`
      vacío, `customerExpandido = false`, `clienteDrawerOpen = false`.
- Nuevo `<VentasClienteDrawer v-model:open="clienteDrawerOpen"
  v-model:customer="customer" />` (siempre montado, controlado por
  `open`).
- `watch(() => props.customerRequerido)`: cuando pasa a `true` y no hay
  datos de cliente todavía, setea `customerExpandido = true` y
  `clienteDrawerOpen = true` automáticamente.

### `pos.vue`

- Sin cambios: los refs `customer`/`customerExpandido`, el reset al
  cambiar tipo de documento (`pos.vue:84-87`), el reset post-venta
  (`pos.vue:156-157`) y el cálculo de `incluirCustomer`
  (`pos.vue:121-147`) siguen igual. `CarritoPanel.vue` sigue recibiendo
  ambos por `v-model` sin cambios en la interfaz externa.

## Casos borde

- Cambiar a un tipo de documento que ya no requiere cliente **no** cierra
  el drawer ni borra los datos automáticamente — solo el reset explícito
  al cambiar de tipo documento (comportamiento ya existente en
  `pos.vue:84-87`) sigue aplicando.
- El drawer usa `width="md"`, `direction="right"` (default de
  `AppDrawer`), consistente con el resto de drawers de ventas.
- `puedeCobrar()` no cambia de firma; sigue bloqueando el cobro si
  `customerRequerido` es true y falta `customerNombre`, sin importar si
  el drawer está abierto o cerrado en ese momento.

## Fuera de alcance

- No se cambia la lógica de negocio de cuándo un cliente es requerido
  (`customerRequerido` sigue viniendo del tipo de documento).
- No se toca `ClienteForm.vue` internamente (autocompletar de terceros,
  campos) — solo dónde se monta.
- No se persiste ningún estado nuevo en backend; es una migración
  puramente de UI/UX en el frontend.
