import { describe, it, expect } from 'vitest'
import { formatStock, formatStockCantidad } from './stock-format'

describe('formatStockCantidad', () => {
  it('no fraccionaria: muestra entero sin decimales', () => {
    expect(formatStockCantidad('98.0000', false)).toBe('98')
    expect(formatStockCantidad('0.0000', false)).toBe('0')
  })

  it('no fraccionaria: redondea al entero más cercano', () => {
    expect(formatStockCantidad('98.6', false)).toBe('99')
  })

  it('fraccionaria: conserva decimales significativos con coma', () => {
    expect(formatStockCantidad('2.5000', true)).toBe('2,5')
    expect(formatStockCantidad('75.0000', true)).toBe('75')
    expect(formatStockCantidad('199.2500', true)).toBe('199,25')
  })

  it('valor vacío devuelve em dash', () => {
    expect(formatStockCantidad(null, true)).toBe('—')
  })
})

describe('formatStock', () => {
  it('no fraccionaria: solo número, sin sufijo', () => {
    expect(formatStock('98.0000', 'unidad', false)).toBe('98')
  })

  it('fraccionaria: incluye sufijo de unidad', () => {
    expect(formatStock('2.5000', 'kg', true)).toBe('2,5 kg')
    expect(formatStock('75.0000', 'l', true)).toBe('75 l')
    expect(formatStock('500.0000', 'g', true)).toBe('500 g')
  })
})
