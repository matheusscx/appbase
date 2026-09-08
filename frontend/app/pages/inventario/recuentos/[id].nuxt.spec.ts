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
    if (url.includes(`/recuentos/${DETALLE_EN_BODEGA.id}`)) return Promise.resolve(DETALLE_EN_BODEGA)
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
