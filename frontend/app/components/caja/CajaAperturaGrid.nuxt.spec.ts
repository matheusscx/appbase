// @vitest-environment nuxt
//
// Auditoría UX 03.11: la cajera no podía abrir su caja con teclado externo.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaAperturaGrid from './CajaAperturaGrid.vue'

// Sin moneda oficial resuelta, `MoneyInput` no tiene máscara y `formatMonto` da
// "—": el monto en pantalla no se podría leer. Se simula la de Paris (CLP).
const CLP = {
  monedaId: 'clp-1', codigoIso: 'CLP', nombre: 'Peso', locale: 'es-CL', prefix: '$',
  thousands: '.', decimal: ',', decimals: 0, habilitada: true, esOficial: true,
  valorDelDia: null,
}
mockNuxtImport('useMonedasStore', () => () => ({
  monedaOficial: CLP,
  getById: () => CLP,
}))

mockNuxtImport('useCajaStore', () => () => ({
  cajonesDisponibles: [
    { cajonId: 'c1', nombre: 'Caja 1', fondoSugerido: null },
    { cajonId: 'c2', nombre: 'Barra', fondoSugerido: '45000.0000' },
  ],
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

// 03.28: cada caja guarda un fondo sugerido que aparece precargado al abrirla.
describe('CajaAperturaGrid — fondo sugerido', () => {
  async function abrir(nombre: string) {
    const w = await mountSuspended(CajaAperturaGrid, {
      global: {
        stubs: {
          AppDrawer: { name: 'AppDrawer', props: ['open'], template: '<div v-if="open"><slot name="body" /></div>' },
        },
      },
    })
    await new Promise(r => setTimeout(r, 0))
    const tarjeta = w.findAll('[role="button"]').find(t => t.text().includes(nombre))!
    await tarjeta.trigger('click')
    await new Promise(r => setTimeout(r, 80))
    return w
  }

  it('la caja con fondo sugerido abre con el saldo precargado, y se puede editar', async () => {
    const w = await abrir('Barra')
    expect(w.findComponent({ name: 'MoneyInput' }).props('modelValue')).toBe('45000')
    expect((w.find('#caja-apertura-grid-form input').element as HTMLInputElement).value).toContain('45.000')
    w.findComponent({ name: 'MoneyInput' }).vm.$emit('update:modelValue', '50000')
    await new Promise(r => setTimeout(r, 0))
    expect(w.findComponent({ name: 'MoneyInput' }).props('modelValue')).toBe('50000')
  })

  it('la caja sin fondo sugerido abre con el saldo vacío, como siempre', async () => {
    const w = await abrir('Caja 1')
    expect(w.findComponent({ name: 'MoneyInput' }).props('modelValue')).toBe('')
  })
})
