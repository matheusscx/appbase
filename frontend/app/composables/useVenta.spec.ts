import { describe, it, expect } from 'vitest'
import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  toCalcularInput,
  descontarStockCatalogo,
  sumaPagos,
  resumenCobro,
  setMontoPago,
  puedeCobrar,
  type CarritoLinea,
  type ItemCatalogo,
} from './useVenta'

const item = (id: string, precio = '100'): ItemCatalogo => ({
  id,
  nombre: `Item ${id}`,
  descripcion: null,
  precioBase: precio,
  monedaId: 'moneda-clp',
  monedaSimbolo: '$',
  stock: '10',
  unidadMedida: 'unidad',
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

  it('descontarStockCatalogo resta las cantidades vendidas', () => {
    const catalogo = [item('a'), item('b', '50')]
    const r = descontarStockCatalogo(catalogo, [
      { item: item('a'), cantidad: '3' },
      { item: item('b'), cantidad: '2' },
    ])
    expect(r.find((i) => i.id === 'a')!.stock).toBe('7')
    expect(r.find((i) => i.id === 'b')!.stock).toBe('8')
  })

  it('descontarStockCatalogo acumula varias líneas del mismo ítem', () => {
    const catalogo = [item('a')]
    const r = descontarStockCatalogo(catalogo, [
      { item: item('a'), cantidad: '2' },
      { item: item('a'), cantidad: '4' },
    ])
    expect(r[0]!.stock).toBe('4')
  })

  it('descontarStockCatalogo no baja de cero', () => {
    const catalogo = [item('a')]
    const r = descontarStockCatalogo(catalogo, [{ item: item('a'), cantidad: '15' }])
    expect(r[0]!.stock).toBe('0')
  })

  it('descontarStockCatalogo no muta el catálogo original', () => {
    const catalogo = [item('a')]
    descontarStockCatalogo(catalogo, [{ item: item('a'), cantidad: '1' }])
    expect(catalogo[0]!.stock).toBe('10')
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

  const metodosMixtos = [
    { metodoPagoId: 'efe', permiteVuelto: true },
    { metodoPagoId: 'tdc', permiteVuelto: false },
  ]

  it('resumenCobro: excedenteSinVuelto cuando los métodos sin vuelto superan el total, aunque haya efectivo', () => {
    const r = resumenCobro(
      '1000',
      [{ metodoPagoId: 'efe', monto: '100' }, { metodoPagoId: 'tdc', monto: '1100' }],
      metodosMixtos,
    )
    expect(r.vuelto).toBe('0')
    expect(r.excedenteSinVuelto).toBe(true)
  })

  it('resumenCobro: vuelto cuando el excedente proviene del efectivo y los métodos sin vuelto no superan el total', () => {
    const r = resumenCobro(
      '1000',
      [{ metodoPagoId: 'tdc', monto: '800' }, { metodoPagoId: 'efe', monto: '500' }],
      metodosMixtos,
    )
    expect(r.vuelto).toBe('300')
    expect(r.excedenteSinVuelto).toBe(false)
  })

  it('resumenCobro: varios métodos sin vuelto que en conjunto superan el total marcan excedenteSinVuelto', () => {
    const r = resumenCobro(
      '1000',
      [{ metodoPagoId: 'tdc', monto: '700' }, { metodoPagoId: 'tdc', monto: '400' }],
      metodosMixtos,
    )
    expect(r.vuelto).toBe('0')
    expect(r.excedenteSinVuelto).toBe(true)
  })
})

describe('setMontoPago', () => {
  it('editar el segundo pago le resta el excedente al primero', () => {
    const r = setMontoPago('5950', [
      { metodoPagoId: 'efe', monto: '5950' },
      { metodoPagoId: 'tdc', monto: '0' },
    ], 1, '500')
    expect(r[0]!.monto).toBe('5450')
    expect(r[1]!.monto).toBe('500')
  })

  it('no toca los demás pagos cuando la suma no supera el total', () => {
    const r = setMontoPago('5950', [
      { metodoPagoId: 'efe', monto: '3000' },
      { metodoPagoId: 'tdc', monto: '0' },
    ], 1, '500')
    expect(r[0]!.monto).toBe('3000')
    expect(r[1]!.monto).toBe('500')
  })

  it('el pago editado conserva lo escrito aunque él solo supere el total (los demás bajan a 0)', () => {
    const r = setMontoPago('5950', [
      { metodoPagoId: 'efe', monto: '5950' },
      { metodoPagoId: 'tdc', monto: '0' },
    ], 1, '7000')
    expect(r[0]!.monto).toBe('0')
    expect(r[1]!.monto).toBe('7000')
  })

  it('el excedente cascadea entre varios pagos empezando por el primero', () => {
    const r = setMontoPago('1000', [
      { metodoPagoId: 'efe', monto: '300' },
      { metodoPagoId: 'tdc', monto: '700' },
      { metodoPagoId: 'trf', monto: '0' },
    ], 2, '500')
    expect(r[0]!.monto).toBe('0')
    expect(r[1]!.monto).toBe('500')
    expect(r[2]!.monto).toBe('500')
  })

  it('un solo pago puede sobrepagar (no hay otros para ajustar; el vuelto se resuelve al confirmar)', () => {
    const r = setMontoPago('5950', [{ metodoPagoId: 'efe', monto: '5950' }], 0, '10000')
    expect(r[0]!.monto).toBe('10000')
  })

  it('editar el primer pago ajusta a los siguientes', () => {
    const r = setMontoPago('1000', [
      { metodoPagoId: 'efe', monto: '400' },
      { metodoPagoId: 'tdc', monto: '600' },
    ], 0, '700')
    expect(r[0]!.monto).toBe('700')
    expect(r[1]!.monto).toBe('300')
  })

  it('reducir un pago no aumenta los demás automáticamente', () => {
    const r = setMontoPago('1000', [
      { metodoPagoId: 'efe', monto: '500' },
      { metodoPagoId: 'tdc', monto: '500' },
    ], 1, '200')
    expect(r[0]!.monto).toBe('500')
    expect(r[1]!.monto).toBe('200')
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
