import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

// ─── Mock Nuxt virtual modules (same pattern as auth.spec.ts) ────────────────
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

const mockNavigateTo = vi.fn()

vi.mock('#app/composables/router', () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
  useRoute: vi.fn(),
  useRouter: vi.fn(),
  abortNavigation: vi.fn(),
  addRouteMiddleware: vi.fn(),
  defineNuxtRouteMiddleware: vi.fn(),
  setPageLayout: vi.fn(),
}))

// ─── Mock useApiFetch composable ──────────────────────────────────────────────
const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

// ─── Mock useAuthStore — activeTenantId backed by a reactive ref ──────────────
// We use a ref so we can change the value between tests and the computed
// `activeTenant` inside the store will react to the change.
const activeTenantIdRef = ref<string | null>(null)
const mockSetToken = vi.fn()

const mockFetchPermisos = vi.fn().mockResolvedValue(undefined)
const mockResetPermisos = vi.fn()
const mockResetMonedas = vi.fn()

vi.mock('./auth', () => ({
  useAuthStore: () => ({
    get activeTenantId() { return activeTenantIdRef.value },
    setToken: mockSetToken,
    token: ref<string | null>(null),
    clearAuth: vi.fn(),
  }),
}))

vi.mock('./permissions', () => ({
  usePermissionsStore: () => ({
    reset: mockResetPermisos,
    fetchPermisos: mockFetchPermisos,
  }),
}))

vi.mock('./monedas', () => ({
  useMonedasStore: () => ({
    reset: mockResetMonedas,
  }),
}))

// Import AFTER mocks are set up
const { useTenantStore } = await import('./tenant')

// ─── Helpers ─────────────────────────────────────────────────────────────────
const TENANT_A: { tenantId: string; nombre: string } = { tenantId: 'tenant-aaa', nombre: 'Empresa A' }
const TENANT_B: { tenantId: string; nombre: string } = { tenantId: 'tenant-bbb', nombre: 'Empresa B' }

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('useTenantStore — estado inicial', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activeTenantIdRef.value = null
    mockApiFetch.mockReset()
    mockSetToken.mockReset()
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

describe('useTenantStore — computed activeTenant', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activeTenantIdRef.value = null
    mockApiFetch.mockReset()
  })

  it('activeTenant es null cuando activeTenantId es null', () => {
    const store = useTenantStore()
    store.tenants = [TENANT_A]
    activeTenantIdRef.value = null
    expect(store.activeTenant).toBeNull()
  })

  it('activeTenant es null cuando la lista de tenants está vacía', () => {
    const store = useTenantStore()
    activeTenantIdRef.value = 'tenant-aaa'
    expect(store.activeTenant).toBeNull()
  })

  it('activeTenant retorna el tenant correcto cuando activeTenantId coincide', () => {
    const store = useTenantStore()
    store.tenants = [TENANT_A, TENANT_B]
    activeTenantIdRef.value = 'tenant-bbb'
    expect(store.activeTenant).toEqual(TENANT_B)
  })

  it('activeTenant es null cuando activeTenantId no coincide con ningún tenant de la lista', () => {
    const store = useTenantStore()
    store.tenants = [TENANT_A]
    activeTenantIdRef.value = 'tenant-desconocido'
    expect(store.activeTenant).toBeNull()
  })

  it('activeTenant se actualiza reactivamente cuando cambia activeTenantId', () => {
    const store = useTenantStore()
    store.tenants = [TENANT_A, TENANT_B]

    activeTenantIdRef.value = 'tenant-aaa'
    expect(store.activeTenant).toEqual(TENANT_A)

    activeTenantIdRef.value = 'tenant-bbb'
    expect(store.activeTenant).toEqual(TENANT_B)

    activeTenantIdRef.value = null
    expect(store.activeTenant).toBeNull()
  })
})

describe('useTenantStore — fetchMyTenants', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activeTenantIdRef.value = null
    mockApiFetch.mockReset()
  })

  it('popula tenants con la respuesta del API', async () => {
    const store = useTenantStore()
    mockApiFetch.mockResolvedValue([TENANT_A, TENANT_B])

    await store.fetchMyTenants()

    expect(store.tenants).toEqual([TENANT_A, TENANT_B])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('llama al endpoint correcto', async () => {
    const store = useTenantStore()
    mockApiFetch.mockResolvedValue([])

    await store.fetchMyTenants()

    expect(mockApiFetch).toHaveBeenCalledWith('http://localhost:3000/api/auth/my-tenants')
  })

  it('loading es true durante la llamada y false al terminar', async () => {
    const store = useTenantStore()
    let loadingDuringCall = false

    mockApiFetch.mockImplementation(async () => {
      loadingDuringCall = store.loading
      return []
    })

    await store.fetchMyTenants()

    expect(loadingDuringCall).toBe(true)
    expect(store.loading).toBe(false)
  })

  it('setea error y limpia loading en caso de fallo', async () => {
    const store = useTenantStore()
    mockApiFetch.mockRejectedValue({ data: { message: 'Unauthorized' } })

    await store.fetchMyTenants()

    expect(store.error).toBe('Unauthorized')
    expect(store.loading).toBe(false)
  })

  it('usa mensaje genérico cuando el error no tiene data.message', async () => {
    const store = useTenantStore()
    mockApiFetch.mockRejectedValue(new Error('Network error'))

    await store.fetchMyTenants()

    // `apiErrorMsg` conserva el motivo real del error local detrás del fallback de
    // contexto, en vez de tragárselo. Antes acá se veía solo el genérico.
    expect(store.error).toBe('Error al cargar tenants: Network error')
    expect(store.loading).toBe(false)
  })

  // El `ValidationPipe` global del backend devuelve `message` como **array** en
  // los errores de validación. El cast a `{ message?: string }` que había acá era
  // una mentira de tipos: el array entraba tal cual a un ref de string y se
  // renderizaba interpolado ("a,b"). `apiErrorMsg` lo junta con ", ".
  it('junta el array de mensajes de validación en un solo string', async () => {
    const store = useTenantStore()
    mockApiFetch.mockRejectedValue({
      data: { message: ['tenantId debe ser un UUID', 'nombre no puede estar vacío'] },
    })

    await store.fetchMyTenants()

    expect(store.error).toBe('tenantId debe ser un UUID, nombre no puede estar vacío')
    expect(typeof store.error).toBe('string')
  })
})

describe('useTenantStore — switchTenant', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activeTenantIdRef.value = null
    mockApiFetch.mockReset()
    mockSetToken.mockReset()
    mockNavigateTo.mockReset()
    mockFetchPermisos.mockClear()
    mockResetPermisos.mockClear()
  })

  it('llama al endpoint con el tenantId correcto', async () => {
    const store = useTenantStore()
    mockApiFetch.mockResolvedValue({ access_token: 'new-token-xyz' })

    await store.switchTenant('tenant-aaa')

    expect(mockApiFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/switch-tenant',
      { method: 'POST', body: { tenantId: 'tenant-aaa' } },
    )
  })

  it('llama a auth.setToken con el nuevo access_token', async () => {
    const store = useTenantStore()
    mockApiFetch.mockResolvedValue({ access_token: 'new-token-xyz' })

    await store.switchTenant('tenant-aaa')

    expect(mockSetToken).toHaveBeenCalledWith('new-token-xyz')
  })

  it('navega a "/" tras el switch exitoso', async () => {
    const store = useTenantStore()
    mockApiFetch.mockResolvedValue({ access_token: 'tok' })

    await store.switchTenant('tenant-aaa')

    expect(mockNavigateTo).toHaveBeenCalledWith('/')
  })

  it('resetea permisos y los recarga tras el switch exitoso', async () => {
    const store = useTenantStore()
    mockApiFetch.mockResolvedValue({ access_token: 'tok' })

    await store.switchTenant('tenant-aaa')

    expect(mockResetPermisos).toHaveBeenCalled()
    expect(mockFetchPermisos).toHaveBeenCalled()
    expect(mockSetToken).toHaveBeenCalledBefore(mockFetchPermisos)
    expect(mockFetchPermisos).toHaveBeenCalledBefore(mockNavigateTo)
  })

  it('en caso de error 403 setea error.value y NO navega', async () => {
    const store = useTenantStore()
    mockApiFetch.mockRejectedValue({ data: { message: 'Forbidden' } })

    await store.switchTenant('tenant-aaa')

    expect(store.error).toBe('Forbidden')
    expect(mockNavigateTo).not.toHaveBeenCalled()
    expect(store.loading).toBe(false)
  })

  // ⚠️ Esta rama es la ÚNICA salida del encierro de la contraseña temporal, y
  // hasta acá no la tocaba ningún test: borrándola entera el frontend quedaba
  // verde. El contrato es el string `DEBE_CAMBIAR_CONTRASENA`, que tiene que
  // coincidir con el que emite `switchTenant` en el backend; renombrarlo de un
  // solo lado deja a todo usuario nuevo en una pantalla de error sin salida.
  it('un 403 con codigo DEBE_CAMBIAR_CONTRASENA desvía a cambiarla, no muestra error', async () => {
    const store = useTenantStore()
    mockApiFetch.mockRejectedValue({
      data: {
        codigo: 'DEBE_CAMBIAR_CONTRASENA',
        message: 'Tenés que cambiar tu contraseña temporal antes de entrar.',
      },
    })

    await store.switchTenant('tenant-aaa')

    expect(mockNavigateTo).toHaveBeenCalledWith('/cambiar-contrasena')
    // No es un error a mostrar sino un desvío: si además setea `error`, la
    // pantalla de destino aparece con un cartel rojo que no corresponde.
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('usa mensaje genérico cuando el error no tiene data.message', async () => {
    const store = useTenantStore()
    mockApiFetch.mockRejectedValue(new Error('Unknown'))

    // Igual que en `fetchMyTenants`: el fallback de contexto se conserva y el
    // motivo del error local se agrega detrás, en vez de perderse.
    expect(store.error).toBeNull()
    await store.switchTenant('tenant-bbb')

    expect(store.error).toBe('Error al cambiar de tenant: Unknown')
  })

  it('loading es true durante la llamada y false al terminar', async () => {
    const store = useTenantStore()
    let loadingDuringCall = false

    mockApiFetch.mockImplementation(async () => {
      loadingDuringCall = store.loading
      return { access_token: 'tok' }
    })

    await store.switchTenant('tenant-aaa')

    expect(loadingDuringCall).toBe(true)
    expect(store.loading).toBe(false)
  })
})
