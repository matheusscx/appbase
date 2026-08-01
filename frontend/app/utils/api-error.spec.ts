import { describe, it, expect } from 'vitest'
import { apiErrorMsg, nombreSugeridoDe } from './api-error'

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

// Lo que separa "no se pudo, avisale" de "no se pudo TODAVÍA, ofrecele un
// nombre libre" al restaurar de la papelera. Devolver algo distinto de `null`
// para un error común haría que la pantalla abriera el modal de colisión con
// el campo vacío ante cualquier 404 o caída de red.
describe('nombreSugeridoDe', () => {
  it('devuelve la sugerencia del 400 de colisión', () => {
    expect(
      nombreSugeridoDe({
        data: {
          message: 'Ya existe un descuento activo con el nombre "Black Friday".',
          nombreSugerido: 'Black Friday 2',
        },
      }),
    ).toBe('Black Friday 2')
  })

  it('devuelve null para un error común del backend (404 sin sugerencia)', () => {
    expect(
      nombreSugeridoDe({ data: { message: 'Descuento x no está en la papelera' } }),
    ).toBeNull()
  })

  it('devuelve null para un Error local sin cuerpo de API', () => {
    expect(nombreSugeridoDe(new Error('fetch failed'))).toBeNull()
  })

  it('devuelve null si la sugerencia viene vacía o no es string', () => {
    // Sería un bug del backend, no una salida usable: con string vacío el
    // modal se abriría con el campo en blanco y el botón deshabilitado.
    expect(nombreSugeridoDe({ data: { nombreSugerido: '' } })).toBeNull()
    expect(nombreSugeridoDe({ data: { nombreSugerido: 42 } })).toBeNull()
  })

  it('no explota con null ni undefined', () => {
    expect(nombreSugeridoDe(null)).toBeNull()
    expect(nombreSugeridoDe(undefined)).toBeNull()
  })
})
