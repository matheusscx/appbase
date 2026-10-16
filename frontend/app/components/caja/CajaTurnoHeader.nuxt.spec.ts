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
