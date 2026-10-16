// @vitest-environment nuxt
//
// Auditoría UX 02.3 y 09.10: "+" y "−" medían 28×28 con el dedo, a 4 px del
// basurero. El mínimo táctil es 44 px.
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AppCantidadInput from './AppCantidadInput.vue'

// `ensureLoaded` espera un ARRAY de unidades.
mockNuxtImport('useApiFetch', () => () => Promise.resolve([]))

const M44 = /(^|\s)(size-11|min-h-11|h-11)(\s|$)/
const M44ANCHO = /(^|\s)(size-11|min-w-11|w-11)(\s|$)/

describe('AppCantidadInput — se toca con el dedo', () => {
  it('los botones + y − miden 44 px', async () => {
    const w = await mountSuspended(AppCantidadInput, {
      props: { modelValue: '2', unidadCodigo: 'unidad', unidadBaseCodigo: 'unidad' },
    })
    const mas = w.find('[data-slot="increment"] button')
    const menos = w.find('[data-slot="decrement"] button')
    for (const b of [mas, menos]) {
      expect(b.classes().join(' ')).toMatch(M44)
      expect(b.classes().join(' ')).toMatch(M44ANCHO)
    }
  })

  it('el campo del medio también', async () => {
    const w = await mountSuspended(AppCantidadInput, {
      props: { modelValue: '2', unidadCodigo: 'unidad', unidadBaseCodigo: 'unidad' },
    })
    expect(w.find('input').classes().join(' ')).toMatch(M44)
  })
})
