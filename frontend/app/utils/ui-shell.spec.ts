import { describe, it, expect } from 'vitest'
import { shellUi } from './ui-shell'

// Auditoría UX 07.36: el pie de los modales dibujaba una línea a todo el ancho (la `divide-y` del
// UModal) y otra inset sobre los botones (AppModalFooter): una doble línea.
describe('shellUi.modal', () => {
  it('apaga la línea divisoria del UModal: la única es la inset del pie', () => {
    const clases = shellUi.modal.content.split(/\s+/)
    expect(clases).toContain('divide-y-0')
  })
})
