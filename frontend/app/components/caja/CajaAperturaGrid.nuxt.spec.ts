// @vitest-environment nuxt
//
// Auditoría UX 03.11: la cajera no podía abrir su caja con teclado externo.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaAperturaGrid from './CajaAperturaGrid.vue'

mockNuxtImport('useCajaStore', () => () => ({
  cajonesDisponibles: [{ cajonId: 'c1', nombre: 'Caja 1' }],
  cargarCajonesDisponibles: vi.fn().mockResolvedValue(undefined),
}))

describe('CajaAperturaGrid — se opera con teclado', () => {
  it('el cajón libre es un botón con Tab y Enter abre el formulario', async () => {
    const w = await mountSuspended(CajaAperturaGrid)
    await new Promise(r => setTimeout(r, 0))
    const tarjeta = w.find('[role="button"]')
    expect(tarjeta.exists()).toBe(true)
    expect(tarjeta.attributes('tabindex')).toBe('0')

    await tarjeta.trigger('keydown', { key: 'Enter' })
    await new Promise(r => setTimeout(r, 20))
    expect(document.body.textContent).toContain('Abrir caja — Caja 1')
  })
})

// Auditoría UX 03.24: el drawer de apertura medía 40 % y cortaba el campo "Comentario" en la tablet.
describe('CajaAperturaGrid — el panel de apertura', () => {
  it('usa el ancho md de los demás drawers de caja, no un porcentaje', async () => {
    const w = await mountSuspended(CajaAperturaGrid)
    expect(w.findComponent({ name: 'AppDrawer' }).props('width')).toBe('md')
  })
})
