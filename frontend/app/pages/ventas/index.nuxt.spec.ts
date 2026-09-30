// @vitest-environment nuxt
//
// Único spec de esta pantalla. Fija una sola cosa: al montar, `/ventas` pide
// `GET /caja/activa` — la revisión independiente del frente de impresión
// encontró que esta pantalla nunca la cargaba (solo lo hacían `pos.vue`,
// `salones/index.vue` y `mi-caja`), así que `VentaDetalleDrawer.puedeReimprimir`
// —el camino sin `Ventas:Anular`, que mira `cajaStore.activa`— nunca veía la
// caja propia para una cajera que entra directo a `/ventas` sin pasar antes
// por el POS o salones: el botón "Reimprimir boleta" no aparecía aunque el
// backend ya se lo permitiera. Mismo molde que `salones/index.vue` (~1128):
// `cajaStore.cargarActiva()` con `.catch()` propio, porque `GET /caja/activa`
// pide `MiCaja:Leer` y este listado solo exige `Ventas:Leer` — sin el catch,
// un rol sin ese permiso (o sin caja abierta) rompería la carga.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import VentasIndex from './index.vue'

const llamadas: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    llamadas.push(url)
    if (url.includes('/ventas/resumen')) {
      return Promise.resolve({ totalVentas: 0, totalFacturado: '0.0000', saldoPendiente: '0.0000' })
    }
    if (url.includes('/caja/activa')) {
      // 403 real de `MiCaja:Leer`: es el caso que el `.catch` de la pantalla
      // tiene que absorber sin romper el resto del montaje.
      return Promise.reject({ data: { message: 'No tienes permiso para esta acción' } })
    }
    if (url.includes('/ventas')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
    }
    return Promise.resolve([])
  }
})

/**
 * `AppDrawer` stubeado por el mismo motivo que `inventario/index.nuxt.spec.ts`
 * y `configuracion/garzones.nuxt.spec.ts`: su root es `UDrawer` (reka-ui) y
 * bajo happy-dom la transición de `usePresence` puede tirar un unhandled
 * rejection que saca a `vitest run` con exit 1. Este spec nunca abre el
 * drawer, pero el stub va igual — barato y evita depender de ese detalle.
 */
async function montar() {
  const wrapper = await mountSuspended(VentasIndex, {
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

beforeEach(() => {
  llamadas.length = 0
  document.body.innerHTML = ''
})

describe('ventas/index — carga la caja activa al montar', () => {
  it('pide GET /caja/activa', async () => {
    await montar()
    expect(llamadas.some(u => u.includes('/caja/activa'))).toBe(true)
  })

  it('un 403 de /caja/activa (rol sin MiCaja:Leer) no rompe el resto del montaje', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Ventas registradas')
  })
})
