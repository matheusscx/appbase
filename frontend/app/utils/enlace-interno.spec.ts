import { describe, it, expect } from 'vitest'
import { debeSeguirElNavegador } from './enlace-interno'

// Auditoría UX 04.15: las tarjetas de Inicio son `<a href>` pero el
// `@click.prevent` incondicional anulaba Cmd/Ctrl+clic y el clic medio, que son
// la forma de comparar "Ventas" y "Cajas" lado a lado.
function clic(over: Partial<MouseEvent> = {}) {
  return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over } as MouseEvent
}

describe('debeSeguirElNavegador', () => {
  it('el clic simple lo resuelve el router (SPA)', () => {
    expect(debeSeguirElNavegador(clic())).toBe(false)
  })
  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['clic medio', { button: 1 }],
  ])('%s+clic lo sigue el navegador (pestaña nueva)', (_n, over) => {
    expect(debeSeguirElNavegador(clic(over))).toBe(true)
  })
})
