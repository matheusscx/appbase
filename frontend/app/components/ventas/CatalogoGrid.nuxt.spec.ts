// @vitest-environment nuxt
//
// La tarjeta del catálogo decide DOS cosas con el mismo número: qué dice y si
// se puede clickear. Las dos viven en el template y en funciones locales del
// `<script setup>`, así que ningún test de composable las alcanza — y son
// exactamente las que cambiaron el 2026-09-01, cuando `GET /items` empezó a
// mandar `stockDisponible` (lo que queda por pedir) al lado de `stock` (lo que
// hay en la bodega).
//
// Sin este archivo, cambiar `stockPedible(item)` de vuelta por `item.stock`
// dejaba la suite entera en verde: el único otro consumidor del número es el
// e2e de navegador, que no corre en `npm test`.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CatalogoGrid from './CatalogoGrid.vue'
import type { ItemCatalogo } from '~/composables/useVenta'

// `UTooltip` necesita un TooltipProvider que solo existe en una app Nuxt real
// (`docs/patterns/frontend.md` §15). Su template propio proyecta el slot para
// que el contenido siga llegando al DOM.
const stubs = {
  UTooltip: { template: '<div><slot /></div>' },
}

function producto(over: Partial<ItemCatalogo> = {}): ItemCatalogo {
  return {
    id: 'item-1',
    nombre: 'Coca-Cola',
    descripcion: null,
    precioBase: '1500',
    monedaId: 'clp',
    monedaSimbolo: '$',
    stock: '3.0000',
    unidadMedida: 'unidad',
    tipo: 'producto',
    activo: true,
    disponible: null,
    ...over,
  }
}

async function montar(items: ItemCatalogo[]) {
  return mountSuspended(CatalogoGrid, { props: { items }, global: { stubs } })
}

/** El texto de la tarjeta, con los saltos de línea del template aplanados. */
function textoTarjeta(wrapper: Awaited<ReturnType<typeof montar>>, id = 'item-1') {
  return wrapper.find(`[data-qa="item-catalogo-${id}"]`).text().replace(/\s+/g, ' ')
}

describe('CatalogoGrid — el número que muestra un producto', () => {
  it('muestra lo que queda por pedir, no el saldo de bodega', async () => {
    // El caso del brief: stock 3, una mesa ya se llevó 2, quedan 1.
    const wrapper = await montar([producto({ stock: '3.0000', stockDisponible: '1.0000' })])

    expect(textoTarjeta(wrapper)).toContain('Disponible: 1')
    expect(textoTarjeta(wrapper)).not.toContain('Disponible: 3')
  })

  it('cae al stock físico cuando el servidor no manda stockDisponible', async () => {
    const wrapper = await montar([producto({ stock: '3.0000', stockDisponible: null })])

    expect(textoTarjeta(wrapper)).toContain('Disponible: 3')
  })

  it('una cantidad fraccionaria se muestra entera, no truncada', async () => {
    // `disponible` (porciones) viaja como `number` y se le hace `.floor()`.
    // Este número es una CANTIDAD y va por otro camino: 1,5 kg tiene que
    // mostrarse 1,5 kg, no 1.
    const wrapper = await montar([
      producto({ stock: '4.0000', stockDisponible: '1.5000', unidadMedida: 'kg' }),
    ])

    expect(textoTarjeta(wrapper)).toContain('Disponible: 1,5 kg')
  })
})

describe('CatalogoGrid — qué se puede clickear', () => {
  it('lo que otras mesas ya se llevaron no se puede agregar, aunque haya stock', async () => {
    const wrapper = await montar([producto({ stock: '3.0000', stockDisponible: '0.0000' })])

    const tarjeta = wrapper.find('[data-qa="item-catalogo-item-1"]')
    expect(tarjeta.attributes('aria-disabled')).toBe('true')

    await tarjeta.trigger('click')
    expect(wrapper.emitted('add')).toBeUndefined()
  })

  it('con unidades disponibles sí emite `add`: el contraejemplo', async () => {
    // Sin este test, un `puedeAgregar` que devolviera siempre `false` pasaría
    // el de arriba y dejaría el catálogo entero muerto.
    const wrapper = await montar([producto({ stock: '3.0000', stockDisponible: '1.0000' })])

    const tarjeta = wrapper.find('[data-qa="item-catalogo-item-1"]')
    expect(tarjeta.attributes('aria-disabled')).toBe('false')

    await tarjeta.trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('un stockDisponible negativo se comporta como agotado', async () => {
    // Un ingrediente no bloqueante puede quedar comprometido de más (spec
    // § 4.2). No es un caso del catálogo de venta hoy, pero el guard no debe
    // depender de que no pase.
    const wrapper = await montar([producto({ stock: '3.0000', stockDisponible: '-1.0000' })])

    const tarjeta = wrapper.find('[data-qa="item-catalogo-item-1"]')
    expect(tarjeta.attributes('aria-disabled')).toBe('true')
    await tarjeta.trigger('click')
    expect(wrapper.emitted('add')).toBeUndefined()
  })
})

describe('CatalogoGrid — recetas y combos siguen con su propio número', () => {
  it('una receta muestra sus porciones, no una cantidad', async () => {
    // `disponible` no cambió: sigue siendo el conteo entero de porciones, y su
    // etiqueta sigue siendo la de siempre.
    const wrapper = await montar([
      producto({ id: 'receta-1', tipo: 'receta', stock: null, disponible: 4, stockDisponible: null }),
    ])

    expect(textoTarjeta(wrapper, 'receta-1')).toContain('Disponibles: 4')
  })

  it('una receta sin stock igual se puede clickear: la valida el backend', async () => {
    const wrapper = await montar([
      producto({ id: 'receta-1', tipo: 'receta', stock: null, disponible: 0, stockDisponible: null }),
    ])

    const tarjeta = wrapper.find('[data-qa="item-catalogo-receta-1"]')
    expect(tarjeta.attributes('aria-disabled')).toBe('false')
    await tarjeta.trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })
})
