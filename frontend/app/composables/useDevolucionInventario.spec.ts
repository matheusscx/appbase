import { describe, it, expect } from 'vitest'
import {
  esDecimalValido,
  agruparFilasDevolucion,
  setCantidadFila,
  filasDevolucionValidas,
  devolucionesPayload,
  notaDevolucion,
  filaDevolvible,
  filaAcreditable,
  setReponerFila,
  normalizarParaSoloStock,
  filaEditable,
  valorAproximadoDevuelto,
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
  totalLinea: '2000',
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
  puedeReponer: true,
  reponerStock: true,
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
        puedeReponer: true,
        reponerStock: true,
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

  it('la reposición nace en lo que el ítem PUEDE, no en true', () => {
    // Tres modos distintos en la misma tanda: con uno solo, arrancar todo en
    // `true` pasaría igual.
    const filas = agruparFilasDevolucion([
      detalle('a', { modoInventario: 'cantidad' }),
      detalle('l', { modoInventario: 'lote' }),
      detalle('s', { modoInventario: null }),
    ])
    expect(filas.map(f => [f.puedeReponer, f.reponerStock])).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ])
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
    expect(payload).toEqual([{ itemId: 'a', cantidad: '1', reponerStock: true }])
  })

  it('el payload lleva la reposición de CADA fila', () => {
    // Las dos con cantidad y con reposición distinta: con un solo valor, mandar
    // siempre `true` pasaría igual.
    const payload = devolucionesPayload([
      fila('a', { cantidad: '2', reponerStock: true }),
      fila('b', { cantidad: '1', reponerStock: false }),
    ])
    expect(payload).toEqual([
      { itemId: 'a', cantidad: '2', reponerStock: true },
      { itemId: 'b', cantidad: '1', reponerStock: false },
    ])
  })
})

describe('setReponerFila', () => {
  it('apaga la reposición de la fila pedida y no toca las otras', () => {
    const filas = [fila('a'), fila('b')]
    const r = setReponerFila(filas, 'a', false)
    expect(r.map(f => f.reponerStock)).toEqual([false, true])
  })

  it('no la enciende donde el ítem no puede reponer', () => {
    // Encenderla mandaría al backend un pedido que rechaza con 400.
    const filas = [fila('s', { modoInventario: null, puedeReponer: false, reponerStock: false })]
    expect(setReponerFila(filas, 's', true)[0]!.reponerStock).toBe(false)
  })
})

describe('normalizarParaSoloStock', () => {
  // El gesto: destildar "generar nota de crédito" en el modal de reembolso. Ese
  // camino EXIGE que toda línea reponga, y su 400 llega después del commit del
  // reembolso: la plata ya volvió y la mercadería no vuelve al stock.
  it('la que el operador apagó con el switch vuelve a reponer, sin perder la cantidad', () => {
    // ⚠️ Es el caso que un filtro por `puedeReponer` deja pasar: la fila PUEDE
    // reponer, el operador la apagó, y al destildar el switch desaparece del
    // DOM — así que ese `false` queda invisible y sale en el payload.
    const filas = [fila('a', { cantidad: '2', reponerStock: false })]
    const r = normalizarParaSoloStock(filas)
    expect(r[0]!.reponerStock).toBe(true)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('la que no puede reponer pierde la cantidad', () => {
    const filas = [
      fila('s', { cantidad: '1', modoInventario: null, puedeReponer: false, reponerStock: false }),
    ]
    const r = normalizarParaSoloStock(filas)
    expect(r[0]!.cantidad).toBe('')
    expect(r[0]!.reponerStock).toBe(false)
  })

  it('ninguna fila queda con reponerStock false y cantidad tipeada', () => {
    // El invariante que el camino de solo-stock necesita, sobre la mezcla.
    const filas = [
      fila('a', { cantidad: '2', reponerStock: false }),
      fila('b', { cantidad: '5' }),
      fila('s', { cantidad: '1', modoInventario: null, puedeReponer: false, reponerStock: false }),
    ]
    expect(
      normalizarParaSoloStock(filas).filter(f => f.cantidad && !f.reponerStock),
    ).toEqual([])
  })
})

describe('filaEditable', () => {
  it('en el camino que acredita entra cualquier ítem; en el de stock, solo el que repone', () => {
    const servicio = fila('s', { modoInventario: null, puedeReponer: false, reponerStock: false })
    const producto = fila('a')
    expect(filaEditable(servicio, 'acredita')).toBe(true)
    expect(filaEditable(servicio, 'solo-stock')).toBe(false)
    expect(filaEditable(producto, 'acredita')).toBe(true)
    expect(filaEditable(producto, 'solo-stock')).toBe(true)
  })

  it('sin disponible no se edita en ningún camino', () => {
    const f = fila('a', { disponible: '0' })
    expect(filaEditable(f, 'acredita')).toBe(false)
    expect(filaEditable(f, 'solo-stock')).toBe(false)
  })
})

describe('notaDevolucion / filaDevolvible / filaAcreditable', () => {
  it('servicio (modoInventario null): no vuelve al stock, pero SÍ se acredita', () => {
    // Es el cambio del 2026-09-04: acreditar dejó de exigir que el ítem pudiera
    // volver al inventario.
    const f = fila('s', { modoInventario: null, puedeReponer: false, reponerStock: false })
    expect(notaDevolucion(f)).toBe('Servicio: no vuelve al stock')
    expect(filaDevolvible(f)).toBe(false)
    expect(filaAcreditable(f)).toBe(true)
  })

  it('modo serie/lote: la vuelta al stock va por Inventario, y se acredita igual', () => {
    const f = fila('l', { modoInventario: 'lote', puedeReponer: false, reponerStock: false })
    expect(notaDevolucion(f)).toBe(
      'Modo lote: la vuelta al stock se registra desde Inventario',
    )
    expect(filaDevolvible(f)).toBe(false)
    expect(filaAcreditable(f)).toBe(true)
  })

  it('modo cantidad con disponible > 0: sin nota, devolvible y acreditable', () => {
    const f = fila('a')
    expect(notaDevolucion(f)).toBeNull()
    expect(filaDevolvible(f)).toBe(true)
    expect(filaAcreditable(f)).toBe(true)
  })

  it('sin disponible no se acredita ni se devuelve, pueda o no reponer', () => {
    // Las dos mitades del título: una fila que puede reponer y otra que no.
    const producto = fila('a', { disponible: '0' })
    const servicio = fila('s', {
      disponible: '0', modoInventario: null, puedeReponer: false, reponerStock: false,
    })
    for (const f of [producto, servicio]) {
      expect(filaDevolvible(f)).toBe(false)
      expect(filaAcreditable(f)).toBe(false)
    }
    expect(notaDevolucion(producto)).toBeNull()
  })
})

describe('valorAproximadoDevuelto', () => {
  it('valúa cada ítem a lo que costó EN LA BOLETA, no al precio de lista', () => {
    // 3 unidades por 3.570 en total → 1.190 la unidad. Se marcan 2 → 2.380.
    // Valores que NO dividen redondo entre sí: con 1.000 la unidad, un cálculo
    // que usara el total de la línea entera pasaría igual.
    const detalles = [detalle('a', { cantidad: '3', totalLinea: '3570' })]
    const filas = [fila('a', { cantidad: '2' })]
    expect(valorAproximadoDevuelto(detalles, filas)).toBe('2380')
  })

  it('suma las líneas del mismo ítem antes de dividir', () => {
    // Dos líneas del mismo ítem con precios distintos: 1.000/1 y 4.000/2. El
    // valor por unidad es (1.000 + 4.000) / 3 = 1.666,66…, no el de una línea.
    const detalles = [
      detalle('a', { cantidad: '1', totalLinea: '1000' }),
      detalle('a', { cantidad: '2', totalLinea: '4000' }),
    ]
    const filas = [fila('a', { cantidad: '3' })]
    expect(valorAproximadoDevuelto(detalles, filas)).toBe('5000')
  })

  it('ignora filas sin cantidad, con cantidad inválida o de ítems que no están', () => {
    const detalles = [detalle('a', { cantidad: '2', totalLinea: '2000' })]
    const filas = [
      fila('a', { cantidad: '' }),
      fila('a', { cantidad: 'x' }),
      fila('z', { cantidad: '1' }),
    ]
    expect(valorAproximadoDevuelto(detalles, filas)).toBe('0')
  })

  it('una línea de cantidad cero no divide por cero', () => {
    const detalles = [detalle('a', { cantidad: '0', totalLinea: '0' })]
    expect(valorAproximadoDevuelto(detalles, [fila('a', { cantidad: '1' })])).toBe('0')
  })
})
