// @vitest-environment nuxt
//
// Lote 4 (03.2): a 768 la tabla del historial medía 822 px en 672 y "Diferencia" —la columna que
// responde "¿cuadró?"— quedaba fuera de la vista. Este spec fija la forma (orden y columnas que se
// ocultan en tablet); los montos y cómo se calculan no cambian.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaHistorial from './CajaHistorial.vue'

const CAJAS = vi.hoisted(() => ([
  {
    id: 'caja-1',
    cajonNombre: 'Caja 1',
    estado: 'cerrada',
    fechaApertura: '2026-08-23T13:00:00.000Z',
    fechaCierre: '2026-08-24T01:00:00.000Z',
    saldoInicial: '10000',
    saldoFinal: '50000',
    diferenciaTotal: '-500',
  },
  {
    id: 'caja-2',
    cajonNombre: 'Caja 2',
    estado: 'abierta',
    fechaApertura: '2026-08-25T13:00:00.000Z',
    fechaCierre: null,
    saldoInicial: '10000',
    saldoFinal: null,
    diferenciaTotal: null,
  },
]))

mockNuxtImport('usePaginatedList', () => () => ({
  items: ref(CAJAS),
  meta: ref({ page: 1, pageSize: 15, total: 2, totalPages: 1 }),
  page: ref(1),
  loading: ref(false),
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
  return mountSuspended(CajaHistorial, { props: { basePath: '/cajas', todas: true } })
}

describe('CajaHistorial — forma de la tabla en tablet', () => {
  it('"Diferencia" va justo después de "Caja"', async () => {
    const w = await montar()
    const cabeceras = w.findAll('th').map(t => t.text())
    expect(cabeceras.indexOf('Diferencia')).toBe(cabeceras.indexOf('Caja') + 1)
  })

  it('hay una sola columna de fecha: "Apertura" no es columna', async () => {
    const w = await montar()
    const cabeceras = w.findAll('th').map(t => t.text())
    expect(cabeceras).not.toContain('Apertura')
    expect(cabeceras).toContain('Cierre')
  })

  it('una caja abierta no tiene cierre: la fecha dice desde cuándo está abierta', async () => {
    const w = await montar()
    const filas = w.findAll('tbody tr')
    expect(filas[1]!.text()).toContain('Abierta desde')
    expect(filas[0]!.text()).not.toContain('Abierta desde')
  })

  it('"Saldo inicial" se oculta bajo lg', async () => {
    const w = await montar()
    const th = w.findAll('th').find(t => t.text() === 'Saldo inicial')
    expect(th?.classes()).toContain('hidden')
    expect(th?.classes()).toContain('lg:table-cell')
  })

  it('la diferencia sigue mostrándose como antes (signo y color)', async () => {
    const w = await montar()
    const fila = w.findAll('tbody tr')[0]!
    expect(fila.text()).toContain('500')
  })
})
