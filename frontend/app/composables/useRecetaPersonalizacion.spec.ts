import { describe, it, expect } from 'vitest'
import {
  sinStock,
  opcionSinStock,
  precioConExtras,
  buildPersonalizacionPayload,
  resumenPersonalizacion,
} from './useRecetaPersonalizacion'

describe('opcionSinStock', () => {
  it('null = no rastreado, nunca bloquea', () => {
    expect(opcionSinStock({ stock: null, stockDisponible: null })).toBe(false)
  })

  it('true si 0 o negativo', () => {
    expect(opcionSinStock({ stock: '0' })).toBe(true)
    expect(opcionSinStock({ stock: '-1' })).toBe(true)
  })

  it('false si hay stock positivo', () => {
    expect(opcionSinStock({ stock: '5' })).toBe(false)
  })

  // Las dos direcciones, y con números que no coinciden: si la opción volviera a
  // leer `stock`, el primer caso diría "hay 3" (falso, las mesas se los llevaron)
  // y el segundo diría "no hay" sobre stock que alguien acaba de liberar.
  it('manda lo disponible sobre el stock físico', () => {
    expect(opcionSinStock({ stock: '3', stockDisponible: '0' })).toBe(true)
    expect(opcionSinStock({ stock: '0', stockDisponible: '2' })).toBe(false)
  })
})

describe('sinStock', () => {
  it('sinStock true si 0', () => expect(sinStock({ stock: '0' })).toBe(true))

  it('sinStock false si hay stock positivo', () => {
    expect(sinStock({ stock: '1' })).toBe(false)
    expect(sinStock({ stock: '0.5' })).toBe(false)
  })

  it('sinStock true si negativo o vacío', () => {
    expect(sinStock({ stock: '-1' })).toBe(true)
    expect(sinStock({ stock: '' })).toBe(true)
  })

  // El bug que cierra este cambio: el drawer ofrecía los 250 g de carne que la
  // mesa 8 ya se había llevado, y los rechazaba recién al confirmar.
  it('manda lo disponible sobre el stock físico', () => {
    expect(sinStock({ stock: '3', stockDisponible: '0' })).toBe(true)
    expect(sinStock({ stock: '0', stockDisponible: '2' })).toBe(false)
  })

  // Una respuesta sin el campo (o un tipo que no lo trae) sigue decidiendo por
  // el stock físico, que es exactamente lo de antes de este cambio.
  it('sin stockDisponible cae al stock', () => {
    expect(sinStock({ stock: '4' })).toBe(false)
    expect(sinStock({ stock: '4', stockDisponible: null })).toBe(false)
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

  it('incluye grupos con opciones elegidas', () => {
    const payload = buildPersonalizacionPayload([], [], '', [
      { grupoId: 'g1', opciones: [{ itemId: 'coca', unidades: 1 }] },
    ])
    expect(payload.grupos).toEqual([
      { grupoId: 'g1', opciones: [{ itemId: 'coca', unidades: 1 }] },
    ])
  })

  it('omite grupos sin ninguna opción elegida', () => {
    const payload = buildPersonalizacionPayload([], [], '', [
      { grupoId: 'g1', opciones: [] },
    ])
    expect(payload.grupos).toBeUndefined()
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

  it('incluye la opción elegida de un grupo como "Grupo: Opción"', () => {
    const r = resumenPersonalizacion([], [], undefined, [
      { grupoNombre: 'Bebida', opcionNombre: 'Coca-Cola', unidades: 1 },
    ])
    expect(r).toBe('Bebida: Coca-Cola')
  })

  it('grupo con más de una unidad muestra xN', () => {
    const r = resumenPersonalizacion([], [], undefined, [
      { grupoNombre: 'Papas', opcionNombre: 'Porción extra', unidades: 2 },
    ])
    expect(r).toBe('Papas: Porción extra x2')
  })
})

