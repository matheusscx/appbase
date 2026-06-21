# Frontend — Flujo multi-tenant + base

**Fecha:** 2026-06-20
**Stack:** Nuxt 4 + @nuxt/ui + Pinia
**Alcance:** Conectar el frontend al backend multi-tenant (campo `tenant_id` + `es_superadmin` en JWT). NO incluye pantallas de gestión de tenants, roles ni RBAC — eso es un spec aparte.

---

## Contexto

El backend acaba de implementar un sistema completo de multi-tenant y RBAC (commits f912fda–28bdd75). El frontend solo tiene auth básico (login/register/Google) con la interfaz `User` en inglés (`name/email`) que ya no coincide con el backend nuevo (`nombre/correo/esSuperadmin`). Además, el registro manda campos en inglés (`name/email/password`) que el backend ya no acepta.

Tras login, el `access_token` sale con `tenant_id: null` y `es_superadmin: boolean`. El frontend necesita interpretar esos claims, obtener la lista de tenants del usuario, seleccionar uno, y emitir un segundo token via `POST /auth/switch-tenant` antes de entrar al dashboard.

---

## Fuente de verdad

El `access_token` (JWT) contiene `tenant_id` y `es_superadmin` en su payload. Son los valores de autoridad — el frontend los lee decodificando el segmento central del token con `atob` (sin verificar firma). Esto garantiza consistencia automática tras cada `switch-tenant` o `refresh`: basta re-decodificar el token nuevo.

Los nombres para mostrar en la UI (nombre del tenant activo, lista de tenants) se obtienen de `GET /auth/my-tenants` y se guardan en un store auxiliar de presentación.

---

## Contratos de API (endpoints usados)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/auth/login` | Body: `{ email, password }`. Res: `{ access_token, user }` + cookie `refresh_token` |
| `POST` | `/auth/register` | Body: `{ nombre, apellido?, correo, contrasena, nombreUsuario?, telefono? }`. Res: igual que login |
| `GET` | `/auth/me` | Bearer token. Res: entidad `Usuario` completa |
| `GET` | `/auth/my-tenants` | Bearer token. Res: `[{ tenantId: string, nombre: string }]` |
| `POST` | `/auth/switch-tenant` | Bearer token. Body: `{ tenantId: string }`. Res: `{ access_token }` + cookie nuevo |
| `POST` | `/auth/refresh` | Cookie. Res: `{ access_token }` + cookie nuevo |
| `POST` | `/auth/logout` | Cookie. Res: `{ message }` |

**Notas de contrato:**
- El `access_token` JWT tiene claims: `{ sub, email, tenant_id: string|null, es_superadmin: boolean, iat, exp }`.
- Tras `switch-tenant`, el nuevo token trae el `tenant_id` elegido.
- Tras `refresh`, el nuevo token preserva el `tenant_id` activo (guardado en `active_tenant_id` del refresh token en BD).
- `GET /auth/my-tenants` devuelve todos los tenants del usuario, sin importar el tenant activo del token.

---

## Arquitectura — módulos nuevos y modificados

### `composables/useJwt.ts` (nuevo)

Función pura `decodeJwt(token: string)` que decodifica el payload del JWT:

```ts
function decodeJwt(token: string): JwtPayload | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64)) as JwtPayload
  } catch {
    return null
  }
}

interface JwtPayload {
  sub: string
  email: string
  tenant_id: string | null
  es_superadmin: boolean
  iat: number
  exp: number
}
```

Token corrupto/indecodificable devuelve `null` → el consumidor trata la sesión como inválida → `clearAuth()` → `/login`.

### `stores/auth.ts` (actualizar)

Cambios respecto al estado actual:

1. **Interfaz `User`** → actualizar a:
   ```ts
   interface User {
     id: string
     nombre: string
     apellido: string | null
     correo: string
     esSuperadmin: boolean
     nombreUsuario: string | null
     creadoEl: string
   }
   ```

2. **`register()`** → cambiar body a `{ nombre, correo, contrasena }` (mínimo; apellido/nombreUsuario/telefono opcionales en el DTO pero no obligatorios en la pantalla inicial).

3. **Claims computados** (computed sobre `token.value`):
   ```ts
   const claims = computed(() => token.value ? decodeJwt(token.value) : null)
   const activeTenantId = computed(() => claims.value?.tenant_id ?? null)
   const isSuperadmin = computed(() => claims.value?.es_superadmin ?? false)
   ```

4. **Mantener** el `user` ref para datos de perfil (nombre, correo, etc.) poblado desde `fetchMe()`.

### `stores/tenant.ts` (nuevo)

Store de presentación — no es fuente de autoridad, solo datos para la UI:

```ts
export const useTenantStore = defineStore('tenant', () => {
  const tenants = ref<{ tenantId: string; nombre: string }[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // computed: cruza activeTenantId (del auth store) contra la lista
  const activeTenant = computed(() => {
    const auth = useAuthStore()
    return tenants.value.find(t => t.tenantId === auth.activeTenantId) ?? null
  })

  async function fetchMyTenants(): Promise<void>
  async function switchTenant(tenantId: string): Promise<void>

  return { tenants, loading, error, activeTenant, fetchMyTenants, switchTenant }
})
```

**`switchTenant(id)`**:
1. `POST /auth/switch-tenant { tenantId: id }` → `{ access_token }`.
2. `authStore.setToken(access_token)` → re-decodifica automáticamente.
3. `navigateTo('/dashboard')`.
4. Error 403 → toast de error, no navega.

---

## Flujo post-login

```
login() / register() / googleCallback()
  └─ setToken(access_token) — token con tenant_id=null
  └─ fetchMyTenants()
        ├─ 0 tenants → navigateTo('/no-tenant')
        ├─ 1 tenant  → switchTenant(id) → navigateTo('/dashboard')
        └─ >1 tenants → navigateTo('/select-tenant')

/select-tenant
  └─ muestra lista de tenants
  └─ usuario elige → switchTenant(id) → navigateTo('/dashboard')
```

---

## Páginas y componentes

### Páginas nuevas

**`pages/select-tenant.vue`**
- Requiere `auth` middleware (token presente) pero NO `tenant_id` en el token (puede ser null aquí).
- Muestra lista de tenants del usuario con nombre.
- Al elegir: llama `tenantStore.switchTenant(id)`.
- Si `tenantStore.loading` → spinner.
- Si `tenantStore.error` → mensaje + botón reintento.
- Si ya hay `activeTenantId` en el token → redirige a `/dashboard` (no volver aquí si ya tiene tenant).

**`pages/no-tenant.vue`**
- Sin middleware especial (solo que el token existe).
- Muestra: "No perteneces a ningún tenant. Contacta al administrador."
- Si `isSuperadmin` → muestra botón adicional "Ir a administración" → `/admin`.
- Sin acciones de cambio de tenant desde aquí.

### Componentes nuevos/modificados

**`components/TenantSwitcher.vue`** (nuevo)
- Dropdown que lista `tenantStore.tenants`.
- Resalta `tenantStore.activeTenant` como activo.
- Al elegir otro: `tenantStore.switchTenant(id)`.
- Si solo hay 1 tenant: muestra solo el nombre (sin dropdown).

**`components/AppNavbar.vue`** (modificar)
- Añadir `TenantSwitcher` junto al nombre de usuario.
- Si `isSuperadmin` → añadir enlace "Admin" → `/admin` (placeholder, ruta no existe todavía).

### Páginas existentes a corregir

**`pages/register.vue`**
- Campos actuales: `name/email/password` en inglés.
- Nuevos campos: `nombre` (obligatorio), `correo` (obligatorio), `contrasena` (obligatorio). `apellido` como opcional en la pantalla.

**`pages/login.vue`**
- Contrato de API no cambia (`email/password`).
- Ajustar el tipo del objeto `user` que llega (ahora es `nombre/correo/esSuperadmin`).
- Añadir flujo post-login: tras login exitoso, llamar `fetchMyTenants()` y redirigir según la lógica descrita.

**`pages/auth/callback.vue`** (OAuth Google)
- Aplica el mismo flujo post-login tras recibir el token.

### Dashboard mínimo

**`pages/index.vue`** / **`layouts/dashboard.vue`**
- Mostrar el nombre del `tenantStore.activeTenant` como prueba visual del flujo.
- Si el guard detecta `activeTenantId === null` → redirige a `/select-tenant`.

---

## Middleware de rutas

### `middleware/auth.ts` (extender)

Lógica actual: si no hay token → `/login`.

Nueva lógica para rutas de dashboard (todo menos `/login`, `/register`, `/select-tenant`, `/no-tenant`, `/admin/**`, `/auth/**`):

```
1. Sin token → /login
2. Con token pero tenant_id=null:
   a. fetchMyTenants (si lista no cargada)
   b. 0 tenants → /no-tenant
   c. 1 tenant → switchTenant(id) → continuar
   d. >1 tenants → /select-tenant
3. Con token y tenant_id presente → continuar
```

Rutas exentas del check tenant_id: `/select-tenant`, `/no-tenant`, `/admin/**` (las rutas admin tienen su propio guard futuro).

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| Token corrupto en `decodeJwt` | `clearAuth()` → `/login` |
| `my-tenants` falla red | Error visible en `/select-tenant` con botón reintento |
| `switch-tenant` 403 | Toast de error, permanece en la pantalla actual |
| `switch-tenant` red error | Toast de error, no navega |
| Token expirado (401) | `useApiFetch` ya maneja el refresh; si falla → `/login` |

---

## Testing (Vitest)

Instalar: `vitest`, `@nuxt/test-utils`, `@vue/test-utils`, `happy-dom`.

Unidades a testear:

| Test | Qué verifica |
|---|---|
| `useJwt.spec.ts` | `decodeJwt` con token válido, token corrupto, payload con `tenant_id: null` y con UUID |
| `stores/auth.spec.ts` | `activeTenantId` e `isSuperadmin` computados correctamente desde el token |
| `stores/tenant.spec.ts` | `activeTenant` cruza bien `activeTenantId` contra la lista; `switchTenant` navega tras éxito |
| `middleware/auth.spec.ts` | Las 4 ramas del middleware (sin token, null tenant, 0/1/>1 tenants) |

No se incluyen tests de componentes visuales ni E2E en este plan — la verificación manual del flujo completo vía `docker-compose up` cubre eso.

---

## Decisiones explícitas

- **Decodificar JWT en cliente:** sin librería externa — `atob` nativo es suficiente para leer claims (no se necesita verificar firma, eso lo hace el backend).
- **`stores/tenant.ts` es de presentación, no de autoridad:** el `activeTenantId` vive siempre en el token; el store solo guarda nombres y la lista.
- **Register simplificado:** la pantalla pide solo `nombre/correo/contrasena`. Los campos opcionales del DTO (`apellido`, `nombreUsuario`, `telefono`) no se incluyen en la pantalla de registro inicial.
- **Pantallas admin excluidas de este spec:** `/admin` es un placeholder. El plan de gestión de tenants y superadmin es un spec aparte.
- **Sin paginación ni búsqueda en el selector de tenants:** YAGNI — en este estado del proyecto ningún usuario tendrá más de unos pocos tenants.
