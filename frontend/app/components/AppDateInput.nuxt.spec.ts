// @vitest-environment nuxt
//
// Auditoría UX 03.12 y 05.16: dos campos de fecha idénticos, sin "Desde" ni
// "Hasta", y los dos botones del calendario se llamaban igual ("Seleccionar
// fecha"). Con `label`, el campo trae su rótulo visible y el botón dice de cuál.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppDateInput from './AppDateInput.vue'

describe('AppDateInput — nombre del campo', () => {
  it('con `label` muestra el rótulo y el botón del calendario dice de qué fecha es', async () => {
    const w = await mountSuspended(AppDateInput, { props: { label: 'Desde' } })
    expect(w.find('label').text()).toBe('Desde')
    expect(w.find('button[aria-label="Seleccionar la fecha Desde"]').exists()).toBe(true)
  })

  it('dos campos rotulados no comparten el nombre del botón', async () => {
    const a = await mountSuspended(AppDateInput, { props: { label: 'Desde' } })
    const b = await mountSuspended(AppDateInput, { props: { label: 'Hasta' } })
    expect(a.find('button').attributes('aria-label')).not.toBe(b.find('button').attributes('aria-label'))
  })

  it('sin `label` queda como estaba (lo usan los que ya traen su UFormField)', async () => {
    const w = await mountSuspended(AppDateInput)
    expect(w.find('label').exists()).toBe(false)
    expect(w.find('button[aria-label="Seleccionar fecha"]').exists()).toBe(true)
  })
})
