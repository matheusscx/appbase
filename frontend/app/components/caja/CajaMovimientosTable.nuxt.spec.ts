// @vitest-environment nuxt
//
// Auditoría UX 03.29: al paginar o filtrar, la tabla se reemplazaba por "Cargando movimientos…" y
// se perdía el punto de lectura. Ahora las filas se quedan, atenuadas, hasta que llegan las nuevas.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaMovimientosTable from './CajaMovimientosTable.vue'

const MOV = {
  id: 'm1', tipo: 'salida', concepto: 'Compra de hielo', monto: '3500',
  referencia: null, fecha: '2026-08-13T10:00:00Z', ventaId: null,
}
const estado = vi.hoisted(() => ({ loading: false, items: [] as unknown[] }))

mockNuxtImport('usePaginatedList', () => () => ({
  items: ref(estado.items),
  meta: ref({ page: 1, pageSize: 15, total: estado.items.length, totalPages: 1 }),
  page: ref(1),
  loading: ref(estado.loading),
  error: ref(false),
  sinPermiso: ref(false),
  fetch: vi.fn(),
}))

const MONEDA_CLP = {
  monedaId: 'clp-1', nombre: 'Peso chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
  separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true, esOficial: true, valorDelDia: null,
}

async function montar() {
  useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
  return mountSuspended(CajaMovimientosTable, { props: { cajaId: 'caja-1' } })
}

beforeEach(() => {
  estado.loading = false
  estado.items = [MOV]
})

describe('CajaMovimientosTable — recargar sin perder el punto de lectura', () => {
  it('mientras recarga con filas a la vista, las filas se quedan', async () => {
    estado.loading = true
    const w = await montar()
    expect(w.text()).toContain('Compra de hielo')
    expect(w.text()).not.toContain('Cargando movimientos')
  })

  it('la primera carga, sin filas todavía, dice que está cargando y no que no hay nada', async () => {
    estado.loading = true
    estado.items = []
    const w = await montar()
    expect(w.text()).toContain('Cargando movimientos')
    expect(w.text()).not.toContain('Sin movimientos registrados')
  })

  it('cargado y sin filas, dice que no hay movimientos', async () => {
    estado.items = []
    const w = await montar()
    expect(w.text()).toContain('Sin movimientos registrados')
  })
})
