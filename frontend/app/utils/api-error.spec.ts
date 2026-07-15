import { describe, it, expect } from 'vitest'
import { apiErrorMsg } from './api-error'

describe('apiErrorMsg', () => {
  it('prioriza el mensaje HTTP del backend', () => {
    expect(apiErrorMsg({ data: { message: 'Stock insuficiente' } }, 'fallback'))
      .toBe('Stock insuficiente')
  })

  it('une mensajes HTTP en array', () => {
    expect(apiErrorMsg({ data: { message: ['a', 'b'] } }, 'fallback')).toBe('a, b')
  })

  it('para Error local usa el message si el fallback es el genérico', () => {
    expect(apiErrorMsg(new Error('La impresora no respondió (timeout 5 s)')))
      .toBe('La impresora no respondió (timeout 5 s)')
  })

  it('para Error local antepone el fallback de contexto', () => {
    expect(
      apiErrorMsg(
        new Error('La impresora no respondió (timeout 5 s)'),
        'Venta registrada, pero falló la impresión de la boleta',
      ),
    ).toBe(
      'Venta registrada, pero falló la impresión de la boleta: La impresora no respondió (timeout 5 s)',
    )
  })

  it('sin data ni Error devuelve el fallback', () => {
    expect(apiErrorMsg({}, 'Algo falló')).toBe('Algo falló')
  })
})
