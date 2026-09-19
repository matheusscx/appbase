// @vitest-environment nuxt
//
// El modal de anular una compra (spec compras § 4.5). Lo que fija: frena y
// dice cuánto sale y de dónde antes de mandar nada, y sin motivo no se anula.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { LineaCompra } from '~/composables/useCompras'
import AnularCompraModal from './AnularCompraModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return Promise.resolve({ id: 'compra-1' })
})

const LINEAS: LineaCompra[] = [
  {
    id: 'l1', orden: 0, itemId: 'i1', itemNombre: 'Tomate', modoInventario: 'cantidad',
    unidadMedidaBase: 'kg', cantidad: '20.0000', unidadCodigo: 'kg', precioUnitario: '1500',
    series: null, lote: null,
  },
  {
    id: 'l2', orden: 1, itemId: 'i2', itemNombre: 'Harina', modoInventario: 'cantidad',
    unidadMedidaBase: 'kg', cantidad: '5', unidadCodigo: 'kg', precioUnitario: '900',
    series: null, lote: null,
  },
]

async function abrir() {
  await mountSuspended(AnularCompraModal, {
    props: { compraId: 'compra-1', ubicacionNombre: 'Bodega', lineas: LINEAS, open: true },
  })
  await new Promise(r => setTimeout(r, 50))
}

function boton(): HTMLButtonElement {
  return document.body.querySelector('[data-qa="anular-compra-si"]') as HTMLButtonElement
}

async function motivo(valor: string) {
  const el = document.body.querySelector('[data-qa="anular-compra-motivo"]') as HTMLTextAreaElement
  el.value = valor
  el.dispatchEvent(new Event('input'))
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
})

describe('AnularCompraModal', () => {
  it('dice qué sale y de dónde antes de anular', async () => {
    await abrir()
    const resumen = document.body.querySelector('[data-qa="anular-compra-resumen"]')!.textContent!
    expect(resumen).toContain('Bodega')
    expect(resumen).toContain('20 kg de Tomate')
    expect(resumen).toContain('5 kg de Harina')
    expect(llamadas).toHaveLength(0)
  })

  it('sin motivo no se anula; con motivo manda el motivo sin espacios de más', async () => {
    await abrir()
    expect(boton().disabled).toBe(true)
    await motivo('   ')
    expect(boton().disabled).toBe(true)

    await motivo('  Factura equivocada ')
    boton().click()
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas).toEqual([
      { url: '/compras/compra-1/anular', method: 'POST', body: { motivo: 'Factura equivocada' } },
    ])
  })
})
