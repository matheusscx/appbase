# Feature: Configuración de Roles y Permisos

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-25

---

## Overview

### What is it?

Módulo de administración RBAC dentro de **Configuración**. Permite al administrador
del tenant: crear/editar/eliminar roles personalizados, configurar la matriz de
permisos (módulo → Leer/Crear/Actualizar/Eliminar) de cada rol, y asignar uno o más
roles a los usuarios del tenant.

### Why does it exist?

El motor RBAC (guards, chequeo de permisos, tablas) ya existía, pero no había interfaz
para administrarlo. Esta feature expone esa administración y corrige un bug que impedía
que los permisos de roles personalizados surtieran efecto.

### Scope

- Incluido: pantallas Roles (lista + editor con matriz) y Usuarios (asignación de
  roles), endpoints de soporte, guard de administrador, decisión multi-rol.
- NO incluido: invitar/crear usuarios nuevos en el tenant, contratar/desactivar módulos
  (superadmin, `/admin/*`), evaluación de condiciones de descuentos/recargos.

### Modelo: multi-rol por usuario

Un usuario puede tener **varios roles** por tenant. Los permisos son la **unión** de
todos sus roles. Permite roles granulares y componibles (ej. "MiCaja" + "Reportes") en
vez de obligar a crear un rol a medida por usuario. El backend ya unía permisos de
todos los roles (`RbacService.getMisPermisos` / `userHasPermiso`).

### Nota: módulo `Caja` renombrado a `MiCaja` + módulo nuevo `Cajas` (2026-07-23)

El módulo de permiso `Caja` se renombró a **`MiCaja`** (operar el propio turno; acciones
`Leer`/`Crear`/`Actualizar`/`Eliminar`, mismo id de siempre) y se creó un módulo nuevo
**`Cajas`** (supervisar todas, solo `Leer`). La acción global `Ver todas` **dejó de
asociarse a caja**: ya no existe `MiCaja:Ver todas`. El diferenciador "supervisor" pasó
de ser una acción CRUD reutilizada a ser tener contratado el módulo `Cajas` — el patrón
a seguir si otro módulo necesita separar "operar lo propio" de "supervisar todo", en vez
de seguir sobrecargando `Ver todas`. Detalle funcional y de permisos:
[`docs/features/gestion-cajas.md`](./gestion-cajas.md#modelo-de-acceso-por-permiso).

### Admin-only vs permiso de módulo — cuándo cada uno

Dos mecanismos de autorización conviven, y la elección **no es por pantalla sino por la
naturaleza de la acción**:

- **`TenantAdminGuard` (solo admin/dueño, no delegable)** → **configuración y políticas**:
  catálogos que administra el dueño (monedas, impuestos, descuentos, recargos, categorías,
  métodos-pago, motivos de diferencia, roles) y **cualquier política que un rol operativo no
  debería poder cambiarse a sí mismo**. La lectura suele quedar abierta al tenant; solo la
  escritura es admin-only.
- **`@RequiresPermiso('Modulo','Accion')` (permiso de módulo, delegable)** → **operación del
  día a día**: caja (`MiCaja`/`Cajas`), ventas, pagos, inventario, etc. Un rol custom lo puede
  recibir sin ser admin.

**Los tres ejes de rol (no confundir):** el **admin/dueño** fija políticas; el **supervisor
contratado** tiene permisos de módulo (`Cajas:*`), es operativo y es un posible vector de
fraude él mismo; los **cajeros** operan lo suyo (`MiCaja:*`). Corolario anti-fraude: tener
`Cajas:Leer` **no** equivale a "confianza de dueño" — no se le revelan cifras ciegas en vivo ni
se le delegan políticas de control.

**Zona gris — acción operativa que es política de control.** Un módulo operativo puede tener
acciones que, por anti-fraude, deben reservarse al dueño aunque el resto del módulo sea
delegable. La prueba: *¿un rol operativo podría desactivar o eludir el control sobre sí mismo?*
Si la respuesta es sí, la acción es admin-only. Casos ya decididos así:

- **Configurar el arqueo ciego** (`PUT /caja/arqueo-ciego`) → admin-only, aunque Caja sea un
  módulo operativo: si un `Cajas:Actualizar` pudiera apagar el ciego, la política anti-fraude
  quedaría decorativa. El **CRUD de cajones** de la misma pantalla sigue delegable a
  `Cajas:Actualizar` — es operación, no política.
- **Justificar el descuadre** en el cierre ciego (override admin sobre una caja cerrada) →
  admin-only por el mismo motivo.

Ante una acción de esta zona gris, **decidir con el owner, no asumir** (regla del proyecto:
"detenerse y preguntar" ante una regla de negocio de control no documentada).

---

## API Endpoints

Todos bajo `JwtAuthGuard + TenantGuard`. Las **mutaciones** agregan `TenantAdminGuard`
(requiere rol `es_fijo = true` en el tenant).

| Método | Ruta | Guard extra | Descripción |
|---|---|---|---|
| GET | `/roles` | — | Lista de roles del tenant |
| POST | `/roles` | TenantAdmin | Crear rol |
| PATCH | `/roles/:id` | TenantAdmin | Editar nombre/descripción (bloquea `esFijo`) |
| DELETE | `/roles/:id` | TenantAdmin | Soft-delete (bloquea `esFijo`) |
| GET | `/roles/modulos-disponibles` | — | Módulos contratados activos + sus permisos |
| GET | `/roles/:id/permissions` | — | `roles_permisos_modulos` del rol |
| PUT | `/roles/:id/modules/:moduloTenantId/permissions` | TenantAdmin | Setear permisos del rol en un módulo |
| POST | `/roles/:id/users` | TenantAdmin | Asignar rol a un usuario |
| DELETE | `/roles/:id/users/:userId` | TenantAdmin | Quitar rol a un usuario |
| GET | `/tenants/members` | — | Miembros con nombre + roles asignados |
| GET | `/rbac/es-admin` | — | `{ esAdmin: boolean }` para gating del frontend |

### Formas relevantes

```
GET /roles/modulos-disponibles →
[ { moduloTenantId, moduloAppId, nombre, icono,
    permisos: [ { moduloAppPermisoId, permisoNombre } ] } ]

GET /tenants/members →
[ { usuarioId, nombre, apellido, correo, roles: [ { rolId, nombre } ] } ]

PUT /roles/:id/modules/:moduloTenantId/permissions
body: { moduloAppPermisoIds: string[] }
```

---

## Backend

- **Roles**: `backend/src/modules/roles/roles.controller.ts`, `roles.service.ts`
  - `findModulosDisponibles(tenantId)` — JOIN `tenant_modulos → modulos_app → modulo_app_permisos → permisos`.
  - **Fix crítico en `setPermissions`**: además de `roles_permisos_modulos`, ahora
    mantiene `modulos_roles` (crea/restaura la fila al asignar permisos; la soft-borra
    al dejar el módulo sin permisos). El chequeo de permisos hace JOIN por
    `modulos_roles`, así que sin esto los permisos de roles personalizados nunca
    surtían efecto.
- **RBAC**: `backend/src/modules/rbac/rbac.service.ts` — nuevo `userIsTenantAdmin()`;
  controller expone `GET /rbac/es-admin`.
- **Guard**: `backend/src/common/guards/tenant-admin.guard.ts` — verifica rol fijo;
  registrado en `common.module.ts`.
- **Tenants**: `tenants.service.ts` — `findMembers` enriquecido con nombre + roles.

---

## Frontend

- **Nav**: `pages/configuracion.vue` — items "Roles y permisos" y "Usuarios" visibles
  solo si `permissionsStore.esAdmin`.
- **Roles lista + editor**: `pages/configuracion/roles/index.vue` — tabla, drawer crear/editar rol
  con matriz de permisos (`RolPermisosPorModulo`); eliminar (bloqueado en `esFijo`).
- **Redirect legacy**: `/configuracion/roles` → `/configuracion/roles` (editor unificado en drawer).
- **Usuarios**: `pages/configuracion/usuarios/index.vue` — miembros con chips de roles;
  edición vía `USelectMenu` múltiple, aplicando diffs (POST/DELETE por rol).
- **Store**: `stores/permissions.ts` — agrega `esAdmin` (cargado junto a `mis-permisos`,
  limpiado en `reset()`).

---

## Testing

### Manual (usuarios de desarrollo)

| Usuario | Contraseña | Rol | Tenant |
|---|---|---|---|
| `vendedor@paris.cl` | `admin` | Vendedor | Paris |
| `admin.paris@paris.cl` | `admin` | Admin (fijo) | Paris |
| `supervisor@paris.cl` | `admin` | Cajas · Supervisión (`Cajas:Leer`, no admin) | Paris |

**Pasos:**
1. `docker-compose up --build`
2. Login como admin de Paris → Configuración → "Roles y permisos" y "Usuarios" visibles.
3. Editar rol Vendedor → activar "Eliminar" en módulo MiCaja → Guardar.
4. Re-login como `vendedor@paris.cl` → verificar en `/mi-caja` que la acción de eliminar
   queda habilitada → confirma que `modulos_roles` se pobló (fix).
5. Login como vendedor: el menú Roles/Usuarios no aparece; `PATCH /roles/:id` directo → 403.

---

## Acceptance Criteria

- [x] Admin crea/edita/elimina roles; rol fijo protegido.
- [x] Matriz de permisos persiste y rehidrata correctamente.
- [x] Permisos de rol personalizado surten efecto (fix `modulos_roles`).
- [x] Usuario puede tener múltiples roles; permisos se unen.
- [x] Mutaciones restringidas a admin del tenant (403 en frontend/backend para no-admin).

---

## Related Features

- [Módulo Configuración](./modulo-configuracion.md) — mismo módulo de Configuración.
