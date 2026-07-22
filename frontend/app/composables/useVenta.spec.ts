import { describe, it, expect } from 'vitest'
import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  setCantidadPresentacion,
  toCalcularInput,
  toVentaLineasBody,
  descontarStockCatalogo,
  sumaPagos,
  resumenCobro,
  setMontoPago,
  puedeCobrar,
  tieneCustomerData,
  type CarritoLinea,
  type ItemCatalogo,
  type CustomerForm,
} from './useVenta'
import type { PersonalizacionPayload } from './useRecetaPersonalizacion'
import type { UnidadCat } from '~/utils/cantidad-presentacion'

const CAT: UnidadCat[] = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
]

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
  it('agregarLinea agrega una línea nueva con cantidad "1" y presentación en unidad base', () => {
    const r = agregarLinea([], item('a'), CAT)
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('1')
    expect(r[0]!.cantidadPresentacion).toBe('1')
    expect(r[0]!.unidadCodigoPresentacion).toBe('unidad')
  })

  it('agregarLinea incrementa la cantidad si el item ya está', () => {
    const r = agregarLinea([{ item: item('a'), cantidad: '1' }], item('a'), CAT)
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('re-agregar suma 1 unidad base y reescribe presentación (500 g + 1 kg → 1500 g)', () => {
    const prod: ItemCatalogo = { ...item('a'), unidadMedida: 'kg' }
    let lineas = agregarLinea([], prod, CAT)
    lineas = setCantidadPresentacion(lineas, 0, '500', 'g', '0.5')
    lineas = agregarLinea(lineas, prod, CAT)
    expect(lineas).toHaveLength(1)
    expect(lineas[0]!.cantidad).toBe('1.5')
    expect(lineas[0]!.cantidadPresentacion).toBe('1500')
    expect(lineas[0]!.unidadCodigoPresentacion).toBe('g')
  })

  it('agregarLinea incrementa cantidad si mismo item y misma personalización', () => {
    const receta = { ...item('r'), tipo: 'receta' }
    const pers: PersonalizacionPayload = {
      omitidos: ['ing-1'],
      extras: [{ ingredienteItemId: 'extra-1', unidades: 1 }],
    }
    const linea: CarritoLinea = { item: receta, cantidad: '1', personalizacion: pers }
    const r = agregarLinea([linea], receta, CAT, pers)
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('agregarLinea crea dos líneas si mismo extra pero distintas unidades', () => {
    const receta = { ...item('r'), tipo: 'receta' }
    const persA: PersonalizacionPayload = {
      omitidos: [],
      extras: [{ ingredienteItemId: 'extra-1', unidades: 1 }],
    }
    const persB: PersonalizacionPayload = {
      omitidos: [],
      extras: [{ ingredienteItemId: 'extra-1', unidades: 2 }],
    }
    const r = agregarLinea(
      [{ item: receta, cantidad: '1', personalizacion: persA }],
      receta,
      CAT,
      persB,
    )
    expect(r).toHaveLength(2)
  })

  it('agregarLinea crea dos líneas si mismo item pero distinta personalización', () => {
    const receta = { ...item('r'), tipo: 'receta' }
    const persA: PersonalizacionPayload = { omitidos: ['ing-1'], extras: [] }
    const persB: PersonalizacionPayload = { omitidos: ['ing-2'], extras: [] }
    const r = agregarLinea(
      [{ item: receta, cantidad: '1', personalizacion: persA }],
      receta,
      CAT,
      persB,
    )
    expect(r).toHaveLength(2)
    expect(r[0]!.cantidad).toBe('1')
    expect(r[1]!.cantidad).toBe('1')
    expect(r[0]!.personalizacion).toEqual(persA)
    expect(r[1]!.personalizacion).toEqual(persB)
  })

  it('agregarLinea sin personalización no fusiona con línea personalizada', () => {
    const receta = { ...item('r'), tipo: 'receta' }
    const pers: PersonalizacionPayload = { omitidos: ['ing-1'], extras: [] }
    const r = agregarLinea(
      [{ item: receta, cantidad: '1', personalizacion: pers }],
      receta,
      CAT,
    )
    expect(r).toHaveLength(2)
    expect(r[0]!.cantidad).toBe('1')
    expect(r[1]!.cantidad).toBe('1')
  })

  it('agregarLinea crea dos líneas si dos combos eligen distinta opción de grupo', () => {
    const combo = { ...item('c'), tipo: 'combo' }
    const persCoca: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      grupos: [{ grupoId: 'g1', opciones: [{ itemId: 'coca', unidades: 1 }] }],
    }
    const persSprite: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      grupos: [{ grupoId: 'g1', opciones: [{ itemId: 'sprite', unidades: 1 }] }],
    }
    const r = agregarLinea(
      [{ item: combo, cantidad: '1', personalizacion: persCoca }],
      combo,
      CAT,
      persSprite,
    )
    expect(r).toHaveLength(2)
    expect(r[0]!.cantidad).toBe('1')
    expect(r[1]!.cantidad).toBe('1')
  })

  it('agregarLinea suma cantidad si dos combos eligen la misma opción de grupo', () => {
    const combo = { ...item('c'), tipo: 'combo' }
    const pers: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      grupos: [{ grupoId: 'g1', opciones: [{ itemId: 'coca', unidades: 1 }] }],
    }
    const r = agregarLinea(
      [{ item: combo, cantidad: '1', personalizacion: pers }],
      combo,
      CAT,
      { ...pers, grupos: [{ grupoId: 'g1', opciones: [{ itemId: 'coca', unidades: 1 }] }] },
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('agregarLinea crea dos líneas si dos combos eligen distinta opción de grupo por componente', () => {
    const combo = { ...item('c'), tipo: 'combo' }
    const persChuleta: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'burger-1',
          unidad: 1,
          grupos: [{ grupoId: 'g-proteina', opciones: [{ itemId: 'chuleta', unidades: 1 }] }],
        },
      ],
    }
    const persCarne: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'burger-1',
          unidad: 1,
          grupos: [{ grupoId: 'g-proteina', opciones: [{ itemId: 'carne', unidades: 1 }] }],
        },
      ],
    }
    const r = agregarLinea(
      [{ item: combo, cantidad: '1', personalizacion: persChuleta }],
      combo,
      CAT,
      persCarne,
    )
    expect(r).toHaveLength(2)
    expect(r[0]!.cantidad).toBe('1')
    expect(r[1]!.cantidad).toBe('1')
  })

  it('agregarLinea suma cantidad si dos combos eligen la misma opción de grupo por componente', () => {
    const combo = { ...item('c'), tipo: 'combo' }
    const pers: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'burger-1',
          unidad: 1,
          grupos: [{ grupoId: 'g-proteina', opciones: [{ itemId: 'chuleta', unidades: 1 }] }],
        },
      ],
    }
    const r = agregarLinea(
      [{ item: combo, cantidad: '1', personalizacion: pers }],
      combo,
      CAT,
      {
        ...pers,
        componentes: [
          {
            componenteItemId: 'burger-1',
            unidad: 1,
            grupos: [{ grupoId: 'g-proteina', opciones: [{ itemId: 'chuleta', unidades: 1 }] }],
          },
        ],
      },
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('agregarLinea suma cantidad si dos combos eligen las mismas opciones de componentes en distinto orden (independencia de orden)', () => {
    const combo = { ...item('c'), tipo: 'combo' }
    // Mismo contenido, distinto orden: componentes (burger-2 antes que burger-1) y,
    // dentro del componente burger-1, opciones del grupo (tocino antes que queso).
    // Si el sort canónico de useVenta.ts:85-91 (o canonicalGrupos) fuera un no-op,
    // el JSON.stringify resultante difeririría por el orden y esto NO fusionaría.
    const persOrdenA: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'burger-2',
          unidad: 1,
          grupos: [{ grupoId: 'g-proteina', opciones: [{ itemId: 'chuleta', unidades: 1 }] }],
        },
        {
          componenteItemId: 'burger-1',
          unidad: 1,
          grupos: [
            {
              grupoId: 'g-extra',
              opciones: [
                { itemId: 'queso', unidades: 1 },
                { itemId: 'tocino', unidades: 1 },
              ],
            },
          ],
        },
      ],
    }
    const persOrdenB: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'burger-1',
          unidad: 1,
          grupos: [
            {
              grupoId: 'g-extra',
              opciones: [
                { itemId: 'tocino', unidades: 1 },
                { itemId: 'queso', unidades: 1 },
              ],
            },
          ],
        },
        {
          componenteItemId: 'burger-2',
          unidad: 1,
          grupos: [{ grupoId: 'g-proteina', opciones: [{ itemId: 'chuleta', unidades: 1 }] }],
        },
      ],
    }
    const r = agregarLinea(
      [{ item: combo, cantidad: '1', personalizacion: persOrdenA }],
      combo,
      CAT,
      persOrdenB,
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('agregarLinea no muta el array original', () => {
    const original: CarritoLinea[] = []
    agregarLinea(original, item('a'), CAT)
    expect(original).toHaveLength(0)
  })

  it('quitarLinea elimina por índice', () => {
    const lineas: CarritoLinea[] = [
      { item: item('a'), cantidad: '1' },
      { item: item('b'), cantidad: '2' },
    ]
    const r = quitarLinea(lineas, 0)
    expect(r).toHaveLength(1)
    expect(r[0]!.item.id).toBe('b')
  })

  it('setCantidad reemplaza la cantidad de la línea por índice', () => {
    const lineas: CarritoLinea[] = [
      { item: item('a'), cantidad: '1' },
      { item: item('b'), cantidad: '2' },
    ]
    const r = setCantidad(lineas, 1, '5')
    expect(r[0]!.cantidad).toBe('1')
    expect(r[1]!.cantidad).toBe('5')
  })

  it('toCalcularInput mapea a { lineas: [{ itemId, cantidad }] }', () => {
    const r = toCalcularInput([{ item: item('a'), cantidad: '3' }])
    expect(r).toEqual({ lineas: [{ itemId: 'a', cantidad: '3' }] })
  })

  it('toVentaLineasBody incluye personalizacion.grupos cuando la línea tiene grupos elegidos', () => {
    const combo = { ...item('c'), tipo: 'combo' }
    const pers: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      grupos: [{ grupoId: 'g1', opciones: [{ itemId: 'coca', unidades: 1 }] }],
    }
    const r = toVentaLineasBody([{ item: combo, cantidad: '1', personalizacion: pers }])
    expect(r[0]).toMatchObject({
      itemId: 'c',
      cantidad: '1',
      personalizacion: {
        omitidos: [],
        extras: [],
        grupos: [{ grupoId: 'g1', opciones: [{ itemId: 'coca', unidades: 1 }] }],
      },
    })
  })

  it('toVentaLineasBody incluye personalizacion.componentes cuando el combo tiene grupos anidados elegidos (regla: el backend nunca cobra lo que no recibe)', () => {
    const combo = { ...item('c'), tipo: 'combo' }
    const pers: PersonalizacionPayload = {
      omitidos: [],
      extras: [],
      componentes: [
        {
          componenteItemId: 'chuleta-1',
          unidad: 1,
          grupos: [{ grupoId: 'g-carne', opciones: [{ itemId: 'carne-premium', unidades: 1 }] }],
        },
      ],
    }
    const r = toVentaLineasBody([{ item: combo, cantidad: '1', personalizacion: pers }])
    expect(r[0]).toMatchObject({
      itemId: 'c',
      cantidad: '1',
      personalizacion: {
        omitidos: [],
        extras: [],
        componentes: [
          {
            componenteItemId: 'chuleta-1',
            unidad: 1,
            grupos: [{ grupoId: 'g-carne', opciones: [{ itemId: 'carne-premium', unidades: 1 }] }],
          },
        ],
      },
    })
  })

  it('toCalcularInput incluye precioUnitario cuando hay override', () => {
    const r = toCalcularInput([
      { item: item('a'), cantidad: '2', precioUnitarioOverride: '1500' },
    ])
    expect(r).toEqual({ lineas: [{ itemId: 'a', cantidad: '2', precioUnitario: '1500' }] })
  })

  it('agregarLinea merge mantiene precioUnitarioOverride', () => {
    const receta = { ...item('r', '1000'), tipo: 'receta' }
    const pers: PersonalizacionPayload = {
      omitidos: [],
      extras: [{ ingredienteItemId: 'extra-1', unidades: 1 }],
    }
    const linea: CarritoLinea = {
      item: receta,
      cantidad: '1',
      personalizacion: pers,
      precioUnitarioOverride: '1500',
    }
    const r = agregarLinea([linea], receta, CAT, pers, undefined, '1500')
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
    expect(r[0]!.precioUnitarioOverride).toBe('1500')
  })

  it('agregarLinea guarda personalizacionDetalle solo cuando hay personalización', () => {
    const receta = { ...item('r', '1000'), tipo: 'receta' }
    const pers: PersonalizacionPayload = {
      omitidos: [],
      extras: [{ ingredienteItemId: 'extra-1', unidades: 1 }],
    }
    const detalle = [{ nombre: 'Queso', tipo: 'extra' as const, unidades: 1, monto: '1000' }]

    const conPers = agregarLinea([], receta, CAT, pers, 'Extra Queso', '1500', detalle)
    expect(conPers[0]!.personalizacionDetalle).toEqual(detalle)

    const sinPers = agregarLinea([], item('a'), CAT, undefined, undefined, undefined, detalle)
    expect(sinPers[0]!.personalizacionDetalle).toBeUndefined()
  })

  it('agregarLinea merge mantiene personalizacionDetalle', () => {
    const receta = { ...item('r', '1000'), tipo: 'receta' }
    const pers: PersonalizacionPayload = {
      omitidos: [],
      extras: [{ ingredienteItemId: 'extra-1', unidades: 1 }],
    }
    const detalle = [{ nombre: 'Queso', tipo: 'extra' as const, unidades: 1, monto: '1000' }]
    const linea: CarritoLinea = {
      item: receta,
      cantidad: '1',
      personalizacion: pers,
      personalizacionDetalle: detalle,
    }
    const r = agregarLinea([linea], receta, CAT, pers, undefined, undefined, detalle)
    expect(r).toHaveLength(1)
    expect(r[0]!.cantidad).toBe('2')
    expect(r[0]!.personalizacionDetalle).toEqual(detalle)
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

  it('descontarStockCatalogo resta disponible de recetas', () => {
    const receta: ItemCatalogo = {
      ...item('r'),
      tipo: 'receta',
      stock: null,
      disponible: 31,
    }
    const r = descontarStockCatalogo([receta], [{ item: receta, cantidad: '15' }])
    expect(r[0]!.disponible).toBe(16)
    expect(receta.disponible).toBe(31)
  })

  it('descontarStockCatalogo no baja disponible bajo cero', () => {
    const receta: ItemCatalogo = {
      ...item('r'),
      tipo: 'receta',
      stock: null,
      disponible: 3,
    }
    const r = descontarStockCatalogo([receta], [{ item: receta, cantidad: '10' }])
    expect(r[0]!.disponible).toBe(0)
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

describe('tieneCustomerData', () => {
  const vacio: CustomerForm = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }

  it('false cuando no hay nombre ni terceroId', () => {
    expect(tieneCustomerData(vacio)).toBe(false)
  })

  it('false cuando el nombre es solo espacios', () => {
    expect(tieneCustomerData({ ...vacio, nombre: '   ' })).toBe(false)
  })

  it('true cuando hay nombre', () => {
    expect(tieneCustomerData({ ...vacio, nombre: 'Juan' })).toBe(true)
  })

  it('true cuando hay terceroId aunque el nombre esté vacío', () => {
    expect(tieneCustomerData({ ...vacio, terceroId: 'tercero-1' })).toBe(true)
  })
})
