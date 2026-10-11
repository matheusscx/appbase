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

  // El admin devolvió el cargo mientras se creaba la venta: la orden vuelve
  // `reembolsada` (con la venta ligada) al retorno mismo. Caía en "Pago
  // rechazado" con el carrito lleno para reintentar (pendientes.md § 2).
  it('reembolsada: dice que el pago se devolvió, no que se rechazó, y vacía el carrito', async () => {
    respuesta = orden('reembolsada', 'venta-1')
    const wrapper = await mountSuspended(Retorno)
    await flushPromises()

    const vista = wrapper.find('[data-qa="retorno-devuelto"]')
    expect(vista.exists()).toBe(true)
    expect(vista.text()).toContain('Pago devuelto')
    expect(vista.text()).toContain(
      'Se te cobró esta compra y el local te devolvió el pago. Si tienes dudas, comunícate con el local.',
    )
    expect(wrapper.text()).not.toContain('Pago rechazado')
    expect(wrapper.text()).not.toContain('Ver detalle de la venta')
    // Mismo criterio que la pagada sin venta: el carrito lleno invita a pagar
    // de nuevo lo que el local decidió devolver.
    expect(limpiezas).toBe(1)
  })

  // La orden que el retorno todavía no resolvió (la anulación entró mientras
  // confirmaba, o el comprador volvió antes de tiempo) caía en "Pago rechazado…
  // Tu carrito sigue disponible para reintentar", y el cargo pudo haber salido
  // (pendientes.md § 2). Va a la vista de pago en confirmación, como `pendiente`.
  it.each(['procesando', 'en_proceso'])('%s: dice que el pago está en confirmación, no que se rechazó', async (estado) => {
    respuesta = orden(estado, null)
    const wrapper = await mountSuspended(Retorno)
    await flushPromises()

    const vista = wrapper.find('[data-qa="retorno-pendiente"]')
    expect(vista.exists()).toBe(true)
    expect(vista.text()).toContain('Tu pago está en proceso de confirmación. Te avisaremos cuando se acredite.')
    expect(wrapper.text()).not.toContain('Pago rechazado')
    expect(wrapper.text()).not.toContain('Tu carrito sigue disponible para reintentar')
    // Lo mismo que hace hoy `pendiente` con el carrito: no lo toca.
    expect(limpiezas).toBe(0)
  })

  it('un estado que este front no conoce no dice "rechazado": dice que no se pudo verificar', async () => {
    respuesta = orden('estado_nuevo_del_backend', null)
    const wrapper = await mountSuspended(Retorno)
    await flushPromises()

    expect(wrapper.text()).toContain('No pudimos verificar el pago')
    expect(wrapper.text()).not.toContain('Pago rechazado')
    expect(limpiezas).toBe(0)
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
