import { describe, expect, it } from 'vitest'
import { esAjusteDeValor, textoHace } from './useFormatters'

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

describe('textoHace', () => {
  const ahora = new Date('2026-10-16T21:00:00Z')

  it('en minutos hasta la hora, y en horas y minutos después', () => {
    expect(textoHace('2026-10-16T20:15:00Z', ahora)).toBe('hace 45 min')
    expect(textoHace('2026-10-16T18:00:00Z', ahora)).toBe('hace 3 h')
    expect(textoHace('2026-10-16T18:50:00Z', ahora)).toBe('hace 2 h 10 min')
    expect(textoHace('2026-10-16T20:57:00Z', ahora)).toBe('hace 3 min')
    expect(textoHace('2026-10-16T20:59:00Z', ahora)).toBe('hace 1 min')
  })

  it('menos de un minuto es "recién"; un reloj adelantado no da un tiempo negativo', () => {
    expect(textoHace('2026-10-16T20:59:40Z', ahora)).toBe('recién')
    expect(textoHace('2026-10-16T21:05:00Z', ahora)).toBe('recién')
  })

  it('pasado el día, en días; sin fecha, nada', () => {
    expect(textoHace('2026-10-14T20:00:00Z', ahora)).toBe('hace 2 d')
    expect(textoHace(null, ahora)).toBe('')
  })
})
