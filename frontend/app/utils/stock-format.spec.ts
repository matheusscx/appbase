import { describe, it, expect } from 'vitest'
import { formatStock, formatStockCantidad } from './stock-format'

describe('formatStockCantidad', () => {
  it('unidad: muestra entero sin decimales', () => {
    expect(formatStockCantidad('98.0000', 'unidad')).toBe('98')
    expect(formatStockCantidad('0.0000', 'unidad')).toBe('0')
  })

  it('unidad: redondea al entero más cercano', () => {
    expect(formatStockCantidad('98.6', 'unidad')).toBe('99')
  })

  it('sin unidad: trata como unidad (entero)', () => {
    expect(formatStockCantidad('50.0000', null)).toBe('50')
  })

  it('kg/l/m: conserva decimales significativos con coma', () => {
    expect(formatStockCantidad('2.5000', 'kg')).toBe('2,5')
    expect(formatStockCantidad('75.0000', 'l')).toBe('75')
    expect(formatStockCantidad('199.2500', 'm')).toBe('199,25')
  })

  it('valor vacío devuelve em dash', () => {
    expect(formatStockCantidad(null, 'kg')).toBe('—')
  })
})

describe('formatStock', () => {
  it('unidad: solo número', () => {
    expect(formatStock('98.0000', 'unidad')).toBe('98')
  })

  it('kg/l/m: incluye sufijo de unidad', () => {
    expect(formatStock('2.5000', 'kg')).toBe('2,5 kg')
    expect(formatStock('75.0000', 'l')).toBe('75 l')
    expect(formatStock('199.0000', 'm')).toBe('199 m')
  })
})
