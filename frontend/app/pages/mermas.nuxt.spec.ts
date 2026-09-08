// @vitest-environment nuxt
//
// Frente de bodegas y traslados: la merma pasa a decir DÓNDE ocurrió. Lo que
// este spec fija:
//   1. Con una sola ubicación (solo local) el selector no se dibuja, y el
//      cliente completa `ubicacionId` con el local igual.
//   2. Con una bodega, el selector se dibuja y lo que el usuario elige viaja
//      en el body de `POST /mermas`.
//   3. Cambiar de ubicación con la cantidad ya tipeada la limpia — mismo
//      criterio que el ajuste de costo con la unidad/el producto.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Mermas from './mermas.vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }

const HARINA = {
  id: 'item-harina',
  nombre: 'Harina',
  costoActual: '1500.0000',
  unidadMedida: 'kg',
  modoInventario: 'cantidad',
}
const CAUSA = { id: 'causa-1', nombre: 'Vencimiento' }

/** Ubicaciones que devuelve `GET /ubicaciones` en cada test. */
let ubicacionesBackend: typeof LOCAL[] = [LOCAL]
let mermasEnviadas: Record<string, unknown>[] = []

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
    if (opts?.method === 'POST' && url.includes('/mermas')) {
      mermasEnviadas.push({ ...(opts.body ?? {}) })
      return Promise.resolve({
        costoPerdido: '100.0000',
        causaNombre: CAUSA.nombre,
        merma: { id: 'mov-1', itemId: HARINA.id, cantidad: '1', costoUnitario: '100', costoPerdido: '100.0000', causaMermaId: CAUSA.id, causaNombre: CAUSA.nombre, comentario: null, creadoEl: new Date().toISOString(), usuarioNombre: null, unidadMedida: 'kg', monedaId: 'clp-1', itemEliminado: false },
      })
    }
    if (url.includes('/items?tipo=producto')) {
      return Promise.resolve({ data: [HARINA], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
    }
    if (url.includes('/items?tipo=ingrediente')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } })
    }
    if (url.includes('/causas-merma')) return Promise.resolve([CAUSA])
    // `useUnidadesMedidaStore.ensureLoaded()` espera un ARRAY, no el shape
    // paginado del catch-all de abajo — sin esto `unidades.value.find` revienta.
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve([])
    return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
  }
})

async function montar() {
  const wrapper = await mountSuspended(Mermas, {
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

/**
 * La página tiene DOS selects con las mismas opciones: el filtro del listado
 * (que suma "todos") y el del formulario del drawer. Sin `sinValor: 'todos'`
 * el `.find()` se queda con el PRIMERO —el filtro— y el test termina
 * emitiendo sobre el select equivocado: `form.itemId` nunca se completa, el
 * guard de `registrar()` corta en silencio (el toast no se ve: no hay
 * `<UNotifications>` montado en este test aislado) y no sale ningún POST.
 */
function selectConOpcion(wrapper: Wrapper, valor: string, sinValor?: string) {
  const select = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    if (!Array.isArray(items)) return false
    if (sinValor && items.some(i => i?.value === sinValor)) return false
    return items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}" (sin "${sinValor}")`).toBeTruthy()
  return select!
}

const selectProducto = (w: Wrapper) => selectConOpcion(w, HARINA.id, 'todos')
const selectCausa = (w: Wrapper) => selectConOpcion(w, CAUSA.id, 'todos')

async function emitir(comp: ReturnType<typeof selectConOpcion>, valor: string) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

async function abrirDrawer(wrapper: Wrapper) {
  const boton = wrapper.findAll('button').find(b => b.text().includes('Registrar merma'))
  expect(boton, 'botón "Registrar merma"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

async function enviar(wrapper: Wrapper) {
  const boton = wrapper.findAllComponents({ name: 'UButton' })
    .find(b => b.text().trim() === 'Registrar' && b.props('type') === 'submit')
  expect(boton, 'botón submit del drawer').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 250))
}

describe('mermas — selector de ubicación', () => {
  beforeEach(() => {
    mermasEnviadas = []
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('con una sola ubicación, el selector NO se dibuja y el body manda el local igual', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    // Sin bodegas, ningún USelectMenu ofrece la opción del local como
    // "ubicación a elegir" — el único lugar donde live el id del local es en
    // el body, completado por el cliente.
    const conUbicacion = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
      const items = (s.props('items') ?? []) as { value: string }[]
      return Array.isArray(items) && items.some(i => i?.value === LOCAL.id)
    })
    expect(conUbicacion).toBeUndefined()

    await emitir(selectProducto(wrapper), HARINA.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('2')
    await emitir(selectCausa(wrapper), CAUSA.id)
    await enviar(wrapper)

    expect(mermasEnviadas).toHaveLength(1)
    expect(mermasEnviadas[0]).toMatchObject({ ubicacionId: LOCAL.id, itemId: HARINA.id })
    wrapper.unmount()
  })

  it('con una bodega, el selector se dibuja y lo elegido viaja en el body', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectProducto(wrapper), HARINA.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('3')
    await emitir(selectCausa(wrapper), CAUSA.id)
    await enviar(wrapper)

    expect(mermasEnviadas).toHaveLength(1)
    expect(mermasEnviadas[0]).toMatchObject({ ubicacionId: BODEGA.id })
    wrapper.unmount()
  })

  it('cambiar de ubicación con la cantidad ya tipeada la limpia', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    await emitir(selectConOpcion(wrapper, LOCAL.id), LOCAL.id)
    const cantidadInput = wrapper.find('input[inputmode="decimal"]')
    await cantidadInput.setValue('7')
    expect((wrapper.find('input[inputmode="decimal"]').element as HTMLInputElement).value).toBe('7')

    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)

    // Si sobreviviera, sería una cantidad tipeada mirando el stock del local
    // aplicada como si fuera de la bodega — un número que nadie tecleó ahí.
    expect((wrapper.find('input[inputmode="decimal"]').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})
