# Spec — `/mi-caja`: grid de cajones disponibles + drawer de apertura

**Fecha:** 2026-07-24
**Estado:** aprobado, listo para plan
**Alcance:** solo frontend. No toca backend, store, cierre/cuadratura ni `/cajas`.

## Objetivo

Reemplazar el formulario único de apertura en `/mi-caja` por un **grid de cards**, una
por cada cajón **disponible** para el usuario. Al hacer click en una card se abre un
**drawer** que pide saldo inicial + comentario y abre la caja sobre ese cajón.

Visualmente alineado con el grid de `/cajas` (`CajaAbiertasGrid`).

## Contexto actual

- `pages/mi-caja/index.vue`: si el usuario ya tiene caja abierta redirige a
  `/mi-caja/[id]`; si no, renderiza `<CajaAperturaForm>` (un `UCard` con selector de
  cajón + saldo + comentario + botón Abrir).
- `GET /caja/cajones-disponibles` ya devuelve **solo los cajones libres** que el usuario
  puede abrir (activo + autorizado + sin sesión abierta). El store lo expone en
  `cajaStore.cajonesDisponibles` (`{ cajonId, nombre }[]`) vía `cargarCajonesDisponibles()`.
- `CajaAperturaForm.vue` se reutiliza en el modal de `/cajas` (`CajaAbiertasGrid`).

## Decisiones tomadas (brainstorm)

1. **Solo se muestran los cajones disponibles.** No se muestran los que están en uso.
   → No hace falta cambiar el backend: `cajones-disponibles` ya devuelve justo eso.
2. **Al tener caja propia abierta**, el comportamiento no cambia: redirige a
   `/mi-caja/[id]`. El grid solo se ve cuando NO hay caja abierta.
3. **Drawer mínimo:** Saldo inicial + Comentario + botón *Abrir caja*. El cajón queda
   implícito por la card clickeada; su nombre se muestra en el título del drawer.

## Comportamiento

1. `onMounted` (sin cambios en el gateo de permisos ni en la carga de `activa`):
   - Si `cajaStore.activa?.id` → `navigateTo('/mi-caja/[id]', { replace: true })`.
   - Si no → se renderiza el grid.
2. **Grid** (`CajaAperturaGrid`): una `UCard` clickeable por cada
   `cajaStore.cajonesDisponibles`. Al hacer click se guarda el cajón seleccionado
   (`cajonId` + `nombre`) y se abre el drawer.
3. **Drawer** (`AppDrawer`):
   - Título: `Abrir caja — {nombre del cajón}`.
   - Campos: `MoneyInput oficial` (saldo inicial, requerido) + `UInput` (comentario,
     opcional).
   - Acciones: Cancelar + Abrir caja (`:loading="saving"`).
   - Al enviar: valida saldo no vacío → `cajaStore.abrir({ saldoInicial, comentario:
     comentario || undefined, cajonId })` → toast de éxito → `emit('opened', caja.id)`.
   - Manejo de error igual al form actual: toast con `e.data.message` de fallback.
4. **Estado vacío:** si `cajonesDisponibles.length === 0` (y no está cargando), se muestra
   el mensaje actual: *"No hay cajas disponibles para abrir. Pedí al administrador que te
   habilite una."*
5. **Loading:** spinner mientras se cargan los cajones disponibles.

## Piezas

### 1. Nuevo componente `app/components/caja/CajaAperturaGrid.vue`
- `defineEmits<{ opened: [cajaId: string] }>()`.
- `onMounted`: `cajaStore.cargarCajonesDisponibles()` (con `loadingCajones` y toast de
  error, como el form actual).
- Estado local: `drawerOpen`, `saving`, `seleccionado: { cajonId, nombre } | null`,
  `form: { saldoInicial, comentario }`.
- `abrirDrawer(cajon)`: setea `seleccionado`, resetea `form`, abre el drawer.
- `abrir()`: validación + `cajaStore.abrir(...)` + emit, como el `abrir()` del form actual.
- Reset del form al cerrar el drawer (watch sobre `drawerOpen`).
- Grid con las mismas clases que `CajaAbiertasGrid`:
  `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`; cards con
  `cursor-pointer transition hover:ring-2 hover:ring-primary-500`.
- `AppDrawer` con `width="40%"`, siguiendo el patrón de `configuracion/cajas.vue`
  (header + body con `UForm id=... @submit` + actions con botón `type="submit"
  form=...`).

### 2. `app/pages/mi-caja/index.vue`
- Cambiar `<CajaAperturaForm @opened="onOpened" />` por
  `<CajaAperturaGrid @opened="onOpened" />`. El resto (permisos, redirección, watch de
  seguridad, link "Ver historial", loading, bloque "Redirigiendo…") queda igual.

### 3. `CajaAperturaForm.vue`
- **Sin cambios.** Sigue sirviendo al modal de `/cajas`.

### 4. Docs
- `docs/features/gestion-cajas.md`: nota breve de UX — `/mi-caja` ahora presenta un grid
  de cajones disponibles y la apertura ocurre en un drawer por cajón.

## Fuera de alcance

- Backend (`caja.controller.ts`, `caja.service.ts`), store (`caja.ts`).
- Mostrar cajones en uso / ocupados.
- `/cajas`, cierre, cuadratura, movimientos.

## Verificación / cierre

- Gate completo (`verify-feature`):
  `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`.
  (Backend sin cambios; igual el gate corre en CI.)
- **Smoke test en navegador** del drawer (memoria: los bugs de runtime del drawer —
  auto-import, estado — no los ve build/typecheck):
  1. Con cajones disponibles: se ve el grid, click abre el drawer con el nombre correcto.
  2. Abrir caja con saldo → redirige a `/mi-caja/[id]`.
  3. Sin cajones disponibles: se ve el mensaje de estado vacío.

## Invariantes

Ninguna en riesgo: cambio de presentación, sin dinero calculado en number (usa
`MoneyInput` + el `abrir` del store), sin queries, sin tocar tenant_id ni soft-delete.
