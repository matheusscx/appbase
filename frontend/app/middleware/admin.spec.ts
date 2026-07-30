import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mismo patrón de mocks de módulos virtuales de Nuxt que `auth.spec.ts`.
vi.mock('#app/nuxt', () => ({
  useNuxtApp: vi.fn(),
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
  defineNuxtPlugin: vi.fn(),
  tryUseNuxtApp: vi.fn(),
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

let mockEsAdmin = false
let error: string | null = null
const mockEnsureCargado = vi.fn()

vi.mock('../stores/permissions', () => ({
  usePermissionsStore: () => ({
    get esAdmin() { return mockEsAdmin },
    get error() { return error },
    ensureCargado: mockEnsureCargado,
  }),
}))

const { default: adminMiddleware } = await import('./admin')

describe('middleware/admin', () => {
  beforeEach(() => {
    error = null
    mockEsAdmin = false
    mockNavigateTo.mockClear()
    mockEnsureCargado.mockClear()
    mockEnsureCargado.mockResolvedValue(undefined)
  })

  it('deja pasar al admin del tenant', async () => {
    mockEsAdmin = true

    const res = await adminMiddleware({} as never, {} as never)

    expect(res).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('redirige a /configuracion al que no es admin', async () => {
    mockEsAdmin = false

    await adminMiddleware({} as never, {} as never)

    expect(mockNavigateTo).toHaveBeenCalledWith('/configuracion')
  })

  it('espera la carga de permisos ANTES de decidir', async () => {
    // El middleware corre antes del `onMounted` que puebla el store. Sin el
    // await, un admin entrando por URL directa o F5 se lee como no-admin y
    // queda expulsado de su propia pantalla — el modo de falla que este
    // middleware no puede tener, porque nadie lo reporta como bug de permisos.
    mockEnsureCargado.mockImplementation(async () => {
      mockEsAdmin = true
    })

    await adminMiddleware({} as never, {} as never)

    expect(mockEnsureCargado).toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('si los permisos NO se pudieron cargar, deja pasar en vez de expulsar', async () => {
    // `esAdmin` arranca en `false`, así que un fetch fallido se lee igual que
    // "no es admin" y echaría a un admin real por un hipo de red. Se deja pasar
    // porque el candado real es el guard del backend; al revés se ve como "a
    // veces me tira al índice" y nadie lo reporta como bug de permisos.
    mockEsAdmin = false
    error = 'Error al cargar permisos'

    await adminMiddleware({} as never, {} as never)

    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})
