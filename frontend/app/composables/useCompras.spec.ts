import { describe, expect, it } from 'vitest'
import { useCompras } from './useCompras'

const { totalLinea, subtotal, totalConDescuento, faltaAlgunPrecio, insigniaEstado, estadoOptions } = useCompras()

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
