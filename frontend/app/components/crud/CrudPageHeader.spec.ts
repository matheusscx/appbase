import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CrudPageHeader from './CrudPageHeader.vue'

// Auditoría UX 07.5: con la descripción larga, "Nuevo X" y "Ver eliminados" se partían en dos líneas.
describe('CrudPageHeader', () => {
  const montar = () => mount(CrudPageHeader, {
    props: { title: 'Impresoras', description: 'Una descripción bastante larga '.repeat(5) },
    slots: { actions: '<button data-qa="accion">Nueva impresora</button>' },
  })

  it('la fila puede envolver: las acciones bajan bajo el título en vez de apretarse', () => {
    expect(montar().get('[data-qa="cabecera"]').classes()).toContain('flex-wrap')
  })

  it('las acciones no se encogen ni parten su texto', () => {
    const acciones = montar().get('[data-qa="cabecera-acciones"]')
    expect(acciones.classes()).toContain('shrink-0')
    expect(acciones.classes()).toContain('whitespace-nowrap')
    expect(acciones.find('[data-qa="accion"]').exists()).toBe(true)
  })

  it('sin acciones no dibuja el contenedor', () => {
    const w = mount(CrudPageHeader, { props: { title: 'x' } })
    expect(w.find('[data-qa="cabecera-acciones"]').exists()).toBe(false)
  })
})
