// @vitest-environment nuxt
//
// Ítem 2 de `2026-09-19-residuos-hora-de-corte/brief.md`: Propinas es la
// única de las 6 pantallas con `<DiaNegocioNota />` que no tenía test de la
// nota (las otras cinco: `mermas.nuxt.spec.ts`, `sesiones-garzon.nuxt.spec.ts`,
// `components/caja/CajaTendencia.nuxt.spec.ts`, `salones/anulaciones.nuxt.spec.ts`
// y el smoke Playwright de `ordenes.vue`). Molde: `mermas.nuxt.spec.ts` →
// describe "nota del día de negocio".
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Propinas from './index.vue'

/** Task 5: corte del día de negocio que devuelve `GET /tenants/me` — 0 por
 *  defecto (sin corte, la `DiaNegocioNota` no se dibuja). */
let horaCorteBackend = 0

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    permisos: ['x'],
    loading: false,
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (url.includes('/tenants/me')) {
      return Promise.resolve({ horaCorte: horaCorteBackend, diaNegocioHoy: '2026-09-18' })
    }
    if (url.includes('/propinas/reportes/resumen')) {
      return Promise.resolve({
        cobranza: { montoCobrado: '0.0000' },
        estadoActual: { pendienteLibreMonto: '0.0000' },
      })
    }
    if (url.includes('/propinas/liquidaciones')) return Promise.resolve([])
    if (url.includes('/turnos')) return Promise.resolve([])
    if (url.includes('/garzones')) return Promise.resolve([])
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Propinas)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

describe('propinas — nota del día de negocio', () => {
  beforeEach(() => {
    horaCorteBackend = 0
  })

  it('con corte configurado, muestra "Tu día va de HH:00 a HH:00"', async () => {
    horaCorteBackend = 5
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    wrapper.unmount()
  })

  it('sin corte (0), no muestra la nota', async () => {
    horaCorteBackend = 0
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Tu día va de')
    wrapper.unmount()
  })
})
