// @vitest-environment nuxt
//
// Frente de bodegas y traslados: el detalle de la sesión muestra la ubicación
// en el encabezado, no editable, solo si hayBodegas (con una sola
// ubicación, decirla siempre dice lo mismo — `docs/features/bodegas-y-traslados.md`,
// «Frontend»).
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import RecuentoDetalle from './[id].vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }

const LINEA = {
  lineaId: 'l1', itemId: 'i1', itemNombre: 'Harina', itemEliminado: false, unidadMedida: 'kg',
  stockSistema: '10', cantidadContada: '8', diferencia: '-2', motivoDiferenciaId: null,
}

const DETALLE_EN_BODEGA = {
  id: 'recuento-1',
  ubicacionId: BODEGA.id,
  ubicacionNombre: BODEGA.nombre,
  estado: 'borrador',
  motivoDiferenciaDefaultId: null,
  comentario: null,
  creadoEl: '2026-09-06T10:00:00.000Z',
  aplicadoEl: null,
  lineas: [],
}

let lineasBackend: typeof LINEA[] = []
let ubicacionesBackend: typeof LOCAL[] = [LOCAL]

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ params: { id: DETALLE_EN_BODEGA.id } })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (url.includes('/ubicaciones')) return Promise.resolve(ubicacionesBackend)
    if (url.includes(`/recuentos/${DETALLE_EN_BODEGA.id}`)) return Promise.resolve({ ...DETALLE_EN_BODEGA, lineas: lineasBackend })
    if (url.includes('/motivos-diferencia-inventario')) return Promise.resolve([])
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(RecuentoDetalle)
  await new Promise(r => setTimeout(r, 150))
  return wrapper
}

describe('inventario/recuentos/[id] — la ubicación en el encabezado', () => {
  it('con una bodega en el tenant, muestra el nombre de la ubicación de la sesión', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()

    expect(wrapper.text()).toContain(BODEGA.nombre)
    wrapper.unmount()
  })

  it('con una sola ubicación en el tenant, no la muestra (siempre diría lo mismo)', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()

    // La sesión en sí sigue siendo de la bodega (dato del backend, no
    // editable) — lo que cambia es que la pantalla no lo repite en el
    // encabezado cuando el tenant no tiene más de una ubicación.
    expect(wrapper.text()).not.toContain(BODEGA.nombre)
    wrapper.unmount()
  })
})

// Lote 4 (05.13): a 768 el selector de causa se cortaba ("Usar la causa por de…"): tabla de 772 en 672.
describe('inventario/recuentos/[id] — forma de la tabla en tablet', () => {
  it('el selector de causa mide 192 px (w-48), no 224', async () => {
    ubicacionesBackend = [LOCAL]
    lineasBackend = [LINEA]
    const wrapper = await montar()
    const celda = wrapper.findAll('tbody td').at(-1)!
    expect(celda.find('.w-48').exists()).toBe(true)
    expect(celda.find('.w-56').exists()).toBe(false)
    wrapper.unmount()
    lineasBackend = []
  })
})
