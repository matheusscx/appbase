// @vitest-environment nuxt
//
// Auditoría UX 08.20: el correo de "olvidé mi contraseña" declara su autocompletado
// (el navegador ofrece el guardado) y no pasa por el corrector ortográfico.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ForgotPassword from './forgot-password.vue'

describe('forgot-password', () => {
  it('el correo se autocompleta y no se corrige', async () => {
    const w = await mountSuspended(ForgotPassword)
    const input = w.find('input[type="email"]')
    expect(input.attributes('autocomplete')).toBe('email')
    expect(input.attributes('name')).toBe('email')
    expect(input.attributes('spellcheck')).toBe('false')
  })
})
