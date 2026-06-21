import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock de Nuxt virtual modules (mismo patrón que auth.spec.ts y tenant.spec.ts)
vi.mock('#app/nuxt', () => ({
  useNuxtApp: vi.fn(),
  useRuntimeConfig: vi.fn(() => ({
    apiUrl: undefined,
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
  defineNuxtPlugin: vi.fn(),
  definePayloadPlugin: vi.fn(),
  defineAppConfig: vi.fn(),
  tryUseNuxtApp: vi.fn(),
}))

vi.mock('#app/composables/cookie', () => ({
  useCookie: vi.fn((_name: string, _opts?: unknown) => {
    const { ref } = require('vue')
    return ref<string | null>(null)
  }),
  refreshCookie: vi.fn(),
}))

// storeToRefs real (pinia) filtra objetos planos a {}; en estos tests el mock
// de store ya expone refs, así que devolvemos el store tal cual.
vi.mock('pinia', async (orig) => {
  const actual = await orig<typeof import('pinia')>()
  return { ...actual, storeToRefs: (store: Record<string, unknown>) => store }
})

const mockNavigateTo = vi.fn()

vi.mock('#app/composables/router', () => ({
  navigateTo: mockNavigateTo,
  useRoute: vi.fn(),
  useRouter: vi.fn(),
  abortNavigation: vi.fn(),
  addRouteMiddleware: vi.fn(),
  defineNuxtRouteMiddleware: (fn: unknown) => fn,
  setPageLayout: vi.fn(),
}))

let mockToken: string | null = null
let mockActiveTenantId: string | null = null
let mockUser: object | null = null
let mockTenants: { tenantId: string, nombre: string }[] = []
const mockFetchMe = vi.fn()
const mockHandlePostLogin = vi.fn()
const mockFetchMyTenants = vi.fn()

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    token: { value: mockToken },
    user: { value: mockUser },
    activeTenantId: { value: mockActiveTenantId },
    isSuperadmin: { value: false },
    fetchMe: mockFetchMe,
    handlePostLogin: mockHandlePostLogin,
  }),
}))

vi.mock('../stores/tenant', () => ({
  useTenantStore: () => ({
    get tenants() { return mockTenants },
    fetchMyTenants: mockFetchMyTenants,
  }),
}))

// Importar el middleware como función
const { default: authMiddleware } = await import('./auth')

// Helper para crear el contexto que espera el middleware.
// defineNuxtRouteMiddleware recibe (to, from) — `to` es la ruta destino.
function makeContext(path: string) {
  return { path } as Parameters<typeof authMiddleware>[0]
}

describe('middleware/auth', () => {
  beforeEach(() => {
    mockToken = null
    mockActiveTenantId = null
    mockUser = null
    mockTenants = []
    mockFetchMe.mockClear()
    mockFetchMe.mockResolvedValue(undefined)
    mockHandlePostLogin.mockClear()
    mockHandlePostLogin.mockResolvedValue(undefined)
    mockFetchMyTenants.mockClear()
    mockFetchMyTenants.mockResolvedValue(undefined)
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
    mockTenants = [{ tenantId: 'tenant-uuid', nombre: 'Empresa A' }]
    await authMiddleware(makeContext('/'))
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('tras refresh: tenant activo pero lista vacía → rehidrata fetchMyTenants', async () => {
    mockToken = 'some.token.here'
    mockUser = { id: '1', nombre: 'Test' }
    mockActiveTenantId = 'tenant-uuid'
    mockTenants = []
    await authMiddleware(makeContext('/'))
    expect(mockFetchMyTenants).toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('tenant activo y lista ya cargada → no vuelve a fetchMyTenants', async () => {
    mockToken = 'some.token.here'
    mockUser = { id: '1', nombre: 'Test' }
    mockActiveTenantId = 'tenant-uuid'
    mockTenants = [{ tenantId: 'tenant-uuid', nombre: 'Empresa A' }]
    await authMiddleware(makeContext('/'))
    expect(mockFetchMyTenants).not.toHaveBeenCalled()
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
