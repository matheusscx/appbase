# Diseño: refactor módulo Caja por permiso

Status: Approved
Date: 2026-06-29
Owner: Cesar Matheus

## Context

Hoy el módulo Caja (`/caja`) solo es accesible para `esAdmin` o quien tenga el
permiso `Caja:Ver todas`. Un usuario con solo `Caja:Leer` (ej. un vendedor) queda
fuera, aunque debería poder operar su propia caja.

Además existe un **bug de permiso**: el sidebar (`dashboard.vue:21`) y la página
(`pages/caja/index.vue:13`) chequean `can('Caja', 'VerTodas')` (sin espacio), pero
el permiso real sembrado es `'Ver todas'` (con espacio, ver
`seeder.service.ts:333`). El componente `CajaHistorial.vue` sí usa el string
correcto. Resultado: hoy el check de "Ver todas" en sidebar/página nunca matchea y
solo entran los admin.

Objetivo del refactor:
- Quien tenga `Caja:Leer` (ej. vendedor) entra a `/caja` y opera **su propia**
  caja (abrir, registrar movimientos, cerrar).
- Quien tenga `Caja:Ver todas` además ve una pestaña con un grid de cards de
  **todas las cajas abiertas** del tenant; al hacer click en una card ajena entra
  a un detalle **read-only** en `/caja/[id]`.

## Scope / Out of scope

**In scope**
- Relajar el gate de acceso a `Caja:Leer`.
- Fix del string de permiso `'VerTodas'` → `'Ver todas'` en front.
- Endpoint nuevo `GET /caja/abiertas` con cajas abiertas + dueño + saldo esperado.
- Vista read-only de caja ajena para usuarios con `Ver todas`.
- Pestañas "Mi caja" / "Todas las cajas" en `/caja`.

**Out of scope**
- Operar (registrar movimientos / cerrar) cajas ajenas. Sigue siendo **owner-only**.
- Cambios en la lógica transaccional de cierre o cálculo de saldo.
- Cajas de tipo `virtual` (el grid es solo de `fisica`).
- Historial de cajas cerradas en la vista "Todas las cajas" (el grid es solo de
  cajas **abiertas**).

## Decisiones tomadas (brainstorming)

1. **Capacidad sobre caja ajena:** solo **read-only**. El usuario con `Ver todas`
   ve saldos y movimientos de la caja ajena, pero no registra movimientos ni la
   cierra. Solo el dueño opera su caja.
2. **Layout de `/caja` para `Ver todas`:** **pestañas** — "Mi caja" (operar) y
   "Todas las cajas" (grid de cards). Para quien no tiene `Ver todas`, no se
   muestran pestañas: se renderiza "Mi caja" directo.
3. **Detalle de caja ajena:** **ruta dedicada** `/caja/[id]` (URL propia,
   navegable), no modal.

## Backend

### 1. Nuevo endpoint `GET /caja/abiertas`

- `@RequiresPermiso('Caja', 'Leer')`.
- El controller resuelve `tieneVerTodas` vía `rbacService.userHasPermiso(... 'Ver
  todas')` (mismo patrón que `detalle`).
- Service `abiertas(tenantId, usuarioId, tieneVerTodas)`:
  - Si `tieneVerTodas` → todas las cajas `fisica` + `estado='abierta'` del tenant.
  - Si no → solo la del propio usuario (defensa en profundidad; el front igual
    solo muestra la grid a usuarios con `Ver todas`).
  - Query raw con join `cajas` → `usuarios` y agregación de movimientos para el
    saldo esperado (misma fórmula que `calcularSaldoEsperado`:
    `saldo_inicial + Σentradas - Σsalidas`, filtrando `eliminado_el IS NULL`).
  - Orden: `fecha_apertura DESC`.
- Forma de cada item (DTO de respuesta):
  ```ts
  {
    id: string
    usuarioId: string | null
    usuarioNombre: string        // nombre + apellido (apellido puede ser null)
    saldoInicial: string
    saldoEsperado: string        // toFixed(4)
    fechaApertura: string
    esPropia: boolean            // usuarioId === usuario autenticado
  }
  ```

### 2. Relajar `listarMovimientos` para lectura con `Ver todas`

- Firma nueva: `listarMovimientos(tenantId, usuarioId, cajaId, tieneVerTodas)`.
- Buscar la caja por `id + tenantId + eliminado_el IS NULL` (quitar el filtro
  rígido `usuarioId` + `estado='abierta'` del `where`).
- Reglas de acceso:
  - Si la caja no existe → `NotFoundException`.
  - Si `caja.usuarioId !== usuarioId && !tieneVerTodas` → `ForbiddenException`.
- `registrarMovimiento` y `cerrar` **no cambian**: siguen exigiendo
  `caja.usuarioId === usuarioId` (owner-only).
- Controller `GET /caja/:id/movimientos` resuelve `tieneVerTodas` vía `rbacService`.

### 3. `findOne` / `GET /caja/:id`

- Sin cambios: ya permite leer caja ajena cuando `tieneVerTodas`. Se reutiliza tal
  cual para el header de `/caja/[id]`.
- Los saldos del detalle se calculan en el **frontend** a partir de los movimientos
  (no se agrega superficie de backend).

## Frontend

### 1. Fix del bug de permiso
- `layouts/dashboard.vue:21`: `can('Caja','VerTodas')` → `can('Caja','Ver todas')`.
- `pages/caja/index.vue`: ídem en el gate.

### 2. Gate de acceso relajado
- **Sidebar** (`dashboard.vue`): mostrar link Caja si `esAdmin || can('Caja','Leer')`.
- **Página** (`pages/caja/index.vue`): permitir acceso si
  `esAdmin || can('Caja','Leer')`; si no, redirigir a `/ventas` (como hoy).

### 3. `pages/caja/index.vue` con pestañas
- Computed `puedeVerTodas = esAdmin || can('Caja','Ver todas')`.
- Si `puedeVerTodas` → `UTabs` con:
  - **"Mi caja"**: contenido actual (`CajaAperturaForm` / `CajaActivaDashboard` +
    `CajaHistorial`).
  - **"Todas las cajas"**: `<CajasAbiertasGrid>`.
- Si no `puedeVerTodas` → render directo de "Mi caja" sin pestañas.

### 4. Nuevo `components/caja/CajasAbiertasGrid.vue`
- En mount: `cajaStore.cargarAbiertas()`.
- Grid responsivo de cards (`UCard` / `UPageCard`). Cada card muestra: dueño
  (`usuarioNombre`), saldo inicial, saldo esperado, hora de apertura, badge
  **"Mía"** si `esPropia`.
- Click:
  - Card ajena → `navigateTo('/caja/<id>')`.
  - Card propia → emite evento para cambiar a la pestaña "Mi caja" (no navega al
    detalle read-only; ahí se opera).
- Estados: loading, vacío ("No hay cajas abiertas").

### 5. Nueva `pages/caja/[id].vue` (read-only)
- `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`.
- En mount: `cargarDetalle(id)` + `cargarMovimientos(id)`.
- Header: dueño, estado, fecha de apertura, saldo inicial, saldo esperado
  (calculado desde movimientos: `saldoInicial + Σentradas - Σsalidas` con
  Decimal.js en el front si ya se usa, o suma simple sobre strings formateados).
- Tabla de movimientos en modo lectura (reusar/compartir markup con
  `CajaActivaDashboard` si conviene, pero sin acciones).
- Link "← Volver a Caja" hacia `/caja`. Sin botones de operar.
- Errores 403/404 del backend → toast + redirect a `/caja`.

### 6. Store `stores/caja.ts`
- Estado nuevo: `abiertas` (lista), `detalle` (Caja | null).
- `cargarAbiertas()` → `GET /caja/abiertas`.
- `cargarDetalle(id)` → `GET /caja/:id`.
- Reusar `cargarMovimientos(id)` (su endpoint ahora permite `Ver todas` en lectura).
- Tipo nuevo `CajaAbierta` (forma del item del endpoint `abiertas`).

## Verification

**Backend (`caja.service.spec.ts`)**
- `abiertas`: con `tieneVerTodas=true` devuelve todas las abiertas con nombre y
  saldo esperado; con `false` devuelve solo la propia.
- `listarMovimientos`: con `tieneVerTodas=true` permite leer movimientos de caja
  ajena; con `false` sobre caja ajena lanza `ForbiddenException`; dueño siempre
  puede.
- `registrarMovimiento` / `cerrar`: siguen lanzando `ForbiddenException` sobre caja
  ajena aunque haya `Ver todas` (owner-only) — verificar que la firma no cambió.

**Frontend (`caja.spec.ts`)**
- `cargarAbiertas` puebla `abiertas` desde el endpoint.
- `cargarDetalle` puebla `detalle`.

**Manual / E2E (smoke)**
- Vendedor (`Caja:Leer`): ve link Caja, entra, abre/opera su caja, no ve pestaña
  "Todas las cajas".
- Supervisor (`Caja:Ver todas`): ve ambas pestañas, grid de cards, entra a caja
  ajena read-only sin botones de operar.

## Decisions / Open questions

- **Cálculo de saldo en el front:** el proyecto usa Decimal.js en backend; en el
  front se decide en implementación si se suma con Decimal.js o se confía en el
  `saldoEsperado` ya calculado por el backend para el header del detalle. Preferir
  reusar el `saldoEsperado` del endpoint `abiertas` no aplica al detalle (otra
  ruta); para el detalle, calcular desde movimientos. **Resuelto:** calcular en el
  front desde movimientos; si hace falta exactitud, exponer también `saldoEsperado`
  en `findOne` en una iteración futura.
- **Nombre del dueño:** `nombre + ' ' + apellido` con `apellido` nullable →
  trim. Sin apellido, solo `nombre`.
