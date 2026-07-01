# Design: Gestión de tenants y razones sociales (tenant-admin)

**Status:** Approved  
**Date:** 2026-06-22  
**Owner:** Cesar Matheus

---

## Context

Feature #4 del plan de migración. Los admins de un tenant deben poder editar los datos de su propia empresa y gestionar sus razones sociales (datos legales para facturación), todo desde `/configuracion`.

Estado actual:
- `tenants.controller.ts` ya tiene `GET /tenants/me` y gestión de miembros/módulos.
- La entidad `Tenant` existe pero no hay `PATCH /tenants/me`.
- Tabla `razones_sociales` existe en el SQL (`startup-pos.sql:149`) pero no hay entidad, servicio ni UI.
- País/provincia están seedeados en `seeder.service.ts` pero el catálogo no expone endpoints de lectura.
- `TenantAdminGuard` existe en `backend/src/common/guards/tenant-admin.guard.ts`.

---

## Scope

**In scope:**
- `PATCH /tenants/me` — tenant-admin edita datos de su empresa.
- CRUD de razones sociales (`GET /POST /PATCH /DELETE /tenants/razones-sociales`).
- Endpoints de lectura `GET /catalog/paises` y `GET /catalog/provincias` para el selector de provincia.
- Seed de 1–2 razones sociales de dev en `seeder.service.ts`.
- Frontend: nuevas páginas `/configuracion/empresa` y `/configuracion/razones-sociales`.

**Out of scope:**
- Panel superadmin `/admin/tenants` (ya existe, no se toca).
- Sub-tenants (tabla reservada, no usar aún — `startup-pos.sql:180`).
- Terceros (feature independiente).
- Edición de `calculo_descuentos` (config de precios, otra feature).
- Configuración de monedas (feature #6).

---

## Backend

### 1. Catálogo — endpoints de provincia/país

**Archivo:** `backend/src/modules/catalog/catalog.service.ts`  
Métodos nuevos:
- `findAllPaises(): Promise<Pais[]>` — `WHERE eliminado_el IS NULL`.
- `findAllProvincias(paisId?: string): Promise<Provincia[]>` — `WHERE eliminado_el IS NULL` + filtro opcional por `paisId`.

**Archivo:** `backend/src/modules/catalog/catalog.controller.ts`  
Rutas nuevas (bajo `JwtAuthGuard`):
- `GET /catalog/paises`
- `GET /catalog/provincias?paisId=` (query param opcional)

Entidades `Pais` y `Provincia` ya existen en `catalog/entities/`.

---

### 2. Tenants — editar datos de la propia empresa

**Ruta:** `PATCH /tenants/me`  
**Guards:** `JwtAuthGuard + TenantGuard + TenantAdminGuard`  
**`tenantId`** siempre del token, nunca del body.

**Archivo nuevo:** `backend/src/modules/tenants/dto/update-my-tenant.dto.ts`
```
nombre?: string
correo?: string (unique validation)
telefono?: string | null
direccion?: string | null
provinciaId?: string (UUID)
```
Todos opcionales (`PartialType`). Validación via `class-validator`.

**Servicio:** agregar `updateMine(tenantId, dto)` en `tenants.service.ts`.  
**Controlador:** agregar método `@Patch('me')` en `TenantsController`.

---

### 3. Razones sociales

**Entidad nueva:** `backend/src/modules/tenants/entities/razon-social.entity.ts`  
Mapea tabla `razones_sociales`:
```
razonSocialId  UUID PK (type:'uuid')  — ADR-004
tenantId       UUID FK (type:'uuid')
nombre         string
rut            string
direccion      string | null
telefono       string | null
habilitado     boolean (default false)
creadoEl, actualizadoEl, eliminadoEl
```

**DTOs nuevos:**
- `create-razon-social.dto.ts` — `nombre` y `rut` requeridos; `direccion`, `telefono` opcionales.
- `update-razon-social.dto.ts` — `PartialType(CreateRazonSocialDto)` + `habilitado?: boolean`.

**Servicio:** agregar métodos en `tenants.service.ts`:
- `findRazonesSociales(tenantId)` — filtra `WHERE tenant_id = $1 AND eliminado_el IS NULL`.
- `createRazonSocial(tenantId, dto)` — `tenantId` del token.
- `updateRazonSocial(tenantId, id, dto)` — valida que el `razon_social_id` pertenezca al `tenantId`.
- `removeRazonSocial(tenantId, id)` — soft delete; valida pertenencia.

**Rutas en `TenantsController`:**
```
GET    /tenants/razones-sociales           JwtAuthGuard + TenantGuard
POST   /tenants/razones-sociales           + TenantAdminGuard
PATCH  /tenants/razones-sociales/:id       + TenantAdminGuard
DELETE /tenants/razones-sociales/:id       + TenantAdminGuard (204 No Content)
```

**Módulo:** registrar `RazonSocial` en el array `TypeOrmModule.forFeature([...])` de `tenants.module.ts`.

---

### 4. Seed de desarrollo

`seeder.service.ts` — agregar `seedRazonesSociales()` llamado después de `seedTenants()`:
- 1–2 razones sociales para el tenant de dev (IDs fijos siguiendo el patrón `550e8400-...`).
- Idempotente: skip si ya existe.

---

## Frontend

### Navegación en `/configuracion`

**Archivo:** `frontend/app/pages/configuracion.vue`  
Agregar dos ítems al bloque `if (permissionsStore.esAdmin)`:
```
{ label: 'Empresa', icon: 'i-lucide-building-2', to: '/configuracion/empresa' }
{ label: 'Razones sociales', icon: 'i-lucide-file-text', to: '/configuracion/razones-sociales' }
```

---

### Página `/configuracion/empresa`

**Archivo nuevo:** `frontend/app/pages/configuracion/empresa.vue`

- Carga en `onMounted`: `GET /tenants/me` + `GET /catalog/paises` → luego `GET /catalog/provincias?paisId=`.
- Form fields: nombre, correo, teléfono, dirección, select de país, select de provincia (dependiente del país).
- Guarda con `PATCH /tenants/me`.
- Patrón: `useApiFetch` + `useRuntimeConfig().public.apiUrl` + `useToast()` (igual que `usuarios/index.vue`).

---

### Página `/configuracion/razones-sociales`

**Archivo nuevo:** `frontend/app/pages/configuracion/razones-sociales.vue`

- Tabla: columnas nombre, RUT, teléfono, dirección, habilitado (badge), acciones (editar, eliminar).
- Modal CRUD (mismo patrón que `usuarios/index.vue`): nombre y RUT requeridos; dirección, teléfono opcionales; toggle habilitado.
- Crear → `POST /tenants/razones-sociales`.
- Editar → `PATCH /tenants/razones-sociales/:id`.
- Eliminar → `DELETE /tenants/razones-sociales/:id` con confirmación.

---

## Data flow

```
Frontend                      Backend                   DB
─────────────────────────────────────────────────────────────────
GET /tenants/me          →  TenantsController        → tenants
GET /catalog/paises      →  CatalogController        → pais
GET /catalog/provincias  →  CatalogController        → provincia
PATCH /tenants/me        →  TenantsService           → tenants
GET /tenants/razones-sociales  → TenantsService      → razones_sociales
POST /tenants/razones-sociales → TenantsService      → razones_sociales
PATCH /tenants/razones-sociales/:id → TenantsService → razones_sociales
DELETE /tenants/razones-sociales/:id → TenantsService → razones_sociales (soft)
```

---

## Error handling

- `PATCH /tenants/me` con correo duplicado → `ConflictException` (409).
- `PATCH/DELETE /tenants/razones-sociales/:id` con id que no pertenece al tenant → `NotFoundException` (404).
- `POST /tenants/razones-sociales` sin `nombre` o `rut` → `ValidationPipe` → 400.
- Frontend: `try/catch` en cada operación; toast de error con mensaje del backend.

---

## Testing

- Unit tests en `tenants.service.spec.ts`: `updateMine`, `findRazonesSociales`, `createRazonSocial`, `updateRazonSocial` (validación pertenencia), `removeRazonSocial`.
- Unit tests en `catalog.service.spec.ts`: `findAllPaises`, `findAllProvincias` con y sin filtro.
- E2E: flujo happy-path de empresa y razones sociales con token admin vs. token no-admin.

---

## Docs a actualizar en el mismo commit

| Archivo | Cambio |
|---|---|
| `docs/features/tenants-razones-sociales.md` | Crear (desde TEMPLATE.md) |
| `docs/README.md` | Agregar link a feature doc |
| `CLAUDE.md` — tabla "Estado actual" | Actualizar fila #4 a ✅ |
| `docs/MIGRACION-FUNCIONALIDADES.md` — tabla de estado | Backend ✅ + Frontend ✅ fila #4 |

---

## Decisions / Open questions

- `calculo_descuentos` no es editable aquí: queda en config de precios (feature posterior).
- Sub-tenants fuera de alcance: tabla `sub_tenants` está reservada (`startup-pos.sql:181`), no se toca.
- Selector de país en el form de empresa es necesario para poblar el de provincias, pero la FK de `tenants` es `provincia_id` (no `pais_id`). El país se infiere al cargar la provincia actual del tenant.
- `habilitado` en `razones_sociales` default `false`: al crear, la razón social queda deshabilitada hasta que el admin la active explícitamente.
