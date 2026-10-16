// @vitest-environment nuxt
//
// Frente de bodegas y traslados: el alta de sesión de recuento elige ubicación.
// Lo que este spec fija:
//   1. Con una sola ubicación (solo local) el selector no se dibuja, y el
//      cliente completa `ubicacionId` con el local igual.
//   2. Con una bodega, el selector se dibuja y lo elegido viaja en el body
//      de `POST /recuentos`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import RecuentosIndex from './index.vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }

const HARINA = { id: 'item-harina', nombre: 'Harina', modoInventario: 'cantidad' }

let ubicacionesBackend: typeof LOCAL[] = [LOCAL]
let recuentosEnviados: Record<string, unknown>[] = []
let busquedasItems: string[] = []
let urlsConStock: string[] = []
let filasLista: Record<string, unknown>[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve({ data: [], meta: {} })
    if (url.includes('/ubicaciones')) return Promise.resolve(ubicacionesBackend)
    if (url.includes('/recuentos/productos-con-stock')) {
      urlsConStock.push(url)
      return Promise.resolve({ itemIds: ['item-a', 'item-b'], enOtroRecuento: 1, truncado: false })
    }
    if (opts?.method !== 'POST' && /\/recuentos(\?|$)/.test(url)) {
      return Promise.resolve({ data: filasLista, meta: { page: 1, pageSize: 15, total: filasLista.length, totalPages: 1 } })
    }
    if (opts?.method === 'POST' && url.includes('/recuentos')) {
      recuentosEnviados.push({ ...(opts.body ?? {}) })
      return Promise.resolve({ id: 'recuento-1' })
    }
    // `GET /items?ids=` (resolver los elegidos) y `GET /items?...` (la búsqueda del selector).
    if (url.includes('/items?ids=')) {
      return Promise.resolve({ data: [HARINA], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
    }
    if (url.includes('/items?')) {
      busquedasItems.push(url)
      return Promise.resolve({ data: [HARINA], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
    }
    return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
  }
})

mockNuxtImport('navigateTo', () => vi.fn())

async function montar() {
  const wrapper = await mountSuspended(RecuentosIndex, {
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
  await new Promise(r => setTimeout(r, 150))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

/** El filtro de estado también es un `USelectMenu`, sin superposición de
 * valores con la ubicación o el producto: no hace falta excluir "todos". */
function selectConOpcion(wrapper: Wrapper, valor: string) {
  const select = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    return Array.isArray(items) && items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}"`).toBeTruthy()
  return select!
}

async function emitir(comp: ReturnType<typeof selectConOpcion>, valor: string | string[]) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

/** El selector de productos es el `AppItemSelect`; su `USelectMenu` no trae opciones hasta abrirse. */
function selectorProductos(wrapper: Wrapper) {
  const menu = wrapper.findComponent({ name: 'AppItemSelect' }).findComponent({ name: 'USelectMenu' })
  expect(menu.exists(), 'selector de productos').toBe(true)
  return menu
}

async function abrirCrear(wrapper: Wrapper) {
  const boton = wrapper.findAll('button').find(b => b.text().includes('Nuevo recuento'))
  expect(boton, 'botón "Nuevo recuento"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

async function crear(wrapper: Wrapper) {
  const boton = wrapper.findAllComponents({ name: 'UButton' })
    .find(b => b.text().trim() === 'Crear' && b.props('type') === 'submit')
  expect(boton, 'botón submit del drawer').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 100))
}

describe('inventario/recuentos — formulario incompleto (05.9)', () => {
  beforeEach(() => {
    recuentosEnviados = []
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('marca la ubicación y los productos que faltan, y no envía', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirCrear(wrapper)
    await crear(wrapper)

    expect(recuentosEnviados).toHaveLength(0)
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text()))
      .toEqual(['Elige la ubicación', 'Elige al menos un producto'])
    wrapper.unmount()
  })
})

describe('inventario/recuentos — selector de ubicación al crear', () => {
  beforeEach(() => {
    recuentosEnviados = []
    busquedasItems = []
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('con una sola ubicación, el selector NO se dibuja y el body manda el local igual', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirCrear(wrapper)

    const conUbicacion = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
      const items = (s.props('items') ?? []) as { value: string }[]
      return Array.isArray(items) && items.some(i => i?.value === LOCAL.id)
    })
    expect(conUbicacion).toBeUndefined()

    await emitir(selectorProductos(wrapper), [HARINA.id])
    await crear(wrapper)

    expect(recuentosEnviados).toHaveLength(1)
    expect(recuentosEnviados[0]).toMatchObject({ ubicacionId: LOCAL.id, itemIds: [HARINA.id] })
    wrapper.unmount()
  })

  it('con una bodega, el selector se dibuja y lo elegido viaja en el body', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirCrear(wrapper)

    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectorProductos(wrapper), [HARINA.id])
    await crear(wrapper)

    expect(recuentosEnviados).toHaveLength(1)
    expect(recuentosEnviados[0]).toMatchObject({ ubicacionId: BODEGA.id })
    wrapper.unmount()
  })

  it('el selector de productos pide al servidor solo los de modo cantidad', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirCrear(wrapper)

    selectorProductos(wrapper).vm.$emit('update:open', true)
    await new Promise(r => setTimeout(r, 20))

    expect(busquedasItems).toHaveLength(1)
    const params = new URL(busquedasItems[0]!, 'http://x').searchParams
    expect(params.get('modoInventario')).toBe('cantidad')
    expect(params.get('tipo')).toBe('producto,ingrediente')
    wrapper.unmount()
  })
})

// Auditoría UX 05.5: para contar toda la bodega había que marcar producto por producto.
describe('inventario/recuentos — "Todos los productos con stock en esta ubicación" (05.5)', () => {
  beforeEach(() => {
    recuentosEnviados = []
    urlsConStock = []
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  const marcar = async (w: Wrapper) => {
    const casilla = w.find('[data-qa="recuento-todos"] [role="checkbox"]')
    expect(casilla.exists(), 'casilla "Todos los productos"').toBe(true)
    await casilla.trigger('click')
    await new Promise(r => setTimeout(r, 40))
  }

  it('al marcarla pide los de ESA ubicación, dice cuántos se cuentan y cuántos quedan afuera, y oculta el selector', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirCrear(wrapper)
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await marcar(wrapper)

    expect(urlsConStock).toHaveLength(1)
    expect(urlsConStock[0]).toContain(`ubicacionId=${BODEGA.id}`)
    const aviso = wrapper.find('[data-qa="recuento-todos-cuenta"]').text()
    expect(aviso).toContain('2 productos')
    expect(aviso).toContain('1 ya está en otro recuento')
    expect(wrapper.findComponent({ name: 'AppItemSelect' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('crear manda esos productos, sin pedirle al usuario que los marque', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirCrear(wrapper)
    await marcar(wrapper)
    await crear(wrapper)

    expect(recuentosEnviados).toHaveLength(1)
    expect(recuentosEnviados[0]).toMatchObject({ ubicacionId: LOCAL.id, itemIds: ['item-a', 'item-b'] })
    wrapper.unmount()
  })

  it('sin ubicación elegida no se puede marcar: no sabría de dónde', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirCrear(wrapper)
    expect(wrapper.find('[data-qa="recuento-todos"] [role="checkbox"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

// Auditoría UX 05.4: "Diferencia neta" sumaba productos de unidades distintas y no significa nada.
describe('inventario/recuentos — la lista dice cuántas líneas difieren (05.4)', () => {
  beforeEach(() => {
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('muestra "Con diferencia" y no la suma neta', async () => {
    ubicacionesBackend = [LOCAL]
    filasLista = [{ id: 'r1', estado: 'borrador', comentario: null, creadoEl: '2026-10-16T10:00:00Z', aplicadoEl: null, cantidadLineas: 5, lineasConDiferencia: 2, diferenciaNeta: '0.0000', usuarioCreadorNombre: 'Ana' }]
    const wrapper = await montar()
    const encabezados = wrapper.findAll('th').map(t => t.text())
    expect(encabezados).toContain('Con diferencia')
    expect(encabezados).not.toContain('Diferencia neta')
    expect(wrapper.find('tbody').text()).toContain('2')
    expect(wrapper.find('tbody').text()).not.toContain('0.0000')
    filasLista = []
    wrapper.unmount()
  })
})
