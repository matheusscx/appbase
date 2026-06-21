# Feature: Flujo multi-tenant en frontend

**Status**: Complete
**Last Updated**: 2026-06-20

---

## Overview

### What is it?

Conecta el frontend al sistema multi-tenant del backend. Tras hacer login, el sistema determina a qué tenants pertenece el usuario y lo dirige al tenant correcto antes de entrar al dashboard. Si el usuario pertenece a varios tenants, ve un selector para elegir con cuál operar.

### Why does it exist?

El backend emite tokens JWT con `tenant_id: null` justo después del login. Para operar en el dashboard, el usuario necesita un token con un `tenant_id` activo. Este flujo resuelve esa transición de forma automática o guiada.

### Scope

Incluido:
- Decodificación de claims JWT en el cliente (`decodeJwt`)
- Store de tenants (lista + switch)
- Flujo post-login: 0 tenants → `/no-tenant`, 1 tenant → auto-switch, >1 → `/select-tenant`
- Página `/select-tenant` con selector visual (avatares de color determinista)
- Página `/no-tenant` con mensaje informativo y enlace a `/admin` para superadmin
- Sidebar con nombre del tenant activo + enlace "Administración" para superadmin
- Middleware de auth extendido con verificación de tenant y guard de `/admin`
- Tests unitarios: `useJwt`, `stores/auth`, `stores/tenant`, `middleware/auth`

NOT incluido (futuro):
- Pantallas de gestión de tenants (crear, editar, invitar usuarios)
- `TenantSwitcher` dropdown en navbar (actualmente muestra solo el nombre)
- RBAC frontend (menú según permisos del rol)

---

## API Endpoints

```
GET /api/auth/my-tenants

Authorization: Bearer <token>

Response (200):
[
  { "tenantId": "uuid", "nombre": "Empresa A" },
  { "tenantId": "uuid", "nombre": "Empresa B" }
]
```

```
POST /api/auth/switch-tenant

Authorization: Bearer <token>
{ "tenantId": "uuid" }

Response (200):
{ "access_token": "eyJ..." }
+ cookie: refresh_token (httpOnly)
```

---

## Backend

Este flujo consume endpoints existentes del módulo `auth`. No agrega lógica de backend.

Ver [features/auth.md](./auth.md) para el módulo auth completo.

---

## Frontend

### Composables

- `app/composables/useJwt.ts` — `decodeJwt(token): JwtPayload | null`
  - Lee el segmento central del JWT con `atob`, sin verificar firma
  - Retorna `null` para tokens corruptos o indecodificables

### Stores

**`app/stores/auth.ts`** (actualizado)
- Interfaz `User`: `{ id, nombre, apellido, correo, esSuperadmin, nombreUsuario, creadoEl }`
- `claims` *(computed)* — `decodeJwt(token.value)`
- `activeTenantId` *(computed)* — `claims.value?.tenant_id ?? null`
- `isSuperadmin` *(computed)* — `claims.value?.es_superadmin ?? false`
- `handlePostLogin()` — orquesta el flujo post-login completo
- `register(nombre, correo, contrasena)` — body actualizado a nombres en español

**`app/stores/tenant.ts`** (nuevo)
- `tenants: TenantItem[]` — lista de tenants del usuario
- `activeTenant` *(computed)* — cruza `activeTenantId` con la lista
- `fetchMyTenants()` — carga la lista desde `GET /auth/my-tenants`
- `switchTenant(id)` — POST + `setToken` + `navigateTo('/')`; error 403 → `error.value`

### Pages

- `app/pages/select-tenant.vue` — Grid de tarjetas (2 columnas para ≤4 tenants, lista para 5+). Avatar con inicial y color determinista (paleta de 6 colores por primera letra). Spinner inline por tarjeta durante el switch.
- `app/pages/no-tenant.vue` — Aviso con icono amber. Botón "Ir a administración" solo si `isSuperadmin`. Botón logout siempre visible.

### Layouts / Components

- `app/layouts/dashboard.vue` — Header del sidebar muestra `tenantStore.activeTenant?.nombre`. Enlace "Administración" en nav solo si `isSuperadmin`. Footer muestra nombre del tenant + nombre del usuario.
- `app/components/AppNavbar.vue` — Slot right muestra `activeTenant?.nombre ?? user?.nombre`.

### Middleware

- `app/middleware/auth.ts` — 7-branch logic: token check → fetchMe → exentas → admin guard → tenant check → handlePostLogin → pasar.

---

## Data Flow

### Flujo post-login

```
login() / register() / googleCallback()
  └─ setToken(access_token)  [tenant_id=null en el token]
  └─ handlePostLogin()
        └─ fetchMyTenants()
              ├─ 0 tenants → navigateTo('/no-tenant')
              ├─ 1 tenant  → switchTenant(id) → navigateTo('/')
              └─ >1 tenants → navigateTo('/select-tenant')

/select-tenant
  └─ usuario elige → switchTenant(id) → navigateTo('/')
```

### Switch de tenant

```
useTenantStore.switchTenant(tenantId)
  ↓ POST /api/auth/switch-tenant { tenantId }
[Backend: valida pertenencia → emite nuevo JWT con tenant_id=tenantId]
  ↓ { access_token }
authStore.setToken(access_token)
  ↓ token.value cambia → claims re-computed → activeTenantId actualizado
navigateTo('/')
```

---

## Testing

### Unit Tests (Frontend)

```bash
cd frontend
npm test
```

| Archivo | Tests |
|---------|-------|
| `app/composables/useJwt.spec.ts` | 4 — decodeJwt: válido, nulo, UUID, corrupto |
| `app/stores/auth.spec.ts` | 5 — computeds activeTenantId e isSuperadmin desde token |
| `app/stores/tenant.spec.ts` | 19 — activeTenant computed, fetchMyTenants, switchTenant |
| `app/middleware/auth.spec.ts` | 4 — 4 ramas del middleware |

Total: 32 tests.

### Manual Testing

```bash
docker-compose up
```

1. Registrar un usuario nuevo → debe llegar a `/no-tenant`
2. Asignar el usuario a un tenant desde la BD o seed
3. Hacer login → debe entrar directo al dashboard (1 tenant) o ver selector (>1)
4. En selector, elegir tenant → dashboard con nombre del tenant en sidebar
5. Verificar que rutas de dashboard sin tenant activo redirigen al selector

---

## Related

- [features/auth.md](./auth.md) — Sistema de autenticación base
- [ADR-001](../adr/001-jwt-auth.md) — JWT para autenticación
- [ADR-003](../adr/003-jwt-decode-client.md) — Decodificar JWT en cliente + patrón híbrido
