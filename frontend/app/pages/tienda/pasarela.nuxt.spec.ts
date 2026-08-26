// @vitest-environment nuxt
//
// Primer spec de `pages/tienda/pasarela.vue`, la pantalla de la pasarela demo.
// Cubre UNA cosa: con qué método de pago registra la venta.
//
// Hasta el 2026-08-26 lo elegía sola —`GET /metodos-pago`, buscar "crédito" en
// el nombre y, si no aparecía, agarrar `metodos[0]`— sin mirar siquiera si ese
// método estaba habilitado. Ahora lo resuelve el backend y viaja en la
// respuesta de `POST /online/pagar`, igual que en la rama Webpay.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Pasarela from './pasarela.vue'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'

const REF = 'ref-e2e'
const METODO_DEL_BACKEND = 'mp-backend'

interface PostVenta { url: string, body: Record<string, unknown> }
let urlsPedidas: string[] = []
let ventas: PostVenta[] = []

mockNuxtImport('useRoute', () => {
  return () => ({ query: { ref: REF } })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    urlsPedidas.push(url)
    if (url.includes('/ventas') && opts?.method === 'POST') {
      ventas.push({ url, body: opts.body ?? {} })
      return Promise.resolve({ id: 'venta-1', estado: 'pagada' })
    }
    return Promise.resolve([])
  }
})

function resultado(totalFinal: string): ResultadoVenta {
  return {
    lineas: [],
    advertencias: [],
    totales: {
      subtotalNeto: totalFinal,
      totalDescuentos: '0',
      totalRecargos: '0',
      totalImpuestos: '0',
      totalFinal,
    },
    trazasVenta: { descuentos: [], recargos: [] },
  } as unknown as ResultadoVenta
}

let montado: { unmount: () => void } | null = null

afterEach(() => {
  montado?.unmount()
  montado = null
})

beforeEach(() => {
  urlsPedidas = []
  ventas = []
})

async function montarCon(totalFinal: string, metodoPagoId: string | null) {
  const { lineas, checkout } = useTiendaCarrito()
  lineas.value = [
    { item: { id: 'item-1', nombre: 'Producto', precioBase: totalFinal }, cantidad: '1' },
  ] as unknown as typeof lineas.value
  checkout.value = {
    resultado: resultado(totalFinal),
    checkoutRef: REF,
    checkoutUrl: `/tienda/pasarela?ref=${REF}`,
    metodoPagoId,
  }
  const wrapper = await mountSuspended(Pasarela)
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('tienda/pasarela — el método de pago lo manda el backend', () => {
  it('registra la venta con el método que vino en el checkout', async () => {
    const wrapper = await montarCon('45000', METODO_DEL_BACKEND)

    await (wrapper.vm as unknown as { aprobar: () => Promise<void> }).aprobar()

    expect(ventas).toHaveLength(1)
    expect(ventas[0]!.body.pagos).toEqual([
      { metodoPagoId: METODO_DEL_BACKEND, monto: '45000' },
    ])
  })

  /**
   * La pantalla ya no tiene de dónde adivinar: si vuelve a pedir el catálogo de
   * métodos, es que alguien reintrodujo la elección del lado del cliente.
   */
  it('no pide el catálogo de métodos de pago', async () => {
    await montarCon('45000', METODO_DEL_BACKEND)

    expect(urlsPedidas.filter(u => u.includes('/metodos-pago'))).toEqual([])
  })

  /**
   * Un carrito de $0 es una venta pagada SIN línea de pago: el backend manda
   * `metodoPagoId: null` justamente porque ahí no hay nada que registrar.
   *
   * 📌 La venta sin `pagos` ya salía así antes del cambio —el camino de $0 no
   * consultaba el método—, así que esa mitad del test fija el statu quo y no
   * discrimina. La que discrimina es la segunda: la pantalla vieja pedía
   * `/metodos-pago` en `onMounted`, o sea también para un carrito que no cobra.
   */
  it('carrito de $0: la venta va sin pagos y sin consultar métodos', async () => {
    const wrapper = await montarCon('0', null)

    await (wrapper.vm as unknown as { aprobar: () => Promise<void> }).aprobar()

    expect(ventas).toHaveLength(1)
    expect(ventas[0]!.body.pagos).toBeUndefined()
    expect(urlsPedidas.filter(u => u.includes('/metodos-pago'))).toEqual([])
  })
})
