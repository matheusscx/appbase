// @vitest-environment nuxt
//
// Auditoría UX 09.10 y 09.11: el basurero del carrito medía 24×24, a 8 px del "+",
// y no tenía nombre: un toque corrido quitaba la línea en vez de sumar una.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CarritoOnline from './CarritoOnline.vue'
import type { CarritoLinea, ItemCatalogo } from '~/composables/useVenta'

const linea = (id: string, nombre: string): CarritoLinea => ({
  item: { id, nombre, tipo: 'producto', precioBase: '1000.0000', monedaId: 'm1', unidadMedida: 'unidad', activo: true } as ItemCatalogo,
  cantidad: '1',
} as CarritoLinea)

describe('CarritoOnline — se toca con el dedo', () => {
  it('cada basurero nombra su línea, mide 44 px y va apartado de la cantidad', async () => {
    const w = await mountSuspended(CarritoOnline, {
      global: { stubs: { AppCantidadInput: true } },
      props: { lineas: [linea('a', 'Papas fritas'), linea('b', 'Bebida')], resultado: null, vigente: false },
    })
    for (const nombre of ['Papas fritas', 'Bebida']) {
      const b = w.find(`button[aria-label="Quitar ${nombre}"]`)
      expect(b.exists(), nombre).toBe(true)
      expect(b.classes().join(' ')).toMatch(/(^|\s)size-11(\s|$)/)
      expect(b.classes().join(' ')).toMatch(/(^|\s)ms-[2-9](\s|$)/)
    }
  })
})

// Auditoría UX 09.10, 09.14, 09.16 y 09.17.
const totales = (over: Record<string, string> = {}) => ({
  subtotalNeto: '30000.0000',
  totalDescuentos: '0.0000',
  totalRecargos: '0.0000',
  totalImpuestos: '5700.0000',
  totalFinal: '35700.0000',
  ...over,
})
const resultadoCon = (over: Record<string, string> = {}) =>
  ({ lineas: [], advertencias: [], advertenciasVenta: [], totales: totales(over) }) as never

async function montar(props: Record<string, unknown> = {}) {
  return mountSuspended(CarritoOnline, {
    global: { stubs: { AppCantidadInput: true } },
    props: { lineas: [linea('a', 'Papas fritas')], resultado: resultadoCon(), vigente: true, ...props },
  })
}

describe('CarritoOnline — el panel de pago', () => {
  it('"Pagar" mide 44 px como el resto de los controles del carrito (09.10)', async () => {
    const w = await montar()
    const pagar = w.findAll('button').find(b => b.text() === 'Pagar')!
    expect(pagar.classes().join(' ')).toMatch(/(^|\s)min-h-11(\s|$)/)
  })

  it('no dibuja "Descuentos" ni "Recargos" cuando valen $0 (09.17)', async () => {
    const w = await montar()
    expect(w.text()).not.toContain('Descuentos')
    expect(w.text()).not.toContain('Recargos')
    expect(w.text()).toContain('Impuestos')
  })

  it('con descuento o recargo vigente sí los dibuja', async () => {
    const w = await montar({ resultado: resultadoCon({ totalDescuentos: '1000.0000', totalRecargos: '500.0000' }) })
    expect(w.text()).toContain('Descuentos')
    expect(w.text()).toContain('Recargos')
  })

  it('el total es lo más grande del panel y se atenúa mientras se recalcula (09.17)', async () => {
    const quieto = await montar()
    const total = quieto.find('[data-qa="carrito-total"]')
    expect(total.classes().join(' ')).toMatch(/text-xl/)
    expect(total.classes().join(' ')).not.toMatch(/opacity-/)
    const calculando = await montar({ loadingCalculo: true })
    expect(calculando.find('[data-qa="carrito-total"]').classes().join(' ')).toMatch(/opacity-/)
  })

  it('el nombre del ítem no se corta con puntos suspensivos (09.16)', async () => {
    const w = await montar({ lineas: [linea('a', 'Combo familiar con papas fritas y bebida grande')] })
    const nombre = w.find('li p')
    expect(nombre.classes()).not.toContain('truncate')
    expect(nombre.classes()).toContain('break-words')
  })

  it('sin permiso de comprar, "Pagar" queda inactivo y dice por qué (09.14)', async () => {
    const w = await montar({ sinPermiso: true })
    const pagar = w.findAll('button').find(b => b.text() === 'Pagar')!
    expect(pagar.attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Tu rol no puede comprar en la tienda')
  })

  it('con permiso no aparece ese aviso', async () => {
    const w = await montar()
    expect(w.text()).not.toContain('Tu rol no puede comprar')
  })
})
