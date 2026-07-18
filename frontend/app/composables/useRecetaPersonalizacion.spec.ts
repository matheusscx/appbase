import { describe, it, expect } from 'vitest'
import {
  sinStock,
  precioConExtras,
  buildPersonalizacionPayload,
  resumenPersonalizacion,
  detallePersonalizacionPreview,
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
  it('precioConExtras suma 1 unidad', () =>
    expect(precioConExtras('5000', [{ precioExtra: '800', unidades: 1 }])).toBe('5800'))

  it('precioConExtras multiplica por unidades', () =>
    expect(precioConExtras('5000', [{ precioExtra: '800', unidades: 3 }])).toBe('7400'))

  it('precioConExtras sin extras devuelve base', () => {
    expect(precioConExtras('5000', [])).toBe('5000')
  })

  it('precioConExtras suma varios extras con sus unidades', () => {
    expect(
      precioConExtras('5000', [
        { precioExtra: '800', unidades: 2 },
        { precioExtra: '200', unidades: 1 },
      ]),
    ).toBe('6800')
  })
})

describe('buildPersonalizacionPayload', () => {
  it('arma omitidos, extras con unidades y comentario', () => {
    expect(
      buildPersonalizacionPayload(
        ['ing-1'],
        [{ ingredienteItemId: 'extra-1', unidades: 2 }],
        'sin sal',
      ),
    ).toEqual({
      omitidos: ['ing-1'],
      extras: [{ ingredienteItemId: 'extra-1', unidades: 2 }],
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
    expect(
      resumenPersonalizacion(['Cebolla'], [{ nombre: 'Queso', unidades: 1 }], 'medio'),
    ).toContain('Sin Cebolla'))

  it('incluye extra y comentario', () => {
    const r = resumenPersonalizacion(['Cebolla'], [{ nombre: 'Queso', unidades: 1 }], 'medio')
    expect(r).toContain('Extra Queso')
    expect(r).toContain('medio')
  })

  it('muestra xN cuando hay más de una unidad', () => {
    const r = resumenPersonalizacion([], [{ nombre: 'Queso', unidades: 3 }])
    expect(r).toContain('Extra Queso x3')
  })

  it('no muestra x1 con una sola unidad', () => {
    const r = resumenPersonalizacion([], [{ nombre: 'Queso', unidades: 1 }])
    expect(r).toBe('Extra Queso')
  })

  it('devuelve vacío si no hay personalización', () => {
    expect(resumenPersonalizacion([], [], '')).toBe('')
  })
})

describe('detallePersonalizacionPreview', () => {
  it('omitidos primero en $0, extras después con monto = precioExtra × unidades', () => {
    const r = detallePersonalizacionPreview(
      ['Cebolla'],
      [{ nombre: 'Queso', unidades: 1, precioExtra: '1000' }, { nombre: 'Tocino', unidades: 2, precioExtra: '750' }],
    )
    expect(r).toEqual([
      { nombre: 'Cebolla', tipo: 'omitido', monto: '0' },
      { nombre: 'Queso', tipo: 'extra', unidades: 1, monto: '1000' },
      { nombre: 'Tocino', tipo: 'extra', unidades: 2, monto: '1500' },
    ])
  })

  it('devuelve [] si no hay omitidos ni extras', () => {
    expect(detallePersonalizacionPreview([], [])).toEqual([])
  })
})
