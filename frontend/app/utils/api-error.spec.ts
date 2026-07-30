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

  // Para pantallas SIN sesión (login/registro): el `message` de un `Error` de red
  // de ofetch trae el método y la URL completa del backend, y eso no puede
  // llegarle a un visitante anónimo. El mensaje HTTP del backend sí se conserva.
  it('con detalleLocal: false descarta el message del Error local', () => {
    expect(
      apiErrorMsg(
        new Error('[POST] "http://backend-interno:3000/api/auth/login": <no response> fetch failed'),
        'Error al iniciar sesión',
        { detalleLocal: false },
      ),
    ).toBe('Error al iniciar sesión')
  })

  it('detalleLocal: false no afecta al mensaje HTTP del backend', () => {
    expect(
      apiErrorMsg({ data: { message: ['a', 'b'] } }, 'fallback', { detalleLocal: false }),
    ).toBe('a, b')
  })
})
