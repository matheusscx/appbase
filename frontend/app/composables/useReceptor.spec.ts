import { describe, expect, it } from 'vitest'
import { normalizarRut, problemaDelReceptor, problemaDelReceptorDeNota, rutValido } from './useReceptor'

/**
 * Mismos casos que `backend/src/common/utils/rut.util.spec.ts`. Los DV salen de
 * un cálculo módulo 11 hecho aparte, no de esta función.
 */
describe('rutValido', () => {
  it.each([
    '76.543.210-3',
    '76543210-3',
    '765432103',
    '9.876.543-3',
    '10.000.013-k',
    '10000013-K',
    '10000004-0',
    '100000-4',
    '99999999-9',
  ])('%s es un RUT', (rut) => {
    expect(rutValido(rut)).toBe(true)
  })

  it.each([
    ['76.543.210-5', 'DV equivocado'],
    ['9.876.543-K', 'K donde va un número'],
    ['10000013-0', 'cero donde va K'],
    ['99999-7', 'cuerpo bajo 100.000, aunque el DV calce'],
    ['100000000-1', 'cuerpo sobre 99.999.999'],
    ['7654321A-3', 'letra en el cuerpo'],
    ['76543210-X', 'DV que no es dígito ni K'],
    ['', 'vacío'],
    ['-', 'solo guion'],
  ])('%s no es un RUT (%s)', (rut) => {
    expect(rutValido(rut)).toBe(false)
  })
})

describe('normalizarRut', () => {
  it.each([
    ['76.543.210-3', '76543210-3'],
    ['765432103', '76543210-3'],
    [' 9.876.543-k ', '9876543-K'],
  ])('%s → %s', (entrada, salida) => {
    expect(normalizarRut(entrada)).toBe(salida)
  })
})

describe('problemaDelReceptor', () => {
  const completo = {
    nombre: 'Comercial Andes SpA',
    rut: '76.543.210-3',
    giro: 'Venta de artículos de ferretería',
    direccion: 'Av. Matta 1234',
    comuna: 'Santiago',
  }
  const factura = { receptorCompleto: true, rutChileno: true }
  const boleta = { receptorCompleto: false, rutChileno: true }
  const otroPais = { receptorCompleto: false, rutChileno: false }

  it('la factura con el receptor completo está lista', () => {
    expect(problemaDelReceptor(completo, factura)).toBeNull()
  })

  it('sin nombre no hay receptor, en cualquier tipo', () => {
    expect(problemaDelReceptor({ ...completo, nombre: '  ' }, boleta)).toBe(
      'Falta el nombre o razón social del cliente',
    )
  })

  it('la factura nombra todo lo que falta, como el servidor', () => {
    expect(
      problemaDelReceptor({ nombre: 'Comercial Andes SpA', rut: '', giro: ' ', direccion: '', comuna: '' }, factura),
    ).toBe('La factura requiere del cliente: RUT, giro, dirección, comuna')
  })

  it('la boleta no exige giro, dirección ni comuna', () => {
    expect(
      problemaDelReceptor({ nombre: 'Juan Pérez', rut: '', giro: '', direccion: '', comuna: '' }, boleta),
    ).toBeNull()
  })

  it('un RUT con DV malo frena también la boleta, en Chile', () => {
    expect(problemaDelReceptor({ ...completo, rut: '76.543.210-5' }, boleta)).toBe(
      'El RUT del cliente no es válido',
    )
  })

  it('en otro país el RUT no se mira', () => {
    expect(problemaDelReceptor({ ...completo, rut: '20-12345678-9' }, otroPais)).toBeNull()
  })

  it.each([
    ['giro', 41, 'El giro no puede pasar de 40 caracteres (límite del SII)'],
    ['comuna', 21, 'La comuna no puede pasar de 20 caracteres (límite del SII)'],
    ['direccion', 71, 'La dirección no puede pasar de 70 caracteres (límite del SII)'],
    ['nombre', 101, 'La razón social no puede pasar de 100 caracteres (límite del SII)'],
  ] as const)('un %s de %i caracteres frena (un tercero precargado puede traerlo)', (campo, largo, mensaje) => {
    expect(problemaDelReceptor({ ...completo, [campo]: 'x'.repeat(largo) }, boleta)).toBe(mensaje)
  })
})

describe('problemaDelReceptorDeNota', () => {
  it('vacío es válido: la nota va a nombre del local', () => {
    expect(problemaDelReceptorDeNota({ nombre: ' ', rut: '' }, true)).toBeNull()
  })

  it.each([
    [{ nombre: 'Juan Pérez', rut: ' ' }, 'Falta el RUT del cliente'],
    [{ nombre: '  ', rut: '12.345.678-5' }, 'Falta el nombre del cliente'],
    [{ nombre: 'x'.repeat(101), rut: '12.345.678-5' }, 'La razón social no puede pasar de 100 caracteres (límite del SII)'],
    [{ nombre: 'Juan Pérez', rut: '12.345.678-9' }, 'El RUT del cliente no es válido'],
  ])('%j → %s', (receptor, mensaje) => {
    expect(problemaDelReceptorDeNota(receptor, true)).toBe(mensaje)
  })

  it('nombre y RUT válido pasan; en otro país el DV no se mira', () => {
    expect(problemaDelReceptorDeNota({ nombre: 'Juan Pérez', rut: '12.345.678-5' }, true)).toBeNull()
    expect(problemaDelReceptorDeNota({ nombre: 'Juan Pérez', rut: '20-12345678-9' }, false)).toBeNull()
  })
})
