// @vitest-environment nuxt
//
// Auditoría UX 04.16: el botón "i" medía 24 px. Crece su área de toque a 44 sin mover el layout.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppInfoButton from './AppInfoButton.vue'

describe('AppInfoButton', () => {
  it('el botón tiene un área de toque de 44 px y un nombre que dice de qué es', async () => {
    const w = await mountSuspended(AppInfoButton, { props: { title: 'Día de negocio', text: 'x' } })
    const boton = w.find('button')
    expect(boton.attributes('aria-label')).toBe('Más información: Día de negocio')
    const clases = boton.classes().join(' ')
    expect(clases).toContain('relative')
    expect(clases).toContain('after:-inset-2.5')
  })
})
