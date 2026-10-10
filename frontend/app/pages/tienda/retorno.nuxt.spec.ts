// @vitest-environment nuxt
//
// `pages/tienda/retorno.vue`: lo que ve el comprador al volver de Webpay.
//
// El caso de este spec es la orden PAGADA SIN VENTA (pendientes.md § 3, D). Hasta
// el 2026-10-10 llegaba como `pagada` y la pantalla decía "Tu compra fue
// registrada correctamente" sobre una venta que no existía. Ahora el backend
// manda `pagada_sin_venta`, y la pantalla dice que el pago llegó y la compra no
// quedó registrada. El motivo no viaja: es del admin.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import Retorno from './retorno.vue'

let respuesta: Record<string, unknown> = {}
let limpiezas = 0

mockNuxtImport('useRoute', () => {
  return () => ({ query: { ordenId: 'orden-1' } })
})

mockNuxtImport('useApiFetch', () => {
  return () => Promise.resolve(respuesta)
})

mockNuxtImport('useTiendaCarrito', () => {
  return () => ({ limpiar: () => { limpiezas++ } })
})

function orden(estado: string, ventaId: string | null) {
  return {
    estado,
    ventaId,
    tipoPago: 'VN',
    numeroCuotas: 0,
    tarjetaUltimos4: '6623',
    motivoRechazo: null,
  }
}

beforeEach(() => {
  limpiezas = 0
})

describe('tienda/retorno', () => {
  it('pagada sin venta: dice que el pago llegó y que la compra NO quedó registrada', async () => {
    respuesta = orden('pagada_sin_venta', null)
    const wrapper = await mountSuspended(Retorno)
    await flushPromises()

    const vista = wrapper.find('[data-qa="retorno-sin-venta"]')
    expect(vista.exists()).toBe(true)
    expect(vista.text()).toContain(
      'Recibimos tu pago pero no pudimos registrar la compra; el local se comunicará contigo.',
    )
    expect(wrapper.text()).not.toContain('registrada correctamente')
    expect(wrapper.text()).not.toContain('Ver detalle de la venta')
    // El cargo existe: el carrito se vacía igual que en el éxito.
    expect(limpiezas).toBe(1)
  })

  it('conciliada: sigue siendo el éxito de siempre', async () => {
    respuesta = orden('conciliada', 'venta-1')
    const wrapper = await mountSuspended(Retorno)
    await flushPromises()

    expect(wrapper.find('[data-qa="retorno-sin-venta"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Tu compra fue registrada correctamente.')
    expect(limpiezas).toBe(1)
  })
})
