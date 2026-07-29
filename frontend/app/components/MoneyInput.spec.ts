import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import MoneyInput from './MoneyInput.vue'
import type { MonedaTenantApi } from '~/types/moneda'

// useMonedasStore() invoca useRuntimeConfig() en su setup: requiere una app Nuxt
// real (mismo problema que app/stores/monedas.spec.ts, ver mock ahí). Sin esto,
// mount plano revienta con "[nuxt] instance unavailable" apenas se instancia el
// store, antes de llegar a montar el componente.
vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

const { useMonedasStore } = await import('~/stores/monedas')

const CLP: MonedaTenantApi = {
  monedaId: 'clp-1',
  nombre: 'Peso Chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esDefault: true,
  esOficial: true,
  valorDelDia: null,
}

// decimales > 0 para ejercitar la rama de `buildMask` con fracción y separadorDecimal,
// que con CLP (decimales: 0) nunca corre.
const USD: MonedaTenantApi = {
  monedaId: 'usd-1',
  nombre: 'Dólar',
  codigoIso: 'USD',
  simbolo: 'US$',
  decimales: 2,
  separadorDecimal: '.',
  separadorMiles: ',',
  locale: 'en-US',
  habilitada: true,
  esDefault: false,
  esOficial: false,
  valorDelDia: null,
}

// UInput (Nuxt UI) no monta sin contexto Nuxt real (ver AdvertenciasPrecio.spec.ts).
// Acá además `MoneyInput` lo usa como input controlado (`:model-value`,
// `:disabled`), así que el stub necesita un `<input>` real para que
// `wrapper.find('input')` refleje lo que ve el usuario, no un `true` genérico.
const stubs = {
  UInput: {
    props: ['modelValue', 'disabled'],
    template: '<input :value="modelValue" :disabled="disabled">',
  },
}

describe('MoneyInput', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useMonedasStore().hydrate([CLP, USD], 'tenant-1')
  })

  it('muestra el monto formateado según la moneda', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '1500000', monedaId: 'clp-1' },
      global: { stubs },
    })

    expect(wrapper.find('input').element.value).toBe('$1.500.000')
  })

  // formatMontoDisplay devuelve '—' para vacío; el input NO debe mostrar eso, tiene que
  // quedar vacío para que el usuario pueda escribir.
  it('con modelValue vacío el input queda vacío, no con el em dash', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '', monedaId: 'clp-1' },
      global: { stubs },
    })

    expect(wrapper.find('input').element.value).toBe('')
  })

  it('sin moneda resuelta el input queda deshabilitado', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '1500000', monedaId: 'no-existe' },
      global: { stubs },
    })

    expect(wrapper.find('input').element.disabled).toBe(true)
  })

  // `syncFromMaska` (MoneyInput.vue) es lo que persiste: emite `update:modelValue` con
  // `detail.unmasked`, el monto sin separadores de miles ni prefijo. La directiva
  // `v-maska` real queda adosada al `<input>` del stub de `UInput` (su root es el
  // elemento nativo), así que escribir en él la dispara de verdad — no hace falta
  // simular su callback a mano.
  it('al escribir emite el monto sin máscara, no el texto formateado', async () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '', monedaId: 'clp-1' },
      global: { stubs },
    })

    await wrapper.find('input').setValue('1500000')

    expect(wrapper.emitted('update:modelValue')).toEqual([['1500000']])
  })

  // Con decimales > 0 la máscara incluye el separador decimal (`buildMask` toma la
  // rama de fracción); el emit debe seguir siendo el monto sin máscara.
  it('con una moneda de decimales > 0 el emit conserva el separador decimal', async () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '', monedaId: 'usd-1' },
      global: { stubs },
    })

    await wrapper.find('input').setValue('1500.5')

    expect(wrapper.emitted('update:modelValue')).toEqual([['1500.5']])
  })
})
