import { describe, expect, it } from 'vitest'
import {
  sugerirPropina,
  porcentajeHumanoADecimal,
  porcentajeDecimalAHumano,
} from './usePropina'

describe('sugerirPropina', () => {
  it('calcula 10% half-up a 0 decimales', () => {
    expect(sugerirPropina('50000', 0)).toBe('5000')
    expect(sugerirPropina('50001', 0)).toBe('5000')
    expect(sugerirPropina('0', 0)).toBe('0')
  })

  it('redondea .5 hacia arriba (half-up)', () => {
    // 50005 × 0.10 = 5000.5 → 5001
    expect(sugerirPropina('50005', 0)).toBe('5001')
  })

  it('acepta otro porcentaje', () => {
    expect(sugerirPropina('10000', 0, '0.15')).toBe('1500')
  })

  it('redondea a la escala de la MONEDA, no a pesos enteros', () => {
    // El bug que esto fija: con 0 hardcodeado, un tenant en USD veía sugerida
    // una propina de 10 sobre una cuenta de 103,45 — la moneda tiene centavos y
    // el campo donde se edita también, así que la sugerencia salía más gruesa
    // que el input que la recibe.
    expect(sugerirPropina('103.45', 2)).toBe('10.35')
    expect(sugerirPropina('103.45', 0)).toBe('10')
    // La escala se respeta aunque el resultado sea exacto: '10.00', no '10'.
    expect(sugerirPropina('100', 2)).toBe('10.00')
  })
})

describe('porcentajeHumanoADecimal', () => {
  it('convierte 10 → 0.100000', () => {
    expect(porcentajeHumanoADecimal('10')).toBe('0.100000')
  })
  it('convierte 10.5 → 0.105000', () => {
    expect(porcentajeHumanoADecimal('10.5')).toBe('0.105000')
  })
})

describe('porcentajeDecimalAHumano', () => {
  it('convierte 0.10 → 10', () => {
    expect(porcentajeDecimalAHumano('0.10')).toBe('10')
  })
  it('convierte 0.105 → 10.5', () => {
    expect(porcentajeDecimalAHumano('0.105')).toBe('10.5')
  })
})
