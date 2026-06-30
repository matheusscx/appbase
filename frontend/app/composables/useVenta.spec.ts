import { describe, it, expect } from 'vitest'
import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  toCalcularInput,
  sumaPagos,
  resumenCobro,
  clampNoVuelto,
  puedeCobrar,
  type CarritoLinea,
  type ItemCatalogo,
} from './useVenta'

const item = (id: string, precio = '100'): ItemCatalogo => ({
  id,
  nombre: `Item ${id}`,
  descripcion: null,
  precioBase: precio,
  monedaSimbolo: '$',
  stock: '10',
  tipo: 'producto',
})

describe('carrito helpers', () => {
  it('agregarLinea agrega una línea nueva con cantidad "1"', () => {
    const r = agregarLinea([], item('a'))
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('1')
  })

  it('agregarLinea incrementa la cantidad si el item ya está', () => {
    const r = agregarLinea([{ item: item('a'), cantidad: '1' }], item('a'))
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('agregarLinea no muta el array original', () => {
    const original: CarritoLinea[] = []
    agregarLinea(original, item('a'))
    expect(original).toHaveLength(0)
  })

  it('quitarLinea elimina por itemId', () => {
    const r = quitarLinea([{ item: item('a'), cantidad: '1' }], 'a')
    expect(r).toHaveLength(0)
  })

  it('setCantidad reemplaza la cantidad de la línea', () => {
    const r = setCantidad([{ item: item('a'), cantidad: '1' }], 'a', '5')
    expect(r[0]!.cantidad).toBe('5')
  })

  it('toCalcularInput mapea a { lineas: [{ itemId, cantidad }] }', () => {
    const r = toCalcularInput([{ item: item('a'), cantidad: '3' }])
    expect(r).toEqual({ lineas: [{ itemId: 'a', cantidad: '3' }] })
  })
})

describe('pagos helpers', () => {
  it('sumaPagos suma montos string con precisión', () => {
    expect(sumaPagos([{ metodoPagoId: 'm1', monto: '0.1' }, { metodoPagoId: 'm2', monto: '0.2' }])).toBe('0.3')
  })

  it('resumenCobro: restante positivo cuando pagos < total', () => {
    const r = resumenCobro('100', [{ metodoPagoId: 'm1', monto: '40' }], [{ metodoPagoId: 'm1', permiteVuelto: true }])
    expect(r.restante).toBe('60')
    expect(r.vuelto).toBe('0')
    expect(r.excedenteSinVuelto).toBe(false)
  })

  it('resumenCobro: vuelto cuando hay excedente y el método permite vuelto', () => {
    const r = resumenCobro('100', [{ metodoPagoId: 'm1', monto: '150' }], [{ metodoPagoId: 'm1', permiteVuelto: true }])
    expect(r.restante).toBe('0')
    expect(r.vuelto).toBe('50')
    expect(r.excedenteSinVuelto).toBe(false)
  })

  it('resumenCobro: excedenteSinVuelto cuando excede y ningún método permite vuelto', () => {
    const r = resumenCobro('100', [{ metodoPagoId: 'm1', monto: '150' }], [{ metodoPagoId: 'm1', permiteVuelto: false }])
    expect(r.vuelto).toBe('0')
    expect(r.excedenteSinVuelto).toBe(true)
  })
})

describe('clampNoVuelto', () => {
  const metodos = [
    { metodoPagoId: 'efe', permiteVuelto: true },
    { metodoPagoId: 'tdc', permiteVuelto: false },
  ]

  it('recorta el monto de un método sin vuelto al total', () => {
    const r = clampNoVuelto('1500.0000', [{ metodoPagoId: 'tdc', monto: '2000' }], metodos)
    expect(r[0]!.monto).toBe('1500')
  })

  it('no toca un método sin vuelto cuyo monto no supera el total', () => {
    const r = clampNoVuelto('1500.0000', [{ metodoPagoId: 'tdc', monto: '1500.0000' }], metodos)
    expect(r[0]!.monto).toBe('1500.0000')
  })

  it('nunca aumenta el monto, solo lo recorta', () => {
    const r = clampNoVuelto('1500', [{ metodoPagoId: 'tdc', monto: '500' }], metodos)
    expect(r[0]!.monto).toBe('500')
  })

  it('permite sobrepago en métodos con vuelto (no recorta efectivo)', () => {
    const r = clampNoVuelto('1500', [{ metodoPagoId: 'efe', monto: '2000' }], metodos)
    expect(r[0]!.monto).toBe('2000')
  })

  it('en pagos divididos, recorta el método sin vuelto al restante tras los otros pagos', () => {
    const r = clampNoVuelto(
      '1500',
      [{ metodoPagoId: 'efe', monto: '1000' }, { metodoPagoId: 'tdc', monto: '900' }],
      metodos,
    )
    expect(r[0]!.monto).toBe('1000')
    expect(r[1]!.monto).toBe('500')
  })

  it('recorta a 0 cuando los otros pagos ya cubren el total', () => {
    const r = clampNoVuelto(
      '1500',
      [{ metodoPagoId: 'efe', monto: '1500' }, { metodoPagoId: 'tdc', monto: '300' }],
      metodos,
    )
    expect(r[1]!.monto).toBe('0')
  })

  it('es idempotente', () => {
    const once = clampNoVuelto('1500', [{ metodoPagoId: 'tdc', monto: '2000' }], metodos)
    const twice = clampNoVuelto('1500', once, metodos)
    expect(twice).toEqual(once)
  })

  it('devuelve la misma referencia de array cuando no hay cambios', () => {
    const pagos = [{ metodoPagoId: 'tdc', monto: '1500' }]
    expect(clampNoVuelto('1500', pagos, metodos)).toBe(pagos)
  })
})

describe('puedeCobrar (gate)', () => {
  const lineas: CarritoLinea[] = [{ item: item('a'), cantidad: '1' }]
  const docId = 'tipo-doc-1'

  it('false sin caja', () => {
    expect(puedeCobrar({ tieneCaja: false, lineas, customerRequerido: false, customerExpandido: false, customerNombre: '', tipoDocumentoId: docId })).toBe(false)
  })

  it('false con carrito vacío', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas: [], customerRequerido: false, customerExpandido: false, customerNombre: '', tipoDocumentoId: docId })).toBe(false)
  })

  it('false si tipoDocumentoId es undefined', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, customerRequerido: false, customerExpandido: false, customerNombre: '', tipoDocumentoId: undefined })).toBe(false)
  })

  it('false si customerRequerido y falta nombre', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, customerRequerido: true, customerExpandido: false, customerNombre: '  ', tipoDocumentoId: docId })).toBe(false)
  })

  it('true con caja, líneas y (sin factura) sin cliente', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, customerRequerido: false, customerExpandido: false, customerNombre: '', tipoDocumentoId: docId })).toBe(true)
  })

  it('true con factura y nombre de cliente', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, customerRequerido: true, customerExpandido: false, customerNombre: 'Juan', tipoDocumentoId: docId })).toBe(true)
  })

  it('false con customerExpandido sin nombre', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, customerRequerido: false, customerExpandido: true, customerNombre: '', tipoDocumentoId: docId })).toBe(false)
  })

  it('true con customerExpandido y nombre', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, customerRequerido: false, customerExpandido: true, customerNombre: 'Juan', tipoDocumentoId: docId })).toBe(true)
  })

  it('true con customerExpandido: false sin nombre (form cerrado)', () => {
    expect(puedeCobrar({ tieneCaja: true, lineas, customerRequerido: false, customerExpandido: false, customerNombre: '', tipoDocumentoId: docId })).toBe(true)
  })
})
