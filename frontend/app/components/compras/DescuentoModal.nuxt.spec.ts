// @vitest-environment nuxt
//
// El modal del descuento al total (spec compras § 4.4). Lo que fija: la clave
// `descuentoTotal` viaja siempre —el backend la exige, y null lo quita— y un
// descuento igual al vigente no se manda.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import DescuentoModal from './DescuentoModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return Promise.resolve({ id: 'compra-1' })
})

async function abrir(descuentoActual: string | null) {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(DescuentoModal, {
    props: { compraId: 'compra-1', descuentoActual, open: true },
  })
  // Montado ya abierto el `watch(open)` no corre: se cierra y se abre, como
  // pasa en la pantalla cada vez que se toca el botón.
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof abrir>>

async function tipear(wrapper: Wrapper, valor: string) {
  wrapper.findComponent({ name: 'MoneyInput' }).vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 0))
}

function boton(): HTMLButtonElement {
  return document.body.querySelector('[data-qa="descuento-enviar"]') as HTMLButtonElement
}

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
})

describe('DescuentoModal', () => {
  it('carga un descuento nuevo', async () => {
    const wrapper = await abrir(null)
    await tipear(wrapper, '2000')
    boton().click()
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas).toEqual([
      { url: '/compras/compra-1/descuento', method: 'PATCH', body: { descuentoTotal: '2000' } },
    ])
  })

  it('vaciarlo lo quita: la clave viaja en null', async () => {
    const wrapper = await abrir('2000.0000')
    await tipear(wrapper, '')
    boton().click()
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas[0]!.body).toEqual({ descuentoTotal: null })
  })

  it('igual al vigente no se manda', async () => {
    const wrapper = await abrir('2000.0000')
    await tipear(wrapper, '2000')
    expect(boton().disabled).toBe(true)
  })
})
