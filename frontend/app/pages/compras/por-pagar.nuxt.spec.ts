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

// Un pago que cubrió una compra entera: no deja saldo a favor y aun así se puede anular (06.6).
const DETALLE_P2 = {
  compras: [],
  pagos: [{
    id: 'pago-9', proveedorId: 'p2', fecha: '2026-09-20', monto: '88000',
    metodoPagoId: 'm1', metodoPagoNombre: 'Transferencia', referencia: null,
    cajaId: null, cajaEstado: null, cajaUsuarioId: null,
    estado: 'vigente', anuladoPor: null, anuladoEl: null, motivoAnulacion: null,
    aplicaciones: [{ compraId: 'c9', monto: '88000' }], sobranteAFavor: '0',
  }],
}

mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useApiFetch', () => (url: string) => {
  const ruta = url.split('/api').pop()!
  if (ruta === '/compras/por-pagar') return Promise.resolve(PROVEEDORES)
  if (ruta === '/compras/por-pagar/p1') return Promise.resolve(DETALLE_P1)
  if (ruta === '/compras/por-pagar/p2') return Promise.resolve(DETALLE_P2)
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

  // Auditoría UX 06.21: la fila abre el detalle solo con clic; sin un control
  // dentro, el teclado y el lector de pantalla no llegan a ningún proveedor.
  it('el nombre del proveedor es un botón: Enter lo elige', async () => {
    await montar()
    const boton = document.body.querySelector<HTMLButtonElement>('[data-qa="por-pagar-proveedor-p1"]')
    expect(boton).toBeTruthy()
    expect(boton!.tagName).toBe('BUTTON')
    boton!.click()
    await new Promise(r => setTimeout(r, 20))
    expect(document.body.querySelector('[data-qa="por-pagar-detalle"]')!.textContent).toContain('Don Pedro')
  })

  it('sin proveedores con deuda ni saldo, no hay nada que seleccionar', async () => {
    document.body.innerHTML = ''
    await montar()
    expect(document.body.querySelector('[data-qa="por-pagar-detalle"]')).toBeNull()
  })
  // Auditoría UX 06.22: la acción principal no se veía hasta tocar una fila.
  it('06.22: el título dice que se toca un proveedor para ver sus compras y pagar', async () => {
    await montar()
    expect(document.body.querySelector('[data-qa="por-pagar"]')!.textContent).toContain('Toca un proveedor para ver sus compras y pagar')
  })

  // 06.19: "FacturaAUDIT-001" sin espacio entre el tipo y el folio.
  it('06.19: el documento se lee "Factura 10", con espacio', async () => {
    const wrapper = await montar()
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const tabla = document.body.querySelector('[data-qa="por-pagar-compras"]')!.textContent!
    expect(tabla).toContain('Factura 10')
  })

  // 06.7 + 06.6: la tabla lista TODOS los pagos vigentes, no solo los que dejan saldo a favor.
  it('06.7: la tabla de pagos se llama "Pagos vigentes" y su vacío no dice que no hay pagos hechos', async () => {
    const wrapper = await montar()
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const detalle = document.body.querySelector('[data-qa="por-pagar-detalle"]')!.textContent!
    expect(detalle).toContain('Pagos vigentes')
    expect(detalle).toContain('No hay pagos vigentes.')
    expect(detalle).not.toContain('Sin pagos registrados')
  })

  it('06.6: un pago sin saldo a favor se puede anular desde su fila, y el modal dice qué pasa', async () => {
    const wrapper = await montar()
    await wrapper.findAll('tbody tr')[1]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const boton = document.body.querySelector<HTMLButtonElement>('[data-qa="por-pagar-anular-pago-9"]')!
    expect(boton).toBeTruthy()
    boton.click()
    await new Promise(r => setTimeout(r, 30))
    expect(document.body.querySelector('[data-qa="anular-pago-efecto-deuda"]')!.textContent).toContain('1 compra vuelve a deber $88.000')
  })

  // 06.18: sin deuda, el panel queda en "Al día" y "Pagar" no ofrece pagar lo que no se debe.
  it('06.18: un proveedor sin compras abiertas queda "Al día" y "Pagar" está apagado', async () => {
    const wrapper = await montar()
    await wrapper.findAll('tbody tr')[1]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const detalle = document.body.querySelector('[data-qa="por-pagar-detalle"]')!
    expect(detalle.textContent).toContain('Al día')
    const pagar = document.body.querySelector<HTMLButtonElement>('[data-qa="por-pagar-pagar-abrir"]')!
    expect(pagar.disabled).toBe(true)
  })

  it('06.18: con compras abiertas, "Pagar" sigue activo', async () => {
    const wrapper = await montar()
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const pagar = document.body.querySelector<HTMLButtonElement>('[data-qa="por-pagar-pagar-abrir"]')!
    expect(pagar.disabled).toBe(false)
  })
})
