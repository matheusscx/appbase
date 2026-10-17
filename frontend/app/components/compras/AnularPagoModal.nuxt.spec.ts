// @vitest-environment nuxt
//
// Anular un pago a proveedor (spec compras-deuda-proveedor § 5.2 y § 10). Lo
// que fija: exige motivo, el body que viaja, y el aviso de caja cerrada
// siempre visible (la pantalla no puede saber si la caja de ese día sigue
// abierta sin pedir un permiso que quien paga puede no tener).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import type { PagoProveedorInfo } from '~/composables/useCompras'
import AnularPagoModal from './AnularPagoModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return Promise.resolve({})
})

function pagoDe(o: Partial<PagoProveedorInfo> = {}): PagoProveedorInfo {
  return {
    id: 'pago-1', proveedorId: 'p1', fecha: '2026-09-20', monto: '80000',
    metodoPagoId: 'm1', metodoPagoNombre: 'Efectivo', referencia: null,
    cajaId: 'caja-1', cajaEstado: 'cerrada', cajaUsuarioId: 'otro',
    estado: 'vigente', anuladoPor: null, anuladoEl: null, motivoAnulacion: null,
    aplicaciones: [{ compraId: 'c1', monto: '80000' }], sobranteAFavor: '0',
    ...o,
  }
}

async function abrir(pago: PagoProveedorInfo = pagoDe()) {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(AnularPagoModal, {
    props: { pago, proveedorNombre: 'Don Pedro', usuarioId: 'yo', open: true },
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

  it('06.6: con la caja cerrada avisa que no vuelve plata a ninguna caja', async () => {
    await abrir()
    expect(document.body.querySelector('[data-qa="anular-pago-aviso-caja"]')).toBeTruthy()
    expect(document.body.querySelector('[data-qa="anular-pago-efecto-caja"]')).toBeNull()
  })

  it('06.6: con la caja abierta y propia dice que la plata vuelve a tu caja, sin el aviso de cierre', async () => {
    await abrir(pagoDe({ cajaEstado: 'abierta', cajaUsuarioId: 'yo' }))
    expect(document.body.querySelector('[data-qa="anular-pago-efecto-caja"]')!.textContent).toContain('vuelven a tu caja abierta')
    expect(document.body.querySelector('[data-qa="anular-pago-aviso-caja"]')).toBeNull()
  })

  it('06.6: con la caja abierta de otro avisa y no deja anular, ni con motivo', async () => {
    await abrir(pagoDe({ cajaEstado: 'abierta', cajaUsuarioId: 'otro' }))
    expect(document.body.querySelector('[data-qa="anular-pago-aviso-ajena"]')).toBeTruthy()
    const textarea = document.body.querySelector('textarea[data-qa="anular-pago-motivo"]') as HTMLTextAreaElement
    textarea.value = 'x'
    textarea.dispatchEvent(new Event('input'))
    await new Promise(r => setTimeout(r, 0))
    expect(boton().disabled).toBe(true)
  })

  it('06.6: una transferencia solo devuelve la deuda: no toca ninguna caja', async () => {
    await abrir(pagoDe({ cajaId: null, cajaEstado: null, cajaUsuarioId: null, metodoPagoNombre: 'Transferencia' }))
    expect(document.body.querySelector('[data-qa="anular-pago-efecto-caja"]')!.textContent).toContain('No se mueve ninguna caja')
    expect(document.body.querySelector('[data-qa="anular-pago-aviso-caja"]')).toBeNull()
  })

  it('06.6: dice cuántas compras vuelven a deber y el saldo a favor que se pierde', async () => {
    await abrir(pagoDe({ aplicaciones: [{ compraId: 'c1', monto: '50000' }, { compraId: 'c2', monto: '20000' }], sobranteAFavor: '10000' }))
    expect(document.body.querySelector('[data-qa="anular-pago-efecto-deuda"]')!.textContent).toContain('2 compras vuelven a deber $70.000')
    expect(document.body.querySelector('[data-qa="anular-pago-efecto-favor"]')!.textContent).toContain('$10.000')
  })

  it('el resumen muestra el monto y el proveedor', async () => {
    await abrir()
    const texto = document.body.querySelector('[data-qa="anular-pago-resumen"]')!.textContent!
    expect(texto).toContain('80.000')
    expect(texto).toContain('Don Pedro')
  })
})
