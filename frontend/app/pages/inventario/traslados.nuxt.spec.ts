// @vitest-environment nuxt
//
// Frente de bodegas y traslados. Lo que este spec fija:
//   1. Origen y destino no pueden coincidir — el botón de confirmar se
//      deshabilita, no se corta recién al mandar el POST.
//   2. El disponible que se muestra por línea es el del ORIGEN elegido, no un
//      número calculado en el cliente: 10 en el local, 20 en la bodega —
//      eligiendo la bodega tiene que decir 20.
//   3. Cambiar el origen limpia las líneas ya cargadas: las cantidades se
//      habían elegido contra el disponible del origen anterior.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Traslados from './traslados.vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }
// Destino del aviso de stock bajo, que puede disparar sobre una bodega y no
// solo sobre el local.
const BODEGA_BARRA = { id: 'bodega-2', nombre: 'Bodega barra', tipo: 'bodega', activo: true }

const PRODUCTO = {
  id: 'item-1',
  nombre: 'Harina',
  modoInventario: 'cantidad',
  unidadMedida: 'kg',
  // 10 en el local (ya neto de lo comprometido) y 20 en la bodega —
  // números distintos a propósito para no poder confundirlos.
  stockDisponible: '10.0000',
}

// Un producto por serie que NO está en la primera búsqueda del selector: solo se alcanza por
// `ids=` (el link directo del toast de rechazo por stock). Si la pantalla no lo trae por id,
// no sabe que va por serie.
const PRODUCTO_SERIE = {
  id: 'item-serie',
  nombre: 'Notebook',
  modoInventario: 'serie',
  unidadMedida: null,
  stockDisponible: '2.0000',
}
const UNIDAD_SERIE = {
  id: 'unidad-1',
  serie: 'SN-0001',
  condicion: 'nuevo',
  garantiaHasta: null,
  ubicacionId: 'bodega-1',
}

const ITEM_DETALLE = {
  id: PRODUCTO.id,
  nombre: PRODUCTO.nombre,
  desglosePorUbicacion: [
    { ubicacionId: LOCAL.id, nombre: LOCAL.nombre, stock: '10.0000' },
    { ubicacionId: BODEGA.id, nombre: BODEGA.nombre, stock: '20.0000' },
  ],
}

const MOTIVO = { id: 'motivo-1', nombre: 'Reposición' }

// Frente de bodegas y traslados: el botón "Trasladar" del toast de "no hay
// stock" llega acá con `?itemId=&origenId=&cantidad=`. `{}` por default —el
// caso de los tres puntos de la cabecera, que abren el drawer a mano— y cada
// test de la precarga lo pisa antes de montar.
//
// Solo se mockea `useRoute` (para inyectar la query), NUNCA `useRouter`: los
// plugins internos de Nuxt (`chunk-reload`, el sync de página) llaman
// `router.beforeEach`/`afterEach`/`beforeResolve` en el arranque, y un mock
// liviano sin esos métodos revienta la inicialización de la app entera —
// medido. El `router.replace(...)` que limpia la query al cerrar el drawer
// corre contra el router REAL y no se afirma en este archivo.
let routeQuery: Record<string, string> = {}
// Si un test lo setea, la respuesta de `GET /items?ids=` espera a que se libere.
let retenerIds: Promise<void> | null = null
let pedidosIds = 0
const urlsItems: string[] = []

mockNuxtImport('useRoute', () => {
  return () => ({ query: routeQuery })
})

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, _opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve({ data: [], meta: {} })
    if (url.includes('/ubicaciones')) return Promise.resolve([LOCAL, BODEGA, BODEGA_BARRA])
    if (url.includes('/motivos-traslado')) return Promise.resolve([MOTIVO])
    // `GET /items?ids=` — el caché por id (`resolver`): solo conoce lo que se pide.
    if (url.includes('/items?ids=')) {
      pedidosIds++
      const ids = new URL(url, 'http://x').searchParams.get('ids')!.split(',')
      const data = [PRODUCTO, PRODUCTO_SERIE].filter(p => ids.includes(p.id))
      const respuesta = { data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } }
      return retenerIds ? retenerIds.then(() => respuesta) : Promise.resolve(respuesta)
    }
    // `GET /items?...` — la búsqueda del selector: 20 por página, solo el PRODUCTO.
    if (url.includes('/items?')) {
      urlsItems.push(url)
      return Promise.resolve({ data: [PRODUCTO], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
    }
    if (url.endsWith(`/items/${PRODUCTO_SERIE.id}/unidades?estado=disponible`)) return Promise.resolve([UNIDAD_SERIE])
    // `GET /items/:id` — el detalle con el desglose por ubicación. Se pide
    // solo cuando el origen es una bodega (del local no hace falta, ya viene
    // neto en `stockDisponible` del listado — `docs/features/bodegas-y-traslados.md`,
    // «El tope del traslado es asimétrico (decisión 6)»).
    if (url.endsWith(`/items/${PRODUCTO.id}`)) return Promise.resolve(ITEM_DETALLE)
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve([])
    return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
  }
})

async function montar() {
  const wrapper = await mountSuspended(Traslados, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: `
            <div v-if="open" role="dialog">
              <slot name="header" />
              <slot name="body" />
              <slot name="actions" />
            </div>
          `,
        },
      },
    },
  })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

/** Todos los `USelectMenu` cuyas opciones incluyen `valor` — en orden de aparición. */
function selectsConOpcion(wrapper: Wrapper, valor: string) {
  return wrapper.findAllComponents({ name: 'USelectMenu' }).filter((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    return Array.isArray(items) && items.some(i => i?.value === valor)
  })
}

function selectConOpcion(wrapper: Wrapper, valor: string) {
  const encontrados = selectsConOpcion(wrapper, valor)
  expect(encontrados.length, `USelectMenu con la opción "${valor}"`).toBeGreaterThan(0)
  return encontrados[0]!
}

/**
 * Elige el producto del selector con búsqueda: abre el menú (que dispara la búsqueda y llena el
 * caché) y emite la selección, como el usuario. `AppItemSelect` no trae opciones hasta que se abre.
 */
async function elegirProducto(wrapper: Wrapper, valor: string) {
  const menu = wrapper.findComponent({ name: 'AppItemSelect' }).findComponent({ name: 'USelectMenu' })
  expect(menu.exists(), 'selector de producto').toBe(true)
  menu.vm.$emit('update:open', true)
  await new Promise(r => setTimeout(r, 20))
  menu.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

async function emitir(comp: ReturnType<typeof selectConOpcion>, valor: string) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

async function abrirDrawer(wrapper: Wrapper) {
  const boton = wrapper.findAll('button').find(b => b.text().includes('Nuevo traslado'))
  expect(boton, 'botón "Nuevo traslado"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

function botonConfirmar(wrapper: Wrapper) {
  const boton = wrapper.findAllComponents({ name: 'UButton' })
    .find(b => b.text().trim() === 'Confirmar traslado' && b.props('type') === 'submit')
  expect(boton, 'botón "Confirmar traslado"').toBeTruthy()
  return boton!
}

describe('traslados — formulario', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('no deja confirmar con origen igual a destino', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    // Origen y destino comparten el mismo universo de opciones (las
    // ubicaciones): el select de ORIGEN aparece antes que el de DESTINO en
    // el formulario, así que el orden de aparición decide cuál es cuál.
    const [origenSelect, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    expect(origenSelect, 'select de origen').toBeTruthy()
    expect(destinoSelect, 'select de destino').toBeTruthy()

    await emitir(origenSelect!, LOCAL.id)
    await emitir(destinoSelect!, LOCAL.id)
    await emitir(selectConOpcion(wrapper, MOTIVO.id), MOTIVO.id)
    await elegirProducto(wrapper, PRODUCTO.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('2')

    const boton = botonConfirmar(wrapper)
    expect(boton.attributes('disabled')).toBeDefined()

    // Con un destino distinto, y todo lo demás igual, el botón se habilita:
    // prueba que lo que lo frenaba era justo el origen === destino.
    await emitir(destinoSelect!, BODEGA.id)
    expect(boton.attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('el disponible que muestra por línea es el del ORIGEN elegido', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    const [origenSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, BODEGA.id)
    await elegirProducto(wrapper, PRODUCTO.id)
    await new Promise(r => setTimeout(r, 30))

    const disponible = wrapper.find('[data-qa="linea-disponible"]')
    expect(disponible.exists()).toBe(true)
    expect(disponible.text()).toContain('20')
    expect(disponible.text()).not.toContain('10')

    wrapper.unmount()
  })

  it('al cambiar el origen, limpia las líneas ya cargadas', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    const [origenSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, LOCAL.id)
    await elegirProducto(wrapper, PRODUCTO.id)

    const cantidadInput = wrapper.find('input[inputmode="decimal"]')
    expect(cantidadInput.exists()).toBe(true)
    await cantidadInput.setValue('7')
    expect((wrapper.find('input[inputmode="decimal"]').element as HTMLInputElement).value).toBe('7')

    await emitir(origenSelect!, BODEGA.id)

    // La línea entera se reinicia: sin ítem elegido, el campo de cantidad ni
    // siquiera se dibuja. Si sobreviviera, sería un "7" tipeado contra el
    // disponible del LOCAL, aplicado como si fuera de la bodega.
    expect(wrapper.find('input[inputmode="decimal"]').exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('traslados — el traslado precargado desde el toast de "no hay stock"', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
    routeQuery = {}
    retenerIds = null
    pedidosIds = 0
    urlsItems.length = 0
  })

  it('con ?itemId&origenId&cantidad, abre el drawer YA armado: origen la bodega, destino el local, el producto y la cantidad cargados', async () => {
    routeQuery = { itemId: PRODUCTO.id, origenId: BODEGA.id, cantidad: '3' }
    const wrapper = await montar()
    // Precarga async: cargar catálogos + `onSeleccionarItem` (que pide
    // `GET /items/:id` para el disponible de la bodega). Más margen que el
    // resto del archivo a propósito.
    await new Promise(r => setTimeout(r, 60))

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

    // Origen = la bodega: lo dice el disponible mostrado (20, el de la bodega —
    // mismo ancla que el test del formulario, arriba).
    const disponible = wrapper.find('[data-qa="linea-disponible"]')
    expect(disponible.exists()).toBe(true)
    expect(disponible.text()).toContain('Bodega centro')
    expect(disponible.text()).toContain('20')

    // Destino = el local: el toast no lo manda, la pantalla lo completa.
    const [, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    expect(destinoSelect, 'select de destino').toBeTruthy()
    expect(destinoSelect!.props('modelValue')).toBe(LOCAL.id)

    // La cantidad que el toast dijo que faltaba, no lo que haya calculado
    // `onSeleccionarItem` de más.
    const cantidadInput = wrapper.find('input[inputmode="decimal"]')
    expect((cantidadInput.element as HTMLInputElement).value).toBe('3')

    wrapper.unmount()
  })

  it('con ?destinoId (el aviso de stock bajo), el destino es ESE y no el local', async () => {
    routeQuery = {
      itemId: PRODUCTO.id,
      origenId: BODEGA.id,
      destinoId: BODEGA_BARRA.id,
      cantidad: '4',
    }
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    const [, destinoSelect] = selectsConOpcion(wrapper, BODEGA_BARRA.id)
    expect(destinoSelect, 'select de destino').toBeTruthy()
    expect(destinoSelect!.props('modelValue')).toBe(BODEGA_BARRA.id)
    const disponible = wrapper.find('[data-qa="linea-disponible"]')
    expect(disponible.text()).toContain('Bodega centro')

    wrapper.unmount()
  })

  it('un ?destinoId que no es un destino posible (desactivado, inexistente) cae al local', async () => {
    routeQuery = {
      itemId: PRODUCTO.id,
      origenId: BODEGA.id,
      destinoId: 'bodega-que-ya-no-esta',
      cantidad: '4',
    }
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))

    const [, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    expect(destinoSelect!.props('modelValue')).toBe(LOCAL.id)

    wrapper.unmount()
  })

  it('un producto por serie que no está en la primera búsqueda abre la línea en modo serie, no en cantidad', async () => {
    routeQuery = { itemId: PRODUCTO_SERIE.id, origenId: BODEGA.id }
    // La respuesta de `ids=` espera: mientras no llega, la pantalla NO puede haber precargado la
    // línea (sin saber el modo, adivinaría `'cantidad'`). Retenerla también evita que el test
    // pase por el resolve-al-montar del selector en vez de por el `resolver` de la pantalla.
    let liberar!: () => void
    retenerIds = new Promise<void>((r) => { liberar = r })
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    // Mientras `ids=` no llegó, la línea no tiene ítem: la pantalla no eligió nada (ni adivinó un modo).
    expect(wrapper.findComponent({ name: 'AppItemSelect' }).props('modelValue')).toBe('')
    expect(wrapper.find('input[inputmode="decimal"]').exists()).toBe(false)

    liberar()
    await new Promise(r => setTimeout(r, 60))

    expect(wrapper.text()).toContain('SN-0001')
    expect(wrapper.text()).toContain('Selecciona unidades a trasladar')
    expect(wrapper.find('input[inputmode="decimal"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('si el usuario elige otro producto mientras se resuelve el del link, la precarga no lo pisa', async () => {
    routeQuery = { itemId: PRODUCTO_SERIE.id, origenId: BODEGA.id }
    let liberar!: () => void
    retenerIds = new Promise<void>((r) => { liberar = r })
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

    // El usuario elige a mano Harina (la búsqueda del selector no pasa por `ids=`).
    await elegirProducto(wrapper, PRODUCTO.id)
    expect(wrapper.findComponent({ name: 'AppItemSelect' }).props('modelValue')).toBe(PRODUCTO.id)

    liberar()
    await new Promise(r => setTimeout(r, 60))

    expect(wrapper.findComponent({ name: 'AppItemSelect' }).props('modelValue')).toBe(PRODUCTO.id)
    expect(wrapper.text()).not.toContain('SN-0001')
    expect(wrapper.text()).toContain('Disponible en Bodega centro')

    wrapper.unmount()
  })

  it('si el ítem del link no se puede traer, avisa y no precarga la línea', async () => {
    routeQuery = { itemId: PRODUCTO_SERIE.id, origenId: BODEGA.id }
    retenerIds = Promise.reject(new Error('sin red'))
    retenerIds.catch(() => {})
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))

    // El drawer abre con origen/destino, pero la línea queda vacía: nada de modo inventado.
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('input[inputmode="decimal"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Selecciona unidades a trasladar')
    expect(pedidosIds).toBeGreaterThan(0)

    wrapper.unmount()
  })

  it('el selector de producto pide ambos tipos al servidor', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    const [origenSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, LOCAL.id)
    await elegirProducto(wrapper, PRODUCTO.id)

    expect(urlsItems.some(u => u.includes('tipo=producto%2Cingrediente'))).toBe(true)

    wrapper.unmount()
  })

  it('sin ?itemId en la URL, no abre nada — es el camino normal del formulario', async () => {
    routeQuery = {}
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 30))

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    wrapper.unmount()
  })
})
