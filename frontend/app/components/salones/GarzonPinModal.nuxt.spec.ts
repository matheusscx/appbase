// @vitest-environment nuxt
//
// Auditoría UX 02.34: la tecla de borrar era solo ícono sin nombre, y los
// puntos del PIN van `aria-hidden`: un lector no oía cuántos dígitos iban.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import GarzonPinModal from './GarzonPinModal.vue'

mockNuxtImport('useGarzones', () => () => ({
  paraSelector: vi.fn().mockResolvedValue([{ garzonId: 'g1', nombre: 'Ana' }]),
  verificarPin: vi.fn().mockResolvedValue(undefined),
}))

const esperar = (ms = 20) => new Promise(r => setTimeout(r, ms))
const enBody = () => document.body

async function abrirTeclado() {
  document.body.innerHTML = ''
  const w = await mountSuspended(GarzonPinModal, { props: { open: false }, attachTo: document.body })
  // La lista de garzones se carga al ABRIR (watch sin `immediate`).
  await w.setProps({ open: true })
  await esperar()
  ;[...enBody().querySelectorAll('button')].find(b => b.textContent?.trim() === 'Ana')!.click()
  await esperar()
}

describe('GarzonPinModal — el teclado se oye', () => {
  it('la tecla de borrar tiene nombre', async () => {
    await abrirTeclado()
    expect(enBody().querySelector('button[aria-label="Borrar el último dígito"]')).toBeTruthy()
  })

  it('un texto de estado dice cuántos dígitos van, sin mostrarlos', async () => {
    await abrirTeclado()
    const estado = () => enBody().querySelector('[data-qa="pin-progreso"]')
    expect(estado()?.textContent?.trim()).toBe('0 de 6 dígitos')
    expect(estado()?.className).toContain('sr-only')
    ;[...enBody().querySelectorAll('button')].find(b => b.textContent?.trim() === '4')!.click()
    ;[...enBody().querySelectorAll('button')].find(b => b.textContent?.trim() === '7')!.click()
    await esperar()
    expect(estado()?.textContent?.trim()).toBe('2 de 6 dígitos')
  })
})
