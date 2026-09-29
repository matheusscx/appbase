// @vitest-environment nuxt
//
// Listado de compras (spec compras-deuda-proveedor § 8 y § 10, decisión 12):
// la insignia de pago y el filtro `estadoPago` son SOLO de quien tiene
// `Compras:Pagar` — con solo `Leer`, ni se piden ni se muestran.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ComprasIndex from './index.vue'

const FILA = {
  id: 'compra-1',
  estado: 'confirmada',
  faltaCosto: false,
  fechaDocumento: '2026-09-15',
  proveedorId: 'p1',
  proveedorNombre: 'Don Pedro',
  tipoDocumentoNombre: 'Factura',
  folio: '4521',
  ubicacionNombre: 'Local',
  lineas: 2,
  total: '30000',
}

let permisos = new Set<string>()
const llamadas: string[] = []

mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return false },
  can: (modulo: string, accion: string) => permisos.has(`${modulo}:${accion}`),
}))

mockNuxtImport('useApiFetch', () => (url: string) => {
  llamadas.push(url.split('/api').pop()!)
  if (url.includes('/compras/proveedores')) return Promise.resolve([{ id: 'p1', nombre: 'Don Pedro' }])
  if (url.includes('/compras')) {
    return Promise.resolve({
      data: [{ ...FILA, ...(permisos.has('Compras:Pagar') ? { estadoPago: 'parcial', deuda: '10000', vencida: false } : {}) }],
      meta: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
    })
  }
  return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
})

async function montar() {
  const wrapper = await mountSuspended(ComprasIndex, { attachTo: document.body })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  permisos = new Set(['Compras:Leer'])
  llamadas.length = 0
  document.body.innerHTML = ''
})

describe('compras/index — insignia y filtro de pago (decisión 12)', () => {
  it('con Pagar, la fila muestra la insignia de pago y el filtro está disponible', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Pagar'])
    await montar()
    expect(document.body.querySelector('[data-qa="compras-filtro-estado-pago"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Te faltan')
  })

  it('sin Pagar (solo Leer), ni la insignia ni el filtro aparecen', async () => {
    permisos = new Set(['Compras:Leer'])
    await montar()
    expect(document.body.querySelector('[data-qa="compras-filtro-estado-pago"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Te faltan')
  })
})
