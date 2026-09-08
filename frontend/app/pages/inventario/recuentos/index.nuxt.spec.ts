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
    if (opts?.method === 'POST' && url.includes('/recuentos')) {
      recuentosEnviados.push({ ...(opts.body ?? {}) })
      return Promise.resolve({ id: 'recuento-1' })
    }
    if (url.includes('/items?tipo=producto')) {
      return Promise.resolve({ data: [HARINA], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
    }
    if (url.includes('/items?tipo=ingrediente')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } })
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

describe('inventario/recuentos — selector de ubicación al crear', () => {
  beforeEach(() => {
    recuentosEnviados = []
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

    await emitir(selectConOpcion(wrapper, HARINA.id), [HARINA.id])
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
    await emitir(selectConOpcion(wrapper, HARINA.id), [HARINA.id])
    await crear(wrapper)

    expect(recuentosEnviados).toHaveLength(1)
    expect(recuentosEnviados[0]).toMatchObject({ ubicacionId: BODEGA.id })
    wrapper.unmount()
  })
})
