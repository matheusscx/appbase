# Architecture

## Stack

- **Backend**: NestJS (TypeScript) REST API, port 3000
- **Frontend**: Nuxt 4 (Vue 3) SPA/SSR, port 5173
- **Database**: PostgreSQL 15 with TypeORM, port 5432 (internal)
- **Orchestration**: Docker Compose

All services run containerized — no local Node.js or PostgreSQL required.

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend (Nuxt) | 5173 | http://localhost:5173 |
| Backend (NestJS) | 3000 | http://localhost:3000 |
| API | 3000/api | http://localhost:3000/api |
| API Docs (Swagger) | 3000/api/docs | http://localhost:3000/api/docs |
| Database | 5432 | Internal (postgres service) |

## Monorepo Structure

```
practica/
├── backend/
│   ├── src/
│   │   ├── main.ts               # Bootstrap: CORS, ValidationPipe, Swagger
│   │   ├── app.module.ts         # Root module, imports config + feature modules
│   │   └── modules/              # Feature modules
│   │       ├── auth/             # Authentication (JWT + Google OAuth)
│   │       └── users/            # User entity and service
│   ├── test/                     # E2E tests
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── app.vue              # Root component (NuxtApp + Pinia setup)
│   │   ├── pages/               # File-based routing (auto)
│   │   │   ├── index.vue        # Dashboard (protected)
│   │   │   ├── login.vue        # Login form
│   │   │   ├── register.vue     # Registration form
│   │   │   └── auth/
│   │   │       └── callback.vue # Google OAuth callback handler
│   │   ├── middleware/          # Route middleware
│   │   │   └── auth.ts          # Auth guard (redirect to /login if not authed)
│   │   ├── stores/              # Pinia global state
│   │   │   └── auth.ts          # Auth store (user, token, login/logout actions)
│   │   └── assets/
│   ├── nuxt.config.ts           # Config: @nuxt/ui, @pinia/nuxt, runtime config
│   └── package.json
├── docker-compose.yml
├── backend.Dockerfile
├── frontend.Dockerfile
├── .env                         # Runtime env (copy from .env.example)
├── .env.example
└── docs/                        # Technical documentation
    ├── ARCHITECTURE.md          # This file
    ├── adr/                     # Architecture Decision Records
    └── features/                # Feature documentation
```

## Backend Architecture

### Module System

Each feature lives in `src/modules/<feature>/`:

```
modules/auth/
├── auth.module.ts              # Module definition, imports, exports
├── auth.controller.ts          # Route handlers
├── auth.service.ts             # Business logic
├── strategies/                 # Passport strategies
│   ├── local.strategy.ts       # Email + password validation
│   ├── jwt.strategy.ts         # JWT token validation
│   └── google.strategy.ts      # Google OAuth flow
├── guards/                     # Route guards
│   ├── jwt-auth.guard.ts       # Require valid JWT
│   └── local-auth.guard.ts     # Require email + password
└── dto/                        # Request/response schemas
    ├── register.dto.ts
    └── login.dto.ts
```

### Bootstrap (main.ts)

1. **ConfigModule**: Global env var loading
2. **CORS**: Allows `FRONTEND_URL` (default `http://localhost:5173`)
3. **ValidationPipe**: Global validation via `class-validator` decorators on all DTOs
4. **ClassSerializerInterceptor**: Auto-excludes fields marked `@Exclude()` (e.g., passwords)
5. **Swagger**: Auto-generated API docs at `/api/docs` with Bearer auth support
6. **API Prefix**: All routes get `/api` prefix globally

### Request Flow

```
[HTTP Request]
    ↓
[NestJS Middleware & Guards]
    ↓ (ValidationPipe validates request body)
[Controller Method]
    ↓
[Service (business logic)]
    ↓ (TypeORM query)
[PostgreSQL]
    ↓
[ClassSerializerInterceptor excludes sensitive fields]
    ↓
[HTTP Response (JSON)]
```

## Frontend Architecture

### File-Based Routing

Nuxt auto-creates routes from `pages/` structure:

| File | Route | Notes |
|------|-------|-------|
| `pages/index.vue` | `/` | Dashboard (requires auth + tenant) |
| `pages/login.vue` | `/login` | |
| `pages/register.vue` | `/register` | |
| `pages/select-tenant.vue` | `/select-tenant` | Selector de tenant (requires auth) |
| `pages/no-tenant.vue` | `/no-tenant` | Aviso si el usuario no pertenece a ningún tenant |
| `pages/auth/callback.vue` | `/auth/callback` | Google OAuth callback |

### State Management (Pinia)

Dos stores:

**`useAuthStore`**
- `user` — Perfil del usuario (`{ id, nombre, apellido, correo, esSuperadmin, ... }`)
- `token` — JWT access token (cookie)
- `activeTenantId` *(computed)* — `tenant_id` del JWT payload; fuente de autoridad
- `isSuperadmin` *(computed)* — `es_superadmin` del JWT payload
- `login(email, password)` / `register(nombre, correo, contrasena)` / `logout()`
- `handlePostLogin()` — Lógica post-login: fetchMyTenants → routing según tenants (0/1/>1)
- `fetchMe()` / `setToken(token)` / `clearAuth()`

**`useTenantStore`** *(presentación)*
- `tenants` — Lista de `{ tenantId, nombre }` del usuario
- `activeTenant` *(computed)* — cruza `activeTenantId` contra la lista
- `fetchMyTenants()` → GET `/api/auth/my-tenants`
- `switchTenant(id)` → POST `/api/auth/switch-tenant` → `setToken(newToken)`

Ver [ADR-003](./adr/003-jwt-decode-client.md) para el patrón JWT-authority + store de presentación.

### Middleware

**`auth.ts`** — Aplicado globalmente (en `pages/index.vue` y futuras rutas de dashboard):

1. Sin token → `/login`
2. Con token pero sin `user` → `fetchMe()` primero
3. Si fetchMe invalidó el token → `/login`
4. Rutas exentas (`/select-tenant`, `/no-tenant`, `/login`, `/register`) → pasar
5. Rutas `/admin/**` → verificar `isSuperadmin`; si false → `/`
6. Sin `activeTenantId` → `handlePostLogin()` (resuelve tenant o redirige)
7. Con `activeTenantId` → pasar

## Database

### TypeORM Configuration

- Entity synchronization enabled in development (`synchronize: true`)
- Connection string via `DATABASE_URL` env var
- Schema auto-syncs from entity decorators

### Current Schema

**Table: `users`**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Auto-generated |
| `name` | varchar | NOT NULL | Full name |
| `email` | varchar | UNIQUE, NOT NULL | Login identifier |
| `password` | varchar | nullable | Bcrypt hash (excluded from API responses) |
| `google_id` | varchar | nullable | Google OAuth ID |
| `created_at` | timestamp | DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | |

## Environment Variables

### Backend (read from `.env`)

| Variable | Purpose | Example |
|----------|---------|---------|
| `NODE_ENV` | Node environment | `development` |
| `PORT` | Listen port | `3000` |
| `API_PREFIX` | Route prefix | `/api` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://dev_user:dev_password@postgres:5432/tecnica_db` |
| `JWT_SECRET` | JWT signing key | `your-secret-key` |
| `JWT_EXPIRATION` | Token lifetime | `7d` |
| `FRONTEND_URL` | CORS origin | `http://localhost:5173` |
| `GOOGLE_CLIENT_ID` | Google OAuth app ID | (from Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | (from Google Cloud Console) |
| `GOOGLE_CALLBACK_URL` | OAuth redirect URL | `http://localhost:3000/api/auth/google/callback` |

### Frontend (runtime config, via `VITE_` prefix)

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_API_URL` | Backend API base | `http://localhost:3000/api` |
| `VITE_APP_NAME` | App title | `practica` |

## Data Flow

### Login (Email + Password)

```
[Login Page]
  ↓ email + password
[useAuthStore.login()]
  ↓ POST /api/auth/login
[AuthController.login()]
  ↓ LocalAuthGuard validates (bcrypt compare)
[AuthService.validateUser()]
  ↓ Query users table by email
[Database]
  ↓ User object
[AuthService.login()]
  ↓ Sign JWT with (sub: user.id, email: user.email)
[Return { access_token, user }]
  ↓ Store token + user in localStorage + Pinia state
[Redirect to Dashboard]
```

### Google OAuth

```
[Login Page: Click "Sign in with Google"]
  ↓ Redirect to /api/auth/google
[AuthController.google()]
  ↓ AuthGuard('google') redirects to Google consent screen
[User grants permission]
  ↓ Google redirects to /api/auth/google/callback with code
[GoogleStrategy validates code]
  ↓ Exchange code for Google profile
[AuthService.googleLogin()]
  ↓ Find or create user by google_id or email
  ↓ Sign JWT
[Redirect to /auth/callback?token=JWT]
  ↓ Frontend reads token from query string
[useAuthStore.setToken()]
  ↓ Store token in localStorage
[Redirect to Dashboard]
```

## Key Conventions

### Backend

- **DTOs**: All request bodies validated via `class-validator` decorators (email, length, etc.)
- **Entities**: Decorated with `@Entity()`, fields auto-map to DB columns
- **Services**: Contain all business logic; injected into controllers
- **Guards**: Applied per-route with `@UseGuards(GuardName)`

Example:
```typescript
@Post('login')
@UseGuards(LocalAuthGuard)  // Validates email + password
async login(@Body() loginDto: LoginDto) {
  return this.authService.login(/* ... */);
}
```

### Frontend

- **Pages**: Placed in `pages/` — routes auto-created
- **Components**: Reusable UI elements, auto-imported if placed in `components/`
- **Stores**: Pinia stores for global state
- **API calls**: Use `$fetch()` (Nuxt built-in) with Bearer token from store

Example:
```typescript
const user = await $fetch('/api/users/me', {
  headers: { Authorization: `Bearer ${auth.token}` }
});
```

## Deployment Considerations

- Docker Compose network: All services on `tecnica_network` bridge
- Postgres data: Persisted in named volume `postgres_data`
- Env vars: Set in `.env` at repo root, shared across all services
- Database migrations: TypeORM synchronizes on app startup (dev only; use migrations in production)

## Documentation

- **Architecture Decision Records**: `docs/adr/`
- **Feature Documentation**: `docs/features/`
- **This file**: High-level overview of the system

See `docs/adr/README.md` for decision rationale.
