// @vitest-environment nuxt
//
// "Elegir local" (auditoría UX 08.13). Los avatares no usan colores de alerta
// (el local "Ln" salía rojo y se leía como un error), y una lista vacía no deja
// la pantalla en blanco: manda a "sin empresa".
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { useTenantStore } from '~/stores/tenant'
import SelectTenant from './select-tenant.vue'

const { navigateTo, tenants } = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  tenants: { lista: [] as { tenantId: string, nombre: string }[] },
}))

mockNuxtImport('navigateTo', () => navigateTo)
mockNuxtImport('useApiFetch', () => () => Promise.resolve(tenants.lista))

describe('select-tenant', () => {
  beforeEach(() => {
    navigateTo.mockClear()
    useTenantStore().tenants = []
  })

  it('los avatares van en petróleo y menta, nunca en rojo, amarillo ni verde de estado', async () => {
    tenants.lista = ['Ln', 'Ana', 'Bar Sur', 'Café', 'Zeta', 'Éxito', 'Quilpué', 'Wok'].map((nombre, i) => ({ tenantId: `t${i}`, nombre }))
    const wrapper = await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(wrapper.findAll('button.group').length).toBe(8))
    const avatares = wrapper.findAll('button.group span.rounded-full')
    expect(avatares.length).toBeGreaterThanOrEqual(8)
    for (const a of avatares) {
      const html = a.html()
      expect(html).not.toMatch(/\b(?:bg|text)-(?:error|warning|success|info|secondary)/)
    }
  })

  it('con la lista vacía pasa a la pantalla "sin empresa"', async () => {
    tenants.lista = []
    await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/no-tenant'))
  })

  it('con locales no redirige', async () => {
    tenants.lista = [{ tenantId: 't1', nombre: 'Local Uno' }]
    const wrapper = await mountSuspended(SelectTenant)
    await vi.waitFor(() => expect(wrapper.findAll('button.group').length).toBe(1))
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
