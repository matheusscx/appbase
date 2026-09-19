// @vitest-environment nuxt
//
// El detalle de una compra confirmada (spec compras § 6). Lo que fija: cada
// acción aparece solo con su permiso y en el estado que la admite, y el
// historial se lee.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import type { CompraDetalle } from '~/composables/useCompras'
import CompraConfirmada from './CompraConfirmada.vue'

let permisos = new Set<string>()

mockNuxtImport('usePermissionsStore', () => () => ({
  get esAdmin() { return false },
  can: (modulo: string, accion: string) => permisos.has(`${modulo}:${accion}`),
}))

function compra(o: Partial<CompraDetalle> = {}): CompraDetalle {
  return {
    id: 'compra-1',
    estado: 'confirmada',
    faltaCosto: false,
    fechaDocumento: '2026-09-15',
    proveedorId: 'p1',
    proveedorNombre: 'Distribuidora X',
    tipoDocumentoCompraId: 't1',
    tipoDocumentoNombre: 'Factura',
    folio: '4521',
    ubicacionId: 'bodega-1',
    ubicacionNombre: 'Bodega',
    observacion: null,
    descuentoTotal: null,
    motivoAnulacion: null,
    total: '30000',
    lineas: [{
      id: 'l1', orden: 0, itemId: 'i1', itemNombre: 'Tomate', modoInventario: 'cantidad',
      unidadMedidaBase: 'kg', cantidad: '20', unidadCodigo: 'kg', precioUnitario: '1500',
      series: null, lote: null,
    }],
    cambios: [],
    ...o,
  }
}

async function montar(c: CompraDetalle) {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  return mountSuspended(CompraConfirmada, { props: { compra: c } })
}

const hay = (w: Awaited<ReturnType<typeof montar>>, qa: string) =>
  w.find(`[data-qa^="${qa}"]`).exists()

beforeEach(() => {
  permisos = new Set()
})

describe('CompraConfirmada — acciones por permiso', () => {
  it('con Actualizar se corrige y se carga el descuento; con Anular se anula', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Actualizar', 'Compras:Anular'])
    const w = await montar(compra())
    expect(hay(w, 'compra-corregir-')).toBe(true)
    expect(hay(w, 'compra-descuento-abrir')).toBe(true)
    expect(hay(w, 'compra-anular-abrir')).toBe(true)
  })

  it('con solo Leer no aparece ninguna acción', async () => {
    permisos = new Set(['Compras:Leer'])
    const w = await montar(compra())
    expect(hay(w, 'compra-corregir-')).toBe(false)
    expect(hay(w, 'compra-descuento-abrir')).toBe(false)
    expect(hay(w, 'compra-anular-abrir')).toBe(false)
  })

  it('Actualizar no alcanza para anular', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Actualizar'])
    const w = await montar(compra())
    expect(hay(w, 'compra-corregir-')).toBe(true)
    expect(hay(w, 'compra-anular-abrir')).toBe(false)
  })

  it('con una línea sin precio se completa, pero el descuento no se ofrece', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Actualizar'])
    const c = compra({ faltaCosto: true })
    c.lineas[0]!.precioUnitario = null
    const w = await montar(c)
    expect(w.find('[data-qa="compra-corregir-l1"]').text()).toContain('Completar')
    expect(hay(w, 'compra-descuento-abrir')).toBe(false)
  })

  it('una anulada muestra el motivo y no ofrece acciones', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Actualizar', 'Compras:Anular'])
    const w = await montar(compra({ estado: 'anulada', motivoAnulacion: 'Factura equivocada' }))
    expect(w.find('[data-qa="compra-anulada-motivo"]').text()).toContain('Factura equivocada')
    expect(hay(w, 'compra-corregir-')).toBe(false)
    expect(hay(w, 'compra-anular-abrir')).toBe(false)
  })
})

describe('CompraConfirmada — historial', () => {
  it('nombra el producto, el campo y los valores de cada corrección', async () => {
    permisos = new Set(['Compras:Leer'])
    const w = await montar(compra({
      cambios: [{
        compraLineaId: 'l1',
        campo: 'precio',
        valorAnterior: null,
        valorNuevo: '1500',
        usuarioNombre: 'Encargado',
        creadoEl: '2026-09-19T12:00:00.000Z',
      }],
    }))
    const historial = w.find('[data-qa="compra-historial"]').text()
    expect(historial).toContain('Tomate')
    expect(historial).toContain('Precio')
    expect(historial).toContain('1.500')
    expect(historial).toContain('Encargado')
  })
})
