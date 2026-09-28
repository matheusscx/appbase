// @vitest-environment nuxt
//
// Compras — la deuda con el proveedor (spec
// `docs/superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md` § 3,
// § 4.2 y § 10, Ruling 1 de la tarea 1). Lo que este spec fija, de la parte
// del formulario del borrador que entra en esta tarea:
//   1. "Total del documento" se muestra requerido en un tipo obligatorio,
//      opcional en uno `opcional`, y oculto en uno `suma_lineas`.
//   2. "Vence el" se sugiere sola desde el plazo del proveedor + la fecha del
//      documento, y queda editable.
//   3. El body de guardar manda `totalDocumento`/`fechaVencimiento` tal cual
//      building lo arma `useCompras.ts → cuerpoDocumento`, nunca desde el `.vue`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import CompraCarga from './[id].vue'

const FACTURA = { id: 'tipo-33', nombre: 'Factura', codigo: '33', requiereFolio: true, totalDocumento: 'obligatorio' }
const GUIA = { id: 'tipo-52', nombre: 'Guía de despacho', codigo: '52', requiereFolio: true, totalDocumento: 'opcional' }
const SIN_DOC = { id: 'tipo-sin', nombre: 'Sin documento', codigo: null, requiereFolio: false, totalDocumento: 'suma_lineas' }
const PROVEEDOR_CON_PLAZO = { id: 'prov-1', nombre: 'Andina', rut: null, plazoPagoDias: 15 }
const PROVEEDOR_SIN_PLAZO = { id: 'prov-2', nombre: 'Don Pedro', rut: null, plazoPagoDias: null }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega', tipo: 'bodega', activo: true }
const HARINA = { id: 'item-harina', nombre: 'Harina', modoInventario: 'cantidad', unidadMedida: 'kg' }

let enviados: { method?: string, url?: string, body?: Record<string, unknown> }[] = []
const routeId = 'nueva'

mockNuxtImport('usePermissionsStore', () => {
  return () => ({ get esAdmin() { return true }, can: () => true })
})
mockNuxtImport('useRoute', () => {
  return () => ({ params: { id: routeId }, query: {} })
})
mockNuxtImport('useToast', () => {
  return () => ({ add: () => {} })
})
mockNuxtImport('onBeforeRouteLeave', () => {
  return () => {}
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (opts?.method === 'POST' && url.endsWith('/compras')) {
      enviados.push({ method: opts.method, body: opts.body })
      return Promise.resolve({
        id: 'compra-1', estado: 'borrador', faltaCosto: false, fechaDocumento: '2026-10-01',
        proveedorId: PROVEEDOR_CON_PLAZO.id, proveedorNombre: PROVEEDOR_CON_PLAZO.nombre,
        tipoDocumentoCompraId: FACTURA.id, tipoDocumentoNombre: 'Factura', folio: '4521',
        ubicacionId: BODEGA.id, ubicacionNombre: BODEGA.nombre, observacion: null,
        descuentoTotal: null, total: null, totalDocumento: null, fechaVencimiento: null, lineas: [],
      })
    }
    if (url.includes('/compras/presentaciones')) return Promise.resolve([])
    if (url.includes('/compras/tipos-documento')) return Promise.resolve([FACTURA, GUIA, SIN_DOC])
    if (url.includes('/compras/proveedores')) return Promise.resolve([PROVEEDOR_CON_PLAZO, PROVEEDOR_SIN_PLAZO])
    if (url.includes('/ubicaciones')) return Promise.resolve([BODEGA])
    if (url.includes('/compras/productos')) return Promise.resolve([HARINA])
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve([])
    return Promise.resolve([])
  }
})

async function montar() {
  useMonedasStore().hydrate([{
    monedaId: 'clp-1', nombre: 'Peso Chileno', codigoIso: 'CLP', simbolo: '$', decimales: 0,
    separadorDecimal: ',', separadorMiles: '.', locale: 'es-CL', habilitada: true,
    esOficial: true, valorDelDia: null,
  }], 'tenant-1')
  const wrapper = await mountSuspended(CompraCarga, { attachTo: document.body })
  await new Promise(r => setTimeout(r, 50))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

function selectConOpcion(wrapper: Wrapper, valor: string) {
  const select = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    return Array.isArray(items) && items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}"`).toBeTruthy()
  return select!
}

async function emitir(comp: { vm: { $emit: (e: string, v: string) => void } }, valor: string) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 0))
}

function totalDocumentoInput(wrapper: Wrapper) {
  const campo = wrapper.find('[data-qa="compra-total-documento-campo"]')
  if (!campo.exists()) return undefined
  return campo.findComponent({ name: 'MoneyInput' })
}

describe('compras/[id] — el total del documento y el vencimiento (spec compras-deuda-proveedor)', () => {
  beforeEach(() => {
    enviados = []
  })

  it('un tipo obligatorio (Factura) muestra "Total del documento" como requerido', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    expect(wrapper.find('[data-qa="compra-total-documento-campo"]').exists()).toBe(true)
    expect(totalDocumentoInput(wrapper)?.exists()).toBe(true)
    wrapper.unmount()
  })

  it('un tipo opcional (Guía de despacho) muestra "Total del documento", sin ser requerido', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, GUIA.id), GUIA.id)
    expect(wrapper.find('[data-qa="compra-total-documento-campo"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('un tipo suma_lineas (Sin documento) OCULTA "Total del documento"', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, SIN_DOC.id), SIN_DOC.id)
    expect(wrapper.find('[data-qa="compra-total-documento-campo"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('"Vence el" se sugiere con el plazo del proveedor + la fecha del documento', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR_CON_PLAZO.id), PROVEEDOR_CON_PLAZO.id)
    await wrapper.find('input[data-qa="compra-vencimiento"]').setValue('')
    const fecha = wrapper.find('input[type="date"]:not([data-qa="compra-vencimiento"])')
    await fecha.setValue('2026-10-01')
    await new Promise(r => setTimeout(r, 10))
    expect((wrapper.find('input[data-qa="compra-vencimiento"]').element as HTMLInputElement).value)
      .toBe('2026-10-16')
    wrapper.unmount()
  })

  it('"Vence el" usa 30 días cuando el proveedor no tiene plazo cargado', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR_SIN_PLAZO.id), PROVEEDOR_SIN_PLAZO.id)
    const fecha = wrapper.find('input[type="date"]:not([data-qa="compra-vencimiento"])')
    await fecha.setValue('2026-10-01')
    await new Promise(r => setTimeout(r, 10))
    expect((wrapper.find('input[data-qa="compra-vencimiento"]').element as HTMLInputElement).value)
      .toBe('2026-10-31')
    wrapper.unmount()
  })

  it('editar "Vence el" a mano sobrevive: no se pisa con la sugerencia', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR_CON_PLAZO.id), PROVEEDOR_CON_PLAZO.id)
    const fecha = wrapper.find('input[type="date"]:not([data-qa="compra-vencimiento"])')
    await fecha.setValue('2026-10-01')
    await new Promise(r => setTimeout(r, 10))
    await wrapper.find('input[data-qa="compra-vencimiento"]').setValue('2026-12-25')
    await new Promise(r => setTimeout(r, 10))
    expect((wrapper.find('input[data-qa="compra-vencimiento"]').element as HTMLInputElement).value)
      .toBe('2026-12-25')
    wrapper.unmount()
  })

  it('guardar manda totalDocumento y fechaVencimiento tal cual el DTO los acepta (forbidNonWhitelisted)', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR_CON_PLAZO.id), PROVEEDOR_CON_PLAZO.id)
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    await wrapper.find('input[data-qa="compra-folio"]').setValue('4521')
    const fecha = wrapper.find('input[type="date"]:not([data-qa="compra-vencimiento"])')
    await fecha.setValue('2026-10-01')
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectConOpcion(wrapper, HARINA.id), HARINA.id)
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20')
    await new Promise(r => setTimeout(r, 10))
    await emitir(totalDocumentoInput(wrapper)!, '500000')
    await wrapper.find('input[data-qa="compra-vencimiento"]').setValue('2026-11-15')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(1)
    const body = enviados[0]!.body!
    expect(body.totalDocumento).toBe('500000')
    expect(body.fechaVencimiento).toBe('2026-11-15')
    // Nada de más: el DTO real tiene `forbidNonWhitelisted`, así que un campo
    // que no declara es 400 — acá se comprueba que no viajen claves espurias.
    expect(Object.keys(body).sort()).toEqual([
      'descuentoTotal', 'fechaDocumento', 'fechaVencimiento', 'folio', 'lineas',
      'observacion', 'proveedorId', 'tipoDocumentoCompraId', 'totalDocumento', 'ubicacionId',
    ])
    wrapper.unmount()
  })

  it('un tipo suma_lineas nunca manda totalDocumento (se limpia solo al cambiar de tipo)', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR_CON_PLAZO.id), PROVEEDOR_CON_PLAZO.id)
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    await new Promise(r => setTimeout(r, 10))
    await emitir(totalDocumentoInput(wrapper)!, '500000')

    await emitir(selectConOpcion(wrapper, SIN_DOC.id), SIN_DOC.id)
    const fecha = wrapper.find('input[type="date"]:not([data-qa="compra-vencimiento"])')
    await fecha.setValue('2026-10-01')
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectConOpcion(wrapper, HARINA.id), HARINA.id)
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20')
    await new Promise(r => setTimeout(r, 10))

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.body!.totalDocumento).toBeNull()
    wrapper.unmount()
  })
})
