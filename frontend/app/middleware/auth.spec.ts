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
    mockFetchMe.mockClear()
    mockFetchMe.mockResolvedValue(undefined)
    mockHandlePostLogin.mockClear()
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
