// @vitest-environment nuxt
//
// Auditoría UX 03.6: la acción principal del encargado en una caja ajena abierta ("Cerrar por el
// cajero") estaba después de las tarjetas de resumen y de la tabla de movimientos, bajo el pliegue.
// Auditoría UX 03.18: revisar un descuadre exigía ir y volver; el detalle no mostraba la explicación.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import DetalleCaja from './[id].vue'
import type { Caja } from '~/stores/caja'

const store = vi.hoisted(() => ({
  detalle: null as unknown,
  arqueo: [] as unknown[],
  cargarDetalle: vi.fn(async () => {}),
  cargarArqueo: vi.fn(async () => {}),
}))
mockNuxtImport('useCajaStore', () => () => store)
mockNuxtImport('useRoute', () => () => ({ path: '/cajas/caja-1', params: { id: 'caja-1' }, query: {} }))

function caja(over: Partial<Caja> = {}): Caja {
  return {
    id: 'caja-1', tenantId: 't1', usuarioId: 'cajero-1', tipo: 'fisica', estado: 'abierta',
    saldoInicial: '1000', saldoFinal: null, montoContado: null, diferencia: null,
    fechaApertura: '2026-08-13T10:00:00Z', fechaCierre: null, comentario: null,
    cajonId: 'cajon-1', cajonNombre: 'Caja 1', usuarioNombre: 'Bruno Cajero',
    ...over,
  }
}

const stubs = {
  CajaActivaDashboard: { template: '<div data-qa="dashboard">dashboard</div>' },
  CajaCierreForzadoPanel: { template: '<div data-qa="panel-forzado">panel</div>' },
  CajaIntentosRechazados: true,
  CajaRevisionDescuadre: { template: '<div data-qa="revision">revision</div>' },
  CajaArqueoTable: true,
}

async function montar() {
  const w = await mountSuspended(DetalleCaja, { global: { stubs } })
  await new Promise(r => setTimeout(r, 20))
  return w
}

beforeEach(() => {
  store.detalle = caja()
  store.arqueo = []
})

describe('/cajas/:id — lo que el encargado viene a hacer va primero', () => {
  it('el panel de cerrar por el cajero está antes que el resumen y los movimientos', async () => {
    const w = await montar()
    const html = w.html()
    expect(html.indexOf('data-qa="panel-forzado"')).toBeGreaterThan(-1)
    expect(html.indexOf('data-qa="panel-forzado"')).toBeLessThan(html.indexOf('data-qa="dashboard"'))
  })
})

describe('/cajas/:id — revisar un descuadre sin ir y volver', () => {
  it('una caja cerrada con diferencia grande muestra la tarjeta de revisión', async () => {
    store.detalle = caja({ estado: 'cerrada', nivelDescuadre: 'alto', explicacionDescuadre: 'Vuelto de más' })
    const w = await montar()
    expect(w.find('[data-qa="revision"]').exists()).toBe(true)
  })

  it('una caja sin descuadre no la muestra', async () => {
    store.detalle = caja({ estado: 'cerrada', nivelDescuadre: 'ninguno' })
    const w = await montar()
    expect(w.find('[data-qa="revision"]').exists()).toBe(false)
  })

  it('una caja abierta no la muestra', async () => {
    const w = await montar()
    expect(w.find('[data-qa="revision"]').exists()).toBe(false)
  })
})
