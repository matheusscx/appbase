import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick, ref } from 'vue'

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

// `handlePostLogin` pasa por el store de tenants, que pide con `useApiFetch`.
const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

import { navigateTo } from '#app/composables/router'
import { useAuthStore } from './auth'
import { useCajaStore } from './caja'

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

    const resultado = await store.register('Ana', 'a@b.com', 'secreta')

    // El registro devuelve el mensaje del backend o el error, y ya no un
    // booleano. No abre sesión — la cuenta no sirve hasta verificar el
    // correo—, así que no hay nada que ramificar salvo "salió" o "falló".
    expect(resultado).toEqual({ error: 'Error al registrarse' })
    // Y el error es del registro: el de `store.error` lo lee el login.
    expect(store.error).toBeNull()
  })

  it('un registro exitoso NO abre sesión: devuelve el mensaje y nada más', async () => {
    // La cuenta nace sin el correo verificado y no se puede usar hasta abrir
    // el link del mail. Si acá quedara un token, la pantalla entraría a una
    // sesión que el backend va a rechazar en la request siguiente — y peor,
    // haría distinguible el caso "el correo ya existía", que es justo lo que
    // el endpoint dejó de revelar.
    const store = useAuthStore()
    $fetchMock.mockResolvedValueOnce({
      message: 'Si ese correo no tenía cuenta, te llega un link para verificarlo y entrar.',
    })

    const resultado = await store.register('Ana', 'a@b.com', 'secreta')

    expect(resultado).toEqual({ mensaje: expect.stringContaining('te llega un link') })
    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
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

    const resultado = await store.register('Ana', 'mal', '1')

    expect(resultado).toEqual({ error: 'email debe ser un correo, password es muy corta' })
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

describe('useAuthStore — handlePostLogin avisa cuando no pudo entrar al tenant', () => {
  // Las tres pantallas que lo invocan —login, callback de Google y el middleware
  // `auth`— leen `authStore.error`. El error de `my-tenants` o de
  // `switch-tenant` quedaba en `tenantStore.error`, que ninguna lee: medido en
  // navegador, el login se quedaba quieto sin mensaje y el callback, girando.
  //
  // El texto es propio y no el del servidor (owner, 2026-09-27): el fixture manda
  // otro mensaje a propósito, para que mostrar el del servidor falle.
  const navigateToMock = vi.mocked(navigateTo)
  const TENANT = { tenantId: 't1', nombre: 'Café Central' }
  const AVISO = 'No pudimos entrar a tu empresa. Intenta de nuevo.'

  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
    navigateToMock.mockReset()
  })

  it('con un tenant, si el switch falla deja el aviso en authStore.error', async () => {
    const store = useAuthStore()
    mockApiFetch
      .mockResolvedValueOnce([TENANT]) // my-tenants
      .mockRejectedValueOnce({ data: { message: 'Internal server error' } }) // switch-tenant

    const ok = await store.handlePostLogin()

    expect(ok).toBe(false)
    expect(store.error).toBe(AVISO)
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('si falla my-tenants no manda a /no-tenant: avisa el error', async () => {
    // "Tu cuenta no pertenece a ninguna empresa" es falso si lo que falló fue
    // la consulta: la lista vacía por error y la lista vacía de verdad no son
    // lo mismo.
    const store = useAuthStore()
    mockApiFetch.mockRejectedValueOnce({ data: { message: 'Internal server error' } })

    const ok = await store.handlePostLogin()

    expect(ok).toBe(false)
    expect(store.error).toBe(AVISO)
    expect(navigateToMock).not.toHaveBeenCalledWith('/no-tenant')
  })

  it('sin tenants de verdad sigue mandando a /no-tenant, sin error', async () => {
    const store = useAuthStore()
    mockApiFetch.mockResolvedValueOnce([])

    const ok = await store.handlePostLogin()

    expect(ok).toBe(true)
    expect(store.error).toBeNull()
    expect(navigateToMock).toHaveBeenCalledWith('/no-tenant')
  })

  it('con un tenant y el switch exitoso entra a / y limpia un error anterior', async () => {
    const store = useAuthStore()
    store.error = AVISO // de un intento anterior
    const conTenant = makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 't1', es_superadmin: false, iat: 0, exp: 9999 })
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/my-tenants')) return [TENANT]
      if (url.endsWith('/auth/switch-tenant')) return { access_token: conTenant }
      if (url.endsWith('/rbac/mis-permisos')) return []
      if (url.endsWith('/rbac/es-admin')) return { esAdmin: true }
      throw new Error(`inesperado: ${url}`)
    })

    const ok = await store.handlePostLogin()

    expect(ok).toBe(true)
    expect(store.error).toBeNull()
    expect(store.activeTenantId).toBe('t1')
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })
})

// El resultado del último cierre de caja vive en memoria para `/mi-caja`: el
// que entra después en ese navegador no puede verlo. Lo limpia el store de
// caja observando la sesión (ver `resultadoCierre` en `caja.ts`).
describe('useAuthStore — la sesión que cambia descarta el resultado del cierre de caja', () => {
  const RESULTADO = { arqueo: [], cajonNombre: 'Barra', fechaCierre: null }
  const tokenDe = (tenantId: string) =>
    makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: tenantId, es_superadmin: false, iat: 0, exp: 9999 })

  beforeEach(() => {
    setActivePinia(createPinia())
    $fetchMock.mockReset()
  })

  function sesionConResultado() {
    const auth = useAuthStore()
    auth.setToken(tokenDe('t1'))
    auth.user = { id: 'u1', nombre: 'Bruno' } as never
    const caja = useCajaStore()
    caja.mostrarResultadoCierre(RESULTADO)
    return { auth, caja }
  }

  it('logout lo vacía', async () => {
    const { auth, caja } = sesionConResultado()
    await nextTick()
    expect(caja.resultadoCierre).toEqual(RESULTADO)
    $fetchMock.mockResolvedValueOnce(undefined) // /auth/logout

    await auth.logout()
    await nextTick()

    expect(caja.resultadoCierre).toBeNull()
  })

  it('cambiar de tenant (otro token) lo vacía', async () => {
    const { auth, caja } = sesionConResultado()
    await nextTick()

    auth.setToken(tokenDe('t2'))
    await nextTick()

    expect(caja.resultadoCierre).toBeNull()
  })

  it('otra persona en el mismo tenant lo vacía', async () => {
    const { auth, caja } = sesionConResultado()
    await nextTick()

    auth.user = { id: 'u2', nombre: 'Ana' } as never
    await nextTick()

    expect(caja.resultadoCierre).toBeNull()
  })

  it('si `fetchMe` vuelve a traer a la misma persona, queda', async () => {
    const { auth, caja } = sesionConResultado()
    await nextTick()

    auth.user = { id: 'u1', nombre: 'Bruno' } as never
    await nextTick()

    expect(caja.resultadoCierre).toEqual(RESULTADO)
  })
})
