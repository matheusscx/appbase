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
      tiposDocumento: [{ id: 'doc-1', nombre: 'Boleta', customerRequerido: false }],
      tieneCaja: true,
      customer: { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null },
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
