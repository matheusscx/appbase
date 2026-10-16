// @vitest-environment nuxt
//
// El campo de contraseña con ojo (auditoría UX 08.9): un botón con nombre, que se
// alcanza con Tab y dice su estado. Lo usan el ingreso, la invitación y Mi cuenta.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppInputContrasena from './AppInputContrasena.vue'

describe('AppInputContrasena', () => {
  it('el ojo es un botón con nombre, alcanzable con Tab, que dice su estado', async () => {
    const w = await mountSuspended(AppInputContrasena, { props: { modelValue: 'abc' } })
    const ojo = w.find('button[aria-label="Mostrar contraseña"]')
    expect(ojo.exists()).toBe(true)
    expect(ojo.attributes('tabindex')).not.toBe('-1')
    expect(ojo.attributes('type')).toBe('button')
    expect(ojo.attributes('aria-pressed')).toBe('false')
    expect(w.find('input').attributes('type')).toBe('password')

    await ojo.trigger('click')
    expect(w.find('button[aria-label="Ocultar contraseña"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('input').attributes('type')).toBe('text')
  })

  it('pasa autocomplete, placeholder y el v-model al campo', async () => {
    const w = await mountSuspended(AppInputContrasena, {
      props: { modelValue: '', autocomplete: 'new-password', placeholder: 'Tu clave' },
    })
    const input = w.find('input')
    expect(input.attributes('autocomplete')).toBe('new-password')
    expect(input.attributes('placeholder')).toBe('Tu clave')
    await input.setValue('hola')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['hola'])
  })

  it('mide 44 px en el ingreso y 40 en Mi cuenta (compacto)', async () => {
    const ingreso = await mountSuspended(AppInputContrasena, { props: { modelValue: '' } })
    const cuenta = await mountSuspended(AppInputContrasena, { props: { modelValue: '', compacto: true } })
    expect(ingreso.find('input').classes()).toContain('min-h-11')
    expect(ingreso.find('button').classes()).toContain('size-11')
    expect(cuenta.find('input').classes()).not.toContain('min-h-11')
    expect(cuenta.find('button').classes()).toContain('size-10')
  })
})
