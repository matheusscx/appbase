// @vitest-environment nuxt
//
// Auditoría UX 03.15: el estado de la caja salía crudo ("EN_CONCILIACION").
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CajaTurnoHeader from './CajaTurnoHeader.vue'

async function montar(estado: string) {
  return mountSuspended(CajaTurnoHeader, {
    props: { caja: { estado, fechaApertura: '2026-08-13T10:00:00Z', cajonNombre: 'Caja 1' }, readonly: true },
  })
}

describe('CajaTurnoHeader — el estado con palabras del local', () => {
  it.each([
    ['abierta', 'Abierta'],
    ['en_conciliacion', 'En conciliación'],
    ['cerrada', 'Cerrada'],
  ])('%s se lee "%s"', async (estado, texto) => {
    const w = await montar(estado)
    expect(w.text()).toContain(texto)
    expect(w.text()).not.toContain('EN_CONCILIACION')
    expect(w.text()).not.toContain('ABIERTA')
  })
})

// Auditoría UX 03.7: en la tablet los controles de la tarea principal medían 32 px.
describe('CajaTurnoHeader — botones de la tarea a 44 px', () => {
  async function botones() {
    const w = await mountSuspended(CajaTurnoHeader, {
      props: { caja: { estado: 'abierta', fechaApertura: '2026-08-13T10:00:00Z', cajonNombre: 'Caja 1' } },
    })
    const buscar = (t: string) => w.findAll('button').find(b => b.text().includes(t))!
    return { movimiento: buscar('Movimiento'), cerrar: buscar('Cerrar caja') }
  }

  it('"+ Movimiento" y "Cerrar caja" llegan a 44 px', async () => {
    const { movimiento, cerrar } = await botones()
    expect(movimiento.classes()).toContain('min-h-11')
    expect(cerrar.classes()).toContain('min-h-11')
  })

  it('"Cerrar caja" va separada de "+ Movimiento", no pegada a 8 px', async () => {
    const { movimiento, cerrar } = await botones()
    // Lo que se usa todo el turno y lo irreversible no comparten contenedor.
    expect(movimiento.element.parentElement).not.toBe(cerrar.element.parentElement)
  })
})
