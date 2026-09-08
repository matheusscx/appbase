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

const PRODUCTO = {
  id: 'item-1',
  nombre: 'Harina',
  modoInventario: 'cantidad',
  unidadMedida: 'kg',
  // 10 en el local (ya neto de lo comprometido) y 20 en la bodega —
  // números distintos a propósito para no poder confundirlos.
  stockDisponible: '10.0000',
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
    if (url.includes('/ubicaciones')) return Promise.resolve([LOCAL, BODEGA])
    if (url.includes('/motivos-traslado')) return Promise.resolve([MOTIVO])
    if (url.includes('/items?tipo=producto')) {
      return Promise.resolve({ data: [PRODUCTO], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
    }
    if (url.includes('/items?tipo=ingrediente')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } })
    }
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
    await emitir(selectConOpcion(wrapper, PRODUCTO.id), PRODUCTO.id)
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
    await emitir(selectConOpcion(wrapper, PRODUCTO.id), PRODUCTO.id)
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
    await emitir(selectConOpcion(wrapper, PRODUCTO.id), PRODUCTO.id)

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

  it('sin ?itemId en la URL, no abre nada — es el camino normal del formulario', async () => {
    routeQuery = {}
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 30))

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    wrapper.unmount()
  })
})
