import { describe, expect, it } from 'vitest'
import { esAjusteDeValor } from './useFormatters'

describe('esAjusteDeValor', () => {
  it('los dos ajustes de valor del kardex se dibujan como costo anterior → nuevo', () => {
    expect(esAjusteDeValor('ajuste_costo')).toBe(true)
    expect(esAjusteDeValor('correccion_compra')).toBe(true)
  })

  it('una compra mueve cantidad: no es un ajuste de valor', () => {
    expect(esAjusteDeValor('compra')).toBe(false)
    expect(esAjusteDeValor('merma')).toBe(false)
  })
})
