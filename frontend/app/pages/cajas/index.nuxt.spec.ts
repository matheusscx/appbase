// @vitest-environment nuxt
//
// Auditoría UX 03.17: "Pendientes de revisar" no decía cuántos hay; el encargado entraba a la bandeja
// solo para enterarse de que estaba vacía.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajasIndex from './index.vue'

const cargarPendientesRevision = vi.fn<() => Promise<unknown[]>>()
mockNuxtImport('useCajaStore', () => () => ({ cargarPendientesRevision }))

async function montar() {
  const w = await mountSuspended(CajasIndex, { global: { stubs: { CajaCajonesGrid: true } } })
  await new Promise(r => setTimeout(r, 20))
  return w
}

beforeEach(() => {
  cargarPendientesRevision.mockReset()
})

describe('/cajas — el botón de pendientes dice cuántos hay', () => {
  it('con cierres pendientes, el botón lleva la cantidad', async () => {
    cargarPendientesRevision.mockResolvedValue([{}, {}, {}])
    const w = await montar()
    expect(w.find('[data-qa="pendientes-cantidad"]').text()).toBe('3')
  })

  it('sin pendientes no muestra número', async () => {
    cargarPendientesRevision.mockResolvedValue([])
    const w = await montar()
    expect(w.find('[data-qa="pendientes-cantidad"]').exists()).toBe(false)
    expect(w.text()).toContain('Pendientes de revisar')
  })

  it('si no pudo contar, no afirma cero: no muestra número', async () => {
    cargarPendientesRevision.mockRejectedValue(new Error('500'))
    const w = await montar()
    expect(w.find('[data-qa="pendientes-cantidad"]').exists()).toBe(false)
    expect(w.text()).toContain('Pendientes de revisar')
  })
})
