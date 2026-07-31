import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

// Mock the virtual module paths that Nuxt uses for auto-imports.
// These are resolved by Nuxt's Vite plugins in the real app but need
// explicit mocking in unit tests that run outside a Nuxt context.
vi.mock('#app/nuxt', () => ({
  useNuxtApp: vi.fn(),
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
  defineNuxtPlugin: vi.fn(),
  definePayloadPlugin: vi.fn(),
  defineAppConfig: vi.fn(),
  tryUseNuxtApp: vi.fn(),
}))

vi.mock('#app/composables/cookie', () => ({
  useCookie: vi.fn((_name: string, _opts?: unknown) => ref<string | null>(null)),
  refreshCookie: vi.fn(),
}))

vi.mock('#app/composables/router', () => ({
  navigateTo: vi.fn(),
  useRoute: vi.fn(),
  useRouter: vi.fn(),
  abortNavigation: vi.fn(),
  addRouteMiddleware: vi.fn(),
  defineNuxtRouteMiddleware: vi.fn(),
  setPageLayout: vi.fn(),
}))

vi.stubGlobal('$fetch', vi.fn())

import { useAuthStore } from './auth'

// El tipo de rutas de `$fetch` (Nuxt) dispara TS2321 (recursión de tipos) al pasar por
// vi.mocked; en el test lo tratamos como un mock plano.
const $fetchMock = vi.mocked($fetch as unknown as (...args: unknown[]) => Promise<unknown>)

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

describe('useAuthStore — mensajes de error del login público', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    $fetchMock.mockReset()
  })

  // `login`/`register` son las ÚNICAS pantallas sin sesión del barrido de
  // `apiErrorMsg`. Cuando el backend no responde, `ofetch` lanza un `Error` cuyo
  // `message` trae el método y la URL completa —`[POST] "http://host:3000/api/
  // auth/login": <no response> fetch failed`—, así que propagarlo le muestra la
  // topología interna a un visitante anónimo. Acá el mensaje técnico se descarta
  // y queda el genérico; las credenciales inválidas siguen llegando con
  // `data.message` del backend y se muestran igual que siempre.
  it('un fallo de red en login no filtra la URL del backend', async () => {
    const store = useAuthStore()
    $fetchMock.mockRejectedValueOnce(
      new Error('[POST] "http://backend-interno:3000/api/auth/login": <no response> fetch failed'),
    )

    const ok = await store.login('a@b.com', 'secreta')

    expect(ok).toBe(false)
    expect(store.error).toBe('Error al iniciar sesión')
    expect(store.error).not.toContain('http')
  })

  it('un fallo de red en registro tampoco filtra la URL del backend', async () => {
    const store = useAuthStore()
    $fetchMock.mockRejectedValueOnce(
      new Error('[POST] "http://backend-interno:3000/api/auth/register": <no response> fetch failed'),
    )

    const ok = await store.register('Ana', 'a@b.com', 'secreta')

    expect(ok).toBe(false)
    expect(store.error).toBe('Error al registrarse')
    expect(store.error).not.toContain('http')
  })

  it('sigue mostrando el mensaje del backend cuando responde con error', async () => {
    const store = useAuthStore()
    $fetchMock.mockRejectedValueOnce({ data: { message: 'Credenciales inválidas' } })

    await store.login('a@b.com', 'mala')

    expect(store.error).toBe('Credenciales inválidas')
  })

  it('junta el array de validación del registro', async () => {
    const store = useAuthStore()
    $fetchMock.mockRejectedValueOnce({
      data: { message: ['email debe ser un correo', 'password es muy corta'] },
    })

    await store.register('Ana', 'mal', '1')

    expect(store.error).toBe('email debe ser un correo, password es muy corta')
  })
})

describe('useAuthStore — restauración de sesión', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    $fetchMock.mockReset()
  })

  it('tryRefresh exitoso guarda el nuevo token y devuelve true', async () => {
    const store = useAuthStore()
    const fresh = makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 'abc-123', es_superadmin: false, iat: 0, exp: 9999 })
    $fetchMock.mockResolvedValueOnce({ access_token: fresh })
    const ok = await store.tryRefresh()
    expect(ok).toBe(true)
    expect(store.token).toBe(fresh)
    expect(store.activeTenantId).toBe('abc-123')
  })

  it('tryRefresh manda `credentials: include` — sin eso la cookie no viaja', async () => {
    // El refresh token vive en una cookie httpOnly: el navegador solo la manda
    // con `credentials: 'include'`. Perderlo no rompe ningún test —`$fetch`
    // está mockeado y los options se ignoran— pero deja el refresh muerto en
    // producción, con un 401 sin explicación. Se fija acá porque al sacar la
    // rama SSR de `tryRefresh` esta opción era lo único que había que conservar.
    const store = useAuthStore()
    const fresh = makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 't1', es_superadmin: false, iat: 0, exp: 9999 })
    $fetchMock.mockResolvedValueOnce({ access_token: fresh })

    await store.tryRefresh()

    const [url, opts] = $fetchMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toContain('/auth/refresh')
    expect(opts).toMatchObject({ method: 'POST', credentials: 'include' })
  })

  it('tryRefresh fallido devuelve false y no setea token', async () => {
    const store = useAuthStore()
    $fetchMock.mockRejectedValueOnce(new Error('401'))
    const ok = await store.tryRefresh()
    expect(ok).toBe(false)
    expect(store.token).toBeNull()
  })

  it('fetchMe con token vencido refresca y reintenta una vez', async () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 't1', es_superadmin: false, iat: 0, exp: 9999 }))
    const fresh = makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 't1', es_superadmin: false, iat: 0, exp: 9999 })
    $fetchMock
      .mockRejectedValueOnce(new Error('401')) // /auth/me con token vencido
      .mockResolvedValueOnce({ access_token: fresh }) // /auth/refresh
      .mockResolvedValueOnce({ id: 'u1', nombre: 'Ana' }) // /auth/me reintento
    await store.fetchMe()
    expect(store.user).toEqual({ id: 'u1', nombre: 'Ana' })
    expect(store.token).toBe(fresh)
  })

  it('fetchMe limpia la sesión si el refresh también falla', async () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 't1', es_superadmin: false, iat: 0, exp: 9999 }))
    $fetchMock
      .mockRejectedValueOnce(new Error('401')) // /auth/me
      .mockRejectedValueOnce(new Error('401')) // /auth/refresh
    await store.fetchMe()
    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
  })
})
