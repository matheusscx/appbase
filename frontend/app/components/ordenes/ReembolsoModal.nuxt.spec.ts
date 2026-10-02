// @vitest-environment nuxt
//
// Todo reembolso aprobado de una orden con venta deja su corrección en el
// backend (spec `2026-10-01-emision-por-venta`, § 3.6): ya no hay casilla que la
// pida. Y el DTO del backend rechaza con 400 lo que no declara, así que si la
// pantalla siguiera mandando `generarNotaCredito`, el reembolso entero fallaría.
// Es lógica de TEMPLATE + `confirmar()`: ni el build ni el typecheck la ven.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ReembolsoModal from './ReembolsoModal.vue'

let llamadas: { url: string, opts?: { method?: string, body?: Record<string, unknown> } }[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    llamadas.push({ url, opts })
    if (opts?.method === 'POST') {
      return Promise.resolve({ ordenId: 'orden-1', estado: 'reembolsada', notaCreditoId: 'nc-1' })
    }
    return Promise.resolve({ detalles: [] })
  }
})

async function abrir(ventaId: string | null) {
  const wrapper = await mountSuspended(ReembolsoModal, {
    props: { open: false, ordenId: 'orden-1', disponible: '100000', ventaId },
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

const botonConfirmar = () =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('Confirmar reembolso'))

describe('ReembolsoModal — el reembolso siempre deja su corrección', () => {
  beforeEach(() => {
    llamadas = []
    document.body.innerHTML = ''
  })

  it('no ofrece la casilla "Generar nota de crédito": no hay nada que elegir', async () => {
    await abrir('venta-1')

    expect(document.body.textContent).not.toContain('Generar nota de crédito')
    expect(document.body.querySelector('[role="checkbox"]')).toBeNull()
  })

  it('confirmar manda solo el monto: ni `generarNotaCredito` ni devoluciones sin ítems marcados', async () => {
    await abrir('venta-1')

    botonConfirmar()!.click()
    await flushPromises()

    const post = llamadas.find(l => l.opts?.method === 'POST')!
    expect(post.url).toContain('/pasarela/admin/ordenes/orden-1/reembolsos')
    expect(post.opts!.body).toEqual({ monto: '100000' })
    expect(post.opts!.body).not.toHaveProperty('generarNotaCredito')
  })

  it('una orden sin venta tampoco manda el campo', async () => {
    await abrir(null)

    botonConfirmar()!.click()
    await flushPromises()

    const post = llamadas.find(l => l.opts?.method === 'POST')!
    expect(post.opts!.body).toEqual({ monto: '100000' })
  })
})
