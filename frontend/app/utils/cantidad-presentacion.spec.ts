import { describe, it, expect } from 'vitest'
import {
  aCantidadCanonica,
  convertirPresentacion,
  desdeCantidadCanonica,
  esConteo,
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

  it('formatCantidadTicket incluye unidad', () => {
    expect(formatCantidadTicket('500', 'g')).toBe('500 g')
    expect(formatCantidadTicket('2', null)).toBe('2')
  })
})
