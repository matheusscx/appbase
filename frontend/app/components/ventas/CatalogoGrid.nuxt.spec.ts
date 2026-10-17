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

async function montar(items: ItemCatalogo[], extra: { total?: number; pageSize?: number } = {}) {
  return mountSuspended(CatalogoGrid, {
    props: { items, total: extra.total ?? items.length, pageSize: extra.pageSize ?? 48 },
    global: { stubs },
  })
}

/** El texto de la tarjeta, con los saltos de línea del template aplanados. */
function textoTarjeta(wrapper: Awaited<ReturnType<typeof montar>>, id = 'item-1') {
  return wrapper.find(`[data-qa="item-catalogo-${id}"]`).text().replace(/\s+/g, ' ')
}

describe('CatalogoGrid — el número que muestra un producto', () => {
  it('muestra lo que queda por pedir, no el saldo de bodega', async () => {
    // El caso de la reserva al pedir: stock 3, una mesa ya se llevó 2, queda 1.
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
    // Un ingrediente no bloqueante puede quedar comprometido de más (§ 4.2 de
    // `docs/superpowers/specs/2026-09-01-reserva-de-stock-al-pedir-design.md`).
    // No es un caso del catálogo de venta hoy, pero el guard no debe depender
    // de que no pase.
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

    expect(textoTarjeta(wrapper, 'receta-1')).toContain('Disponible: 4')
  })

  it('una receta con disponible NEGATIVO se atenúa igual que la de cero', async () => {
    // `disponible` cambió de dominio el 2026-09-01: es `stock − comprometido` y
    // puede ser negativo. Con el `=== 0` de antes, el plato en −2 —el que menos
    // se puede servir— era el único que NO se atenuaba.
    const wrapper = await montar([
      producto({ id: 'receta-1', tipo: 'receta', stock: null, disponible: -2, stockDisponible: null }),
    ])

    expect(wrapper.find('[data-qa="item-catalogo-receta-1"]').classes()).toContain('opacity-50')
  })

  // El orden por disponibilidad (incluido el disponible negativo al final) ya no
  // vive acá: lo fija el servidor con `orden=disponibilidad`, y lo cubren
  // `catalogo-orden.spec.ts` (backend) y `catalogo-paginado.e2e-spec.ts`.

  it('disponible null no se atenúa: es "sin bloqueantes", no "sin stock"', async () => {
    const wrapper = await montar([
      producto({ id: 'receta-1', tipo: 'receta', stock: null, disponible: null, stockDisponible: null }),
    ])

    expect(wrapper.find('[data-qa="item-catalogo-receta-1"]').classes()).not.toContain('opacity-50')
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

describe('CatalogoGrid — búsqueda, orden y paginación vienen de afuera', () => {
  it('tipear en el buscador emite `update:busqueda`', async () => {
    const wrapper = await montar([producto()])

    await wrapper.find('input').setValue('coca')

    expect(wrapper.emitted('update:busqueda')?.at(-1)).toEqual(['coca'])
  })

  it('respeta el orden en que llegan los ítems: ya no reordena', async () => {
    // Antes la grilla mandaba lo agotado al final; ahora el orden es del servidor.
    const wrapper = await montar([
      producto({ id: 'sin-stock', nombre: 'AAA', stock: '0.0000', stockDisponible: '0.0000' }),
      producto({ id: 'con-stock', nombre: 'ZZZ', stock: '3.0000', stockDisponible: '3.0000' }),
    ])

    const orden = wrapper.findAll('[data-qa^="item-catalogo-"]').map(c => c.attributes('data-qa'))
    expect(orden).toEqual(['item-catalogo-sin-stock', 'item-catalogo-con-stock'])
  })

  it('no filtra por lo que hay en el buscador: muestra lo que llega', async () => {
    const wrapper = await mountSuspended(CatalogoGrid, {
      props: { items: [producto({ nombre: 'Coca-Cola' })], total: 1, pageSize: 48, busqueda: 'zzz' },
      global: { stubs },
    })

    expect(wrapper.find('[data-qa="item-catalogo-item-1"]').exists()).toBe(true)
  })

  it('con más ítems que una página muestra la paginación y emite `update:page`', async () => {
    const wrapper = await montar([producto()], { total: 100, pageSize: 48 })

    const paginacion = wrapper.findComponent({ name: 'UPagination' })
    expect(paginacion.exists()).toBe(true)
    // A 375 px los dos vecinos por lado más los controles no entran en una fila.
    expect(paginacion.props('siblingCount')).toBe(1)

    paginacion.vm.$emit('update:page', 2)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:page')?.at(-1)).toEqual([2])
  })

  it('cabiendo en una página no muestra la paginación', async () => {
    const wrapper = await montar([producto()], { total: 10, pageSize: 48 })

    expect(wrapper.findComponent({ name: 'UPagination' }).exists()).toBe(false)
  })
})

describe('CatalogoGrid — sin ítems: no es lo mismo no tener, no encontrar y no poder cargar (lote 7)', () => {
  async function montarVacio(props: Record<string, unknown>) {
    return mountSuspended(CatalogoGrid, {
      props: { items: [], total: 0, pageSize: 48, ...props },
      global: { stubs },
    })
  }

  it('sin búsqueda y sin ítems dice qué hacer, no "No hay ítems para mostrar"', async () => {
    const wrapper = await montarVacio({})
    expect(wrapper.text()).not.toContain('No hay ítems para mostrar')
    expect(wrapper.text()).toContain('Aún no hay ítems para vender. Avisa al encargado.')
  })

  it('el texto del vacío lo puede poner la pantalla (la tienda online)', async () => {
    const wrapper = await montarVacio({ vacio: 'Aún no hay ítems a la venta online.' })
    expect(wrapper.text()).toContain('Aún no hay ítems a la venta online.')
  })

  it('con búsqueda sin resultado nombra lo buscado y ofrece borrarla', async () => {
    const wrapper = await montarVacio({ busqueda: 'zzzz' })
    expect(wrapper.text()).toContain('No encontramos «zzzz». Prueba con otra palabra.')
    expect(wrapper.text()).not.toContain('Avisa al encargado')

    expect(wrapper.find('[data-qa="estado-quitar-filtros"]').text()).toBe('Borrar búsqueda')
    await wrapper.find('[data-qa="estado-quitar-filtros"]').trigger('click')
    expect(wrapper.emitted('update:busqueda')?.at(-1)).toEqual([''])
  })

  it('si el catálogo no cargó, dice que falló y ofrece Reintentar (no "no hay ítems")', async () => {
    const wrapper = await montarVacio({ error: true })
    expect(wrapper.text()).not.toContain('Aún no hay ítems')
    expect(wrapper.text()).toContain('No pudimos cargar el catálogo')

    await wrapper.find('[data-qa="estado-reintentar"]').trigger('click')
    expect(wrapper.emitted('reintentar')).toHaveLength(1)
  })

  it('un 403 dice "Sin acceso al catálogo"', async () => {
    const wrapper = await montarVacio({ error: true, sinPermiso: true })
    expect(wrapper.text()).toContain('Sin acceso al catálogo.')
  })

  it('si falló pero quedan ítems de antes, la grilla se queda (un corte no la vacía a mitad de servicio)', async () => {
    const wrapper = await mountSuspended(CatalogoGrid, {
      props: { items: [producto()], total: 1, pageSize: 48, error: true },
      global: { stubs },
    })
    expect(wrapper.find('[data-qa="item-catalogo-item-1"]').exists()).toBe(true)
  })

  it('el buscador sigue disponible en cualquiera de los estados', async () => {
    const wrapper = await montarVacio({ error: true })
    expect(wrapper.find('input').exists()).toBe(true)
  })
})

// Auditoría UX 01.9 / 09.12: la tarjeta era un `div` con `@click`. Sin rol ni
// `tabindex`, el teclado saltaba el catálogo entero y la tienda online (que no
// tiene otro camino al carrito) quedaba sin uso con lector de pantalla.
describe('CatalogoGrid — se opera con teclado', () => {
  it('la tarjeta es un botón alcanzable con Tab', async () => {
    const wrapper = await montar([producto({ stockDisponible: '1.0000' })])
    const tarjeta = wrapper.find('[data-qa="item-catalogo-item-1"]')
    expect(tarjeta.attributes('role')).toBe('button')
    expect(tarjeta.attributes('tabindex')).toBe('0')
  })

  it('Enter y Espacio agregan el ítem', async () => {
    const wrapper = await montar([producto({ stockDisponible: '1.0000' })])
    const tarjeta = wrapper.find('[data-qa="item-catalogo-item-1"]')
    await tarjeta.trigger('keydown', { key: 'Enter' })
    await tarjeta.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('add')).toHaveLength(2)
  })

  it('mantener apretado Enter agrega una sola vez (la tecla repetida no cuenta)', async () => {
    const wrapper = await montar([producto({ stockDisponible: '5.0000' })])
    const tarjeta = wrapper.find('[data-qa="item-catalogo-item-1"]')
    await tarjeta.trigger('keydown', { key: 'Enter' })
    await tarjeta.trigger('keydown', { key: 'Enter', repeat: true })
    await tarjeta.trigger('keydown', { key: 'Enter', repeat: true })
    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('agotado, el teclado tampoco agrega', async () => {
    const wrapper = await montar([producto({ stockDisponible: '0.0000' })])
    const tarjeta = wrapper.find('[data-qa="item-catalogo-item-1"]')
    await tarjeta.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('add')).toBeUndefined()
  })
})

describe('CatalogoGrid — el buscador del mostrador (01.25)', () => {
  it('un lector que escribe el código y manda Enter emite `buscar-enter`', async () => {
    const wrapper = await montar([producto({ stockDisponible: '1.0000' })])

    await wrapper.find('input').setValue('7801234')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('buscar-enter')).toHaveLength(1)
  })

  it('con texto en el buscador hay un botón para borrarlo', async () => {
    const wrapper = await mountSuspended(CatalogoGrid, {
      props: { items: [producto()], total: 1, pageSize: 48, busqueda: 'coca' },
      global: { stubs },
    })

    const borrar = wrapper.find('button[aria-label="Borrar búsqueda"]')
    expect(borrar.exists()).toBe(true)
    await borrar.trigger('click')

    expect(wrapper.emitted('update:busqueda')?.at(-1)).toEqual([''])
  })

  it('sin texto no hay botón de borrar', async () => {
    const wrapper = await montar([producto()])

    expect(wrapper.find('button[aria-label="Borrar búsqueda"]').exists()).toBe(false)
  })

  it('con `autofocus` y un puntero fino (escritorio), el buscador toma el foco', async () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('pointer: fine'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      const wrapper = await mountSuspended(CatalogoGrid, {
        props: { items: [producto()], total: 1, pageSize: 48, autofocus: true },
        global: { stubs },
        attachTo: document.body,
      })
      await new Promise(r => setTimeout(r, 0))
      expect(document.activeElement).toBe(wrapper.find('input').element)
      wrapper.unmount()
    }
    finally {
      window.matchMedia = original
    }
  })

  it('en una tablet (puntero grueso) no abre el teclado solo', async () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    try {
      const wrapper = await mountSuspended(CatalogoGrid, {
        props: { items: [producto()], total: 1, pageSize: 48, autofocus: true },
        global: { stubs },
        attachTo: document.body,
      })
      await new Promise(r => setTimeout(r, 0))
      expect(document.activeElement).not.toBe(wrapper.find('input').element)
      wrapper.unmount()
    }
    finally {
      window.matchMedia = original
    }
  })
})

describe('CatalogoGrid — una sola palabra para lo que queda, y por qué no se puede vender (01.26)', () => {
  it('productos y recetas dicen "Disponible"', async () => {
    const wrapper = await montar([
      producto({ stockDisponible: '5.0000' }),
      producto({ id: 'receta-1', tipo: 'receta', stock: null, disponible: 4, stockDisponible: null }),
    ])

    expect(textoTarjeta(wrapper)).toContain('Disponible: 5')
    expect(textoTarjeta(wrapper, 'receta-1')).toContain('Disponible: 4')
    expect(wrapper.text()).not.toContain('Disponibles')
  })

  it('una tarjeta sin stock lo dice', async () => {
    const wrapper = await montar([producto({ stock: '0.0000', stockDisponible: '0.0000' })])

    expect(textoTarjeta(wrapper)).toContain('Sin stock')
  })

  it('una receta agotada también', async () => {
    const wrapper = await montar([
      producto({ id: 'receta-1', tipo: 'receta', stock: null, disponible: 0, stockDisponible: null }),
    ])

    expect(textoTarjeta(wrapper, 'receta-1')).toContain('Sin stock')
  })

  it('el combo que depende de la opción lo dice en el texto, sin asterisco ni tooltip', async () => {
    const wrapper = await montar([
      producto({ id: 'combo-1', tipo: 'combo', stock: null, disponible: null, stockDisponible: null, disponibleCondicional: true }),
    ])

    const t = textoTarjeta(wrapper, 'combo-1')
    expect(t).toContain('Disponible según la opción')
    expect(t).not.toContain('*')
  })

  it('con stock no dice "Sin stock"', async () => {
    const wrapper = await montar([producto({ stockDisponible: '2.0000' })])

    expect(textoTarjeta(wrapper)).not.toContain('Sin stock')
  })
})

describe('CatalogoGrid — textos con "…" y no con tres puntos (01.31)', () => {
  it('el placeholder del buscador y el de carga usan el carácter "…"', async () => {
    const wrapper = await mountSuspended(CatalogoGrid, {
      props: { items: [], total: 0, pageSize: 48, loading: true },
      global: { stubs },
    })

    expect(wrapper.find('input').attributes('placeholder')).toBe('Buscar ítem…')
    expect(wrapper.text()).toContain('Cargando catálogo…')
    expect(wrapper.text()).not.toContain('...')
  })
})

// Auditoría UX 02.25: con un menú de 80 ítems, buscar solo por texto con el teclado de la tablet
// es lo único que había. Chips de categoría arriba de la búsqueda (solo si la pantalla las pasa).
describe('CatalogoGrid — categorías (02.25)', () => {
  const CATEGORIAS = [{ id: 'cat-bebidas', nombre: 'Bebidas' }, { id: 'cat-platos', nombre: 'Platos' }]

  async function conCategorias(items: ItemCatalogo[], extra: Record<string, unknown> = {}) {
    return mountSuspended(CatalogoGrid, {
      props: { items, total: items.length, pageSize: 48, categorias: CATEGORIAS, ...extra },
      global: { stubs },
    })
  }

  const chips = (w: Awaited<ReturnType<typeof conCategorias>>) => w.findAll('[data-qa="categoria-chip"]')

  it('sin categorías no dibuja chips (el POS y la tienda siguen como están)', async () => {
    const w = await montar([producto()])
    expect(w.findAll('[data-qa="categoria-chip"]')).toHaveLength(0)
  })

  it('ofrece "Todas" y una por categoría; tocar una emite su id, "Todas" emite null', async () => {
    const w = await conCategorias([producto()])
    expect(chips(w).map(c => c.text())).toEqual(['Todas', 'Bebidas', 'Platos'])
    await chips(w)[1]!.trigger('click')
    expect(w.emitted('update:categoria')?.at(-1)).toEqual(['cat-bebidas'])
    await chips(w)[0]!.trigger('click')
    expect(w.emitted('update:categoria')?.at(-1)).toEqual([null])
  })

  it('la elegida queda marcada para el lector de pantalla', async () => {
    const w = await conCategorias([producto()], { categoria: 'cat-platos' })
    expect(chips(w).map(c => c.attributes('aria-pressed'))).toEqual(['false', 'false', 'true'])
  })

  it('una categoría sin productos lo dice y ofrece volver a todas', async () => {
    const w = await conCategorias([], { categoria: 'cat-platos' })
    expect(w.text()).toContain('No hay productos en «Platos»')
    const volver = w.findAll('button').find(b => b.text() === 'Ver todas')
    expect(volver, 'botón para quitar la categoría').toBeTruthy()
    await volver!.trigger('click')
    expect(w.emitted('update:categoria')?.at(-1)).toEqual([null])
  })
})
