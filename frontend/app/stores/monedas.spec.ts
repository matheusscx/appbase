import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

const activeTenantIdRef = ref<string | null>('tenant-1')

vi.mock('./auth', () => ({
  useAuthStore: () => ({
    get activeTenantId() { return activeTenantIdRef.value },
  }),
}))

const { useMonedasStore } = await import('./monedas')

const API_MONEDA = {
  monedaId: 'm-clp',
  nombre: 'Peso Chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esDefault: true,
  esOficial: true,
  valorDelDia: '1',
}

describe('useMonedasStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activeTenantIdRef.value = 'tenant-1'
    mockApiFetch.mockReset()
  })

  it('ensureLoaded es idempotente tras primera carga', async () => {
    mockApiFetch.mockResolvedValue([API_MONEDA])
    const store = useMonedasStore()

    await store.ensureLoaded()
    await store.ensureLoaded()

    expect(mockApiFetch).toHaveBeenCalledTimes(1)
    expect(store.isLoaded).toBe(true)
    expect(store.getById('m-clp')?.locale).toBe('es-CL')
    expect(store.getByCodigo('CLP')?.decimals).toBe(0)
  })

  it('reset limpia diccionarios', async () => {
    mockApiFetch.mockResolvedValue([API_MONEDA])
    const store = useMonedasStore()
    await store.ensureLoaded()
    store.reset()
    expect(store.isLoaded).toBe(false)
    expect(store.getById('m-clp')).toBeUndefined()
  })

  it('patchMoneda actualiza config en memoria', async () => {
    mockApiFetch.mockResolvedValue([API_MONEDA])
    const store = useMonedasStore()
    await store.ensureLoaded()
    store.patchMoneda('m-clp', { habilitada: false, valorDelDia: '2' })
    expect(store.getById('m-clp')?.habilitada).toBe(false)
    expect(store.getById('m-clp')?.valorDelDia).toBe('2')
  })

  it('monedaOficial computed', async () => {
    mockApiFetch.mockResolvedValue([API_MONEDA])
    const store = useMonedasStore()
    await store.ensureLoaded()
    expect(store.monedaOficial?.codigoIso).toBe('CLP')
  })
})
