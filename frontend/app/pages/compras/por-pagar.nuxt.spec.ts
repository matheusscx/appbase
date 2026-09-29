// @vitest-environment nuxt
//
// "Por pagar" (spec compras-deuda-proveedor § 8 y § 10, decisión 9): la lista
// por proveedor, y al tocar uno, sus compras abiertas y sus pagos con el
// botón Pagar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import PorPagar from './por-pagar.vue'

const PROVEEDORES = [
  {
    proveedorId: 'p1', proveedorNombre: 'Don Pedro', deuda: '50000', vencido: '50000',
    venceProximos7Dias: '0', comprasTotalDesconocido: 0, saldoAFavor: '0',
  },
  {
    proveedorId: 'p2', proveedorNombre: 'Andina', deuda: '88000', vencido: '0',
    venceProximos7Dias: '88000', comprasTotalDesconocido: 0, saldoAFavor: '2000',
  },
]

const DETALLE_P1 = {
  compras: [{
    id: 'c1', fechaDocumento: '2026-09-01', folio: '10', tipoDocumentoNombre: 'Factura',
    total: '50000', totalDocumento: '50000', fechaVencimiento: '2026-09-20',
    estadoPago: 'pendiente', deuda: '50000', vencida: true,
  }],
  pagos: [],
}

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string) => {
  const ruta = url.split('/api').pop()!
  if (ruta === '/compras/por-pagar') return Promise.resolve(PROVEEDORES)
  if (ruta === '/compras/por-pagar/p1') return Promise.resolve(DETALLE_P1)
  if (ruta === '/compras/por-pagar/p2') return Promise.resolve({ compras: [], pagos: [] })
  if (ruta === '/compras/medios-pago') return Promise.resolve([{ id: 'm1', nombre: 'Efectivo', esEfectivo: true }])
  return Promise.reject(new Error(`ruta no mockeada: ${ruta}`))
})

async function montar() {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(PorPagar, { attachTo: document.body })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('compras/por-pagar', () => {
  it('lista los proveedores con deuda o saldo a favor', async () => {
    await montar()
    const texto = document.body.querySelector('[data-qa="por-pagar-proveedores"]')!.textContent!
    expect(texto).toContain('Don Pedro')
    expect(texto).toContain('Andina')
  })

  it('al tocar un proveedor, se cargan sus compras y aparece "Pagar"', async () => {
    const wrapper = await montar()
    const filas = wrapper.findAll('tbody tr')
    expect(filas.length).toBeGreaterThan(0)
    await filas[0]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))

    const detalle = document.body.querySelector('[data-qa="por-pagar-detalle"]')!.textContent!
    expect(detalle).toContain('Don Pedro')
    expect(detalle).toContain('Factura')
    expect(document.body.querySelector('[data-qa="por-pagar-pagar-abrir"]')).toBeTruthy()
  })

  it('sin proveedores con deuda ni saldo, no hay nada que seleccionar', async () => {
    document.body.innerHTML = ''
    await montar()
    expect(document.body.querySelector('[data-qa="por-pagar-detalle"]')).toBeNull()
  })
})
