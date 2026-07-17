import { describe, expect, it } from 'vitest'
import { sugerirPropina } from './usePropina'

describe('sugerirPropina', () => {
  it('calcula 10% half-up a 0 decimales', () => {
    expect(sugerirPropina('50000')).toBe('5000')
    expect(sugerirPropina('50001')).toBe('5000')
    expect(sugerirPropina('0')).toBe('0')
  })

  it('redondea .5 hacia arriba (half-up)', () => {
    // 50005 × 0.10 = 5000.5 → 5001
    expect(sugerirPropina('50005')).toBe('5001')
  })

  it('acepta otro porcentaje', () => {
    expect(sugerirPropina('10000', '0.15')).toBe('1500')
  })
})
