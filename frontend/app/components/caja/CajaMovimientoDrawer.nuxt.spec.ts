// @vitest-environment nuxt
//
// Auditoría UX 03.25: el selector Entrada/Salida eran dos botones sueltos; el
// elegido solo se distinguía por el relleno y el lector de pantalla no lo anunciaba.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CajaMovimientoDrawer from './CajaMovimientoDrawer.vue'

const AppDrawer = {
  name: 'AppDrawer',
  props: ['open'],
  template: '<div v-if="open"><slot name="body" /></div>',
}

async function montar() {
  return mountSuspended(CajaMovimientoDrawer, {
    props: { cajaId: 'c1', open: true },
    global: { stubs: { AppDrawer } },
  })
}

describe('CajaMovimientoDrawer — Entrada y Salida', () => {
  it('anuncia cuál está elegido', async () => {
    const w = await montar()
    const entrada = w.findAll('button').find(b => b.text() === 'Entrada')!
    const salida = w.findAll('button').find(b => b.text() === 'Salida')!
    expect(entrada.attributes('aria-pressed')).toBe('true')
    expect(salida.attributes('aria-pressed')).toBe('false')

    await salida.trigger('click')
    expect(entrada.attributes('aria-pressed')).toBe('false')
    expect(salida.attributes('aria-pressed')).toBe('true')
  })
})
