// @vitest-environment nuxt
//
// Anular un pago a proveedor (spec compras-deuda-proveedor § 5.2 y § 10). Lo
// que fija: exige motivo, el body que viaja, y el aviso de caja cerrada
// siempre visible (la pantalla no puede saber si la caja de ese día sigue
// abierta sin pedir un permiso que quien paga puede no tener).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import AnularPagoModal from './AnularPagoModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return Promise.resolve({})
})

async function abrir() {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(AnularPagoModal, {
    props: { pagoId: 'pago-1', proveedorNombre: 'Don Pedro', monto: '80000', fecha: '2026-09-20', open: true },
  })
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

function boton(): HTMLButtonElement {
  return document.body.querySelector('[data-qa="anular-pago-si"]') as HTMLButtonElement
}

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
})

describe('AnularPagoModal', () => {
  it('sin motivo, el botón queda deshabilitado y no manda nada', async () => {
    await abrir()
    expect(boton().disabled).toBe(true)
    boton().click()
    await new Promise(r => setTimeout(r, 10))
    expect(llamadas).toHaveLength(0)
  })

  it('con motivo, manda el body a POST /compras/pagos/:id/anular', async () => {
    await abrir()
    const textarea = document.body.querySelector('textarea[data-qa="anular-pago-motivo"]') as HTMLTextAreaElement
    textarea.value = 'Registrado por error'
    textarea.dispatchEvent(new Event('input'))
    await new Promise(r => setTimeout(r, 0))

    expect(boton().disabled).toBe(false)
    boton().click()
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas).toEqual([
      { url: '/compras/pagos/pago-1/anular', method: 'POST', body: { motivo: 'Registrado por error' } },
    ])
  })

  it('el aviso de caja cerrada siempre está, sin condicionarse a nada que la pantalla no puede saber', async () => {
    await abrir()
    expect(document.body.querySelector('[data-qa="anular-pago-aviso-caja"]')).toBeTruthy()
  })

  it('el resumen muestra el monto y el proveedor', async () => {
    await abrir()
    const texto = document.body.querySelector('[data-qa="anular-pago-resumen"]')!.textContent!
    expect(texto).toContain('80.000')
    expect(texto).toContain('Don Pedro')
  })
})
