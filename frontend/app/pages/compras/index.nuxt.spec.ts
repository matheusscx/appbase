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
let esAdmin = false
const llamadas: string[] = []

mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return esAdmin },
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
  esAdmin = false
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

describe('compras/index — el admin del tenant ve lo que su tenant contrató', () => {
  // Sin atajo por `esAdmin` (owner, 2026-10-15): `mis-permisos` le trae al admin el
  // catálogo entero de los módulos contratados, y nada de los otros.
  it('con Compras contratado, ve "Nueva compra" y el filtro de pago', async () => {
    esAdmin = true
    permisos = new Set(['Compras:Leer', 'Compras:Crear', 'Compras:Actualizar', 'Compras:Anular', 'Compras:Pagar'])
    await montar()
    expect(document.body.textContent).toContain('Nueva compra')
    expect(document.body.querySelector('[data-qa="compras-filtro-estado-pago"]')).toBeTruthy()
  })

  it('en un tenant que no contrató Compras, no ve "Nueva compra" ni el filtro de pago', async () => {
    esAdmin = true
    permisos = new Set(['Paquetería:Leer'])
    await montar()
    expect(document.body.textContent).not.toContain('Nueva compra')
    expect(document.body.querySelector('[data-qa="compras-filtro-estado-pago"]')).toBeNull()
  })
})

// Lote 4 (06.14 / 00.9): a 768 la tabla de quien paga tiene que mostrar "Pago".
describe('compras/index — forma de la tabla en tablet', () => {
  function cabecera(texto: string) {
    return Array.from(document.body.querySelectorAll('th')).find(th => th.textContent?.trim() === texto)
  }

  it('"Entra a" y "Líneas" se ocultan bajo lg; "Pago" y "Estado" siguen siempre', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Pagar'])
    await montar()
    for (const t of ['Entra a', 'Líneas']) {
      expect(cabecera(t)?.className).toContain('lg:table-cell')
      expect(cabecera(t)?.className).toContain('hidden')
    }
    for (const t of ['Estado', 'Pago']) {
      expect(cabecera(t)).toBeTruthy()
      expect(cabecera(t)?.className).not.toContain('hidden')
    }
  })
})

// Auditoría UX 06.21: la fila abre la compra con clic, pero no era un enlace:
// sin Ctrl+clic para otra pestaña y sin que el lector la anuncie como navegación.
describe('compras/index — la compra es un enlace', () => {
  it('el documento lleva a la compra con un <a href>', async () => {
    await montar()
    const enlace = document.body.querySelector<HTMLAnchorElement>('a[href="/compras/compra-1"]')
    expect(enlace).toBeTruthy()
    expect(enlace!.textContent).toContain('4521')
  })
  // Auditoría UX 06.9: la lista mostraba el dato crudo (2026-09-15) y el detalle 15-09-2026.
  it('06.9: la fecha de la lista sale con el mismo formato que el detalle', async () => {
    await montar()
    const texto = document.body.textContent!
    expect(texto).toContain('15-09-2026')
    expect(texto).not.toContain('2026-09-15')
  })

  // 06.19: "Factura4521" sin espacio entre el tipo y el folio.
  it('06.19: el documento se lee "Factura 4521"', async () => {
    await montar()
    expect(document.body.querySelector('a[href="/compras/compra-1"]')!.textContent!.trim()).toBe('Factura 4521')
  })
})
