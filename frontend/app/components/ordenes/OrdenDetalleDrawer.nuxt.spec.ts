// @vitest-environment nuxt
//
// "Generar nota" (owner, 2026-10-02): en el historial de la orden, el REFUND
// aprobado que quedó sin nota de crédito aparece marcado y, con el permiso de
// reembolsar, lleva el botón que la genera. Lógica de TEMPLATE: ni el build ni
// el typecheck la ven.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import OrdenDetalleDrawer from './OrdenDetalleDrawer.vue'
import GenerarNotaModal from './GenerarNotaModal.vue'
import ReembolsoModal from './ReembolsoModal.vue'

const refund = (extra: Record<string, unknown> = {}) => ({
  transaccionId: 'tx-r',
  tipo: 'REFUND',
  estado: 'aprobada',
  monto: '70000.000000',
  codigoAutorizacion: null,
  codigoRespuesta: '0',
  fechaTransaccion: '2026-10-04T12:00:00Z',
  correccionVentaId: null,
  devoluciones: [],
  ...extra,
})
const ordenCon = (transacciones: unknown[], ventaId: string | null = 'venta-1') => ({
  ordenId: 'orden-1',
  codigoOrden: 'O-1',
  pagadorRef: null,
  referenciaExterna: null,
  ventaId,
  descripcion: 'Orden',
  monto: '100000',
  moneda: 'CLP',
  estado: 'conciliada',
  origen: 'interno',
  creadoEl: '2026-10-04T12:00:00Z',
  transacciones,
})

let ordenActual: ReturnType<typeof ordenCon>
let cargasDeLaOrden = 0
let lecturasDeLaVenta: string[] = []
let permisos = ['Pasarelas:Reembolsar']

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    esAdmin: false,
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})
mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (url.endsWith('/pasarela/admin/ordenes/orden-1')) {
      cargasDeLaOrden++
      return Promise.resolve(structuredClone(ordenActual))
    }
    if (url.includes('/ventas/')) {
      lecturasDeLaVenta.push(url)
      return Promise.resolve({ detalles: [] })
    }
    return Promise.resolve([])
  }
})

async function abrir() {
  const wrapper = await mountSuspended(OrdenDetalleDrawer, {
    props: { open: false, ordenId: 'orden-1' },
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}
const texto = () => document.body.textContent ?? ''
const botonGenerar = () =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Generar nota')

describe('OrdenDetalleDrawer — el REFUND sin nota de crédito', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    permisos = ['Pasarelas:Reembolsar']
    cargasDeLaOrden = 0
    lecturasDeLaVenta = []
  })

  it('aparece marcado y, con Pasarelas:Reembolsar, con el botón "Generar nota"', async () => {
    ordenActual = ordenCon([refund()])
    await abrir()

    expect(texto()).toContain('Sin nota de crédito')
    expect(botonGenerar()).toBeDefined()
  })

  it('sin el permiso de reembolsar se ve la marca, pero no el botón', async () => {
    permisos = ['Pasarelas:Leer']
    ordenActual = ordenCon([refund()])
    await abrir()

    expect(texto()).toContain('Sin nota de crédito')
    expect(botonGenerar()).toBeUndefined()
  })

  it.each([
    ['ya ligado a su nota', [refund({ correccionVentaId: 'nc-1' })], 'venta-1'],
    ['sin confirmar (se aclara en su tarjeta)', [refund({ estado: 'iniciada' })], 'venta-1'],
    ['de una orden sin venta (no hay documento que corregir)', [refund()], null],
  ])('un REFUND %s no se marca ni lleva el botón', async (_caso, transacciones, ventaId) => {
    ordenActual = ordenCon(transacciones, ventaId)
    await abrir()

    expect(texto()).not.toContain('Sin nota de crédito')
    expect(botonGenerar()).toBeUndefined()
  })

  it('el botón abre el modal con ESE REFUND: su monto y lo que pidió', async () => {
    const pedido = [{ itemId: 'item-1', cantidad: '1', stock: 'pierde' }]
    ordenActual = ordenCon([refund({ devoluciones: pedido })])
    const wrapper = await abrir()

    botonGenerar()!.click()
    await flushPromises()

    expect(texto()).toContain('Generar nota de crédito')
    const modal = wrapper.findComponent(GenerarNotaModal)
    expect(modal.props()).toMatchObject({
      open: true,
      ordenId: 'orden-1',
      transaccionId: 'tx-r',
      monto: '70000.000000',
      ventaId: 'venta-1',
      devoluciones: pedido,
    })
    // El modal nace ya abierto (v-if): tiene que cargar las líneas igual. Sin
    // esto la nota salía sin lo que el reembolso declaró (lo cazó Playwright).
    expect(lecturasDeLaVenta).toEqual([expect.stringContaining('/ventas/venta-1')])
  })

  it('un reembolso que salió SIN nota (warning) recarga la orden: la marca y lo que pidió vienen del servidor', async () => {
    ordenActual = ordenCon([])
    const wrapper = await abrir()
    expect(cargasDeLaOrden).toBe(1)
    ordenActual = ordenCon([refund()])

    wrapper.findComponent(ReembolsoModal).vm.$emit('success', {
      ordenId: 'orden-1',
      estado: 'conciliada',
      reembolsoAprobado: true,
      warning: 'la nota falló',
      reembolso: { ...refund(), correccionVentaId: undefined, devoluciones: undefined },
    })
    await flushPromises()

    expect(cargasDeLaOrden).toBe(2)
    expect(texto()).toContain('Sin nota de crédito')
  })

  it('un reembolso que dejó su nota se pinta sin recargar, y no se marca', async () => {
    ordenActual = ordenCon([])
    const wrapper = await abrir()

    wrapper.findComponent(ReembolsoModal).vm.$emit('success', {
      ordenId: 'orden-1',
      estado: 'conciliada',
      reembolsoAprobado: true,
      notaCreditoId: 'nc-1',
      reembolso: { ...refund(), correccionVentaId: undefined, devoluciones: undefined },
    })
    await flushPromises()

    expect(cargasDeLaOrden).toBe(1)
    expect(texto()).toContain('Reembolso')
    expect(texto()).not.toContain('Sin nota de crédito')
  })
})
