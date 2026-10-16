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
// Los POST /traslados que salieron (05.2: una línea incompleta no debe viajar ni descartarse).
let enviados: { url: string, body: { lineas: Record<string, unknown>[] } }[] = []
let avisos: { title: string, color?: string }[] = []
let bodegasBackend: typeof BODEGA[] = [BODEGA, BODEGA_BARRA]

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title: string, color?: string }) => avisos.push(t) })
})

mockNuxtImport('useRoute', () => {
  return () => ({ query: routeQuery })
})

// 05.24: un rol sin Inventario:Crear (el aprobador) entra a la lista y no ve ninguna acción.
let permitido = true
mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return permitido },
    can: () => permitido,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve({ data: [], meta: {} })
    if (opts?.method === 'POST' && url.endsWith('/traslados')) {
      enviados.push({ url, body: opts.body as { lineas: Record<string, unknown>[] } })
      return Promise.resolve({ id: 't-1', detalle: [] })
    }
    if (url.includes('/ubicaciones')) return Promise.resolve([LOCAL, ...bodegasBackend])
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
              <slot name="ayuda" />
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

describe('traslados — por qué Confirmar está apagado (05.10)', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  const falta = (w: Wrapper) => w.find('[data-qa="traslado-falta"]')

  it('va nombrando lo primero que falta, en el orden del formulario', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    expect(falta(wrapper).text()).toBe('Falta elegir el origen')

    const [origenSelect, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, LOCAL.id)
    expect(falta(wrapper).text()).toBe('Falta elegir el destino')

    await emitir(destinoSelect!, LOCAL.id)
    expect(falta(wrapper).text()).toBe('El origen y el destino no pueden ser el mismo')

    await emitir(destinoSelect!, BODEGA.id)
    expect(falta(wrapper).text()).toBe('Falta elegir el motivo')

    await emitir(selectConOpcion(wrapper, MOTIVO.id), MOTIVO.id)
    expect(falta(wrapper).text()).toBe('Falta elegir un producto')

    await elegirProducto(wrapper, PRODUCTO.id)
    expect(falta(wrapper).text()).toBe('Falta la cantidad')

    await wrapper.find('input[inputmode="decimal"]').setValue('2')
    expect(falta(wrapper).exists()).toBe(false)
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

// Lote 4 (05.13): a 768 la tabla de traslados medía 802 px en 672 y "Comentario" quedaba fuera.
describe('traslados — forma de la tabla en tablet', () => {
  function cabecera(texto: string) {
    return Array.from(document.body.querySelectorAll('th')).find(th => th.textContent?.trim() === texto)
  }

  it('"Usuario" se oculta bajo lg y el comentario se acota', async () => {
    await montar()
    expect(cabecera('Usuario')?.className).toContain('hidden')
    expect(cabecera('Usuario')?.className).toContain('lg:table-cell')
    expect(cabecera('Comentario')?.className).toContain('max-w-40')
  })
})

describe('traslados — una línea empezada e incompleta bloquea el envío (05.2)', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
    routeQuery = {}
    enviados = []
    avisos = []
  })

  /** Cabecera completa: origen bodega, destino local, motivo. */
  async function cabecera(wrapper: Wrapper) {
    const [origenSelect, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, BODEGA.id)
    await emitir(destinoSelect!, LOCAL.id)
    await emitir(selectConOpcion(wrapper, MOTIVO.id), MOTIVO.id)
  }

  const errorDeLinea = (w: Wrapper) => w.find('[data-slot="error"]')

  it('con producto y sin cantidad, el envío no sale, el campo queda marcado y no hay aviso de éxito', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await cabecera(wrapper)
    await elegirProducto(wrapper, PRODUCTO.id)

    // Antes del intento no se grita.
    expect(errorDeLinea(wrapper).exists()).toBe(false)
    // El botón queda activo para que el error aparezca junto al campo.
    expect(botonConfirmar(wrapper).attributes('disabled')).toBeUndefined()

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(0)
    expect(avisos.map(a => a.title)).not.toContain('Traslado registrado')
    expect(errorDeLinea(wrapper).text()).toBe('Falta la cantidad')

    // Al completar la cantidad la marca se va y el envío sale.
    await wrapper.find('input[inputmode="decimal"]').setValue('2')
    expect(errorDeLinea(wrapper).exists()).toBe(false)
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))
    expect(enviados).toHaveLength(1)
    wrapper.unmount()
  })

  it('una línea completa y otra incompleta: no viaja NINGUNA (antes viajaba solo la completa)', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await cabecera(wrapper)
    await elegirProducto(wrapper, PRODUCTO.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('2')

    const agregar = wrapper.findAll('button').find(b => b.text().includes('Agregar línea'))
    await agregar!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    // Segunda línea: producto elegido, sin cantidad.
    const menu = wrapper.findAllComponents({ name: 'AppItemSelect' })[1]!.findComponent({ name: 'USelectMenu' })
    menu.vm.$emit('update:open', true)
    await new Promise(r => setTimeout(r, 20))
    menu.vm.$emit('update:modelValue', PRODUCTO.id)
    await new Promise(r => setTimeout(r, 40))

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(0)
    expect(wrapper.findAll('[data-slot="error"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('una línea vacía (sin producto) no bloquea y no viaja', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await cabecera(wrapper)
    await elegirProducto(wrapper, PRODUCTO.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('2')

    const agregar = wrapper.findAll('button').find(b => b.text().includes('Agregar línea'))
    await agregar!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.findAllComponents({ name: 'AppItemSelect' })).toHaveLength(2)

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.body.lineas).toHaveLength(1)
    expect(wrapper.findAll('[data-slot="error"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('un producto por serie sin unidades elegidas queda marcado y no viaja', async () => {
    routeQuery = { itemId: PRODUCTO_SERIE.id, origenId: BODEGA.id }
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))
    const [, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(destinoSelect!, LOCAL.id)
    await emitir(selectConOpcion(wrapper, MOTIVO.id), MOTIVO.id)

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(0)
    expect(wrapper.find('[data-qa="linea-error"]').text()).toBe('Elige las unidades a trasladar')
    wrapper.unmount()
  })
})

// Auditoría UX 05.18: quitar línea medía 28×28 pegado al selector de producto,
// sin confirmación ni deshacer; "Agregar línea" 110×24.
describe('traslados — tamaño táctil de las líneas', () => {
  const M44 = /(^|\s)(min-h-11|size-11|h-11)(\s|$)/

  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('"Agregar línea" y quitar línea miden 44 px, y quitar va apartado del selector', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    const agregar = wrapper.findAll('button').find(b => b.text().includes('Agregar línea'))
    expect(agregar!.classes().join(' ')).toMatch(M44)

    const [origenSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, LOCAL.id)
    await agregar!.trigger('click')
    await new Promise(r => setTimeout(r, 20))

    const quitar = wrapper.find('button[aria-label="Quitar línea del traslado"]')
    expect(quitar.exists()).toBe(true)
    expect(quitar.classes().join(' ')).toMatch(M44)
    expect(quitar.classes().join(' ')).toMatch(/(^|\s)ms-[2-9](\s|$)/)
    wrapper.unmount()
  })
})

// Auditoría UX 05.8: con "Disponible: 20" a la vista se podía escribir 999 sin ninguna marca; el
// servidor contestaba en un toast. La marca NO bloquea: el tope lo sigue calculando el servidor.
describe('traslados — la cantidad que no alcanza se marca junto al campo (05.8)', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
    routeQuery = {}
    enviados = []
    avisos = []
  })

  async function conProducto(wrapper: Wrapper) {
    const [origenSelect, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, BODEGA.id)
    await emitir(destinoSelect!, LOCAL.id)
    await emitir(selectConOpcion(wrapper, MOTIVO.id), MOTIVO.id)
    await elegirProducto(wrapper, PRODUCTO.id)
    await new Promise(r => setTimeout(r, 30))
  }

  it('si la cantidad supera lo disponible, lo dice con el número y no apaga el botón', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await conProducto(wrapper)
    const disponible = wrapper.find('[data-qa="linea-disponible"]')
    expect(wrapper.find('[data-qa="linea-excede"]').exists()).toBe(false)

    await wrapper.find('input[inputmode="decimal"]').setValue('999')
    const excede = wrapper.find('[data-qa="linea-excede"]')
    expect(excede.exists()).toBe(true)
    expect(excede.text()).toContain('20')
    expect(disponible.exists()).toBe(true)
    expect(botonConfirmar(wrapper).attributes('disabled')).toBeUndefined()

    await wrapper.find('input[inputmode="decimal"]').setValue('20')
    expect(wrapper.find('[data-qa="linea-excede"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

// Auditoría UX 05.11: antes de confirmar, una línea que dice qué se va a mover.
describe('traslados — resumen antes de confirmar (05.11)', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
    routeQuery = {}
  })

  it('con todo completo dice qué se mueve, de dónde y a dónde; incompleto, no lo dice', async () => {
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    const [origenSelect, destinoSelect] = selectsConOpcion(wrapper, LOCAL.id)
    await emitir(origenSelect!, BODEGA.id)
    await emitir(destinoSelect!, LOCAL.id)
    await emitir(selectConOpcion(wrapper, MOTIVO.id), MOTIVO.id)
    await elegirProducto(wrapper, PRODUCTO.id)
    expect(wrapper.find('[data-qa="traslado-resumen"]').exists()).toBe(false)

    await wrapper.find('input[inputmode="decimal"]').setValue('2')
    const resumen = wrapper.find('[data-qa="traslado-resumen"]')
    expect(resumen.text()).toBe('Vas a mover 2 kg de Harina de Bodega centro a Local')
    expect(wrapper.find('[data-qa="traslado-falta"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

// Auditoría UX 05.19: la casilla de cada serie medía 16 px y no estaba unida a su texto.
describe('traslados — la casilla de cada serie (05.19)', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('el nombre de la serie es la etiqueta de su casilla, y tocarla marca la unidad', async () => {
    routeQuery = { itemId: PRODUCTO_SERIE.id, origenId: BODEGA.id }
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))
    const casilla = wrapper.find('[role="checkbox"]')
    expect(casilla.exists()).toBe(true)
    const etiqueta = wrapper.find(`label[for="${casilla.attributes('id')}"]`)
    expect(etiqueta.text()).toContain('SN-0001')
    await casilla.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.text()).toContain('1 seleccionadas')
    wrapper.unmount()
  })
})

// Auditoría UX 05.24: sin permiso o sin bodegas, el botón falta o se apaga sin motivo visible.
describe('traslados — por qué no hay botón o está apagado (05.24)', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
    routeQuery = {}
    permitido = true
    bodegasBackend = [BODEGA, BODEGA_BARRA]
  })

  const aviso = (w: Wrapper) => w.find('[data-qa="traslados-sin-accion"]')

  it('con permiso y con bodegas no dice nada', async () => {
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))
    expect(aviso(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('sin permiso de trasladar, dice que solo puede mirar y quién los registra', async () => {
    permitido = false
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))
    expect(aviso(wrapper).text()).toBe('Solo puedes ver los traslados; los registra quien cuenta.')
    wrapper.unmount()
  })

  it('sin bodegas, el botón apagado se explica en pantalla y no solo en un title', async () => {
    bodegasBackend = []
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 60))
    expect(aviso(wrapper).text()).toBe('Para trasladar necesitas al menos una bodega.')
    wrapper.unmount()
  })
})
