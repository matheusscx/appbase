// @vitest-environment nuxt
//
// 01.18 / 03.13: abrir la caja o registrar un movimiento con datos que faltan
// marca cada campo junto a su error (los dos a la vez), en vez de un toast que
// avisa de una cosa por vez.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import CajaAperturaForm from './CajaAperturaForm.vue'
import CajaMovimientoDrawer from './CajaMovimientoDrawer.vue'

const cajaStoreMock = reactive({
  cajonesDisponibles: [{ cajonId: 'c1', nombre: 'Caja 1' }],
  cargarCajonesDisponibles: vi.fn(async () => {}),
  abrir: vi.fn(async () => ({ id: 'caja-1' })),
  registrarMovimiento: vi.fn(async () => ({ id: 'm1' })),
})
mockNuxtImport('useCajaStore', () => () => cajaStoreMock)

describe('CajaAperturaForm', () => {
  it('sin caja ni saldo: marca los dos campos y no abre', async () => {
    cajaStoreMock.abrir.mockClear()
    const wrapper = await mountSuspended(CajaAperturaForm)
    await new Promise(r => setTimeout(r, 20))
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(cajaStoreMock.abrir).not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text()))
      .toEqual(['Selecciona una caja', 'Ingresa el saldo inicial'])
  })
})

describe('CajaMovimientoDrawer', () => {
  const stubs = {
    AppDrawer: {
      name: 'AppDrawer',
      props: ['open'],
      template: '<div v-if="open"><slot name="body" /></div>',
    },
  }

  it('sin concepto ni monto: marca los dos campos y no registra', async () => {
    cajaStoreMock.registrarMovimiento.mockClear()
    const wrapper = await mountSuspended(CajaMovimientoDrawer, {
      props: { cajaId: 'caja-1', open: true },
      global: { stubs },
    })
    await new Promise(r => setTimeout(r, 20))
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(cajaStoreMock.registrarMovimiento).not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text()))
      .toEqual(['Ingresa el concepto del movimiento', 'Ingresa el monto'])
  })
})
