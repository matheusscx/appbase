import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

const { useUnidadesMedidaStore } = await import('../stores/unidades-medida')
const { useUnidadConversion } = await import('./useUnidadConversion')

const UNIDADES = [
  { unidadMedidaId: 'g-uuid', codigo: 'g', nombre: 'Gramo', magnitud: 'masa', factorBase: '1.000000' },
  { unidadMedidaId: 'kg-uuid', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'masa', factorBase: '1000.000000' },
  { unidadMedidaId: 'l-uuid', codigo: 'l', nombre: 'Litro', magnitud: 'volumen', factorBase: '1000.000000' },
]

describe('useUnidadConversion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUnidadesMedidaStore().hydrate(UNIDADES)
  })

  it('convertirCantidad escala por el factor de la unidad de origen', () => {
    const { convertirCantidad } = useUnidadConversion()

    expect(convertirCantidad('2', 'kg', 'g')?.toString()).toBe('2000')
    expect(convertirCantidad('500', 'g', 'kg')?.toString()).toBe('0.5')
  })

  // El corazón del contrato: el costo va al revés que la cantidad. Si alguien
  // "corrige" la inversión de argumentos de convertirCosto, este test cae —
  // sin él, un error de factor 1000 llega al kardex sin que nada lo vea.
  it('convertirCosto escala al revés que convertirCantidad', () => {
    const { convertirCantidad, convertirCosto } = useUnidadConversion()

    // Un producto que cuesta $5.000 por kg cuesta $5 por gramo.
    expect(convertirCosto('5000', 'kg', 'g')?.toString()).toBe('5')
    expect(convertirCosto('5', 'g', 'kg')?.toString()).toBe('5000')

    // Y la cantidad, en la misma dirección, va al revés.
    expect(convertirCantidad('5000', 'kg', 'g')?.toString()).toBe('5000000')
  })

  it('convertirCosto preserva el valor total de la línea', () => {
    const { convertirCantidad, convertirCosto } = useUnidadConversion()

    const cantidadEnG = convertirCantidad('2', 'kg', 'g')!
    const costoPorG = convertirCosto('5000', 'kg', 'g')!

    // 2 kg × $5.000/kg === 2000 g × $5/g
    expect(cantidadEnG.mul(costoPorG).toString()).toBe('10000')
  })

  it('devuelve el mismo valor cuando la unidad no cambia', () => {
    const { convertirCantidad, convertirCosto } = useUnidadConversion()

    expect(convertirCantidad('7.5', 'kg', 'kg')?.toString()).toBe('7.5')
    expect(convertirCosto('7.5', 'kg', 'kg')?.toString()).toBe('7.5')
  })

  it('devuelve null entre magnitudes distintas, código desconocido o valor no numérico', () => {
    const { convertirCantidad, convertirCosto } = useUnidadConversion()

    expect(convertirCantidad('1', 'kg', 'l')).toBeNull()
    expect(convertirCosto('1', 'kg', 'l')).toBeNull()
    expect(convertirCantidad('1', 'kg', 'xx')).toBeNull()
    expect(convertirCosto('1', 'xx', 'kg')).toBeNull()
    expect(convertirCantidad('no-numero', 'kg', 'g')).toBeNull()
    expect(convertirCosto('no-numero', 'kg', 'g')).toBeNull()
  })

  it('redondea a 4 decimales, como el backend', () => {
    const { convertirCosto } = useUnidadConversion()

    // $1 por kg → $0,001 por g; con más precisión de la que admite la columna
    // se corta en el 4º decimal.
    expect(convertirCosto('1', 'kg', 'g')?.toString()).toBe('0.001')
    expect(convertirCosto('0.5', 'kg', 'g')?.toString()).toBe('0.0005')
  })
})
