import { describe, it, expect } from 'vitest'
import { apiErrorMsg, apiFieldErrors, nombreSugeridoDe, esSinPermiso } from './api-error'

describe('apiErrorMsg', () => {
  it('prioriza el mensaje HTTP del backend', () => {
    expect(apiErrorMsg({ data: { message: 'Stock insuficiente' } }, 'fallback'))
      .toBe('Stock insuficiente')
  })

  it('une mensajes HTTP en array', () => {
    expect(apiErrorMsg({ data: { message: ['a', 'b'] } }, 'fallback')).toBe('a, b')
  })

  it('para Error local usa el message si el fallback es el genérico', () => {
    expect(apiErrorMsg(new Error('La impresora no respondió')))
      .toBe('La impresora no respondió')
  })

  it('para Error local antepone el fallback de contexto', () => {
    expect(
      apiErrorMsg(
        new Error('La impresora no respondió'),
        'Venta registrada, pero falló la impresión de la boleta',
      ),
    ).toBe(
      'Venta registrada, pero falló la impresión de la boleta: La impresora no respondió',
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

// Lo que separa "no se pudo, avísale" de "no se pudo TODAVÍA, ofrécele un
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

describe('apiErrorMsg: el texto crudo del validador no llega a la persona', () => {
  const msg = (m: string | string[]) => apiErrorMsg({ data: { message: m } }, 'fallback')

  it('traduce "no puede estar vacío" y nombra el campo con su etiqueta', () => {
    expect(msg('nombre should not be empty')).toBe('Nombre: es obligatorio')
  })

  it('traduce un UUID inválido a "elige"', () => {
    expect(msg('tipoReglaId must be a UUID')).toBe('Elige tipo de regla')
  })

  it('une varios sin repetir y sin inglés', () => {
    expect(msg(['nombre should not be empty', 'host should not be empty']))
      .toBe('Nombre: es obligatorio, Host: es obligatorio')
  })

  it('traduce largo mínimo y número', () => {
    expect(msg('contrasena must be longer than or equal to 6 characters'))
      .toBe('Contraseña: mínimo 6 caracteres')
    expect(msg('minimo must be a number string')).toBe('Mínimo: escribe un número')
  })

  it('largo mínimo de 1 es lo mismo que obligatorio (mesa sin nombre)', () => {
    expect(msg('nombre must be longer than or equal to 1 characters')).toBe('Nombre: es obligatorio')
  })

  it('traduce el correo y el formato', () => {
    expect(msg('correo must be an email')).toBe('Correo: escribe un correo válido')
    expect(msg('emisorRut must match /^[0-9.\\s]{1,12}-?[0-9kK]\\s*$/ regular expression'))
      .toBe('RUT del emisor: el formato no es válido')
  })

  it('cualquier otro inglés cae a un texto en español', () => {
    expect(msg('foo must be a boolean value')).toBe('Foo: el valor no es válido')
  })

  it('cambia el nombre interno de un mensaje en español por su etiqueta', () => {
    expect(msg('lineas.0.cantidad debe ser mayor a cero'))
      .toBe('Línea 1, cantidad debe ser mayor a cero')
    expect(msg('precioBase no puede ser negativo')).toBe('Precio base no puede ser negativo')
  })

  it('deja intacta una frase en español del backend', () => {
    expect(msg('no hay stock suficiente')).toBe('no hay stock suficiente')
    expect(msg('Stock insuficiente de "Pan": faltan 3')).toBe('Stock insuficiente de "Pan": faltan 3')
  })

  it('un 500 genérico no se muestra en inglés', () => {
    expect(apiErrorMsg({ data: { message: 'Internal server error', statusCode: 500 } }, 'No se pudo registrar la venta. Inténtalo de nuevo.'))
      .toBe('No se pudo registrar la venta. Inténtalo de nuevo.')
  })
})

describe('apiFieldErrors', () => {
  it('devuelve el mensaje traducido por campo', () => {
    expect(apiFieldErrors({ data: { message: ['nombre should not be empty', 'host should not be empty'] } }))
      .toEqual({ nombre: 'Es obligatorio', host: 'Es obligatorio' })
  })

  it('ignora los mensajes que no son de un campo', () => {
    expect(apiFieldErrors({ data: { message: 'Stock insuficiente' } })).toEqual({})
    expect(apiFieldErrors({})).toEqual({})
  })
})

describe('esSinPermiso', () => {
  it('es true con un 403, venga como status o como response.status', () => {
    expect(esSinPermiso({ status: 403 })).toBe(true)
    expect(esSinPermiso({ response: { status: 403 } })).toBe(true)
  })

  it('es false con cualquier otro fallo', () => {
    expect(esSinPermiso({ status: 500 })).toBe(false)
    expect(esSinPermiso(new Error('Failed to fetch'))).toBe(false)
    expect(esSinPermiso(undefined)).toBe(false)
  })
})
