# Plan: Módulo de Configuración — Roles y Permisos

Status: Done
Date: 2026-06-21
Owner: Cesar Matheus

> Al ejecutar, copiar este plan a `docs/superpowers/plans/2026-06-21-modulo-roles-permisos.md`
> (convención del proyecto) y marcar los `- [ ]` a medida que se avanza.

## Context

El tenant necesita administrar su control de acceso (RBAC) desde la app. El backend
ya tiene **casi todo** el motor RBAC implementado (módulos `roles` y `rbac`, guards
`PermisosGuard`/`TenantGuard`, entidades de las 8 tablas RBAC). Lo que falta es:
(1) un par de endpoints "enriquecidos" para alimentar la UI, (2) corregir un bug que
impide que los permisos asignados a roles personalizados funcionen, (3) restringir la
administración de roles a administradores del tenant, y (4) **toda la interfaz** (no
existe ninguna pantalla de roles/usuarios todavía).

**Decisión de modelo (confirmada con el usuario):** un usuario puede tener **varios
roles** por tenant. Permite roles granulares y componibles (ej. "Caja" + "Reportes")
en vez de obligar a crear un rol a medida por usuario. El backend ya une permisos de
todos los roles del usuario, así que el modelo multi-rol "ya funciona" en la capa de
negocio; solo la UI debe reflejarlo.

## Scope / Out of scope

**En alcance:**
- Pantalla de **Roles**: listar, crear, editar (nombre/descripción), eliminar, y matriz
  módulo→permisos por rol.
- Pantalla de **Usuarios**: listar miembros del tenant con sus roles; asignar/quitar
  roles (multi-rol) por usuario.
- Endpoints backend faltantes + corrección del bug de `setPermissions`.
- Restringir mutaciones de roles a administradores del tenant.
- Documentación viva.

**Fuera de alcance:**
- Invitar/crear usuarios nuevos o agregarlos al tenant (gestión de usuarios global) —
  la pantalla de Usuarios solo administra **roles de miembros existentes**.
- Contratar/desactivar módulos del tenant (es del superadmin, `/admin/*`).
- Evaluación de condiciones de descuentos/recargos (otra fase).

## Backend

Ubicación: reutilizar `backend/src/modules/roles/` y `backend/src/modules/tenants/`.

- [x] **FIX crítico — `RolesService.setPermissions`** (`roles.service.ts:116`). Hoy solo
  escribe `roles_permisos_modulos`, pero el chequeo de permisos
  (`rbac.service.ts:33-50`) hace JOIN por `modulos_roles`. Un rol personalizado al que
  se le asignan permisos por el endpoint actual **nunca pasará** el chequeo. Corregir:
  - Si `moduloAppPermisoIds.length > 0` → asegurar fila en `modulos_roles`
    `(rolId, moduloTenantId)` (crear, o restaurar si está soft-deleted).
  - Si queda vacío → `softDelete` de esa fila en `modulos_roles`.
  - Usar el `ModuloRol` repo (entidad ya existe: `entities/modulo-rol.entity.ts`).
- [x] **Endpoint: módulos contratados con sus permisos** (para la matriz del editor).
  Nuevo método `RolesService.findModulosDisponibles(tenantId)` + ruta
  `GET /roles/modulos-disponibles`. Devuelve por cada `tenant_modulos` activo (no
  eliminado): `{ moduloTenantId, moduloAppId, nombre, icono, permisos: [{ moduloAppPermisoId, permisoNombre }] }`.
  Query raw uniendo `tenant_modulos → modulos_app → modulo_app_permisos → permisos`
  (espejo del JOIN en `rbac.service.ts`).
- [x] **Enriquecer miembros con nombre + roles** (para pantalla Usuarios).
  Modificar `TenantsService.findMembers` (`tenants.service.ts:139`) — hoy devuelve
  `UsuarioTenant[]` pelado. Cambiar a query raw que una `usuarios_tenants → usuarios`
  y agregue los roles asignados (`roles_usuarios → roles`, no eliminados):
  `{ usuarioId, nombre, apellido, correo, roles: [{ rolId, nombre }] }`.
  (No cambia la ruta `GET /tenants/members`.)
- [x] **Restringir administración de roles a admin del tenant.** Las rutas de
  mutación de `RolesController` hoy solo usan `JwtAuthGuard + TenantGuard` → cualquier
  miembro puede editar roles. Agregar un guard ligero `TenantAdminGuard` en
  `common/guards/` que verifique que el usuario tiene un rol `es_fijo = true` en el
  tenant (misma lógica del short-circuit en `rbac.service.ts:19-30`), y aplicarlo a
  `POST/PATCH/DELETE/PUT` de roles y a las mutaciones de la pantalla Usuarios.
  Registrar el guard en `common.module.ts`. Dejar los `GET` accesibles a cualquier
  miembro (la UI igual ocultará el menú a no-admin).
- [x] DTOs: reutilizar `CreateRolDto`/`UpdateRolDto`/`AssignUserDto` existentes. El
  body de `setPermissions` ya es `{ moduloAppPermisoIds: string[] }` — no cambia.

Endpoints que ya existen y se reutilizan tal cual:
`GET/POST/PATCH/DELETE /roles`, `GET /roles/:id/permissions`,
`PUT /roles/:id/modules/:moduloTenantId/permissions`,
`POST /roles/:id/users`, `DELETE /roles/:id/users/:userId`, `GET /tenants/members`.

## Frontend

Patrón a copiar: módulo **Configuración** existente (`pages/configuracion.vue`,
`pages/configuracion/perfil.vue`, `components/configuracion/PerfilForm.vue`).
Reutilizar `useApiFetch` (`composables/useApiFetch.ts`), `useToast`, `usePermissionsStore`
(`stores/permissions.ts`), y componentes Nuxt UI (`UCard`, `UTable`, `UFormField`,
`UInput`, `UButton`, `UModal`, `UCheckbox`, `USelectMenu`).

- [x] **Nav** en `pages/configuracion.vue`: agregar items "Roles y permisos"
  (`/configuracion/roles`) y "Usuarios" (`/configuracion/usuarios`). Mostrarlos solo
  a administradores (gate con `permissionsStore`/flag de rol fijo; ver Decisions).
- [x] **`pages/configuracion/roles/index.vue`** — tabla de roles (nombre, descripción,
  badge "Fijo"). Botón "Nuevo rol" abre `UModal` (nombre + descripción → `POST /roles`)
  y al crear navega al editor. Acciones editar (→ `[id]`) y eliminar
  (`DELETE /roles/:id`, deshabilitado/oculto si `esFijo`). Toast en éxito/error.
- [x] **`pages/configuracion/roles/[id].vue`** — editor de rol:
  - Form nombre/descripción → `PATCH /roles/:id` (bloqueado si `esFijo`).
  - **Matriz de permisos:** cargar `GET /roles/modulos-disponibles` (módulos+permisos)
    y `GET /roles/:id/permissions` (marcados actuales). Por cada módulo, checkboxes de
    permisos. Guardar = por cada módulo modificado, `PUT /roles/:id/modules/:moduloTenantId/permissions`
    con los `moduloAppPermisoIds` seleccionados.
- [x] **`pages/configuracion/usuarios/index.vue`** — tabla de miembros
  (`GET /tenants/members` enriquecido): nombre, correo, chips de roles. Editar roles de
  un usuario vía `USelectMenu` multiple (lista de `GET /roles`), aplicando diffs con
  `POST /roles/:id/users` y `DELETE /roles/:id/users/:userId`. Toast.
- [x] **Componentes** en `components/configuracion/roles/` y `.../usuarios/` para
  formularios/tablas reutilizables, siguiendo el estilo de `PerfilForm.vue`.

## Verification

1. `docker-compose up --build`; confirmar que el seeder corre sin errores.
2. **Bug fix end-to-end:** login como `vendedor@paris.cl` (rol "Vendedor", no fijo) en
   tenant Paris → abrir `/test`. Sección A debe habilitar solo Leer/Crear (ya sembrado).
   Luego como admin (`admin.paris`) editar el rol Vendedor y activar "Actualizar" en el
   módulo Test → re-login como vendedor → el botón Actualizar (sección A) se habilita y
   la llamada backend (sección B) responde 200. Esto prueba que `modulos_roles` se
   puebla correctamente.
3. **Roles:** como admin crear un rol nuevo, asignarle permisos de Caja, verificarlo en
   la matriz al recargar.
4. **Usuarios:** asignar 2 roles a un usuario, confirmar chips y que sus permisos se
   unen (`GET /rbac/mis-permisos`).
5. **Autorización:** como usuario no-admin, confirmar que el menú Roles/Usuarios no
   aparece y que un `PATCH /roles/:id` directo devuelve 403.
6. `cd backend && npm run lint && npm test`.

## Decisions / Open questions

- **Multi-rol por usuario:** confirmado. Actualizar la sección RBAC de
  `docs/PRODUCTO.md` (que insinuaba un rol único) y registrar la decisión.
- **Gate del menú en frontend:** no hay módulo/permiso "Configuración" sembrado. Para
  decidir si el usuario es admin del tenant en el front, lo más simple es exponer un
  flag (ej. agregar `esAdminTenant` derivado de rol fijo en el token o en
  `GET /tenants/me`). Alternativa mínima: mostrar el menú a todos y dejar que el backend
  (TenantAdminGuard) bloquee — pero es peor UX. **Recomendado:** incluir el flag en el
  payload del perfil/tenant. (A confirmar en ejecución.)
- **Docs a actualizar (CLAUDE.md "documentación viva"):** crear
  `docs/features/roles-permisos.md` + link en `docs/README.md`; actualizar tabla
  "Estado actual" en `CLAUDE.md` y `docs/MIGRACION-FUNCIONALIDADES.md`; nota de decisión
  multi-rol en `docs/PRODUCTO.md` (y opcional ADR en `docs/adr/`).
