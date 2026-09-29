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
    totalDocumento: null,
    fechaVencimiento: null,
    lineas: [{
      id: 'l1', orden: 0, itemId: 'i1', itemNombre: 'Tomate', modoInventario: 'cantidad',
      unidadMedidaBase: 'kg', cantidad: '20', unidadCodigo: 'kg', precioUnitario: '1500',
      series: null, lote: null, presentacion: null,
    }],
    cambios: [],
    ...o,
  }
}

async function montar(c: CompraDetalle, totalDocumentoTipo: 'suma_lineas' | 'obligatorio' | 'opcional' = 'obligatorio') {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  return mountSuspended(CompraConfirmada, { props: { compra: c, totalDocumentoTipo } })
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

describe('CompraConfirmada — total, vencimiento y su corrección (spec compras-deuda-proveedor § 6 y § 10)', () => {
  it('muestra el total del documento y el vencimiento', async () => {
    permisos = new Set(['Compras:Leer'])
    const w = await montar(compra({ totalDocumento: '119000', fechaVencimiento: '2026-10-16' }))
    expect(w.find('[data-qa="compra-documento-total"]').text()).toContain('119.000')
    expect(w.find('[data-qa="compra-documento-vencimiento"]').text()).toContain('16')
  })

  it('un tipo suma_lineas no muestra "Total del documento" (no hay nada transcrito)', async () => {
    permisos = new Set(['Compras:Leer'])
    const w = await montar(compra({ totalDocumento: null }), 'suma_lineas')
    expect(w.find('[data-qa="compra-documento-total"]').exists()).toBe(false)
  })

  it('con Actualizar aparece "Corregir total o vencimiento"; con solo Leer, no', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Actualizar'])
    const w = await montar(compra())
    expect(hay(w, 'compra-documento-corregir-abrir')).toBe(true)

    permisos = new Set(['Compras:Leer'])
    const w2 = await montar(compra())
    expect(hay(w2, 'compra-documento-corregir-abrir')).toBe(false)
  })
})

describe('CompraConfirmada — pago (spec § 8 y § 10, decisión 12)', () => {
  it('con Pagar y estadoPago presente, muestra pagado, deuda, insignia y pagos', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Pagar'])
    const w = await montar(compra({
      estadoPago: 'parcial',
      deuda: '20000',
      aplicado: '99000',
      vencida: false,
      pagos: [{
        id: 'pago-1', proveedorId: 'p1', fecha: '2026-09-20', monto: '99000',
        metodoPagoId: 'm1', metodoPagoNombre: 'Efectivo', referencia: null, cajaId: 'caja-1',
        estado: 'vigente', anuladoPor: null, anuladoEl: null, motivoAnulacion: null,
        aplicaciones: [{ compraId: 'compra-1', monto: '99000' }], sobranteAFavor: '0',
      }],
    }))
    const texto = w.find('[data-qa="compra-pago"]').text()
    expect(texto).toContain('99.000')
    expect(texto).toContain('20.000')
    expect(texto).toContain('Te faltan')
    expect(w.find('[data-qa="compra-pagos-tabla"]').text()).toContain('Efectivo')
  })

  it('sin Pagar, la sección de pago ni se muestra (aunque venga estadoPago)', async () => {
    permisos = new Set(['Compras:Leer'])
    const w = await montar(compra({ estadoPago: 'pagada', deuda: '0', vencida: false }))
    expect(hay(w, 'compra-pago')).toBe(false)
  })

  it('sin estadoPago (sin Pagar en la respuesta del backend), tampoco se muestra', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Pagar'])
    const w = await montar(compra())
    expect(hay(w, 'compra-pago')).toBe(false)
  })

  it('vencida pisa a las demás: la insignia dice "Vencida", no "Te faltan $X"', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Pagar'])
    const w = await montar(compra({ estadoPago: 'parcial', deuda: '20000', aplicado: '99000', vencida: true }))
    expect(w.find('[data-qa="compra-pago"]').text()).toContain('Vencida')
  })

  it('con deuda pendiente aparece "Pagar"; una compra ya pagada no lo ofrece', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Pagar'])
    const conDeuda = await montar(compra({ estadoPago: 'parcial', deuda: '20000', aplicado: '99000', vencida: false }))
    expect(hay(conDeuda, 'compra-pagar-abrir')).toBe(true)

    const pagada = await montar(compra({ estadoPago: 'pagada', deuda: '0', aplicado: '30000', vencida: false }))
    expect(hay(pagada, 'compra-pagar-abrir')).toBe(false)
  })

  it('sin Pagar, "Pagar" tampoco aparece', async () => {
    permisos = new Set(['Compras:Leer'])
    const w = await montar(compra({ estadoPago: 'parcial', deuda: '20000', vencida: false }))
    expect(hay(w, 'compra-pagar-abrir')).toBe(false)
  })
})

describe('CompraConfirmada — presentación (pieza 2 § 6)', () => {
  it('una línea en presentación muestra la etiqueta y la cantidad en la unidad base', async () => {
    permisos = new Set(['Compras:Leer'])
    const c = compra({
      lineas: [{
        id: 'l1', orden: 0, itemId: 'i1', itemNombre: 'Coca-Cola lata', modoInventario: 'cantidad',
        unidadMedidaBase: 'unidad', cantidad: '10', unidadCodigo: null, precioUnitario: '9600',
        series: null, lote: null,
        presentacion: { id: 'pres-1', nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' },
      }],
    })
    const w = await montar(c)
    expect(w.find('[data-qa="compra-confirmada"]').text()).toContain('Caja (12)')
    expect(w.find('[data-qa="compra-confirmada"]').text()).toContain('120 unidad')
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
