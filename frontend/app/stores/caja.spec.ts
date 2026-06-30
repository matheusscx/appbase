import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ─── Mock Nuxt virtual modules (same pattern as tenant.spec.ts) ──────────────
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

// ─── Mock useApiFetch composable ──────────────────────────────────────────────
const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

// Import AFTER mocks are set up
const { useCajaStore } = await import('./caja')

const CAJA = {
  id: 'caja-1',
  tenantId: 'tenant-1',
  usuarioId: 'user-1',
  tipo: 'fisica',
  estado: 'abierta',
  saldoInicial: '1000.0000',
  saldoFinal: null,
  montoContado: null,
  diferencia: null,
  fechaApertura: '2026-06-29T00:00:00Z',
  fechaCierre: null,
  comentario: null,
}

describe('useCajaStore — cargarActiva', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApiFetch.mockReset()
  })

  it('activa inicia como null', () => {
    const store = useCajaStore()
    expect(store.activa).toBeNull()
  })

  it('popula activa con la caja devuelta por el API', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue(CAJA)

    await store.cargarActiva()

    expect(store.activa).toEqual(CAJA)
  })

  it('activa queda en null cuando no hay caja abierta (API responde null)', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue(null)

    await store.cargarActiva()

    expect(store.activa).toBeNull()
  })

  // El backend retorna `null` cuando no hay caja → NestJS envía un body HTTP
  // vacío → ofetch lo deserializa como '' (string vacío), no null. El store debe
  // normalizar esto a null para que `activa !== null` no dé un falso positivo.
  it('activa queda en null cuando el API responde body vacío ("")', async () => {
    const store = useCajaStore()
    mockApiFetch.mockResolvedValue('')

    await store.cargarActiva()

    expect(store.activa).toBeNull()
  })

  it('loadingActiva es true durante la llamada y false al terminar', async () => {
    const store = useCajaStore()
    let loadingDuringCall = false
    mockApiFetch.mockImplementation(async () => {
      loadingDuringCall = store.loadingActiva
      return CAJA
    })

    await store.cargarActiva()

    expect(loadingDuringCall).toBe(true)
    expect(store.loadingActiva).toBe(false)
  })
})
