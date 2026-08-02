import { describe, it, expect } from 'vitest'
import {
  aCantidadCanonica,
  convertirPresentacion,
  desdeCantidadCanonica,
  esConteo,
  formatCantidadLinea,
  formatCantidadTicket,
  opcionesMismaMagnitud,
  puedeDecrementar,
} from './cantidad-presentacion'

const CAT = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
  { codigo: 'ml', magnitud: 'volumen', factorBase: '1' },
  { codigo: 'l', magnitud: 'volumen', factorBase: '1000' },
  { codigo: 'cm', magnitud: 'longitud', factorBase: '1' },
  { codigo: 'm', magnitud: 'longitud', factorBase: '100' },
]

describe('cantidad-presentacion', () => {
  it('convierte kg ↔ g', () => {
    expect(convertirPresentacion('500', 'g', 'kg', CAT)).toBe('0.5')
    expect(convertirPresentacion('0.5', 'kg', 'g', CAT)).toBe('500')
  })

  it('convierte m ↔ cm', () => {
    expect(convertirPresentacion('50', 'cm', 'm', CAT)).toBe('0.5')
    expect(convertirPresentacion('0.5', 'm', 'cm', CAT)).toBe('50')
  })

  it('opcionesMismaMagnitud filtra por magnitud', () => {
    const opts = opcionesMismaMagnitud('kg', CAT)
    expect(opts.map(o => o.codigo).sort()).toEqual(['g', 'kg'])
    expect(opcionesMismaMagnitud('m', CAT).map(o => o.codigo).sort()).toEqual(['cm', 'm'])
  })

  it('conteo: puedeDecrementar false en 1', () => {
    expect(puedeDecrementar('1', 'unidad', CAT)).toBe(false)
    expect(puedeDecrementar('2', 'unidad', CAT)).toBe(true)
  })

  it('continua: puedeDecrementar no baja a ≤0', () => {
    expect(puedeDecrementar('1', 'g', CAT)).toBe(false)
    expect(puedeDecrementar('2', 'g', CAT)).toBe(true)
  })

  it('aCantidadCanonica y desdeCantidadCanonica son inversas', () => {
    const canon = aCantidadCanonica('500', 'g', 'kg', CAT)
    expect(canon).toBe('0.5')
    expect(desdeCantidadCanonica(canon, 'kg', 'g', CAT)).toBe('500')
  })

  it('esConteo detecta magnitud conteo', () => {
    expect(esConteo('unidad', CAT)).toBe(true)
    expect(esConteo('kg', CAT)).toBe(false)
  })

  it('formatCantidadTicket incluye unidad para magnitudes fraccionarias', () => {
    expect(formatCantidadTicket('500', 'g', true)).toBe('500 g')
  })

  it('formatCantidadTicket recorta ceros sobrantes en fraccionarias, con coma decimal (es-CL)', () => {
    expect(formatCantidadTicket('1.50', 'kg', true)).toBe('1,5 kg')
    expect(formatCantidadTicket('2.00', 'kg', true)).toBe('2 kg')
  })

  it('formatCantidadTicket redondea a entero y omite el sufijo de unidad en conteo', () => {
    expect(formatCantidadTicket('2', 'unidad', false)).toBe('2')
    expect(formatCantidadTicket('2.00', 'unidad', false)).toBe('2')
  })

  it('formatCantidadTicket sin unidadCodigo recorta igual, solo que sin sufijo', () => {
    // Devolvía el string crudo, y por eso el detalle de venta mostraba
    // `1.0000` en toda línea sin presentación —el caso más común—.
    expect(formatCantidadTicket('1.0000', null, true)).toBe('1')
    expect(formatCantidadTicket('2.5000', null, true)).toBe('2,5')
    expect(formatCantidadTicket('2', null, true)).toBe('2')
  })

  describe('formatCantidadLinea', () => {
    it('usa la presentación cuando la línea se vendió por presentación', () => {
      expect(formatCantidadLinea('2000', '2', 'kg', true)).toBe('2 kg')
    })

    it('cae a la cantidad canónica recortada cuando no hay presentación', () => {
      expect(formatCantidadLinea('1.0000', null, null, false)).toBe('1')
      expect(formatCantidadLinea('2.5000', null, null, false)).toBe('2,5')
    })

    it('ignora una presentación a medias: sin unidad no se puede formatear', () => {
      // `cantidadPresentacion` sin `unidadCodigoPresentacion` no dice en qué
      // unidad está, así que gana la canónica.
      expect(formatCantidadLinea('24.0000', '2', null, true)).toBe('24')
      expect(formatCantidadLinea('24.0000', null, 'caja', true)).toBe('24')
    })
  })
})
