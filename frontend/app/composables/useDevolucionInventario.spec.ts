import { describe, it, expect } from 'vitest'
import {
  esDecimalValido,
  agruparFilasDevolucion,
  setCantidadFila,
  filasDevolucionValidas,
  devolucionesPayload,
  notaDevolucion,
  filaDevolvible,
  type DetalleVentaDevolucion,
  type FilaDevolucion,
} from './useDevolucionInventario'

const detalle = (
  itemId: string,
  overrides: Partial<DetalleVentaDevolucion> = {},
): DetalleVentaDevolucion => ({
  itemId,
  descripcion: `Item ${itemId}`,
  cantidad: '2',
  modoInventario: 'cantidad',
  cantidadDevuelta: '0',
  ...overrides,
})

const fila = (
  itemId: string,
  overrides: Partial<FilaDevolucion> = {},
): FilaDevolucion => ({
  itemId,
  descripcion: `Item ${itemId}`,
  disponible: '2',
  modoInventario: 'cantidad',
  cantidad: '',
  ...overrides,
})

describe('esDecimalValido', () => {
  it('acepta enteros y decimales positivos', () => {
    expect(esDecimalValido('1')).toBe(true)
    expect(esDecimalValido('0.5')).toBe(true)
    expect(esDecimalValido('10.25')).toBe(true)
  })

  it('rechaza vacío, negativos y no numéricos', () => {
    expect(esDecimalValido('')).toBe(false)
    expect(esDecimalValido('-1')).toBe(false)
    expect(esDecimalValido('abc')).toBe(false)
    expect(esDecimalValido('1,5')).toBe(false)
  })
})

describe('agruparFilasDevolucion', () => {
  it('crea una fila por ítem con disponible = cantidad − cantidadDevuelta', () => {
    const filas = agruparFilasDevolucion([
      detalle('a', { cantidad: '3', cantidadDevuelta: '1' }),
    ])
    expect(filas).toEqual([
      {
        itemId: 'a',
        descripcion: 'Item a',
        disponible: '2',
        modoInventario: 'cantidad',
        cantidad: '',
      },
    ])
  })

  it('agrupa líneas del mismo ítem restando cantidadDevuelta UNA sola vez (el backend repite el total por ítem en cada línea)', () => {
    const filas = agruparFilasDevolucion([
      detalle('a', { cantidad: '2', cantidadDevuelta: '1' }),
      detalle('a', { cantidad: '3', cantidadDevuelta: '1' }),
    ])
    // disponible = (2 + 3) − 1, no − 2
    expect(filas).toHaveLength(1)
    expect(filas[0]!.disponible).toBe('4')
  })

  it('usa itemId como descripción cuando la línea no tiene descripción', () => {
    const filas = agruparFilasDevolucion([detalle('a', { descripcion: null })])
    expect(filas[0]!.descripcion).toBe('a')
  })

  it('preserva modoInventario null (servicio)', () => {
    const filas = agruparFilasDevolucion([detalle('s', { modoInventario: null })])
    expect(filas[0]!.modoInventario).toBeNull()
  })
})

describe('setCantidadFila', () => {
  it('actualiza solo la fila del ítem, de forma inmutable', () => {
    const filas = [fila('a'), fila('b')]
    const result = setCantidadFila(filas, 'a', '1.5')
    expect(result[0]!.cantidad).toBe('1.5')
    expect(result[1]!.cantidad).toBe('')
    expect(filas[0]!.cantidad).toBe('')
    expect(result).not.toBe(filas)
  })
})

describe('filasDevolucionValidas', () => {
  it('vacías o sin cantidad son válidas', () => {
    expect(filasDevolucionValidas([])).toBe(true)
    expect(filasDevolucionValidas([fila('a')])).toBe(true)
  })

  it('cantidad no numérica invalida', () => {
    expect(filasDevolucionValidas([fila('a', { cantidad: 'x' })])).toBe(false)
  })

  it('cantidad que excede el disponible invalida', () => {
    expect(filasDevolucionValidas([fila('a', { disponible: '2', cantidad: '3' })])).toBe(false)
    expect(filasDevolucionValidas([fila('a', { disponible: '2', cantidad: '2' })])).toBe(true)
  })
})

describe('devolucionesPayload', () => {
  it('incluye solo filas con cantidad válida > 0', () => {
    const payload = devolucionesPayload([
      fila('a', { cantidad: '1' }),
      fila('b', { cantidad: '' }),
      fila('c', { cantidad: '0' }),
      fila('d', { cantidad: 'x' }),
    ])
    expect(payload).toEqual([{ itemId: 'a', cantidad: '1' }])
  })
})

describe('notaDevolucion / filaDevolvible', () => {
  it('servicio (modoInventario null): nota y no devolvible', () => {
    const f = fila('s', { modoInventario: null })
    expect(notaDevolucion(f)).toBe('Servicio: sin stock')
    expect(filaDevolvible(f)).toBe(false)
  })

  it('modo serie/lote: nota de devolución manual y no devolvible', () => {
    const f = fila('l', { modoInventario: 'lote' })
    expect(notaDevolucion(f)).toBe('Modo lote: devolución manual desde Inventario')
    expect(filaDevolvible(f)).toBe(false)
  })

  it('modo cantidad con disponible > 0: sin nota y devolvible', () => {
    const f = fila('a')
    expect(notaDevolucion(f)).toBeNull()
    expect(filaDevolvible(f)).toBe(true)
  })

  it('modo cantidad sin disponible: sin nota pero no devolvible', () => {
    const f = fila('a', { disponible: '0' })
    expect(notaDevolucion(f)).toBeNull()
    expect(filaDevolvible(f)).toBe(false)
  })
})
