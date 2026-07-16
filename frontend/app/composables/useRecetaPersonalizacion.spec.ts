import { describe, it, expect } from 'vitest'
import {
  sinStock,
  precioConExtras,
  buildPersonalizacionPayload,
  resumenPersonalizacion,
} from './useRecetaPersonalizacion'

describe('sinStock', () => {
  it('sinStock true si 0', () => expect(sinStock('0')).toBe(true))

  it('sinStock false si hay stock positivo', () => {
    expect(sinStock('1')).toBe(false)
    expect(sinStock('0.5')).toBe(false)
  })

  it('sinStock true si negativo o vacío', () => {
    expect(sinStock('-1')).toBe(true)
    expect(sinStock('')).toBe(true)
  })
})

describe('precioConExtras', () => {
  it('precioConExtras suma', () =>
    expect(precioConExtras('5000', [{ precioExtra: '800' }])).toBe('5800'))

  it('precioConExtras sin extras devuelve base', () => {
    expect(precioConExtras('5000', [])).toBe('5000')
  })

  it('precioConExtras suma varios extras', () => {
    expect(
      precioConExtras('5000', [{ precioExtra: '800' }, { precioExtra: '200' }]),
    ).toBe('6000')
  })
})

describe('buildPersonalizacionPayload', () => {
  it('arma omitidos, extras y comentario', () => {
    expect(
      buildPersonalizacionPayload(['ing-1'], ['extra-1'], 'sin sal'),
    ).toEqual({
      omitidos: ['ing-1'],
      extras: [{ ingredienteItemId: 'extra-1' }],
      comentario: 'sin sal',
    })
  })

  it('omite comentario vacío', () => {
    expect(buildPersonalizacionPayload([], [], '   ')).toEqual({
      omitidos: [],
      extras: [],
    })
  })

  it('trunca comentario a 200 caracteres', () => {
    const largo = 'a'.repeat(250)
    const payload = buildPersonalizacionPayload([], [], largo)
    expect(payload.comentario).toHaveLength(200)
  })
})

describe('resumenPersonalizacion', () => {
  it('resumen', () =>
    expect(resumenPersonalizacion(['Cebolla'], ['Queso'], 'medio')).toContain(
      'Sin Cebolla',
    ))

  it('incluye extra y comentario', () => {
    const r = resumenPersonalizacion(['Cebolla'], ['Queso'], 'medio')
    expect(r).toContain('Extra Queso')
    expect(r).toContain('medio')
  })

  it('devuelve vacío si no hay personalización', () => {
    expect(resumenPersonalizacion([], [], '')).toBe('')
  })
})
