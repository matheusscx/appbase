// @vitest-environment nuxt
//
// El resumen de Pagos resta lo devuelto con la misma cuenta que el "Cobrado"
// del inicio (owner, 2026-10-02): "Cobrado $105.000 · propinas −$5.000 ·
// devuelto −$40.000 → $60.000". El número grande es el neto que ya restó el
// backend; debajo va el desglose solo si hay propinas o devoluciones, y ese
// cobrado es lo que suman las filas (cobros). La pantalla no hace la cuenta:
// solo decide qué partes de la línea muestra.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import PagosIndex from './index.vue'

// Sin moneda oficial hidratada `formatMonto` rinde "—": se hidrata a mano tras
// montar, como `ventas/index.nuxt.spec.ts`.
const CLP = {
  monedaId: 'clp-1',
  nombre: 'Peso chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

const SIN_DEVOLUCIONES = {
  totalPagos: 3,
  montoCobrado: '250000.0000',
  montoPropinas: '0.0000',
  montoDevuelto: '0.0000',
  montoNeto: '250000.0000',
  pagosHoy: 1,
  montoHoy: '100000.0000',
  propinasHoy: '0.0000',
  devueltoHoy: '0.0000',
  netoHoy: '100000.0000',
}

let resumenRespuesta: Record<string, unknown> = SIN_DEVOLUCIONES

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (url.includes('/pagos/resumen')) return Promise.resolve(resumenRespuesta)
    if (url.includes('/pagos')) {
      return Promise.resolve({
        data: [],
        meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 },
      })
    }
    return Promise.resolve([])
  }
})

// Mismo motivo que `ventas/index.nuxt.spec.ts`: el root de `AppDrawer` es un
// `UDrawer` (reka-ui) que bajo happy-dom puede tirar un unhandled rejection.
const AppDrawerStub = {
  name: 'AppDrawer',
  props: ['open'],
  template: '<div v-if="open" role="dialog"><slot name="body" /></div>',
}

async function montar() {
  const wrapper = await mountSuspended(PagosIndex, {
    attachTo: document.body,
    global: { stubs: { AppDrawer: AppDrawerStub } },
  })
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

const tarjeta = (wrapper: Awaited<ReturnType<typeof montar>>, titulo: string) =>
  wrapper.findAll('div.rounded-lg').find(d => d.text().includes(titulo))!.text()

beforeEach(() => {
  document.body.innerHTML = ''
  resumenRespuesta = SIN_DEVOLUCIONES
})

describe('pagos/index — cobrado, devuelto y neto', () => {
  it('el café: muestra el neto y debajo "cobrado $100.000 · devuelto −$40.000", en el total y en hoy', async () => {
    resumenRespuesta = {
      ...SIN_DEVOLUCIONES,
      totalPagos: 1,
      montoCobrado: '100000.0000',
      montoDevuelto: '40000.0000',
      montoNeto: '60000.0000',
      montoHoy: '100000.0000',
      devueltoHoy: '40000.0000',
      netoHoy: '60000.0000',
    }

    const wrapper = await montar()

    for (const titulo of ['Total cobrado', 'Cobrado hoy']) {
      const texto = tarjeta(wrapper, titulo).replace(/\s+/g, ' ')
      expect(texto).toContain('$60.000')
      expect(texto).toContain('cobrado $100.000 · devuelto −$40.000')
      expect(texto).not.toContain('propinas')
    }
  })

  it('con propina: "cobrado $105.000 · propinas −$5.000 · devuelto −$40.000" bajo un neto de $60.000', async () => {
    resumenRespuesta = {
      totalPagos: 1,
      montoCobrado: '105000.0000',
      montoPropinas: '5000.0000',
      montoDevuelto: '40000.0000',
      montoNeto: '60000.0000',
      pagosHoy: 1,
      montoHoy: '105000.0000',
      propinasHoy: '5000.0000',
      devueltoHoy: '40000.0000',
      netoHoy: '60000.0000',
    }

    const wrapper = await montar()

    for (const titulo of ['Total cobrado', 'Cobrado hoy']) {
      const texto = tarjeta(wrapper, titulo).replace(/\s+/g, ' ')
      expect(texto).toContain('$60.000')
      expect(texto).toContain('cobrado $105.000 · propinas −$5.000 · devuelto −$40.000')
    }
  })

  it('con propina y sin devoluciones, el desglose muestra solo la propina', async () => {
    resumenRespuesta = {
      ...SIN_DEVOLUCIONES,
      montoCobrado: '255000.0000',
      montoPropinas: '5000.0000',
    }

    const wrapper = await montar()

    const total = tarjeta(wrapper, 'Total cobrado').replace(/\s+/g, ' ')
    expect(total).toContain('cobrado $255.000 · propinas −$5.000')
    expect(total).not.toContain('devuelto')
  })

  it('sin propinas ni devoluciones no hay desglose: el número es lo cobrado', async () => {
    const wrapper = await montar()

    const total = tarjeta(wrapper, 'Total cobrado')
    expect(total).toContain('$250.000')
    expect(total).not.toContain('devuelto')
    expect(total).not.toContain('propinas')
    const hoy = tarjeta(wrapper, 'Cobrado hoy')
    expect(hoy).toContain('$100.000')
    expect(hoy).not.toContain('devuelto')
    expect(hoy).not.toContain('propinas')
  })

  it('una devolución de otro día aparece en el total y no en hoy', async () => {
    resumenRespuesta = {
      ...SIN_DEVOLUCIONES,
      montoDevuelto: '15000.0000',
      montoNeto: '235000.0000',
    }

    const wrapper = await montar()

    expect(tarjeta(wrapper, 'Total cobrado').replace(/\s+/g, ' '))
      .toContain('cobrado $250.000 · devuelto −$15.000')
    expect(tarjeta(wrapper, 'Cobrado hoy')).not.toContain('devuelto')
  })
})
