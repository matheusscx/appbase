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
    usuarioNombre: 'Ana Pérez',
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
    usuarioNombre: null,
  },
  {
    id: 'caja-3',
    cajonNombre: 'Caja 3',
    estado: 'en_conciliacion',
    fechaApertura: '2026-08-26T13:00:00.000Z',
    fechaCierre: null,
    saldoInicial: '10000',
    saldoFinal: null,
    diferenciaTotal: '0',
    usuarioNombre: 'Luis Soto',
  },
]))

mockNuxtImport('usePaginatedList', () => () => ({
  items: ref(CAJAS),
  meta: ref({ page: 1, pageSize: 15, total: 3, totalPages: 1 }),
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

// El filtro llega por la URL; el middleware de auth no deja navegar de verdad en el spec.
let query: Record<string, string> = {}
mockNuxtImport('useRoute', () => () => ({ path: '/cajas/historial', query }))

async function montar(q: Record<string, string> = {}) {
  query = q
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

// Auditoría UX 03.15 y 03.16.
describe('CajaHistorial — estado legible y cajero', () => {
  it('el estado sale con palabras del local, no el valor de la base', async () => {
    const w = await montar()
    const texto = w.findAll('tbody tr').map(f => f.text()).join(' | ')
    expect(texto).toContain('Cerrada')
    expect(texto).toContain('Abierta')
    expect(texto).toContain('En conciliación')
    expect(texto).not.toContain('en_conciliacion')
    expect(texto).not.toContain('cerrada ')
  })

  it('cada fila dice de qué cajero es la caja', async () => {
    const w = await montar()
    const filas = w.findAll('tbody tr')
    expect(filas[0]!.text()).toContain('Ana Pérez')
    expect(filas[2]!.text()).toContain('Luis Soto')
  })

  it('una diferencia en cero no se pinta verde ni lleva signo (03.22)', async () => {
    const w = await montar()
    const celda = w.findAll('tbody tr')[2]!.find('[data-qa="diferencia-total"]')
    expect(celda.text()).not.toContain('+')
    expect(celda.classes()).toContain('text-muted')
    expect(celda.classes()).not.toContain('text-success')
  })

  it('las cifras de las columnas de plata alinean los dígitos (03.21)', async () => {
    const w = await montar()
    expect(w.find('[data-qa="saldo-final"]').classes()).toContain('tabular-nums')
    expect(w.find('[data-qa="diferencia-total"]').classes()).toContain('tabular-nums')
  })

  it('sin filtro no hay chip de filtro', async () => {
    const w = await montar()
    expect(w.find('[data-qa="filtro-activo"]').exists()).toBe(false)
  })

  it('filtrado por cajero, el título dice por quién y se puede quitar', async () => {
    const w = await montar({ usuarioId: 'u-1' })
    const chip = w.find('[data-qa="filtro-activo"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('Cajero: Ana Pérez')
    expect(chip.text()).toContain('Quitar filtro')
  })

  it('filtrado por caja, el chip nombra la caja', async () => {
    const w = await montar({ cajonId: 'c-1' })
    expect(w.find('[data-qa="filtro-activo"]').text()).toContain('Caja: Caja 1')
  })
})
