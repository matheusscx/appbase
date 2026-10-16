// @vitest-environment nuxt
//
// Auditoría UX 03.18: el detalle de una caja no mostraba lo que explica el descuadre, y marcar
// visto obligaba a volver a la bandeja.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaRevisionDescuadre from './CajaRevisionDescuadre.vue'
import type { Caja } from '~/stores/caja'

let puedeActualizar = true
mockNuxtImport('usePermissionsStore', () => () => ({
  can: (m: string, a: string) => m === 'Cajas' && a === 'Actualizar' ? puedeActualizar : false,
}))
mockNuxtImport('useCajaStore', () => () => ({ marcarRevisado: vi.fn() }))

function caja(over: Partial<Caja> = {}): Caja {
  return {
    id: 'caja-1', tenantId: 't1', usuarioId: 'u1', tipo: 'fisica', estado: 'cerrada',
    saldoInicial: '1000', saldoFinal: null, montoContado: null, diferencia: '-8000',
    fechaApertura: '2026-08-13T10:00:00Z', fechaCierre: '2026-08-13T20:00:00Z', comentario: null,
    cajonId: 'c1', cajonNombre: 'Caja 1', usuarioNombre: 'Ana Pérez',
    nivelDescuadre: 'alto', explicacionDescuadre: 'Le di vuelto de más a un cliente',
    revisadoPor: null, revisadoEl: null,
    ...over,
  }
}
const montar = (c: Caja) => mountSuspended(CajaRevisionDescuadre, { props: { caja: c } })

beforeEach(() => {
  puedeActualizar = true
})

describe('CajaRevisionDescuadre', () => {
  it('muestra lo que dijo el cajero y qué tan grande fue la diferencia', async () => {
    const w = await montar(caja())
    expect(w.text()).toContain('Le di vuelto de más a un cliente')
    expect(w.text()).toContain('Diferencia muy grande')
  })

  it('sin explicación, cae al comentario del cierre y si no hay, lo dice', async () => {
    expect((await montar(caja({ explicacionDescuadre: null, comentarioCierre: 'Cerré yo' }))).text()).toContain('Cerré yo')
    expect((await montar(caja({ explicacionDescuadre: null }))).text()).toContain('No dejó explicación')
  })

  it('un cierre pendiente ofrece "Marcar visto" a quien puede actualizar', async () => {
    const w = await montar(caja())
    expect(w.find('[data-qa="marcar-visto-caja-1"]').exists()).toBe(true)
  })

  it('sin Cajas:Actualizar no se ofrece marcar visto', async () => {
    puedeActualizar = false
    const w = await montar(caja())
    expect(w.find('[data-qa="marcar-visto-caja-1"]').exists()).toBe(false)
  })

  it('un cierre ya revisado dice cuándo y no ofrece marcar de nuevo', async () => {
    const w = await montar(caja({ revisadoEl: '2026-08-14T09:00:00Z' }))
    expect(w.find('[data-qa="revision-hecha"]').text()).toContain('Revisado el')
    expect(w.find('[data-qa="marcar-visto-caja-1"]').exists()).toBe(false)
  })

  it('el nivel aviso no entra a la bandeja: no se ofrece marcar', async () => {
    const w = await montar(caja({ nivelDescuadre: 'aviso' }))
    expect(w.text()).toContain('Diferencia grande')
    expect(w.find('[data-qa="marcar-visto-caja-1"]').exists()).toBe(false)
  })
})
