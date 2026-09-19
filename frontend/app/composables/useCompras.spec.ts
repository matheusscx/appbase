import { describe, expect, it } from 'vitest'
import { useCompras } from './useCompras'

const {
  totalLinea,
  subtotal,
  totalConDescuento,
  faltaAlgunPrecio,
  insigniaEstado,
  estadoOptions,
  diferenciaCantidad,
  cuerpoCorreccion,
  cuerpoDescuento,
  cantidadConUnidad,
  cantidadParaEditar,
  etiquetaCambio,
} = useCompras()

describe('useCompras', () => {
  it('total de línea: 20,35 kg a $1.490 da 30321.5 (solo para comparar con el papel)', () => {
    expect(totalLinea('20.35', '1490')).toBe('30321.5')
  })

  it('sin precio, o con un precio a medio tipear, no hay total de línea', () => {
    expect(totalLinea('3', null)).toBeNull()
    expect(totalLinea('3', '')).toBeNull()
    expect(totalLinea('3', '12,')).toBeNull()
  })

  it('el subtotal es null si falta algún precio, y el regalo a $0 cuenta como precio', () => {
    expect(subtotal([
      { cantidad: '1', precioUnitario: '10' },
      { cantidad: '1', precioUnitario: null },
    ])).toBeNull()
    expect(subtotal([
      { cantidad: '2', precioUnitario: '10' },
      { cantidad: '1', precioUnitario: '0' },
    ])).toBe('20')
  })

  it('el total resta el descuento; sin subtotal no hay total, y un descuento vacío no descuenta', () => {
    // La lata del owner: 12 cajas de $30.000 con 5 % de descuento al total.
    expect(totalConDescuento('360000', '18000')).toBe('342000')
    expect(totalConDescuento('360000', '')).toBe('360000')
    expect(totalConDescuento(null, '18000')).toBeNull()
  })

  it('diferenciaCantidad dice si sube o baja y cuánto; nada si no cambia o no es un número', () => {
    expect(diferenciaCantidad('10', '12')).toEqual({ sube: true, cuanto: '2' })
    expect(diferenciaCantidad('10', '8.5')).toEqual({ sube: false, cuanto: '1.5' })
    expect(diferenciaCantidad('10', '10.000')).toBeNull()
    expect(diferenciaCantidad('10', '0')).toBeNull()
    expect(diferenciaCantidad('10', '12,')).toBeNull()
  })

  it('cuerpoCorreccion manda solo lo que cambió, y nada si no cambió nada', () => {
    const actual = { cantidad: '10', precioUnitario: '1000.0000' }
    expect(cuerpoCorreccion(actual, { cantidad: '10', precioUnitario: '1000' })).toBeNull()
    expect(cuerpoCorreccion(actual, { cantidad: '10', precioUnitario: '1500' }))
      .toEqual({ precioUnitario: '1500' })
    expect(cuerpoCorreccion(actual, { cantidad: '12', precioUnitario: '1000' }))
      .toEqual({ cantidad: '12' })
    // Completar: el precio que faltaba.
    expect(cuerpoCorreccion({ cantidad: '10', precioUnitario: null }, { cantidad: '10', precioUnitario: '1500' }))
      .toEqual({ precioUnitario: '1500' })
    // Un precio borrado no se manda: "volver a sin precio" no es una corrección.
    expect(cuerpoCorreccion(actual, { cantidad: '10', precioUnitario: '' })).toBeNull()
  })

  it('cuerpoCorreccion en serie lleva las series que entran o las unidades que salen, solo si cambia la cantidad', () => {
    const actual = { cantidad: '2', precioUnitario: '90000' }
    expect(cuerpoCorreccion(actual, { cantidad: '3', precioUnitario: '90000' }, { series: ['SN-3'] }))
      .toEqual({ cantidad: '3', series: [{ serie: 'SN-3' }] })
    expect(cuerpoCorreccion(actual, { cantidad: '1', precioUnitario: '90000' }, { unidadIds: ['u-1'] }))
      .toEqual({ cantidad: '1', unidadIds: ['u-1'] })
    expect(cuerpoCorreccion(actual, { cantidad: '2', precioUnitario: '95000' }, { series: ['SN-3'] }))
      .toEqual({ precioUnitario: '95000' })
  })

  it('cuerpoDescuento manda la clave siempre, vacío es null, y nada si no cambia', () => {
    expect(cuerpoDescuento(null, '2000')).toEqual({ descuentoTotal: '2000' })
    expect(cuerpoDescuento('2000.0000', '')).toEqual({ descuentoTotal: null })
    expect(cuerpoDescuento('2000.0000', '2000')).toBeNull()
    expect(cuerpoDescuento(null, '')).toBeNull()
    expect(cuerpoDescuento(null, '12,')).toBeNull()
  })

  it('la cantidad de la base se muestra sin los ceros de la columna, con coma y su unidad', () => {
    expect(cantidadConUnidad('10.0000', 'unidad')).toBe('10 unidad')
    expect(cantidadConUnidad('20.3500', 'kg')).toBe('20,35 kg')
    expect(cantidadParaEditar('10.0000')).toBe('10')
    expect(cantidadParaEditar('20.3500')).toBe('20.35')
  })

  it('etiquetaCambio nombra el campo del historial', () => {
    expect(etiquetaCambio('descuento')).toBe('Descuento al total')
    expect(etiquetaCambio('precio')).toBe('Precio')
  })

  it('faltaAlgunPrecio distingue el 0 (regalo) del vacío', () => {
    expect(faltaAlgunPrecio([{ precioUnitario: '0' }])).toBe(false)
    expect(faltaAlgunPrecio([{ precioUnitario: null }])).toBe(true)
    expect(faltaAlgunPrecio([{ precioUnitario: '' }])).toBe(true)
  })

  it('una confirmada sin costo lleva dos insignias', () => {
    expect(insigniaEstado({ estado: 'confirmada', faltaCosto: true }).map(i => i.label))
      .toEqual(['Confirmada', 'Falta costo'])
    expect(insigniaEstado({ estado: 'borrador', faltaCosto: false }).map(i => i.label))
      .toEqual(['Borrador'])
  })

  it('las opciones del filtro salen del mismo mapa que las etiquetas', () => {
    expect(estadoOptions.map(o => o.value)).toEqual(['borrador', 'confirmada', 'anulada'])
  })
})
