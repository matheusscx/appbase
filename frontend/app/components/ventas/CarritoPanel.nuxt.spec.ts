// @vitest-environment nuxt
//
// El gating de las advertencias vive en el TEMPLATE, y el composable que lo
// alimenta (`useResultadoCalculado`, testeado aparte) no puede probarlo: el bug
// es que el índice del aviso apunte a otra línea de la lista, y eso solo se ve
// renderizando. Sin este archivo la propiedad testeada era la del cálculo, no la
// del cruce.
//
// Se testea el carrito del POS porque es el que cobra. `CarritoOnline.vue`
// (tienda) usa la misma expresión verbatim; si se tocan, se tocan juntos.
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CarritoPanel from './CarritoPanel.vue'
import type { CarritoLinea, ItemCatalogo } from '~/composables/useVenta'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'

mockNuxtImport('usePermissionsStore', () => {
  return () => ({ esAdmin: true, can: () => true })
})

const item = (id: string, nombre: string): ItemCatalogo => ({
  id,
  nombre,
  tipo: 'producto',
  precioBase: '1000.0000',
  monedaId: 'moneda-1',
  unidadMedida: 'unidad',
  activo: true,
} as ItemCatalogo)

const linea = (id: string, nombre: string): CarritoLinea => ({
  item: item(id, nombre),
  cantidad: '1',
} as CarritoLinea)

/** Resultado con UNA advertencia, en la línea que se le pida. */
function resultadoConAvisoEn(indice: number, cantidadLineas: number): ResultadoVenta {
  return {
    lineas: Array.from({ length: cantidadLineas }, (_, i) => ({
      itemId: `item-${i}`,
      cantidad: '1',
      precioUnitario: '1000',
      subtotalNeto: '1000',
      descuentoAplicado: '0',
      recargoAplicado: '0',
      impuestoAplicado: '0',
      totalLinea: '1000',
      trazas: { descuentos: [], recargos: [], impuestos: [], promociones: [] },
      advertencias: i === indice
        ? [{ titulo: 'Descuento topeado', detalle: 'superaba el monto disponible' }]
        : [],
    })),
    totales: {
      subtotalNeto: '1000',
      totalDescuentos: '0',
      totalRecargos: '0',
      totalImpuestos: '0',
      totalFinal: '1000',
    },
    trazasVenta: { descuentos: [], recargos: [] },
    advertencias: [],
    advertenciasVenta: [{ titulo: 'Descuento de venta topeado', detalle: 'sin monto disponible' }],
  }
}

// `UTooltip` necesita un TooltipProvider que solo existe en una app Nuxt real
// (`docs/patterns/frontend.md` §15); su template propio proyecta el slot para
// que el título de la advertencia siga llegando al DOM.
const stubs = {
  UTooltip: { template: '<div><slot /></div>' },
  // Trae el store de unidades y sale a buscarlas; nada que ver con lo que se prueba.
  AppCantidadInput: true,
}

function montar(props: { lineas: CarritoLinea[], resultado: ResultadoVenta | null, vigente: boolean }) {
  return mountSuspended(CarritoPanel, {
    global: { stubs },
    props: {
      ...props,
      tiposDocumento: [{ id: 'doc-1', nombre: 'Boleta', customerRequerido: false, esBoleta: true, receptorCompleto: false, rutChileno: false, umbralIdentidad: null }],
      tieneCaja: true,
      customer: { nombre: '', rut: '', giro: '', direccion: '', comuna: '', telefono: '', email: '', terceroId: null },
    },
  })
}

describe('CarritoPanel — advertencias solo con el cálculo vigente', () => {
  it('con el cálculo vigente, el aviso sale en SU línea y no en la otra', async () => {
    const wrapper = await montar({
      lineas: [linea('item-0', 'Papas'), linea('item-1', 'Bebida')],
      resultado: resultadoConAvisoEn(1, 2),
      vigente: true,
    })

    const filas = wrapper.findAll('li')
    expect(filas).toHaveLength(2)
    expect(filas[0]!.text()).toContain('Papas')
    expect(filas[0]!.text()).not.toContain('Descuento topeado')
    expect(filas[1]!.text()).toContain('Bebida')
    expect(filas[1]!.text()).toContain('Descuento topeado')
    expect(wrapper.text()).toContain('Descuento de venta topeado')
  })

  it('sin vigencia no se dibuja ninguna advertencia', async () => {
    // Es el estado en que el carrito ya cambió y el cálculo todavía es del
    // anterior: dibujar el aviso ahí lo pone bajo la línea equivocada.
    const wrapper = await montar({
      lineas: [linea('item-0', 'Papas'), linea('item-1', 'Bebida')],
      resultado: resultadoConAvisoEn(0, 2),
      vigente: false,
    })

    expect(wrapper.text()).not.toContain('Descuento topeado')
    expect(wrapper.text()).not.toContain('Descuento de venta topeado')
  })

  it('los totales SÍ se siguen mostrando sin vigencia (no parpadean)', async () => {
    const wrapper = await montar({
      lineas: [linea('item-0', 'Papas')],
      resultado: resultadoConAvisoEn(0, 1),
      vigente: false,
    })

    expect(wrapper.text()).toContain('Neto')
  })
})

describe('CarritoPanel — "Vaciar todo" vuelve a la boleta, no al primero del catálogo', () => {
  /**
   * El catálogo llega ordenado por nombre, y la boleta no tiene por qué ser la
   * primera: acá un tipo "Acta…" ordena antes. Hasta el 2026-10-02 el panel
   * tomaba `tiposDocumento[0]` como "lo de por defecto", así que vaciar dejaba
   * puesto el Acta —que pide cliente— y un panel vacío con la boleta elegida
   * se veía como "algo que limpiar".
   */
  const catalogo = [
    { id: 'doc-acta', nombre: 'Acta de Entrega', customerRequerido: true, esBoleta: false, receptorCompleto: false, rutChileno: false, umbralIdentidad: null },
    { id: 'doc-boleta', nombre: 'Boleta de Venta', customerRequerido: false, esBoleta: true, receptorCompleto: false, rutChileno: false, umbralIdentidad: null },
  ]

  function montarConCatalogo(lineas: CarritoLinea[], tipoDocumentoId: string) {
    return mountSuspended(CarritoPanel, {
      global: { stubs },
      props: {
        lineas,
        resultado: null,
        vigente: false,
        tiposDocumento: catalogo,
        tieneCaja: true,
        tipoDocumentoId,
        customer: { nombre: '', rut: '', giro: '', direccion: '', comuna: '', telefono: '', email: '', terceroId: null },
      },
    })
  }

  it('vaciar deja la boleta elegida', async () => {
    const wrapper = await montarConCatalogo([linea('item-0', 'Papas')], 'doc-acta')

    wrapper.findComponent({ name: 'CrudModal' }).vm.$emit('confirm')
    await nextTick()

    expect(wrapper.emitted('update:tipoDocumentoId')?.at(-1)).toEqual(['doc-boleta'])
  })

  it('un panel vacío con la boleta elegida no tiene nada que limpiar', async () => {
    const wrapper = await montarConCatalogo([], 'doc-boleta')

    const vaciar = wrapper.findAllComponents({ name: 'UButton' })
      .find(b => b.props('icon') === 'i-lucide-eraser')
    expect(vaciar, 'el botón de vaciar').toBeDefined()
    expect(vaciar!.props('disabled')).toBe(true)
  })
})

describe('CarritoPanel — línea de un producto con serie', () => {
  const lineaSerie = (): CarritoLinea => ({
    item: { ...item('celu-1', 'iPhone 15'), modoInventario: 'serie' } as ItemCatalogo,
    cantidad: '2',
    unidades: [
      { id: 'u-1', serie: '350000000000001', condicion: 'nuevo' },
      { id: 'u-2', serie: '350000000000002', condicion: 'usado' },
    ],
  })

  it('muestra las series y no el input de cantidad', async () => {
    const wrapper = await mountSuspended(CarritoPanel, {
      global: { stubs: { ...stubs, AppCantidadInput: { template: '<div data-qa="cantidad-input" />' } } },
      props: {
        lineas: [lineaSerie(), linea('item-1', 'Bebida')],
        resultado: null,
        vigente: true,
        tiposDocumento: [{ id: 'doc-1', nombre: 'Boleta', customerRequerido: false, esBoleta: true, receptorCompleto: false, rutChileno: false, umbralIdentidad: null }],
        tieneCaja: true,
        customer: { nombre: '', rut: '', giro: '', direccion: '', comuna: '', telefono: '', email: '', terceroId: null },
      },
    })

    const filas = wrapper.findAll('li')
    expect(filas[0]!.text()).toContain('350000000000001')
    expect(filas[0]!.text()).toContain('350000000000002')
    expect(filas[0]!.text()).toContain('Usado')
    expect(filas[0]!.find('[data-qa="cantidad-input"]').exists()).toBe(false)
    // La línea común conserva su input de cantidad.
    expect(filas[1]!.find('[data-qa="cantidad-input"]').exists()).toBe(true)
  })

  it('"Cambiar unidades" emite el índice de la línea', async () => {
    const wrapper = await mountSuspended(CarritoPanel, {
      global: { stubs },
      props: {
        lineas: [linea('item-0', 'Papas'), lineaSerie()],
        resultado: null,
        vigente: true,
        tiposDocumento: [{ id: 'doc-1', nombre: 'Boleta', customerRequerido: false, esBoleta: true, receptorCompleto: false, rutChileno: false, umbralIdentidad: null }],
        tieneCaja: true,
        customer: { nombre: '', rut: '', giro: '', direccion: '', comuna: '', telefono: '', email: '', terceroId: null },
      },
    })

    const filas = wrapper.findAll('li')
    expect(filas[0]!.text()).not.toContain('Cambiar unidades')
    const boton = filas[1]!.findAll('button').find(b => b.text().includes('Cambiar unidades'))
    expect(boton, 'el botón Cambiar unidades').toBeTruthy()
    await boton!.trigger('click')

    expect(wrapper.emitted('cambiar-unidades')).toEqual([[1]])
  })
})

describe('CarritoPanel — boleta sobre el umbral de la Res. Ex. SII 44/2025', () => {
  // Montos de 2026: $5.363.274,60. "Exceda" es estricto: 5.363.274 no lo pasa.
  const boleta = {
    id: 'doc-boleta',
    nombre: 'Boleta de Venta',
    customerRequerido: false,
    esBoleta: true,
    receptorCompleto: false,
    rutChileno: true,
    umbralIdentidad: '5363274.60',
  }
  const resultadoDe = (totalFinal: string): ResultadoVenta => ({
    ...resultadoConAvisoEn(-1, 1),
    totales: { ...resultadoConAvisoEn(-1, 1).totales, totalFinal },
    advertenciasVenta: [],
  })
  const cliente = (nombre: string, rut: string) => ({
    nombre, rut, giro: '', direccion: '', comuna: '', telefono: '', email: '', terceroId: null,
  })

  function montarSobre(totalFinal: string, customer = cliente('', '')) {
    return mountSuspended(CarritoPanel, {
      global: { stubs: { ...stubs, VentasClienteDrawer: true } },
      props: {
        lineas: [linea('item-0', 'Notebook')],
        resultado: resultadoDe(totalFinal),
        vigente: true,
        tiposDocumento: [boleta],
        tieneCaja: true,
        tipoDocumentoId: 'doc-boleta',
        customer,
      },
    })
  }
  const cobrar = (wrapper: Awaited<ReturnType<typeof montarSobre>>) =>
    wrapper.findAllComponents({ name: 'UButton' }).find(b => b.props('label') === 'Cobrar')!

  it('un peso sobre el umbral sin cliente: avisa y no deja cobrar', async () => {
    const wrapper = await montarSobre('5363275')
    expect(wrapper.find('[data-qa="aviso-identidad-pagador"]').exists()).toBe(true)
    expect(cobrar(wrapper).props('disabled')).toBe(true)
  })

  it('con nombre y sin RUT tampoco; con nombre y RUT válido, sí', async () => {
    expect(cobrar(await montarSobre('5363275', cliente('Juana Pérez', ''))).props('disabled')).toBe(true)
    expect(cobrar(await montarSobre('5363275', cliente('Juana Pérez', '12.345.678-9'))).props('disabled')).toBe(true)
    expect(cobrar(await montarSobre('5363275', cliente('Juana Pérez', '12.345.678-5'))).props('disabled')).toBe(false)
  })

  it('bajo el umbral la boleta se cobra sin cliente y no avisa', async () => {
    const wrapper = await montarSobre('5363274')
    expect(wrapper.find('[data-qa="aviso-identidad-pagador"]').exists()).toBe(false)
    expect(cobrar(wrapper).props('disabled')).toBe(false)
  })
})

// Auditoría UX 01.8: los botones de solo ícono del carrito (el borrador "Vaciar
// todo" y un tacho por línea) se anunciaban como "botón" a secas. El
// `UTooltip` no da nombre accesible.
describe('CarritoPanel — botones de ícono con nombre', () => {
  it('"Vaciar todo" y un "Quitar <producto>" por línea', async () => {
    const wrapper = await montar({
      lineas: [linea('item-0', 'Papas fritas'), linea('item-1', 'Bebida')],
      resultado: null,
      vigente: false,
    })
    expect(wrapper.find('button[aria-label="Vaciar todo"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Quitar Papas fritas"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Quitar Bebida"]').exists()).toBe(true)
  })
})

describe('CarritoPanel — si el cálculo falla, el total viejo no pasa por bueno (01.12)', () => {
  const lineas = () => [linea('item-0', 'Papas')]

  async function conError(error: unknown) {
    const wrapper = await mountSuspended(CarritoPanel, {
      global: { stubs },
      props: {
        lineas: lineas(),
        resultado: resultadoConAvisoEn(-1, 1),
        vigente: false,
        errorCalculo: error,
        tiposDocumento: [{ id: 'doc-1', nombre: 'Boleta', customerRequerido: false, esBoleta: true, receptorCompleto: false, rutChileno: false, umbralIdentidad: null }],
        tieneCaja: true,
        customer: { nombre: '', rut: '', giro: '', direccion: '', comuna: '', telefono: '', email: '', terceroId: null },
      },
    })
    return wrapper
  }

  it('avisa que no se pudo recalcular y atenúa los totales', async () => {
    const wrapper = await conError(new Error('Failed to fetch'))

    expect(wrapper.find('[data-qa="aviso-calculo-carrito"]').text()).toContain('No se pudo recalcular el total')
    expect(wrapper.find('[data-qa="totales-carrito"]').classes()).toContain('opacity-50')
  })

  it('"Volver a calcular" emite `recalcular`', async () => {
    const wrapper = await conError(new Error('Failed to fetch'))

    const boton = wrapper.find('[data-qa="aviso-calculo-carrito"]').findAll('button')
      .find(b => b.text().includes('Volver a calcular'))
    expect(boton, 'el botón Volver a calcular').toBeTruthy()
    await boton!.trigger('click')

    expect(wrapper.emitted('recalcular')).toHaveLength(1)
  })

  it('sin error no hay aviso y los totales se ven a plena intensidad', async () => {
    const wrapper = await conError(null)

    expect(wrapper.find('[data-qa="aviso-calculo-carrito"]').exists()).toBe(false)
    expect(wrapper.find('[data-qa="totales-carrito"]').classes()).not.toContain('opacity-50')
  })
})

describe('CarritoPanel — la línea cabe en un carrito angosto (01.13)', () => {
  it('el nombre puede ocupar dos líneas y no se corta con puntos', async () => {
    const wrapper = await montar({
      lineas: [linea('item-0', 'Hamburguesa doble con queso y tocino')],
      resultado: resultadoConAvisoEn(-1, 1),
      vigente: true,
    })

    const nombre = wrapper.findAll('li p').find(p => p.text().includes('Hamburguesa'))
    expect(nombre!.classes()).toContain('line-clamp-2')
    expect(nombre!.classes()).not.toContain('truncate')
  })

  it('la unidad no se repite junto al precio unitario: ya la dice el selector de cantidad', async () => {
    const wrapper = await montar({
      lineas: [linea('item-0', 'Papas')],
      resultado: resultadoConAvisoEn(-1, 1),
      vigente: true,
    })

    const fila = wrapper.find('li').text()
    expect(fila).toContain('c/u')
    expect(fila).not.toMatch(/c\/u\s*·/)
  })
})

describe('CarritoPanel — no muestra filas en cero (01.24)', () => {
  const conTotales = (over: Partial<ResultadoVenta['totales']>) => {
    const r = resultadoConAvisoEn(-1, 1)
    return { ...r, totales: { ...r.totales, ...over } }
  }

  it('Descuentos y Recargos en 0 no salen', async () => {
    const wrapper = await montar({ lineas: [linea('item-0', 'Papas')], resultado: conTotales({}), vigente: true })

    expect(wrapper.text()).not.toContain('Descuentos')
    expect(wrapper.text()).not.toContain('Recargos')
    expect(wrapper.text()).toContain('Neto')
  })

  it('con valor, salen', async () => {
    const wrapper = await montar({
      lineas: [linea('item-0', 'Papas')],
      resultado: conTotales({ totalDescuentos: '500.0000', totalRecargos: '300.0000' }),
      vigente: true,
    })

    expect(wrapper.text()).toContain('Descuentos')
    expect(wrapper.text()).toContain('Recargos')
  })
})

// 01.6 y 01.7: lo que la cajera dice en voz alta se ve, y lo que toca se toca. jsdom no mide
// píxeles: se afirman las clases (`size-11`, `min-h-11`), como el resto de la guía.
describe('CarritoPanel — el total se lee y los botones se tocan (01.6, 01.7)', () => {
  async function conUnaLinea() {
    return montar({ lineas: [linea('item-0', 'Papas')], resultado: resultadoConAvisoEn(0, 1), vigente: true })
  }

  it('el Total va en text-xl', async () => {
    const wrapper = await conUnaLinea()
    const fila = wrapper.get('[data-qa="totales-carrito"]').findAll('div').find(d => d.text().startsWith('Total'))!
    expect(fila.classes()).toContain('text-xl')
  })

  it('Cobrar mide 44 px o más', async () => {
    const wrapper = await conUnaLinea()
    const cobrar = wrapper.findAll('button').find(b => b.text().includes('Cobrar'))!
    expect(cobrar.classes()).toContain('min-h-11')
  })

  it('quitar línea, Vaciar todo y Agregar datos del cliente miden 44 px', async () => {
    const wrapper = await conUnaLinea()
    expect(wrapper.get('button[aria-label="Quitar Papas"]').classes()).toContain('size-11')
    expect(wrapper.get('button[aria-label="Vaciar todo"]').classes()).toContain('size-11')
    const agregar = wrapper.findAll('button').find(b => b.text().includes('Agregar datos del cliente'))!
    expect(agregar.classes()).toContain('min-h-11')
  })
})
