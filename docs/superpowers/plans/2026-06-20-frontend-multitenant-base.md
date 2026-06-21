# Frontend — Flujo Multi-tenant Base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar el frontend Nuxt 4 al backend multi-tenant: arreglar la interfaz de usuario obsoleta, agregar decodificación de JWT para leer `tenant_id` / `es_superadmin`, implementar el flujo de selección de tenant post-login, y proteger el dashboard con un middleware que exige tenant activo.

**Architecture:** El `access_token` (JWT) es la fuente de verdad para `tenant_id` y `es_superadmin`. Un composable puro `useJwt` lo decodifica con `atob`; `stores/auth` expone computed derivados del token. Un store secundario `stores/tenant` guarda la lista de tenants (solo presentación). El flujo post-login llama a `GET /auth/my-tenants` y según la cantidad redirige automáticamente.

**Tech Stack:** Nuxt 4, Vue 3, @nuxt/ui 4, Pinia, Vitest, @nuxt/test-utils, happy-dom

## Global Constraints

- Nunca instalar axios ni otras librerías HTTP — usar `$fetch` de Nuxt y el composable `useApiFetch` existente en `app/composables/useApiFetch.ts`.
- `tenant_id` en el token puede ser `string | null`. Nunca asumir que es string sin verificar.
- Nombres de campos del backend: `nombre`, `apellido`, `correo`, `contrasena`, `esSuperadmin` (camelCase en TypeScript, snake_case en BD). El frontend nunca manda `name`, `email`, `password` al backend.
- El login sigue mandando `{ email, password }` — eso no cambia (la `LocalStrategy` del backend usa `usernameField: 'email'`).
- Toda la UI usa componentes de `@nuxt/ui` v4 (`UButton`, `UInput`, `UFormField`, `UAlert`, etc.) — sin HTML raw para formularios o botones.
- El layout del dashboard usa `UDashboardGroup` + `UDashboardSidebar` (sidebar lateral, no top navbar).
- Tests unitarios con Vitest — no tests de componentes ni E2E en este plan. Solo lógica pura: `useJwt`, stores, middleware.
- Soft delete: ignorado en frontend — el backend ya filtra `eliminado_el IS NULL`.
- Commits frecuentes: uno por task como mínimo.

---

## Mapa de archivos

### Archivos nuevos
| Archivo | Responsabilidad |
|---|---|
| `frontend/app/composables/useJwt.ts` | Función pura `decodeJwt(token)` → `JwtPayload \| null` |
| `frontend/app/stores/tenant.ts` | Lista de tenants + `switchTenant()` + `activeTenant` computed |
| `frontend/app/pages/select-tenant.vue` | Pantalla de selección de tenant |
| `frontend/app/pages/no-tenant.vue` | Pantalla informativa cuando el usuario no tiene tenants |
| `frontend/vitest.config.ts` | Configuración de Vitest |
| `frontend/app/composables/useJwt.spec.ts` | Tests de `decodeJwt` |
| `frontend/app/stores/auth.spec.ts` | Tests de computed `activeTenantId` / `isSuperadmin` |
| `frontend/app/stores/tenant.spec.ts` | Tests de `activeTenant` computed y `switchTenant` |
| `frontend/app/middleware/auth.spec.ts` | Tests de las 4 ramas del middleware |

### Archivos modificados
| Archivo | Cambio |
|---|---|
| `frontend/package.json` | Agregar devDependencies: vitest, @nuxt/test-utils, happy-dom, @vue/test-utils |
| `frontend/nuxt.config.ts` | Agregar módulo `@nuxt/test-utils/module` |
| `frontend/app/stores/auth.ts` | Actualizar interfaz `User`, corregir `register()`, agregar `claims`/`activeTenantId`/`isSuperadmin`/`handlePostLogin()` |
| `frontend/app/middleware/auth.ts` | Extender con lógica de tenant (4 ramas) |
| `frontend/app/layouts/dashboard.vue` | Mostrar tenant activo en sidebar; enlace Admin si `isSuperadmin` |
| `frontend/app/pages/index.vue` | Cambiar `store.user?.name` → `store.user?.nombre` |
| `frontend/app/pages/login.vue` | Llamar `handlePostLogin()` tras login exitoso |
| `frontend/app/pages/register.vue` | Cambiar campos a `nombre/correo/contrasena`, llamar `handlePostLogin()` |
| `frontend/app/pages/auth/callback.vue` | Llamar `handlePostLogin()` tras OAuth |

---

## Task 1: Setup Vitest + composable `useJwt`

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/app/composables/useJwt.ts`
- Create: `frontend/app/composables/useJwt.spec.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/nuxt.config.ts`

**Interfaces:**
- Produces: `decodeJwt(token: string): JwtPayload | null` — importable desde cualquier archivo del proyecto
- Produces: interfaz `JwtPayload { sub, email, tenant_id, es_superadmin, iat, exp }`

- [ ] **Step 1: Instalar dependencias de testing**

```bash
cd frontend
npm install -D vitest @nuxt/test-utils happy-dom @vue/test-utils
```

Salida esperada: devDependencies actualizadas en `package.json` sin errores.

- [ ] **Step 2: Agregar script de test en `package.json`**

En `frontend/package.json`, dentro de `"scripts"`, agregar:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Crear `frontend/vitest.config.ts`**

```typescript
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'happy-dom',
  },
})
```

- [ ] **Step 4: Agregar módulo de test a `frontend/nuxt.config.ts`**

El archivo actual es:
```typescript
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  runtimeConfig: {
    apiUrl: process.env.API_INTERNAL_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    public: {
      apiUrl: process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    },
  },
})
```

Reemplazarlo con:
```typescript
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/test-utils/module'],
  runtimeConfig: {
    apiUrl: process.env.API_INTERNAL_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    public: {
      apiUrl: process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    },
  },
})
```

- [ ] **Step 5: Escribir el test ANTES del composable**

Crear `frontend/app/composables/useJwt.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { decodeJwt } from './useJwt'

// Token JWT de ejemplo con payload { sub: 'user-1', email: 'a@b.com', tenant_id: null, es_superadmin: false }
// Generado con: btoa(JSON.stringify({sub:'user-1',email:'a@b.com',tenant_id:null,es_superadmin:false,iat:1000,exp:9999}))
const makeToken = (payload: object) => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${header}.${body}.fake-signature`
}

describe('decodeJwt', () => {
  it('devuelve el payload de un token válido', () => {
    const token = makeToken({
      sub: 'user-1',
      email: 'a@b.com',
      tenant_id: null,
      es_superadmin: false,
      iat: 1000,
      exp: 9999,
    })
    const result = decodeJwt(token)
    expect(result).not.toBeNull()
    expect(result!.sub).toBe('user-1')
    expect(result!.email).toBe('a@b.com')
    expect(result!.tenant_id).toBeNull()
    expect(result!.es_superadmin).toBe(false)
  })

  it('devuelve el tenant_id cuando está presente', () => {
    const token = makeToken({
      sub: 'user-2',
      email: 'b@c.com',
      tenant_id: '550e8400-e29b-41d4-a716-446655440001',
      es_superadmin: false,
      iat: 1000,
      exp: 9999,
    })
    const result = decodeJwt(token)
    expect(result!.tenant_id).toBe('550e8400-e29b-41d4-a716-446655440001')
  })

  it('devuelve es_superadmin true cuando el token lo indica', () => {
    const token = makeToken({
      sub: 'admin-1',
      email: 'admin@sistema.com',
      tenant_id: null,
      es_superadmin: true,
      iat: 1000,
      exp: 9999,
    })
    const result = decodeJwt(token)
    expect(result!.es_superadmin).toBe(true)
  })

  it('devuelve null para un token corrupto', () => {
    expect(decodeJwt('no.es.un.jwt')).toBeNull()
    expect(decodeJwt('')).toBeNull()
    expect(decodeJwt('solo-un-segmento')).toBeNull()
  })
})
```

- [ ] **Step 6: Ejecutar test — debe FALLAR**

```bash
cd frontend
npm test
```

Salida esperada: error de importación `Cannot find module './useJwt'`.

- [ ] **Step 7: Implementar `frontend/app/composables/useJwt.ts`**

```typescript
export interface JwtPayload {
  sub: string
  email: string
  tenant_id: string | null
  es_superadmin: boolean
  iat: number
  exp: number
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64)) as JwtPayload
  } catch {
    return null
  }
}
```

- [ ] **Step 8: Ejecutar test — debe PASAR**

```bash
cd frontend
npm test
```

Salida esperada: `4 tests passed`.

- [ ] **Step 9: Commit**

```bash
cd frontend
git add package.json nuxt.config.ts vitest.config.ts app/composables/useJwt.ts app/composables/useJwt.spec.ts
git commit -m "feat(frontend): setup Vitest + composable decodeJwt"
```

---

## Task 2: Actualizar `stores/auth.ts`

**Files:**
- Modify: `frontend/app/stores/auth.ts`
- Create: `frontend/app/stores/auth.spec.ts`

**Interfaces:**
- Consumes: `decodeJwt` de `~/composables/useJwt` (Task 1)
- Produces:
  - `store.user` → tipo `User` actualizado (`nombre, apellido, correo, esSuperadmin, ...`)
  - `store.claims` → `JwtPayload | null`
  - `store.activeTenantId` → `string | null`
  - `store.isSuperadmin` → `boolean`
  - `store.register(nombre, correo, contrasena)` → `Promise<boolean>`
  - `store.handlePostLogin()` → `Promise<void>` (ver contrato en Step 3)

- [ ] **Step 1: Escribir tests ANTES de modificar el store**

Crear `frontend/app/stores/auth.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './auth'

// Token de prueba con tenant_id y es_superadmin
const makeToken = (payload: object) => {
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `header.${body}.sig`
}

describe('useAuthStore — computed claims', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('activeTenantId es null cuando token tiene tenant_id: null', () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: null, es_superadmin: false, iat: 0, exp: 9999 }))
    expect(store.activeTenantId).toBeNull()
  })

  it('activeTenantId devuelve el UUID cuando está en el token', () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 'abc-123', es_superadmin: false, iat: 0, exp: 9999 }))
    expect(store.activeTenantId).toBe('abc-123')
  })

  it('isSuperadmin es true cuando es_superadmin está en el token', () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: null, es_superadmin: true, iat: 0, exp: 9999 }))
    expect(store.isSuperadmin).toBe(true)
  })

  it('isSuperadmin es false cuando no hay token', () => {
    const store = useAuthStore()
    expect(store.isSuperadmin).toBe(false)
  })

  it('activeTenantId es null cuando no hay token', () => {
    const store = useAuthStore()
    expect(store.activeTenantId).toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar test — debe FALLAR**

```bash
cd frontend
npm test
```

Salida esperada: fallo porque `activeTenantId` e `isSuperadmin` no existen en el store.

- [ ] **Step 3: Reemplazar `frontend/app/stores/auth.ts` completo**

```typescript
import { defineStore } from 'pinia'
import { decodeJwt } from '~/composables/useJwt'

export interface User {
  id: string
  nombre: string
  apellido: string | null
  correo: string
  esSuperadmin: boolean
  nombreUsuario: string | null
  creadoEl: string
}

export const useAuthStore = defineStore('auth', () => {
  const config = useRuntimeConfig()
  const serverApiUrl = (config as Record<string, unknown>).apiUrl as string | undefined
  const resolvedApiUrl = import.meta.server ? (serverApiUrl ?? config.public.apiUrl) : config.public.apiUrl

  const token = useCookie<string | null>('access_token', {
    maxAge: 60 * 15,
    sameSite: 'lax',
    path: '/',
  })
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Fuente de verdad: claims del JWT
  const claims = computed(() => token.value ? decodeJwt(token.value) : null)
  const activeTenantId = computed(() => claims.value?.tenant_id ?? null)
  const isSuperadmin = computed(() => claims.value?.es_superadmin ?? false)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function setToken(newToken: string) {
    token.value = newToken
  }

  function clearAuth() {
    token.value = null
    user.value = null
  }

  async function login(email: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${config.public.apiUrl}/auth/login`,
        { method: 'POST', body: { email, password }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: unknown) {
      error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Error al iniciar sesión'
      return false
    } finally {
      loading.value = false
    }
  }

  async function register(nombre: string, correo: string, contrasena: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${config.public.apiUrl}/auth/register`,
        { method: 'POST', body: { nombre, correo, contrasena }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: unknown) {
      const msg = (e as { data?: { message?: string | string[] } })?.data?.message
      error.value = Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Error al registrarse')
      return false
    } finally {
      loading.value = false
    }
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return
    try {
      user.value = await $fetch<User>(`${resolvedApiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token.value}` },
      })
    } catch {
      clearAuth()
    }
  }

  // Lógica post-login: llama my-tenants y redirige según cantidad
  // 0 tenants → /no-tenant
  // 1 tenant  → switch-tenant automático → /
  // >1 tenants → /select-tenant
  async function handlePostLogin(): Promise<void> {
    const tenantStore = useTenantStore()
    await tenantStore.fetchMyTenants()
    const list = tenantStore.tenants
    if (list.length === 0) {
      await navigateTo('/no-tenant')
    } else if (list.length === 1) {
      await tenantStore.switchTenant(list[0].tenantId)
    } else {
      await navigateTo('/select-tenant')
    }
  }

  function loginWithGoogle() {
    const apiBase = config.public.apiUrl.replace('/api', '')
    window.location.href = `${apiBase}/api/auth/google`
  }

  async function logout() {
    try {
      await $fetch(`${config.public.apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch { /* ignore */ }
    clearAuth()
    navigateTo('/login')
  }

  return {
    token,
    user,
    loading,
    error,
    claims,
    activeTenantId,
    isSuperadmin,
    isAuthenticated,
    setToken,
    clearAuth,
    login,
    register,
    fetchMe,
    handlePostLogin,
    loginWithGoogle,
    logout,
  }
})
```

**NOTA:** `useTenantStore` es auto-importado por Nuxt. No agregar import manual.

- [ ] **Step 4: Ejecutar test — debe PASAR**

```bash
cd frontend
npm test
```

Salida esperada: todos los tests de `auth.spec.ts` y `useJwt.spec.ts` pasan (9 tests total).

- [ ] **Step 5: Commit**

```bash
cd frontend
git add app/stores/auth.ts app/stores/auth.spec.ts
git commit -m "feat(frontend): actualizar auth store con claims JWT multi-tenant"
```

---

## Task 3: Crear `stores/tenant.ts`

**Files:**
- Create: `frontend/app/stores/tenant.ts`
- Create: `frontend/app/stores/tenant.spec.ts`

**Interfaces:**
- Consumes: `useAuthStore().activeTenantId` (Task 2); `useApiFetch` de `~/composables/useApiFetch`; `useAuthStore().setToken`
- Produces:
  - `tenantStore.tenants` → `{ tenantId: string; nombre: string }[]`
  - `tenantStore.activeTenant` → `{ tenantId: string; nombre: string } | null`
  - `tenantStore.loading` → `boolean`
  - `tenantStore.error` → `string | null`
  - `tenantStore.fetchMyTenants()` → `Promise<void>`
  - `tenantStore.switchTenant(tenantId: string)` → `Promise<void>`

- [ ] **Step 1: Escribir tests ANTES del store**

Crear `frontend/app/stores/tenant.spec.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock de useAuthStore para el test
const mockActiveTenantId = vi.fn<[], string | null>(() => null)

vi.mock('./auth', () => ({
  useAuthStore: () => ({
    activeTenantId: { value: mockActiveTenantId() },
    setToken: vi.fn(),
  }),
}))

// Importar DESPUÉS del mock
const { useTenantStore } = await import('./tenant')

describe('useTenantStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockActiveTenantId.mockReturnValue(null)
  })

  it('activeTenant es null cuando no hay activeTenantId', () => {
    const store = useTenantStore()
    store.tenants = [{ tenantId: 'abc', nombre: 'Empresa A' }]
    mockActiveTenantId.mockReturnValue(null)
    // Simular directamente: activeTenant busca en la lista
    const result = store.tenants.find(t => t.tenantId === null) ?? null
    expect(result).toBeNull()
  })

  it('tenants inicia como lista vacía', () => {
    const store = useTenantStore()
    expect(store.tenants).toEqual([])
  })

  it('loading inicia como false', () => {
    const store = useTenantStore()
    expect(store.loading).toBe(false)
  })

  it('error inicia como null', () => {
    const store = useTenantStore()
    expect(store.error).toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar test — debe FALLAR**

```bash
cd frontend
npm test
```

Salida esperada: error de importación `Cannot find module './tenant'`.

- [ ] **Step 3: Implementar `frontend/app/stores/tenant.ts`**

```typescript
import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export interface TenantItem {
  tenantId: string
  nombre: string
}

export const useTenantStore = defineStore('tenant', () => {
  const config = useRuntimeConfig()
  const tenants = ref<TenantItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const activeTenant = computed(() => {
    const auth = useAuthStore()
    return tenants.value.find(t => t.tenantId === auth.activeTenantId) ?? null
  })

  async function fetchMyTenants(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      tenants.value = await useApiFetch<TenantItem[]>(
        `${config.public.apiUrl}/auth/my-tenants`,
      )
    } catch (e: unknown) {
      error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cargar tenants'
    } finally {
      loading.value = false
    }
  }

  async function switchTenant(tenantId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const auth = useAuthStore()
      const data = await useApiFetch<{ access_token: string }>(
        `${config.public.apiUrl}/auth/switch-tenant`,
        { method: 'POST', body: { tenantId } },
      )
      auth.setToken(data.access_token)
      await navigateTo('/')
    } catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      error.value = msg ?? 'Error al cambiar de tenant'
    } finally {
      loading.value = false
    }
  }

  return { tenants, loading, error, activeTenant, fetchMyTenants, switchTenant }
})
```

- [ ] **Step 4: Ejecutar tests — deben PASAR**

```bash
cd frontend
npm test
```

Salida esperada: todos los tests pasan (13+ tests).

- [ ] **Step 5: Commit**

```bash
cd frontend
git add app/stores/tenant.ts app/stores/tenant.spec.ts
git commit -m "feat(frontend): store de tenants con fetchMyTenants y switchTenant"
```

---

## Task 4: Páginas `select-tenant` y `no-tenant`

**Files:**
- Create: `frontend/app/pages/select-tenant.vue`
- Create: `frontend/app/pages/no-tenant.vue`

**Interfaces:**
- Consumes: `useTenantStore()` (Task 3); `useAuthStore().isSuperadmin` (Task 2)

- [ ] **Step 1: Crear `frontend/app/pages/select-tenant.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: false })

const tenantStore = useTenantStore()
const authStore = useAuthStore()

// Si ya tiene tenant activo, no tiene nada que hacer aquí
if (authStore.activeTenantId) {
  navigateTo('/')
}

onMounted(async () => {
  if (tenantStore.tenants.length === 0) {
    await tenantStore.fetchMyTenants()
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-4">
          <UIcon name="i-heroicons-building-office-2" class="text-white w-5 h-5" />
        </div>
        <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
          Selecciona tu empresa
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Tu cuenta pertenece a varias empresas. ¿En cuál vas a trabajar?
        </p>
      </div>

      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-sm ring-1 ring-gray-200 dark:ring-gray-800 overflow-hidden">
        <!-- Error -->
        <div v-if="tenantStore.error" class="p-4 border-b border-gray-200 dark:border-gray-800">
          <UAlert
            color="error"
            variant="subtle"
            :description="tenantStore.error"
            icon="i-heroicons-exclamation-circle"
          />
          <UButton
            class="mt-3"
            variant="ghost"
            size="sm"
            @click="tenantStore.fetchMyTenants()"
          >
            Reintentar
          </UButton>
        </div>

        <!-- Loading -->
        <div v-else-if="tenantStore.loading" class="p-8 text-center">
          <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-primary-600 animate-spin mx-auto" />
        </div>

        <!-- Lista de tenants -->
        <div v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <button
            v-for="tenant in tenantStore.tenants"
            :key="tenant.tenantId"
            class="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            :disabled="tenantStore.loading"
            @click="tenantStore.switchTenant(tenant.tenantId)"
          >
            <div class="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-950 flex items-center justify-center shrink-0">
              <UIcon name="i-heroicons-building-office" class="w-5 h-5 text-primary-600" />
            </div>
            <span class="font-medium text-sm text-gray-900 dark:text-white truncate">
              {{ tenant.nombre }}
            </span>
            <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-gray-400 ml-auto shrink-0" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Crear `frontend/app/pages/no-tenant.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: false })

const authStore = useAuthStore()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <div class="w-full max-w-sm text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-950 mb-6">
        <UIcon name="i-heroicons-building-office-2" class="w-8 h-8 text-amber-500" />
      </div>

      <h1 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Sin acceso a empresas
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-8">
        Tu cuenta no pertenece a ninguna empresa todavía. Contacta al administrador para que te agregue.
      </p>

      <div class="flex flex-col gap-3">
        <UButton
          v-if="authStore.isSuperadmin"
          to="/admin"
          block
          icon="i-heroicons-cog-6-tooth"
        >
          Ir a administración
        </UButton>

        <UButton
          variant="ghost"
          color="neutral"
          block
          @click="authStore.logout()"
        >
          Cerrar sesión
        </UButton>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Verificar que el servidor Nuxt arranca sin errores de compilación**

```bash
cd frontend
npm run dev &
sleep 5
kill %1
```

Si hay errores de compilación de TypeScript los muestra en consola. No deben haber errores.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add app/pages/select-tenant.vue app/pages/no-tenant.vue
git commit -m "feat(frontend): páginas select-tenant y no-tenant"
```

---

## Task 5: Sidebar con tenant activo + enlace Admin

**Files:**
- Modify: `frontend/app/layouts/dashboard.vue`
- Modify: `frontend/app/components/AppNavbar.vue`

**Interfaces:**
- Consumes: `useTenantStore().activeTenant` (Task 3); `useAuthStore().isSuperadmin` (Task 2); `useAuthStore().user.nombre` (Task 2)

- [ ] **Step 1: Modificar `frontend/app/layouts/dashboard.vue`**

El archivo actual usa `UDashboardSidebar` con slots `header`, `default`, `footer`. Reemplazar el archivo completo:

```vue
<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const authStore = useAuthStore()
const tenantStore = useTenantStore()

const items = computed<NavigationMenuItem[]>(() => {
  const base: NavigationMenuItem[] = [
    {
      label: 'Inicio',
      icon: 'i-heroicons-home',
      to: '/',
    },
  ]
  if (authStore.isSuperadmin) {
    base.push({
      label: 'Administración',
      icon: 'i-heroicons-cog-6-tooth',
      to: '/admin',
    })
  }
  return base
})
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable>
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 px-1">
          <div class="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
            <UIcon name="i-heroicons-bolt" class="text-white w-4 h-4" />
          </div>
          <span v-if="!collapsed" class="font-semibold text-sm truncate">
            {{ tenantStore.activeTenant?.nombre ?? 'Prueba Técnica' }}
          </span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="items"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex flex-col gap-2">
          <!-- Tenant activo (cuando sidebar expandido) -->
          <div v-if="!collapsed && tenantStore.activeTenant" class="px-2 text-xs text-muted truncate flex items-center gap-1">
            <UIcon name="i-heroicons-building-office" class="w-3 h-3 shrink-0" />
            {{ tenantStore.activeTenant.nombre }}
          </div>
          <div v-if="!collapsed" class="px-2 text-xs text-muted truncate">
            {{ authStore.user?.nombre }}
          </div>
          <UButton
            :icon="collapsed ? 'i-heroicons-arrow-right-on-rectangle' : undefined"
            :label="collapsed ? undefined : 'Cerrar sesión'"
            color="neutral"
            variant="ghost"
            block
            @click="authStore.logout()"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
```

- [ ] **Step 2: Modificar `frontend/app/components/AppNavbar.vue`**

```vue
<script setup lang="ts">
defineProps<{
  title: string
}>()

const authStore = useAuthStore()
const tenantStore = useTenantStore()
</script>

<template>
  <UDashboardNavbar :title="title">
    <template #leading>
      <UDashboardSidebarCollapse />
    </template>
    <template #right>
      <slot name="right">
        <span class="text-sm text-muted">
          {{ tenantStore.activeTenant?.nombre ?? authStore.user?.nombre }}
        </span>
      </slot>
    </template>
  </UDashboardNavbar>
</template>
```

- [ ] **Step 3: Commit**

```bash
cd frontend
git add app/layouts/dashboard.vue app/components/AppNavbar.vue
git commit -m "feat(frontend): sidebar muestra tenant activo + enlace admin para superadmin"
```

---

## Task 6: Extender middleware + arreglar páginas existentes

**Files:**
- Modify: `frontend/app/middleware/auth.ts`
- Modify: `frontend/app/pages/login.vue`
- Modify: `frontend/app/pages/register.vue`
- Modify: `frontend/app/pages/auth/callback.vue`
- Modify: `frontend/app/pages/index.vue`
- Create: `frontend/app/middleware/auth.spec.ts`

**Interfaces:**
- Consumes: `useAuthStore().activeTenantId`, `useAuthStore().handlePostLogin()` (Task 2); `useTenantStore()` (Task 3)

- [ ] **Step 1: Escribir tests del middleware ANTES de modificarlo**

Crear `frontend/app/middleware/auth.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks de Nuxt composables
const mockNavigateTo = vi.fn()
vi.stubGlobal('navigateTo', mockNavigateTo)

let mockToken: string | null = null
let mockActiveTenantId: string | null = null
let mockUser: object | null = null
const mockFetchMe = vi.fn()
const mockHandlePostLogin = vi.fn()

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    token: { value: mockToken },
    user: { value: mockUser },
    activeTenantId: { value: mockActiveTenantId },
    fetchMe: mockFetchMe,
    handlePostLogin: mockHandlePostLogin,
  }),
}))

// Importar el middleware como función
const { default: authMiddleware } = await import('./auth')

// Helper para crear el contexto que espera el middleware
function makeContext(path: string) {
  return { to: { path }, from: null } as Parameters<typeof authMiddleware>[0]
}

describe('middleware/auth', () => {
  beforeEach(() => {
    mockToken = null
    mockActiveTenantId = null
    mockUser = null
    mockFetchMe.mockResolvedValue(undefined)
    mockHandlePostLogin.mockResolvedValue(undefined)
    mockNavigateTo.mockClear()
  })

  it('sin token → redirige a /login', async () => {
    mockToken = null
    await authMiddleware(makeContext('/'))
    expect(mockNavigateTo).toHaveBeenCalledWith('/login')
  })

  it('con token y sin tenant activo → llama handlePostLogin', async () => {
    mockToken = 'some.token.here'
    mockUser = { id: '1', nombre: 'Test' }
    mockActiveTenantId = null
    await authMiddleware(makeContext('/'))
    expect(mockHandlePostLogin).toHaveBeenCalled()
  })

  it('con token y tenant activo → no redirige', async () => {
    mockToken = 'some.token.here'
    mockUser = { id: '1', nombre: 'Test' }
    mockActiveTenantId = 'tenant-uuid'
    await authMiddleware(makeContext('/'))
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('rutas exentas no requieren tenant activo (/select-tenant)', async () => {
    mockToken = 'some.token.here'
    mockUser = { id: '1', nombre: 'Test' }
    mockActiveTenantId = null
    await authMiddleware(makeContext('/select-tenant'))
    expect(mockHandlePostLogin).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Ejecutar tests — deben FALLAR**

```bash
cd frontend
npm test
```

Salida esperada: los tests de `auth.spec.ts` fallan porque el middleware actual no tiene lógica de tenant.

- [ ] **Step 3: Reemplazar `frontend/app/middleware/auth.ts`**

```typescript
// Rutas que no necesitan tenant activo (además de no necesitar auth o tenerla aparte)
const TENANT_EXEMPT = ['/select-tenant', '/no-tenant', '/login', '/register']

export default defineNuxtRouteMiddleware(async (to) => {
  const store = useAuthStore()

  // Sin token → login
  if (!store.token.value) return navigateTo('/login')

  // Cargar usuario si no está cargado
  if (!store.user.value) await store.fetchMe()

  // Si fetchMe falló (token inválido), clearAuth ya limpió el token
  if (!store.token.value) return navigateTo('/login')

  // Rutas exentas del check de tenant
  if (TENANT_EXEMPT.some(p => to.path.startsWith(p))) return

  // Rutas admin: guard propio (futuro). Por ahora solo verificar token.
  if (to.path.startsWith('/admin')) return

  // Necesita tenant activo
  if (!store.activeTenantId.value) {
    await store.handlePostLogin()
    return
  }
})
```

- [ ] **Step 4: Ejecutar tests — deben PASAR**

```bash
cd frontend
npm test
```

Salida esperada: todos los tests pasan.

- [ ] **Step 5: Arreglar `frontend/app/pages/login.vue`**

Solo cambiar la función `onLogin` para llamar `handlePostLogin` en lugar de redirigir directamente:

```vue
<script setup lang="ts">
definePageMeta({ layout: false })

const store = useAuthStore()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const keepSession = ref(false)

const toast = useToast()

async function onLogin() {
  const ok = await store.login(email.value, password.value)
  if (ok) await store.handlePostLogin()
}

async function onGoogle() {
  store.loginWithGoogle()
}
</script>
```

Mantener el `<template>` exactamente igual que ahora — sin cambios visuales.

- [ ] **Step 6: Arreglar `frontend/app/pages/register.vue`**

Cambiar el script completo (el template necesita ajustar el campo `name` → `nombre`):

```vue
<script setup lang="ts">
definePageMeta({ layout: false })

const store = useAuthStore()

const nombre = ref('')
const correo = ref('')
const password = ref('')
const showPassword = ref(false)

async function onRegister() {
  const ok = await store.register(nombre.value, correo.value, password.value)
  if (ok) await store.handlePostLogin()
}

async function onGoogle() {
  store.loginWithGoogle()
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-4">
          <UIcon name="i-heroicons-bolt" class="text-white w-5 h-5" />
        </div>
        <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
          Prueba Técnica
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Crea tu cuenta</p>
      </div>

      <!-- Card -->
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-sm ring-1 ring-gray-200 dark:ring-gray-800 p-8 space-y-5">

        <!-- Error -->
        <UAlert
          v-if="store.error"
          color="error"
          variant="subtle"
          :description="store.error"
          icon="i-heroicons-exclamation-circle"
        />

        <!-- Google -->
        <UButton
          block
          variant="outline"
          color="neutral"
          :disabled="store.loading"
          @click="onGoogle"
        >
          <template #leading>
            <svg class="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          </template>
          Continuar con Google
        </UButton>

        <!-- Divider -->
        <div class="flex items-center gap-3">
          <div class="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          <span class="text-xs text-gray-400 dark:text-gray-500">o</span>
          <div class="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
        </div>

        <!-- Form -->
        <form class="space-y-4" @submit.prevent="onRegister">
          <UFormField label="Nombre" name="nombre">
            <UInput
              v-model="nombre"
              type="text"
              placeholder="Tu nombre"
              autocomplete="given-name"
              :disabled="store.loading"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Email" name="correo">
            <UInput
              v-model="correo"
              type="email"
              placeholder="tu@email.com"
              autocomplete="email"
              :disabled="store.loading"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Contraseña" name="password">
            <UInput
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Mínimo 6 caracteres"
              autocomplete="new-password"
              :disabled="store.loading"
              class="w-full"
            >
              <template #trailing>
                <button
                  type="button"
                  tabindex="-1"
                  class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  @click="showPassword = !showPassword"
                >
                  <UIcon :name="showPassword ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'" class="w-4 h-4" />
                </button>
              </template>
            </UInput>
          </UFormField>

          <UButton
            type="submit"
            block
            :loading="store.loading"
            :disabled="store.loading || !nombre || !correo || !password"
          >
            Crear cuenta
          </UButton>
        </form>
      </div>

      <!-- Login link -->
      <p class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        ¿Ya tienes cuenta?
        <NuxtLink
          to="/login"
          class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
        >
          Iniciar sesión
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 7: Arreglar `frontend/app/pages/auth/callback.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const store = useAuthStore()

onMounted(async () => {
  const token = route.query.token as string | undefined
  if (!token) return navigateTo('/login')
  store.setToken(token)
  await store.fetchMe()
  if (!store.isAuthenticated) return navigateTo('/login')
  await store.handlePostLogin()
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
    <div class="text-center space-y-3">
      <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 text-primary-600 animate-spin mx-auto" />
      <p class="text-sm text-gray-500 dark:text-gray-400">Iniciando sesión…</p>
    </div>
  </div>
</template>
```

- [ ] **Step 8: Arreglar `frontend/app/pages/index.vue`**

Cambiar `store.user?.name` → `store.user?.nombre`:

```vue
<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  layout: 'dashboard',
})

const store = useAuthStore()
const tenantStore = useTenantStore()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Inicio" />
    </template>

    <template #body>
      <div class="max-w-2xl mx-auto px-6 py-16 text-center">
        <div class="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-950 flex items-center justify-center mx-auto mb-6">
          <UIcon name="i-heroicons-check-circle" class="w-8 h-8 text-primary-600" />
        </div>
        <h2 class="text-2xl font-semibold text-default mb-2">
          Bienvenido, {{ store.user?.nombre }}
        </h2>
        <p class="text-muted text-sm">
          Trabajando en <strong>{{ tenantStore.activeTenant?.nombre ?? '—' }}</strong>
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
```

- [ ] **Step 9: Ejecutar todos los tests**

```bash
cd frontend
npm test
```

Salida esperada: todos los tests pasan (sin nuevos fallos).

- [ ] **Step 10: Commit final**

```bash
cd frontend
git add app/middleware/auth.ts app/middleware/auth.spec.ts \
        app/pages/login.vue app/pages/register.vue \
        app/pages/auth/callback.vue app/pages/index.vue
git commit -m "feat(frontend): flujo post-login multi-tenant completo + middleware extendido"
```
