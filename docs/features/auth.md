# Feature: Authentication

**Status**: Complete  
**Last Updated**: 2026-08-15

---

## Overview

### What is it?

User authentication and authorization system supporting:
- Email + password registration and login
- Google OAuth 2.0 social login
- JWT tokens for stateless auth
- Protected routes (API endpoints and frontend pages)

### Why does it exist?

Essential for any app that needs to identify users, protect data, and restrict access to features. Supports both traditional login and modern social login.

### Scope

- ✅ Email + password registration
- ✅ Email + password login
- ✅ Google OAuth 2.0 login
- ✅ JWT token generation and validation
- ✅ Protected routes (API + frontend)
- ✅ User session management
- ✅ Password reset self-service (`/auth/recuperar`, link de 1 hora)
- ✅ Verificación de correo: sin verificar **no se puede entrar** (2026-08-15)
- ❌ 2FA / MFA (not implemented)

---

## API Endpoints

### Register

```
POST /api/auth/register

Request:
{
  "nombre": "John Doe",
  "correo": "john@example.com",
  "contrasena": "SecurePass123"  (min 6 chars)
}

Response (200) — SIEMPRE la misma, exista o no el correo:
{
  "message": "Si ese correo no tenía cuenta, te llega un link para verificarlo y entrar."
}
```

⚠️ **Responde lo mismo exista o no el correo, y no devuelve sesión.** Las dos
cosas son la misma decisión (owner, 2026-08-15): antes devolvía `409 "El correo
ya esta registrado"` contra un `201`, o sea que cualquiera podía **enumerar qué
direcciones tienen cuenta**. Para que las dos respuestas sean indistinguibles no
puede haber tokens: cuando el correo es de otra persona no hay cuenta propia a
la cual entrar.

Es el mismo criterio que `POST /auth/recuperar` ya usaba. La asimetría entre los
dos era interna y no deliberada.

Las tres ramas, indistinguibles desde afuera:

| Estado del correo | Qué pasa | Qué recibe |
|---|---|---|
| Libre | Se crea la cuenta **sin verificar** | Link de verificación |
| Existe, sin verificar | No se crea nada; se reenvía el link | Link de verificación |
| Existe y verificada | No se toca nada | Aviso de que alguien intentó registrarse con su correo |

El reenvío de la segunda fila no es cortesía: la `unique` de `usuarios.correo`
reserva la dirección y el token vence a los 7 días, así que sin reenvío alguien
que tipeó mal su propio correo se quedaba con la dirección trabada para siempre.

### Verificar el correo

```
POST /api/auth/verificar/:token   → { "message": "..." }
```

Sella `usuarios.correo_verificado_el`. **Una cuenta sin verificar no puede
entrar** (`validateUser`), y el corte va **después** de comprobar la contraseña:
si fuera antes, sería el mismo oráculo de enumeración que se acaba de cerrar.

El correo se sella por tres caminos, y ninguno es el registro: este link, aceptar
una invitación (llegó al mail y lo abrió), y Google **sólo** si el perfil trae
`email_verified`.

### Login (Email + Password)

```
POST /api/auth/login

Request:
{
  "email": "john@example.com",
  "password": "SecurePass123"
}

Response (200):
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "John Doe",
  "email": "john@example.com",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "created_at": "2026-06-13T10:00:00Z"
}
```

### Google OAuth - Initiate

```
GET /api/auth/google

Response: Redirects to Google consent screen
```

### Google OAuth - Callback

```
GET /api/auth/google/callback?code=...

Response: Redirects to http://localhost:5173/auth/callback?token=<jwt>
```

⚠️ **"El correo coincide" no vincula.** Si el `googleId` no está registrado pero
existe una cuenta local con ese correo, se responde `409` y se manda a la persona
a entrar con su contraseña. Antes se **ataba el `googleId` a esa cuenta local**
sin probar que la dirección fuera de quien entraba — con el registro público sin
verificar, era una vía directa a la cuenta de otro.

Vincular Google a una cuenta que ya existe es una acción deliberada desde adentro
de la sesión; **no existe todavía** y hacerla implícita en el login era el
agujero. Y se exige `email_verified` del perfil: sin eso, un Workspace mal
configurado alcanzaba para crear una cuenta a nombre de cualquier dirección.

### Refresh y cambio de tenant

```
POST /api/auth/refresh         (cookie httpOnly)
POST /api/auth/switch-tenant   (Bearer + cookie httpOnly)
```

**El canje del refresh token es atómico y el reuso corta la sesión.** La fila no
se borra al rotar: se marca `usado_el` —mismo patrón que
`TokensAccesoService.quemar()`— y esa sola sentencia resuelve las dos mitades:

- `UPDATE ... WHERE token = $1 AND usado_el IS NULL` ⇒ **un solo ganador**. Antes
  eran `findOne` + `delete` sin mirar `affected`, y dos pestañas despertando de
  standby a la vez **podían ganar las dos** (el frontend serializa el refresh por
  pestaña, no entre pestañas).
- La fila marcada queda de lápida ⇒ presentar un token **ya rotado** deja de ser
  un 401 indistinguible de un token inventado.

⚠️ **Pero el canje atómico NO elimina la carrera: sólo elige un perdedor**, y ese
perdedor es indistinguible de un atacante. Sin nada más, dos pestañas despertando
juntas —o un reintento de red— deslogueaban de **todos** sus dispositivos a
alguien que no hizo nada. La primera versión de este cambio tenía ese agujero y
lo cazó la revisión independiente.

Lo resuelve `reemplazado_por` + una **ventana de gracia de 30 s**:

| Qué presenta | Cuándo | Qué pasa |
|---|---|---|
| Token inexistente | — | 401. No revoca |
| Token vencido | — | 401. No revoca |
| Token rotado, con reemplazo vivo | dentro de 30 s | **Se le devuelve el mismo token que ganó el otro.** Las dos pestañas siguen vivas |
| Token rotado, sin reemplazo utilizable | dentro de 30 s | 401. **No revoca**: revocar volvería a castigar la carrera |
| Token rotado | pasados 30 s | Sesión copiada: **revoca todas las sesiones** |

Los dos últimos son el mismo hecho visto a distinta distancia temporal y no hay
forma de separarlos por otra vía: se elige un umbral y se documenta. 30 s cubre
de sobra dos tabs y un reintento, y deja la utilidad de un token robado en casi
nada.

⚠️ Las revocaciones deliberadas (`switch-tenant`, cambio de contraseña) borran
sólo las filas **vivas** (`usado_el IS NULL`). Llevarse las lápidas apagaba la
detección de reuso después de cada cambio de tenant.

**`switch-tenant` exige también la cookie de refresh**, no sólo el `JwtAuthGuard`.
La ruta emite un refresh token nuevo, así que con el access token solo cualquier
filtración —historial, log del hosting, XSS— se volvía **sesión renovable**. La
cookie tiene que ser de una sesión viva **del mismo usuario**: sin eso, el refresh
de otra cuenta serviría de segundo factor para el token robado.

### Get Current User

```
GET /api/auth/me

Authorization: Bearer <token>

Response (200):
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "John Doe",
  "email": "john@example.com",
  "created_at": "2026-06-13T10:00:00Z"
}

Response (401): Unauthorized (missing/invalid token)
```

---

## Backend

### Module & Services

**Module**: `src/modules/auth/auth.module.ts`
- Imports `PassportModule`, `JwtModule`, `UsersModule`
- Provides `AuthService`, `AuthController`
- Registers strategies: `LocalStrategy`, `JwtStrategy`, `GoogleStrategy`

**Controller**: `src/modules/auth/auth.controller.ts`
- `@Post('register')` — `RegisterDto`
- `@Post('login')` — `LocalAuthGuard`, `LoginDto`
- `@Get('google')` — `AuthGuard('google')`
- `@Get('google/callback')` — `AuthGuard('google')`
- `@Get('me')` — `JwtAuthGuard`

**Service**: `src/modules/auth/auth.service.ts`
- `validateUser(email, password)` — Check password via bcrypt
- `register(dto)` — Responde **lo mismo exista o no el correo** y **no emite sesión**: crea la cuenta sin verificar y manda el link, o avisa al dueño real. Ver "Register"
- `login(user)` — Issue JWT for existing user
- `googleLogin(profile)` — Find-or-create **sólo por Google ID**. La coincidencia de correo con una cuenta local es `409`, no un vínculo. Exige `email_verified`
- `generateToken(user)` — Sign JWT with sub + email
- `getMe(userId)` — Fetch user by ID (protected endpoint)

### Authentication Strategies

**LocalStrategy** (`src/modules/auth/strategies/local.strategy.ts`)
- Uses `usernameField: 'email'` to validate email + password
- Calls `authService.validateUser(email, password)`
- On success, injects `user` object into request

**JwtStrategy** (`src/modules/auth/strategies/jwt.strategy.ts`)
- Extracts token from `Authorization: Bearer <token>` header
- Validates signature against `JWT_SECRET`
- Injects `{ sub: user.id, email: user.email }` into request

**GoogleStrategy** (`src/modules/auth/strategies/google.strategy.ts`)
- Redirects to Google OAuth consent screen
- On user grant, exchanges `code` for Google profile
- Calls `authService.googleLogin(profile)` to upsert user
- On error or success, redirects to frontend with token or error

### Guards

**LocalAuthGuard** (`src/modules/auth/guards/local-auth.guard.ts`)
- Applied to `POST /api/auth/login`
- Validates email + password via LocalStrategy

**JwtAuthGuard** (`src/modules/auth/guards/jwt-auth.guard.ts`)
- Applied to `GET /api/auth/me`
- Validates JWT token in Authorization header

### Entity

**Table**: `users`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Auto-generated |
| `name` | varchar(255) | NOT NULL | User's full name |
| `email` | varchar(255) | UNIQUE, NOT NULL | Login identifier |
| `password` | varchar(255) | nullable | Bcrypt hash; null if OAuth-only user |
| `google_id` | varchar(255) | nullable, UNIQUE | Google OAuth ID |
| `correo_verificado_el` | timestamptz | nullable | `NULL` = la dirección no está probada, y **la cuenta no puede entrar**. Ver "Verificar el correo" |
| `created_at` | timestamp | DEFAULT now() | Account creation time |
| `updated_at` | timestamp | DEFAULT now() | Last update time |

> ⚠️ Esta tabla arrastra nombres viejos (`users`, `name`, `email`, `password`).
> En la base son `usuarios`, `nombre`, `correo`, `contrasena`. La fila nueva va
> con su nombre real; corregir las otras es una pasada aparte.

### DTOs

**RegisterDto** (`src/modules/auth/dto/register.dto.ts`)
```typescript
{
  name: string;      // Required
  email: string;     // Required, must be valid email
  password: string;  // Required, min 6 characters
}
```

**LoginDto** (`src/modules/auth/dto/login.dto.ts`)
```typescript
{
  email: string;     // Required
  password: string;  // Required
}
```

---

## Frontend

### Pages

**`pages/login.vue`** — `/login`
- Email + password form
- "Sign in with Google" button
- "Don't have an account?" link to `/register`
- "Forgot password?" link (not implemented)
- Form submission calls `useAuthStore.login()`

**`pages/register.vue`** — `/register`
- Name, email, password form
- "Sign up with Google" button
- "Already have an account?" link to `/login`
- Form submission calls `useAuthStore.register()`

**`pages/auth/callback.vue`** — `/auth/callback`
- Reads `?token=...` from query string
- Calls `useAuthStore.setToken(token)`
- Calls `useAuthStore.fetchMe()` to rehydrate user
- On success: redirects to `/` (dashboard)
- On error: redirects to `/login`

**`pages/index.vue`** — `/` (Dashboard)
- Protected page (guarded by `auth` middleware)
- Shows welcome message with user name and email
- "Logout" button calls `useAuthStore.logout()`

### Pinia Store

**File**: `stores/auth.ts`

**State**:
```typescript
user: User | null      // { id, name, email, created_at }
token: string | null   // JWT (persisted to localStorage)
loading: boolean
error: string | null
```

**Getters**:
- `isAuthenticated` — Returns true if both `token` and `user` are set

**Actions**:
- `setToken(token)` — Set token in state and localStorage
- `clearAuth()` — Clear state and localStorage
- `login(email, password)` → POST `/api/auth/login`
- `register(name, email, password)` → POST `/api/auth/register`
- `fetchMe()` → GET `/api/auth/me` with Bearer token
- `loginWithGoogle()` — Redirect browser to `/api/auth/google`
- `logout()` — Clear auth and navigate to `/login`

### Middleware

**File**: `middleware/auth.ts`

Applied to: `pages/index.vue` (dashboard)

**Logic**:
1. If no token → redirect to `/login`
2. If token but no user → call `fetchMe()` to rehydrate
3. If still not authenticated → redirect to `/login`
4. Else → allow access

---

## Data Flow

### Email + Password Login

```
[Login Page: User enters email + password]
  ↓ useAuthStore.login(email, password)
[POST /api/auth/login]
  ↓
[AuthController.login()]
  ↓
[LocalAuthGuard validates (bcrypt compare)]
  ↓
[AuthService.validateUser()]
  ↓
[Query users table by email]
  ↓
[Bcrypt.compare(password, password_hash)]
  ↓ Valid
[Return user object]
  ↓
[AuthService.login()]
  ↓
[Sign JWT: { sub: user.id, email: user.email, exp: now + 7d }]
  ↓
[Return { access_token, user }]
  ↓
[Store.setToken(access_token)]
  ↓ Save to localStorage + Pinia state
[Navigation redirect to / (dashboard)]
```

### Google OAuth Login

```
[Login Page: User clicks "Sign in with Google"]
  ↓
[useAuthStore.loginWithGoogle()]
  ↓ Browser redirect to GET /api/auth/google
[AuthGuard('google') redirects to Google consent screen]
  ↓
[User grants permission to share email + profile]
  ↓
[Google redirects to GET /api/auth/google/callback?code=...]
  ↓
[GoogleStrategy exchanges code for Google profile]
  ↓
[AuthService.googleLogin(profile)]
  ↓
[Find user by google_id; if not found, find by email]
  ↓
[If found: link google_id to existing user; if not found: create new user]
  ↓
[Sign JWT for user]
  ↓
[Redirect to http://localhost:5173/auth/callback?token=<jwt>]
  ↓
[pages/auth/callback.vue reads token from query string]
  ↓
[Store.setToken(token)]
  ↓ Save to localStorage + Pinia state
[Store.fetchMe()]
  ↓ GET /api/auth/me to rehydrate user
[Redirect to / (dashboard)]
```

### Protected API Endpoint

```
[Frontend: useFetch('/api/auth/me', { headers: { Authorization: 'Bearer <token>' } })]
  ↓
[AuthController.getMe()]
  ↓
[JwtAuthGuard validates Bearer token]
  ↓
[JwtStrategy extracts and validates token]
  ↓ Valid: injects { sub: user.id, email: user.email } into request
[AuthService.getMe(userId)]
  ↓
[Query users table by ID]
  ↓
[Return user object (password excluded via @Exclude() decorator)]
```

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | — | Secret key for signing JWTs (must be set) |
| `JWT_EXPIRATION` | `7d` | Token lifetime |
| `GOOGLE_CLIENT_ID` | — | Google OAuth app ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth app secret |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3000/api/auth/google/callback` | OAuth redirect URI |
| `FRONTEND_URL` | `http://localhost:5173` | CORS origin (for login redirects) |

### Google Cloud Setup

To use Google OAuth, you must:
1. Go to https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Enable "Google+ API"
4. Create an OAuth 2.0 credential (type: Web Application)
5. Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`

---

## Testing

### Unit Tests (Backend)

```bash
# Auth service
docker-compose exec backend npm test -- modules/auth/auth.service.spec.ts

# Strategies
docker-compose exec backend npm test -- modules/auth/strategies/
```

### E2E Tests

```bash
docker-compose exec backend npm run test:e2e
```

### Manual Testing

**Register via email + password:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "Password123"
  }'
```

**Login via email + password:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123"
  }'
```

**Get current user:**
```bash
TOKEN="<access_token from login>"
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

**Swagger UI:**
Open http://localhost:3000/api/docs, click "Authorize" button (top-right), enter Bearer token, then test endpoints.

---

## Related Decisions

- [ADR-001: JWT Authentication](../adr/001-jwt-auth.md)
- [ADR-002: Google OAuth 2.0](../adr/002-google-oauth.md)

---

## Known Issues & TODOs

- [x] Password reset — implementado (`/auth/recuperar`, ver arriba)
- [x] Email verification — implementada el 2026-08-15 (`correo_verificado_el`)
- [ ] "Keep session" checkbox on login page has no effect (always persists to localStorage)
- [x] Rotación de refresh token — rota desde antes, y desde el 2026-08-15 con canje atómico, lápidas y detección de reuso con ventana de gracia
- [ ] Google OAuth env vars not in docker-compose.yml (must set in `.env` manually)

---

## Links

- **API Docs**: http://localhost:3000/api/docs
- **Google OAuth Docs**: https://developers.google.com/identity/protocols/oauth2
