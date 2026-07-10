# Plan: Mover Pasarelas a Configuración y promover Órdenes a módulo del nav

> Al ejecutar, guardar copia en `docs/superpowers/plans/2026-07-10-pasarelas-a-config-ordenes-modulo.md` (convención del repo) y actualizar la tabla "Estado actual" de `CLAUDE.md`.

## Context

Hoy `/pasarelas` es una única página con 3 tabs mezclando dos responsabilidades:
**configuración** (Mis pasarelas + API Keys) y **operación** (Órdenes de cobro, lista
read-only). Queremos separarlas: la configuración pertenece al área de Configuración
del tenant, mientras que las Órdenes son gestión operativa y deben tener su propio
módulo en el nav principal. Resultado esperado:

- **Configuración → Pasarelas**: `/configuracion/pasarelas` con las 2 tabs de config
  (Mis pasarelas | API Keys).
- **Órdenes** (nuevo módulo en el nav principal): `/ordenes`, la lista de órdenes de cobro.
- Desaparece el item "Pasarelas" del nav principal y la ruta top-level `/pasarelas`.

## Decisiones tomadas (con el usuario)

- **Permiso del módulo Órdenes**: reusar `Pasarelas:Leer` — sin cambios de backend/RBAC.
  El nav item se gatea con `permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Leer')`.
- **Pasarelas en Configuración**: una sola sub-sección con `UTabs` internos
  (Mis pasarelas | API Keys). Se mantiene el patrón de tabs local actual.

## Scope / Out of scope

**In scope (solo frontend):**
- Crear `pages/configuracion/pasarelas.vue` (config: tabs Mis pasarelas + API Keys).
- Crear `pages/ordenes.vue` (Órdenes extraídas).
- Borrar `pages/pasarelas.vue`.
- Editar `pages/configuracion.vue` (agregar item al menú de config).
- Editar `layouts/dashboard.vue` (quitar item Pasarelas, agregar item Órdenes).

**Out of scope:** cambios de backend, nuevo módulo RBAC, cambios en endpoints
(`/pasarela/admin/*` se mantienen igual), y `pages/tienda/pasarela.vue` (checkout de
tienda, no relacionado).

## Frontend

Todos los archivos bajo `/Users/m2pro/cmatheus/startup-app/frontend/`.

### 1. `app/pages/configuracion/pasarelas.vue` (nuevo)

Sub-página de Configuración. **No** usa `UDashboardPanel`/`AppNavbar` (el parent
`configuracion.vue` ya los provee via `<NuxtPage />`) — renderiza contenido "pelado",
igual que `configuracion/metodos-pago.vue`.

- `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`.
- Migrar de `pasarelas.vue` **solo** lo de las tabs `config` y `keys`:
  - Interfaces `PasarelaGlobal`, `TenantPasarelaRow`, `ApiKeyRow`.
  - Estado y funciones tab 1: `cargarConfig`, `abrirCrear`, `abrirEditar`,
    `guardarConfig`, `confirmarEliminarConfig`, `emptyForm`, `tocoCredenciales`, etc.
  - Estado y funciones tab 2: `cargarKeys`, `crearKey`, `copiarKey`, `confirmarRevocar`.
  - `onMounted` → `cargarConfig()` + `cargarKeys()`.
  - `tabs` reducido a `[{ Mis pasarelas, config }, { API Keys, keys }]`, `tab = ref('config')`.
- Template: reutilizar `CrudPageHeader`, `UTabs`, el `AppDrawer` de alta/edición
  (líneas 431-510 del original), `CrudModal` (eliminar/revocar) y los 2 `UModal`
  (crear key / key creada). Envolver en un contenedor simple (p.ej. `space-y-6`);
  quitar el wrapper `max-w-5xl mx-auto py-6` porque el parent ya da padding (`p-6`).
- Composables/utilidades ya existentes a reutilizar: `useApiFetch`, `useFormatters`
  (`formatFecha`), `usePermissionsStore`, `apiErrorMsg`.

### 2. `app/pages/ordenes.vue` (nuevo)

Página top-level, módulo propio. **Sí** usa `UDashboardPanel` + `AppNavbar` (patrón de
página raíz, igual que hacía `pasarelas.vue`).

- `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`.
- Migrar de `pasarelas.vue`: interface `OrdenRow`, el `usePaginatedList<OrdenRow>({ path: '/pasarela/admin/ordenes' })`
  (líneas 259-264) y el mapa `estadoColor` (líneas 266-273). `usePaginatedList` se auto-fetchea en su `onMounted`.
- Template: copiar el bloque de la tab Órdenes (líneas 390-427: lista + `UPagination`)
  dentro de `UDashboardPanel`/`#body`. Header `AppNavbar title="Órdenes de cobro"`.
  Reutilizar `useFormatters` (`formatMonto`, `formatFecha`).

### 3. `app/pages/pasarelas.vue`

Borrar el archivo (su contenido queda repartido entre 1 y 2).

### 4. `app/pages/configuracion.vue`

Agregar un item al computed `navItems` (después de "Métodos de pago", dentro del bloque
`esAdmin` o con su propio gate). Como Pasarelas usa el permiso `Pasarelas:Leer`:

```ts
if (permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Leer')) {
  items.push({
    label: 'Pasarelas',
    icon: 'i-lucide-plug-zap',
    to: '/configuracion/pasarelas',
  })
}
```
(colocar el bloque fuera del `if (esAdmin)` grande, siguiendo el estilo de Items/Inventario).

### 5. `app/layouts/dashboard.vue`

- **Quitar** el bloque Pasarelas (líneas 90-96) del computed `items`.
- **Agregar** el nuevo módulo Órdenes en su lugar (mismo gate, reusando `Pasarelas:Leer`):

```ts
if (permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Leer')) {
  base.push({
    label: 'Órdenes',
    icon: 'i-lucide-receipt',
    to: '/ordenes',
  })
}
```

## Verification

1. `docker-compose up` (o `cd frontend && npm run dev`).
2. Login como admin. En el nav principal: **no** aparece "Pasarelas"; **sí** aparece
   "Órdenes" → `/ordenes` muestra la lista de órdenes de cobro con paginación.
3. Configuración → menú lateral muestra "Pasarelas" → `/configuracion/pasarelas`:
   - Tab "Mis pasarelas": listar, agregar (drawer), editar, eliminar funcionan.
   - Tab "API Keys": crear (muestra key one-time + copiar), revocar funcionan.
4. Navegar directo a `/pasarelas` → 404 (ruta eliminada, esperado).
5. `cd frontend && npm run build` sin errores de tipos.
6. Verificar en red que los endpoints `/pasarela/admin/config|api-keys|ordenes`
   siguen respondiendo igual desde las nuevas ubicaciones.

## Decisions / Open questions

- Ninguna pendiente. Si más adelante se quiere un permiso RBAC propio para Órdenes,
  sembrar módulo `Ordenes` en `backend/src/modules/seeder/seeder.service.ts` y cambiar
  el gate — fuera de alcance de este plan.
