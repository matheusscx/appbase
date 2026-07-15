# Architecture

## Stack

- **Backend**: NestJS (TypeScript) REST API, puerto 3000
- **Frontend**: Nuxt 4 (Vue 3) SPA/SSR, puerto 5173
- **Database**: PostgreSQL 15 con TypeORM, puerto 5432 (interno)
- **Orchestration**: Docker Compose

Todo el stack corre en contenedores — no se requiere Node.js ni PostgreSQL local.

## Puertos

| Servicio     | Puerto host   |
|--------------|---------------|
| Frontend     | 5173          |
| Backend      | 3000          |
| API          | 3000/api      |
| Swagger      | 3000/api/docs |
| PostgreSQL   | 5432 (interno)|

## Monorepo

```
startup-app/
├── backend/
│   ├── src/
│   │   ├── main.ts               # Bootstrap: CORS, ValidationPipe, Swagger
│   │   ├── app.module.ts         # Módulo raíz, importa todos los feature modules
│   │   └── modules/
│   │       ├── auth/             # JWT (access + refresh), Google OAuth, switch-tenant
│   │       ├── me/               # Perfil del usuario autenticado (PATCH /me/*)
│   │       ├── users/            # Entidad usuario
│   │       ├── tenants/          # Gestión de tenants y razones sociales
│   │       ├── rbac/             # Roles, permisos, módulos, asignación a usuarios
│   │       ├── roles/            # CRUD de roles por tenant
│   │       ├── monedas/          # Configuración de monedas por tenant
│   │       ├── catalog/          # Catálogo agregado (uso interno)
│   │       ├── categorias/       # Categorías de items por tenant
│   │       ├── impuestos/        # Catálogo de impuestos por tenant
│   │       ├── descuentos/       # Catálogo de descuentos por tenant
│   │       ├── recargos/         # Catálogo de recargos por tenant
│   │       ├── metodos-pago/     # Métodos de pago (global + habilitación por tenant)
│   │       ├── tipos-regla/      # Tipos de regla de precio
│   │       ├── items/            # Catálogo de items (productos y servicios) + ajuste de stock
│   │       ├── inventario/       # Kardex de movimientos de stock (serie/lote/cantidad)
│   │       ├── calculo-precios/  # Motor de cálculo de precios (servicio puro stateless)
│   │       ├── ventas/           # Procesamiento de ventas transaccional + tipos de documento
│   │       ├── pagos/            # Abonos a ventas pendientes y ledger de pagos
│   │       ├── caja/             # Gestión de cajas (física/virtual, movimientos, cierre)
│   │       ├── seeder/           # Seed de datos de desarrollo (corre al arrancar)
│   │       └── test/             # Módulo de prueba para validación RBAC end-to-end
│   ├── test/                     # Tests e2e
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── app.vue               # Componente raíz
│   │   ├── pages/                # Routing basado en archivos (auto)
│   │   ├── components/           # Componentes auto-importados
│   │   ├── composables/          # Composables auto-importados
│   │   ├── middleware/           # Route middleware
│   │   └── stores/               # Stores Pinia
│   ├── nuxt.config.ts
│   └── package.json
├── docker-compose.yml
├── backend.Dockerfile
├── frontend.Dockerfile
├── .env                          # Copiar de .env.example
├── .env.example
└── startup-pos.sql               # Esquema de BD completo (fuente de verdad del schema)
```

## Backend

### Flujo de una request

```
[HTTP Request]
    ↓
[Guards — JwtAuthGuard / TenantAdminGuard / SuperadminGuard]
    ↓
[ValidationPipe — class-validator sobre DTOs]
    ↓
[Controller]
    ↓
[Service — lógica de negocio, SQL raw o TypeORM]
    ↓
[PostgreSQL]
    ↓
[ClassSerializerInterceptor — excluye campos @Exclude()]
    ↓
[HTTP Response JSON]
```

### Bootstrap (`main.ts`)

1. **CORS** — origen `FRONTEND_URL` (dev: `http://localhost:5173`)
2. **ValidationPipe** — global, valida todos los DTOs con `class-validator`
3. **ClassSerializerInterceptor** — excluye campos anotados con `@Exclude()`
4. **Swagger** — docs en `/api/docs` con soporte Bearer
5. **Prefijo global** `/api`

### Estructura de un módulo feature

```
modules/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts
├── <feature>.service.ts
├── entities/
│   └── <feature>.entity.ts
└── dto/
    ├── create-<feature>.dto.ts
    └── update-<feature>.dto.ts
```

### Guards disponibles

| Guard | Decorator | Protege |
|---|---|---|
| `JwtAuthGuard` | `@UseGuards(JwtAuthGuard)` | Toda ruta autenticada |
| `TenantAdminGuard` | `@UseGuards(TenantAdminGuard)` | Mutaciones de configuración del tenant (rol admin) |
| `SuperadminGuard` | `@UseGuards(SuperadminGuard)` | Rutas `/admin/*` (flag `es_superadmin`) |

### UUID en entidades TypeORM (crítico)

Toda columna PK o FK de tipo UUID **debe** declarar `type: 'uuid'` explícitamente. Sin eso TypeORM infiere `character varying` y los JOINs fallan en runtime. Ver [ADR-004](./adr/004-uuid-column-types.md).

```typescript
// ✅ Correcto
@PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
@Column({ name: 'usuario_id', type: 'uuid', nullable: true })

// ❌ Incorrecto — TypeORM infiere varchar
@PrimaryColumn({ name: 'tenant_id' })
@Column({ name: 'usuario_id', type: 'varchar', nullable: true })
```

## Frontend

### Páginas (`pages/`)

| Ruta | Archivo | Notas |
|------|---------|-------|
| `/login` | `login.vue` | Pública |
| `/register` | `register.vue` | Pública |
| `/forgot-password` | `forgot-password.vue` | Pública |
| `/auth/callback` | `auth/callback.vue` | Callback Google OAuth |
| `/select-tenant` | `select-tenant.vue` | Requiere auth, exenta de tenant activo |
| `/no-tenant` | `no-tenant.vue` | Requiere auth, exenta de tenant activo |
| `/` | `index.vue` | Dashboard (requiere auth + tenant) |
| `/admin` | `admin.vue` | Solo superadmin |
| `/test` | `test.vue` | Módulo de prueba RBAC |
| `/configuracion` | `configuracion/index.vue` | Redirect → `/configuracion/perfil` (compat. bookmarks) |
| `/configuracion/perfil` | `configuracion/perfil.vue` | Perfil de usuario (**ruta canónica** del hub config) |
| `/configuracion/empresa` | `configuracion/empresa.vue` | Datos del tenant |
| `/configuracion/preferencias-financieras` | `configuracion/preferencias-financieras.vue` | Motor de precios |
| `/configuracion/razones-sociales` | `configuracion/razones-sociales.vue` | |
| `/configuracion/monedas` | `configuracion/monedas.vue` | |
| `/configuracion/categorias` | `configuracion/categorias.vue` | |
| `/configuracion/impuestos` | `configuracion/impuestos.vue` | |
| `/configuracion/descuentos` | `configuracion/descuentos.vue` | |
| `/configuracion/recargos` | `configuracion/recargos.vue` | |
| `/configuracion/metodos-pago` | `configuracion/metodos-pago.vue` | |
| `/configuracion/items` | `configuracion/items.vue` | |
| `/inventario` | `inventario.vue` | Kardex de movimientos |
| `/mermas` | `mermas.vue` | Registro y listado de mermas |
| `/recetas-desfases` | `recetas-desfases.vue` | Bandeja de recetas con costo desfasado |
| `/configuracion/roles` | `configuracion/roles/index.vue` | Lista + editor de rol en drawer |
| `/configuracion/roles/:id` | `configuracion/roles/[id].vue` | Redirect → `/configuracion/roles` (compat.) |
| `/configuracion/usuarios` | `configuracion/usuarios/index.vue` | Asignación de roles a usuarios |
| `/ventas` | `ventas/index.vue` | Historial + detalle en drawer (`?venta=uuid`) |
| `/ventas/pos` | `ventas/pos.vue` | Punto de venta (crear venta) |
| `/ventas/historial` | `ventas/historial.vue` | Redirect → `/ventas` (compat.) |
| `/ventas/:id` | `ventas/[id].vue` | Redirect → `/ventas?venta=:id` (compat.) |
| `/pagos` | `pagos/index.vue` | Ledger de pagos del tenant |
| `/caja` | `caja/index.vue` | Gestión de cajas |
| `/caja/:id` | `caja/[id].vue` | Detalle de caja abierta |

### Stores Pinia

**`useAuthStore`**
- `user` — perfil del usuario (`{ id, nombre, apellido, correo, esSuperadmin, ... }`)
- `token` — JWT access token (cookie httpOnly)
- `activeTenantId` *(computed)* — `tenant_id` del payload del JWT; fuente de autoridad
- `isSuperadmin` *(computed)* — `es_superadmin` del JWT payload
- `login()` / `logout()` / `tryRefresh()` / `fetchMe()` / `handlePostLogin()`

**`useTenantStore`** *(presentación)*
- `tenants` — lista de `{ tenantId, nombre }` del usuario
- `activeTenant` *(computed)* — cruza `activeTenantId` contra la lista
- `fetchMyTenants()` → `GET /api/auth/my-tenants`
- `switchTenant(id)` → `POST /api/auth/switch-tenant` → actualiza el token

**`usePermissionsStore`**
- `permisos` — array de strings `"modulo:accion"` para el tenant activo
- `esAdmin` — si el usuario es admin del tenant activo
- `fetchPermisos()` — carga permisos desde `GET /api/rbac/mis-permisos` + `/api/rbac/es-admin`
- `can(modulo, permiso)` — devuelve `true` si el usuario tiene el permiso (o es superadmin)

Ver [ADR-003](./adr/003-jwt-decode-client.md) para el patrón JWT-authority + store de presentación.

### Middleware (`middleware/auth.ts`)

Aplicado globalmente. Lógica en orden:

1. Sin access token → `tryRefresh()`; si sigue sin token → `/login`
2. Sin `user` cargado → `fetchMe()`
3. Si `fetchMe` falló (token inválido) → `/login`
4. Rutas exentas de tenant (`/select-tenant`, `/no-tenant`, `/login`, `/register`) → pasar
5. Rutas `/admin/**` → verificar `isSuperadmin`; si false → `/`
6. Sin `activeTenantId` → `handlePostLogin()` (resuelve tenant o redirige)
7. Con `activeTenantId` pero lista de tenants vacía → `fetchMyTenants()` (rehidratación tras refresh)

### Llamadas a la API

Usar `$fetch` (Nuxt built-in) vía el composable `useApiFetch` — nunca axios.

```typescript
const data = await useApiFetch<ResponseType>(`${apiUrl}/endpoint`)
```

## Base de datos

- TypeORM con `synchronize: true` en desarrollo (el esquema se autosinc desde entidades)
- Soft delete en todas las tablas: `eliminado_el TIMESTAMPTZ`; toda lectura filtra `eliminado_el IS NULL`
- PKs UUID en todas las tablas
- **Esquema completo:** ver `startup-pos.sql` (fuente de verdad del schema)

## Variables de entorno

### Backend (`.env`)

| Variable | Propósito |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL |
| `PORT` | Puerto de escucha (default 3000) |
| `API_PREFIX` | Prefijo de rutas (`/api`) |
| `JWT_SECRET` | Firma del access token |
| `JWT_EXPIRATION` | Vida del access token (ej. `15m`) |
| `JWT_REFRESH_SECRET` | Firma del refresh token |
| `JWT_REFRESH_EXPIRATION` | Vida del refresh token (ej. `1h`) |
| `FRONTEND_URL` | Origen CORS permitido |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Google OAuth |

### Frontend (runtime config, prefijo `VITE_`)

| Variable | Propósito |
|---|---|
| `VITE_API_URL` | Base URL del backend (`http://localhost:3000/api`) |
| `VITE_APP_NAME` | Título de la app |

## Deployment

- Docker Compose: todos los servicios en red `tecnica_network` (bridge)
- Datos de PostgreSQL: volumen nombrado `postgres_data`
- Variables de entorno: archivo `.env` en la raíz del repo, compartido entre servicios
- En producción: reemplazar `synchronize: true` por migraciones TypeORM; endurecer CORS

## Documentación

- **ADRs** (`docs/adr/`) — decisiones arquitectónicas con contexto y consecuencias
- **Features** (`docs/features/`) — doc operativa de cada feature implementada
- **Patrones** (`docs/patterns/`) — playbook backend/frontend; leer antes de planificar
- **Producto** (`docs/PRODUCTO.md`) — reglas de negocio completas
- **Schema** (`startup-pos.sql`) — esquema SQL completo y actualizado
