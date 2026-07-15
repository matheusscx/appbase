import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

const { useUnidadesMedidaStore } = await import('./unidades-medida')

const UNIDADES = [
  { unidadMedidaId: 'g-uuid', codigo: 'g', nombre: 'Gramo', magnitud: 'masa', factorBase: '1.000000' },
  { unidadMedidaId: 'kg-uuid', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'masa', factorBase: '1000.000000' },
  { unidadMedidaId: 'unidad-uuid', codigo: 'unidad', nombre: 'Unidad', magnitud: 'conteo', factorBase: '1.000000' },
]

describe('useUnidadesMedidaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('esFraccionaria: true para magnitudes continuas, false para conteo', async () => {
    const store = useUnidadesMedidaStore()
    store.hydrate(UNIDADES)

    expect(store.esFraccionaria('kg')).toBe(true)
    expect(store.esFraccionaria('g')).toBe(true)
    expect(store.esFraccionaria('unidad')).toBe(false)
  })

  it('esFraccionaria: sin catálogo cargado, solo "unidad" y null son enteros', () => {
    const store = useUnidadesMedidaStore()

    expect(store.esFraccionaria('kg')).toBe(true)
    expect(store.esFraccionaria('unidad')).toBe(false)
    expect(store.esFraccionaria(null)).toBe(false)
  })

  it('opts arma las opciones del selector con el código como value', () => {
    const store = useUnidadesMedidaStore()
    store.hydrate(UNIDADES)

    expect(store.opts).toEqual([
      { label: 'Gramo (g)', value: 'g' },
      { label: 'Kilogramo (kg)', value: 'kg' },
      { label: 'Unidad', value: 'unidad' },
    ])
  })

  it('magnitudDe devuelve la magnitud del código conocido', () => {
    const store = useUnidadesMedidaStore()
    store.hydrate(UNIDADES)

    expect(store.magnitudDe('kg')).toBe('masa')
    expect(store.magnitudDe('inventada')).toBeNull()
  })
})
