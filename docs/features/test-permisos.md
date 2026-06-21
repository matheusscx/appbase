# Feature: Test de Permisos RBAC

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-06-21

---

## Overview

### What is it?

Módulo demostrativo que permite verificar el funcionamiento del sistema RBAC de punta a punta. Expone 4 acciones CRUD (Leer, Crear, Actualizar, Eliminar) protegidas por permisos, y una página de prueba con dos secciones: validación en el frontend (botones deshabilitados) y validación en el backend (respuestas 200 o 403).

### Why does it exist?

Proveer un sandbox concreto para validar que los permisos se respetan tanto en la UI como en el servidor, sin necesidad de módulos de negocio reales.

### Scope

- Incluido: 4 endpoints protegidos por `@RequiresPermiso`, endpoint `GET /rbac/mis-permisos`, página `/test` con secciones A y B, store de permisos frontend
- NO incluido (futuro): integración con módulos de negocio, permisos dinámicos por UI

---

## API Endpoints

### GET /api/test/leer
```
Authorization: Bearer <token>
X-Tenant-ID: <tenant-id>  (seteado por TenantGuard vía token)

Response 200: { "message": "Leyendo" }
Response 403: { "message": "No tienes permiso para esta acción" }
```

### POST /api/test/crear
```
Authorization: Bearer <token>

Response 200: { "message": "Creando" }
Response 403: { "message": "No tienes permiso para esta acción" }
```

### PATCH /api/test/actualizar
```
Authorization: Bearer <token>

Response 200: { "message": "Actualizando" }
Response 403: { "message": "No tienes permiso para esta acción" }
```

### DELETE /api/test/eliminar
```
Authorization: Bearer <token>

Response 200: { "message": "Eliminando" }
Response 403: { "message": "No tienes permiso para esta acción" }
```

### GET /api/rbac/mis-permisos
```
Authorization: Bearer <token>

Response 200: ["Test:Leer", "Test:Crear"]  // ejemplo para usuario Vendedor
```

---

## Backend

### Module & Services

- **Module**: `backend/src/modules/test/test.module.ts`
- **Controller**: `backend/src/modules/test/test.controller.ts`
- **Service**: `backend/src/modules/test/test.service.ts`
- **RBAC Controller**: `backend/src/modules/rbac/rbac.controller.ts`
- **RBAC Service method**: `RbacService.getMisPermisos(userId, tenantId)`

### Entity & Database

Sin entidad ni tabla — el módulo Test no persiste datos.

Los datos de permisos viven en las tablas RBAC existentes (`modulos_app`, `modulo_app_permisos`, `tenant_modulos`, `modulos_roles`, `roles_permisos_modulos`).

### Seed de desarrollo

El seeder agrega automáticamente:
- Módulo Test (`id: ...440050`)
- 4 `modulo_app_permisos` (Leer ...051, Crear ...052, Actualizar ...053, Eliminar ...054)
- Paris contrata Test (`tenant_modulo id: ...440055`)
- Rol Vendedor tiene Leer + Crear (NO Actualizar ni Eliminar)

### Guards aplicados

`@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` + `@RequiresPermiso('Test', '<acción>')` en cada endpoint del TestController.

`GET /rbac/mis-permisos` solo requiere `JwtAuthGuard + TenantGuard`.

---

## Frontend

### Pages

- `frontend/app/pages/test.vue` — Página de prueba con secciones A y B

### Pinia Store

**File**: `frontend/app/stores/permissions.ts`

**State**: `permisos: string[]`, `loading: boolean`, `error: string | null`

**Actions**:
- `fetchPermisos()` — GET /rbac/mis-permisos → llena `permisos`
- `can(modulo, permiso)` — `true` si superadmin o si `'Modulo:Permiso'` está en el array
- `reset()` — limpia `permisos` y `error`

### Sección A — Validación Frontend

4 botones con `:disabled="!permissionsStore.can('Test', '<acción>')"`. No llaman al backend — muestran un toast local.

### Sección B — Validación Backend

4 botones siempre habilitados. Llaman a los endpoints y muestran el `message` del backend (toast success en 200, toast error en 403).

---

## Data Flow

### Carga de permisos al entrar a /test

```
onMounted()
  ↓
permissionsStore.fetchPermisos()
  ↓
GET /api/rbac/mis-permisos
  ↓
RbacController → RbacService.getMisPermisos(userId, tenantId)
  ↓
SQL JOIN: roles → modulos_roles → tenant_modulos → modulo_app_permisos → permisos
  ↓
["Test:Leer", "Test:Crear"]
  ↓
permisos[] actualizado → botones Sección A se habilitan/deshabilitan
```

---

## Testing

### Manual (usuarios de desarrollo)

| Usuario | Contraseña | Rol | Tenant | Permisos Test |
|---|---|---|---|---|
| `vendedor@paris.cl` | `admin` | Vendedor | Paris | Leer, Crear |
| `admin.paris@paris.cl` | `admin` | Admin (fijo) | Paris | Todos |

**Pasos:**
1. `docker-compose up --build`
2. Login como `vendedor@paris.cl`
3. Navegar a `/test`
4. Sección A: Leer/Crear habilitados, Actualizar/Eliminar deshabilitados
5. Sección B: GET+POST → 200, PATCH+DELETE → 403

---

## Acceptance Criteria

- [x] GET /test/leer → 200 para Vendedor
- [x] POST /test/crear → 200 para Vendedor
- [x] PATCH /test/actualizar → 403 para Vendedor
- [x] DELETE /test/eliminar → 403 para Vendedor
- [x] GET /rbac/mis-permisos → ["Test:Leer","Test:Crear"] para Vendedor
- [x] Admin (es_fijo=true) → 200 en todos los endpoints
- [x] Página /test muestra estado correcto en Sección A y B

---

## Related Features

- [Authentication](./auth.md) — Sistema JWT que provee userId y tenantId
- [Frontend Multi-tenant](./frontend-multitenant.md) — Selección de tenant que precede al acceso
