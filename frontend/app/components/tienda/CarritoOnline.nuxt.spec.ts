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
