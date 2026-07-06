# Plan: Administración de suscripciones (admin del tenant)

- **Status:** Approved
- **Date:** 2026-07-06
- **Owner:** Cesar Matheus

## Context

Las suscripciones reales (feature 2026-07-05) solo tienen vista de cliente: cada
usuario ve y gestiona **sus propias** suscripciones en `/tienda/suscripciones`
(`GET/PATCH /suscripciones` filtran por `usuario_id` del token). No existe ninguna
superficie donde el admin del tenant vea el estado de las suscripciones de todos
los clientes ni pueda administrarlas.

Pedido del usuario (decisiones ya validadas):
1. **Nuevo módulo de gestión de suscripciones**: entrada propia en el sidebar
   llamada "Suscripciones". Lista todas las suscripciones del tenant con su
   estado y datos del cliente.
2. **Módulo RBAC nuevo con permisos propios** (decisión del usuario): `ModuloApp`
   "Suscripciones" con permisos Leer / Actualizar / Eliminar, enforcement real en
   backend vía `PermisosGuard` + `@RequiresPermiso` (patrón de Caja/Test). El rol
   admin fijo del tenant tiene acceso total por short-circuit (`es_fijo`).
3. **Renombrar** la entrada/página actual del cliente a **"Mis suscripciones"**.
4. **Acciones del admin**: Pausar / Reanudar / Cancelar cualquier suscripción
   **+ Eliminar** (soft delete) las canceladas para limpiarlas de la lista.
5. **Vigencia tras cancelar (`activa_hasta`)**: al cancelar, la suscripción ya
   pagada sigue vigente hasta el fin del período. Ej.: semanal de lunes, cobrada
   hoy lunes, se cancela → queda válida martes…domingo y "se cancela el lunes a
   primera hora". Esto debe informarse en la administración.
6. **Modal de confirmación al cancelar (cliente)**: informativo, indicando hasta
   cuándo sigue activa y cuándo se cancela efectivamente.

## Semántica de `activa_hasta` (decisión central)

- Nueva columna `suscripciones.activa_hasta DATE NULL`.
- Al ejecutar la transición `cancelar` (cliente o admin): `activa_hasta = proximo_cobro`
  vigente en ese momento. `proximo_cobro` ya representa el fin del período pagado,
  así que no hay cálculo nuevo.
- Interpretación (un solo dato, dos lecturas): la suscripción queda **usable hasta
  el día anterior** a `activa_hasta`; "se cancela el `<activa_hasta>` a primera hora".
- `estado` pasa a `'cancelada'` inmediatamente (no hay motor de cobro recurrente
  aún; la vigencia es informativa). Pausar no toca `activa_hasta`.

## Scope / Out of scope

**In scope:** columna `activa_hasta`, módulo RBAC "Suscripciones" (seed completo:
módulo, pares módulo×permiso, contratación para tenants de dev), endpoints admin
(listar todas / transicionar / eliminar) con `@RequiresPermiso`, página admin
`/suscripciones`, renombre a "Mis suscripciones", modales de confirmación de
cancelación (cliente y admin), docs vivas.

**Out of scope:** motor de cobro recurrente (cron que cobre y cancele
efectivamente en `activa_hasta`), notificaciones al cliente, reportería/MRR,
wiring de roles no-admin a los permisos nuevos (se hace desde la matriz RBAC
existente en runtime).

## Backend

### 1. Entity + regla de cancelación
- [ ] `suscripcion.entity.ts`: agregar
  `@Column({ name: 'activa_hasta', type: 'date', nullable: true }) activaHasta: string | null;`
  (dev usa `synchronize: true` — la columna se crea sola).
- [ ] `suscripciones.service.ts` `cambiarEstado()`: refactor de firma a
  `cambiarEstado(tenantId, usuarioId: string | null, suscripcionId, dto)` —
  `usuarioId = null` ⇒ scope admin (busca solo por `tenantId`). Al `cancelar`:
  `suscripcion.activaHasta = suscripcion.proximoCobro`. Devolver
  `{ id, estado, activaHasta }`.
- [ ] `findMias()`: agregar `s.activa_hasta` al SELECT y `activaHasta` al mapeo.

### 2. Endpoints admin
- [ ] `findTodas(tenantId)`: mismo estilo SQL raw que `findMias` pero sin filtro
  de usuario y con `JOIN usuarios u ON u.usuario_id = s.usuario_id AND u.eliminado_el IS NULL`
  → agrega `usuarioNombre` (`u.nombre`) y `usuarioEmail` (`u.correo`) a la respuesta.
- [ ] `eliminar(tenantId, suscripcionId)`: soft delete (`softRemove`), **solo si
  `estado === 'cancelada'`** (si no, `BadRequestException`).
- [ ] `suscripciones.controller.ts`: agregar `PermisosGuard` a los guards de clase
  (`@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` — no afecta las rutas
  cliente, que no llevan `@RequiresPermiso`); tres rutas nuevas:
  - `GET /suscripciones/admin` → `@RequiresPermiso('Suscripciones', 'Leer')` → `findTodas`
    (declararla ANTES de cualquier ruta `:id`)
  - `PATCH /suscripciones/admin/:id` → `@RequiresPermiso('Suscripciones', 'Actualizar')`
    → `cambiarEstado(tenantId, null, id, dto)` (mismo `UpdateSuscripcionDto`)
  - `DELETE /suscripciones/admin/:id` → `@RequiresPermiso('Suscripciones', 'Eliminar')` → `eliminar`
- [ ] Tests en `suscripciones.service.spec.ts`: cancelar setea `activa_hasta` =
  `proximo_cobro` previo (cliente y admin); scope admin transiciona suscripción de
  otro usuario / scope cliente NO puede (NotFound); `findTodas` mapea usuario;
  `eliminar` rechaza no-canceladas y soft-deletea canceladas.

### 3. Seed RBAC (seeder.service.ts)
UUIDs libres a partir de `...440172` (fijos ≤171 usados; el generador dinámico de
`seedItemsMonedaUnidadMatrix()` reserva itemIds ≤157 y movIds 120/159–169 —
verificado, NO alcanza 172+):
- [ ] `seedModulosApp()`: `ModuloApp` "Suscripciones"
  (`moduloAppId: ...440172`, `url: '/suscripciones'`, `icono: 'mdi-autorenew'`).
- [ ] `seedModuloAppPermisos()`: pares módulo×permiso con el catálogo existente —
  Leer (`...440173`), Actualizar (`...440174`), Eliminar (`...440175`).
- [ ] `seedTenantModulo()`: contratación activa para Paris (`...440176`) y
  Falabella (`...440177`).

## Frontend

### 4. Navegación (`layouts/dashboard.vue`)
- [ ] Renombrar la entrada `Suscripciones → /tienda/suscripciones` a
  **"Mis suscripciones"** (mantiene gating `Tienda Online:Leer` e icono `i-lucide-repeat`).
- [ ] Nueva entrada **"Suscripciones"** (`icon: 'i-lucide-repeat-2'`,
  `to: '/suscripciones'`) gated `esAdmin || can('Suscripciones', 'Leer')`.

### 5. Composable admin (`app/composables/useSuscripcionesAdmin.ts`, nuevo)
- [ ] Interface `SuscripcionAdmin` = `Suscripcion` (de `useSuscripciones`) +
  `usuarioNombre: string`, `usuarioEmail: string`.
- [ ] Mismo patrón optimista-con-revert de `useSuscripciones` pero contra
  `GET/PATCH/DELETE /suscripciones/admin[...]`; al cancelar, aplicar el
  `activaHasta` que devuelve el PATCH sobre la fila. `eliminar(id)` quita la fila
  (optimista, revert si falla). Guard `mutando` contra doble click.

### 6. Página admin (`app/pages/suscripciones.vue`, nueva)
- [ ] `definePageMeta({ middleware: 'auth', layout: 'dashboard' })`; si
  `!(esAdmin || can('Suscripciones', 'Leer'))` → redirect a `/`.
- [ ] `CrudPageHeader` + `CrudTable` (patrón de `tienda/suscripciones.vue`):
  columnas Suscripción (item + subtítulo precio/frecuencia/día — reusar los
  helpers `detalleDia`/`frecuenciaLabel`), **Cliente** (nombre + email),
  Estado (badge; si `cancelada` con `activaHasta`, texto secundario
  "activa hasta el `<activaHasta − 1 día>` — se cancela el `<activaHasta>` a
  primera hora"), Próximo cobro (solo activas/pausadas), Acciones.
- [ ] Filtro por estado (`USelectMenu`: Todas / Activas / Pausadas / Canceladas).
- [ ] Acciones por fila (Pausar/Reanudar gated `can('Suscripciones','Actualizar')`,
  Eliminar gated `can('Suscripciones','Eliminar')`, siempre con bypass `esAdmin`):
  Pausar / Reanudar / **Cancelar** (abre `UModal` de confirmación con la vigencia,
  en tercera persona) / **Eliminar** solo en canceladas (`UModal` de confirmación).
- [ ] `formatMonto`/`formatFecha` desde `useFormatters` (nunca locales).

### 7. Vista cliente (`app/pages/tienda/suscripciones.vue` + `useSuscripciones.ts`)
- [ ] Título del navbar y `CrudPageHeader` → **"Mis suscripciones"**.
- [ ] `useSuscripciones`: agregar `activaHasta: string | null` a la interface;
  en `accion()`, si la respuesta del PATCH trae `activaHasta`, aplicarla a la fila.
- [ ] Botón **Cancelar** ya no muta directo: abre `UModal` de confirmación
  informativo — "Tu suscripción seguirá activa hasta el `<proximoCobro − 1 día>`
  y se cancelará el `<proximoCobro>` a primera hora. ¿Confirmás la cancelación?"
  (fechas con `formatFecha`). Confirmar → `cancelar(id)`; cerrar → nada.
- [ ] Fila cancelada con `activaHasta`: subtítulo muestra "activa hasta el X"
  en lugar de "próximo cobro X".

## Docs vivas (mismo cambio final)

- [ ] `CLAUDE.md` tabla Estado actual: fila nueva
  `| Suscripciones — administración (módulo RBAC propio, admin del tenant) | ✅ Implementado (2026-07-06) |`.
- [ ] `docs/features/tienda-online.md`: sección admin (endpoints `/suscripciones/admin`,
  página `/suscripciones`, módulo RBAC, semántica `activa_hasta`), renombre
  "Mis suscripciones".
- [ ] `docs/PRODUCTO.md`: regla de vigencia tras cancelar + acciones del admin
  (incl. eliminar solo canceladas).
- [ ] `startup-pos.sql`: columna `activa_hasta DATE` en `CREATE TABLE suscripciones`.

## Verification

1. **Unit backend**: `cd backend && npm test` (specs nuevos de suscripciones +
   suite completa en verde) y `npm run lint`.
2. **Frontend**: `cd frontend && npm test` y `npm run build`.
3. **E2E manual** (docker-compose ya arriba, login admin Paris, chrome-devtools MCP):
   - Sidebar: admin ve "Suscripciones" y "Mis suscripciones"; usuario sin el
     permiso `Suscripciones:Leer` no ve la entrada nueva y navegar a
     `/suscripciones` lo redirige; llamar `GET /suscripciones/admin` sin permiso → 403.
   - `/suscripciones`: lista suscripciones de TODOS los usuarios con nombre/email;
     filtro por estado funciona.
   - Cliente cancela desde "Mis suscripciones" → modal informa vigencia →
     confirmar → badge Cancelada + "activa hasta X"; en BD
     (`mcp__postgres__query`): `activa_hasta` = `proximo_cobro` previo.
   - Admin pausa/reanuda/cancela la suscripción de otro usuario; cancelar muestra
     el modal con la vigencia.
   - Admin elimina una cancelada → desaparece de la lista y de "Mis suscripciones"
     del cliente; en BD `eliminado_el IS NOT NULL`. Eliminar una activa vía API
     directa → 400.

## Decisions / Open questions

- **`activa_hasta` = `proximo_cobro` al cancelar** — un solo dato; la UI deriva
  "activa hasta el día anterior" y "se cancela el `<fecha>` a primera hora".
  No hay motor recurrente todavía: la vigencia es informativa.
- **Módulo RBAC propio con permisos** (decisión del usuario, reemplaza el gating
  `esAdmin`/`TenantAdminGuard` propuesto inicialmente): `ModuloApp` "Suscripciones"
  + `@RequiresPermiso` en backend — primer módulo de negocio nuevo que estrena el
  enforcement granular fuera de Caja/Test. El rol admin fijo pasa por el
  short-circuit `es_fijo` de `RbacService.userHasPermiso`.
- **Rutas cliente sin `@RequiresPermiso`**: crear/ver/gestionar las propias
  suscripciones sigue al nivel de Tienda Online (guards estándar), sin exigir el
  módulo nuevo.
- **Eliminar** solo aplica a suscripciones `cancelada` (soft delete) — evita
  borrar contratos vigentes por accidente.
- **Rutas admin anidadas** bajo `/suscripciones/admin` en el mismo controller
  (evita módulo backend nuevo para 3 endpoints del mismo agregado).
