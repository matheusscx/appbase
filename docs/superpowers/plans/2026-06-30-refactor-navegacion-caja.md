# Plan: Refactorización de navegación del módulo Caja

Status: Done
Date: 2026-06-30
Owner: Cesar Matheus

## Context

Hoy el acceso a una caja es inconsistente: la caja del usuario se ve directamente
en `/caja` (dentro de la pestaña "Mi caja"), mientras que las demás se ven en
`/caja/:id`. Además hay dos pestañas (`Mi caja` / `Todas las cajas`) que sólo
aparecen si el usuario tiene el permiso `Caja:Ver todas`.

Objetivo: unificar **todo** el acceso a cualquier caja en una única ruta
`/caja/:id`. `/caja` pasa a ser sólo un punto de entrada (dispatcher) y se eliminan
las pestañas.

### Estado actual del código (relevante)

- `pages/caja/index.vue`: gate `Caja:Leer`; `UTabs` (Mi caja / Todas) si
  `puedeVerTodas`. "Mi caja" = `CajaAperturaForm` (si no hay activa) ó
  `CajaActivaDashboard` + `CajaHistorial`. "Todas" = `CajaAbiertasGrid`.
- `pages/caja/[id].vue`: read-only. Carga `cargarDetalle(id)` y muestra
  `CajaActivaDashboard :readonly="true"` + `CajaHistorial`.
- `CajaAbiertasGrid.vue`: carga `cargarAbiertas()`; al click, si `esPropia` emite
  `operar-propia` (vuelve al tab), si no `navigateTo('/caja/:id')`.
- `CajaAperturaForm.vue`: `cajaStore.abrir()` (setea `activa`); no navega ni emite.
- Store `caja.ts`: ya tiene `cargarActiva`, `cargarAbiertas` (con `esPropia`),
  `cargarDetalle`, `abrir`, `cerrar`. **No requiere cambios.**
- Backend (`caja.controller.ts` / `caja.service.ts`): ya soporta todo
  (`/caja/activa`, `/caja/abiertas` con `esPropia`, `/caja/:id` con ownership +
  `Ver todas`, `abrir`, `movimientos`, `cerrar` con enforcement de propiedad).
  **Sin cambios de backend.**

## Scope / Out of scope

**In scope (sólo frontend):**
- `/caja` como dispatcher: redirección (sin permiso) ó listado (con permiso).
- Listado siempre con la caja propia **de primera**.
- Card "Abrir mi caja" en el listado cuando el usuario no tiene caja abierta.
- Apertura desde el listado (card → form → navegar a `/caja/:nuevaId`).
- `/caja/:id` como vista unificada operable/read-only según propiedad.
- Eliminar las pestañas `Mi caja` / `Todas las cajas`.

**Out of scope:**
- Cambios de backend / endpoints.
- Mostrar el nombre del dueño de la caja en el header del dashboard (la entidad
  `Caja` no trae `usuarioNombre`; queda como mejora futura).
- Cambiar `CajaHistorial`, `CajaMovimientoModal`, `CajaCierreModal` (se reutilizan
  tal cual).

## Decisiones tomadas

1. **Vista unificada `/caja/:id`** para cualquier caja (propia u otra). La
   diferencia operable vs read-only se deriva, no se duplica la página.
2. **Determinar operabilidad sin pedir el `usuarioId`:** `readonly` =
   `detalle.id !== activa.id`. `activa` es, por definición, la caja física
   **abierta del usuario actual**. Así:
   - caja propia abierta → `detalle.id === activa.id` → **operable**.
   - caja propia cerrada (desde historial) → `activa` null/distinto → read-only
     (correcto: una caja cerrada no se opera).
   - caja de otro → read-only.
3. **Apertura (sin caja abierta) → card "Mi caja" en el listado** (decisión del
   usuario). El listado siempre muestra "Mi caja" de primero; si no está abierta,
   esa card dice "Abrir mi caja" y abre el formulario; al abrir, navega a
   `/caja/:nuevaId`.
4. **Sin permiso `Ver todas` y sin caja abierta:** no hay listado ni `:id` al cual
   redirigir, así que `/caja` muestra el `CajaAperturaForm` + `CajaHistorial`
   directamente (preserva la paridad con el comportamiento actual). Al abrir,
   navega a `/caja/:nuevaId`.
5. **Tras cerrar la caja en `/caja/:id`:** `activa` pasa a null → redirigir a
   `/caja` (que re-despacha: listado ó apertura). Espeja el comportamiento viejo
   (cerrar volvía al form de apertura).
6. **Ordenamiento propia-primero:** en el frontend (computed), sin tocar el
   backend (que ordena por `fecha_apertura DESC`).

## Frontend

### 1. `components/caja/CajaAperturaForm.vue`
- [x] Agregar `const emit = defineEmits<{ opened: [] }>()` y emitir `emit('opened')`
      tras `abrir()` exitoso (después del toast de éxito). El padre decide la
      navegación. No cambiar el resto del form.

### 2. `components/caja/CajaAbiertasGrid.vue`
- [x] En `onMounted`, además de `cargarAbiertas()`, asegurar `cargarActiva()`
      (para saber si el usuario ya tiene caja propia abierta).
- [x] Computed `cajasOrdenadas`: copia de `cajaStore.abiertas` con las `esPropia`
      primero (`[...abiertas].sort((a, b) => Number(b.esPropia) - Number(a.esPropia))`).
- [x] Computed `tieneCajaPropia` = existe alguna `esPropia` en `abiertas`
      (equivalente a `!!cajaStore.activa`).
- [x] Quitar el emit `operar-propia`. `abrir(caja)` ahora **siempre**
      `navigateTo('/caja/' + caja.id)` (también para la propia).
- [x] Cuando `!tieneCajaPropia`: renderizar como **primera** card una tarjeta
      sintética "Abrir mi caja" (icono `i-heroicons-plus-circle`) que abre un
      `UModal` con `CajaAperturaForm`.
- [x] `UModal` de apertura: al recibir `@opened` del form, cerrar el modal y
      `navigateTo('/caja/' + cajaStore.activa.id)`.
- [x] Mantener estados loading / vacío. (El estado "no hay cajas abiertas" sólo
      aplica cuando además el usuario ya tiene la suya; con la card de apertura el
      grid nunca queda totalmente vacío para quien no tiene caja.)

### 3. `pages/caja/index.vue` (dispatcher — reescritura)
- [x] Mantener el gate: cargar permisos si hace falta; si no
      `esAdmin && !can('Caja','Leer')` → toast + `navigateTo('/ventas')`.
- [x] `await cargarActiva()`.
- [x] `puedeVerTodas = esAdmin || can('Caja','Ver todas')`.
- [x] **Sin `Ver todas`:**
      - con `activa` → `navigateTo('/caja/' + activa.id, { replace: true })`.
      - sin `activa` → render `CajaAperturaForm` (con `@opened` →
        `navigateTo('/caja/' + activa.id)`) + `CajaHistorial`.
- [x] **Con `Ver todas`:** render `CajaAbiertasGrid` (sin props de tab).
- [x] Eliminar `UTabs`, `tab`, `tabItems` y los slots `#mi-caja` / `#todas`.

### 4. `pages/caja/[id].vue` (vista unificada)
- [x] (Opcional, UX) gate `Caja:Leer` análogo al de index para evitar el toast
      genérico "no existe" cuando el problema es permiso.
- [x] En `onMounted`: `await cargarActiva()` **y** `await cargarDetalle(id)`
      (si `!detalle` → toast + `navigateTo('/caja')`, como hoy).
- [x] `readonly = computed(() => cajaStore.detalle?.id !== cajaStore.activa?.id)`
      y pasarlo a `<CajaActivaDashboard :readonly="readonly">`.
- [x] `watch(() => cajaStore.activa, ...)`: si estábamos operando la propia
      (`!readonly`) y `activa` pasa a null (cierre) → `navigateTo('/caja')`.
- [x] Link "Volver al listado" → mostrar sólo si `puedeVerTodas` (para usuarios sin
      permiso, `/caja` sólo redirige de vuelta).
- [x] Mantener `CajaHistorial :usuario-id="detalle.usuarioId"`.

## Verification

Probar con dos usuarios del mismo tenant: uno **con** `Caja:Ver todas` (o admin) y
uno **sin** el permiso.

**Sin `Ver todas`:**
- [x] Con caja abierta: entrar a `/caja` → redirige a `/caja/:miId`; dashboard
      **operable** (botones + Movimiento / Cerrar caja visibles); historial visible.
- [x] Sin caja abierta: `/caja` muestra el form de apertura; al abrir → navega a
      `/caja/:nuevaId` operable.
- [x] No aparece link "Volver al listado".
- [x] Cerrar la caja en `/caja/:id` → vuelve a `/caja` (form de apertura).

**Con `Ver todas`:**
- [x] `/caja` muestra el **listado** (no redirige). La caja propia aparece
      **primera** y marcada "Mía".
- [x] Click en la caja propia → `/caja/:id` operable.
- [x] Click en la caja de otro usuario → `/caja/:id` **read-only** (sin botones de
      Movimiento / Cerrar). Intentar operar no es posible (botones ocultos; el
      backend igual rechaza).
- [x] Sin caja propia abierta: la primera card del listado es "Abrir mi caja" →
      abre el form → al abrir navega a `/caja/:nuevaId` operable, y al volver al
      listado la card propia ya aparece primera.

**General:**
- [x] No quedan pestañas `Mi caja` / `Todas las cajas` en ningún caso.
- [x] El item del menú lateral `/caja` (`layouts/dashboard.vue`) sigue funcionando
      como entrada.
- [x] `cd frontend && npm run build` y los tests de store (`caja.spec.ts`) pasan.

## Decisions / Open questions

- **(Resuelto)** Apertura sin caja → card "Mi caja" en el listado / form en `/caja`
  cuando no hay permiso (decisión del usuario, ver Decisiones #3 y #4).
- **(Resuelto)** Operabilidad vía `detalle.id === activa.id` (Decisión #2).
- **Gap menor aceptado:** un usuario **con** `Ver todas` pero **sin** caja abierta
  no puede ver el historial de sus cajas cerradas desde `/caja` (el listado se
  mantiene como punto de entrada limpio). Lo recupera al tener/abrir una caja
  (`/caja/:id` muestra `CajaHistorial`). Si se quiere cerrar el gap, agregar
  `CajaHistorial` bajo el listado — **pendiente de confirmar** si vale la pena.
