// @vitest-environment nuxt
//
// Compras, pieza 1 — la carga del borrador (spec
// `docs/superpowers/specs/2026-09-18-compras-recepcion-design.md` § 6). Lo que
// este spec fija:
//   1. El total de la línea se muestra al lado, para comparar con el papel.
//   2. El descuento al total está deshabilitado y dice por qué.
//   3. "Sin documento" oculta el folio.
//   4. "Guardar borrador" manda un body que el DTO del backend acepta:
//      cantidad como string, precio `null` cuando falta, y sin `tenantId`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import CompraCarga from './[id].vue'

const FACTURA = { id: 'tipo-33', nombre: 'Factura', codigo: '33', requiereFolio: true }
const SIN_DOC = { id: 'tipo-sin', nombre: 'Sin documento', codigo: null, requiereFolio: false }
const PROVEEDOR = { id: 'prov-1', nombre: 'Distribuidora X', rut: null }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega', tipo: 'bodega', activo: true }
const HARINA = { id: 'item-harina', nombre: 'Harina', modoInventario: 'cantidad', unidadMedida: 'kg' }

let enviados: { method?: string, body?: Record<string, unknown> }[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ params: { id: 'nueva' }, query: {} })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (opts?.method === 'POST' && url.endsWith('/compras')) {
      enviados.push({ method: opts.method, body: opts.body })
      return Promise.resolve({
        id: 'compra-1', estado: 'borrador', faltaCosto: false, fechaDocumento: '2026-09-15',
        proveedorId: PROVEEDOR.id, proveedorNombre: PROVEEDOR.nombre,
        tipoDocumentoCompraId: FACTURA.id, tipoDocumentoNombre: 'Factura', folio: '4521',
        ubicacionId: BODEGA.id, ubicacionNombre: BODEGA.nombre, observacion: null,
        descuentoTotal: null, total: null, lineas: [],
      })
    }
    if (url.includes('/compras/tipos-documento')) return Promise.resolve([FACTURA, SIN_DOC])
    if (url.includes('/compras/proveedores')) return Promise.resolve([PROVEEDOR])
    if (url.includes('/ubicaciones')) return Promise.resolve([BODEGA])
    if (url.includes('/items?tipo=producto')) {
      return Promise.resolve({ data: [HARINA], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
    }
    if (url.includes('/items?tipo=ingrediente')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } })
    }
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

/** El `MoneyInput` del precio de la PRIMERA línea (el del descuento está deshabilitado). */
function precioInput(wrapper: Wrapper) {
  const money = wrapper.findAllComponents({ name: 'MoneyInput' }).find(m => !m.props('disabled'))
  expect(money, 'MoneyInput del precio').toBeTruthy()
  return money!
}

describe('compras/[id] — carga del borrador', () => {
  beforeEach(() => {
    enviados = []
  })

  it('muestra el total de la línea al lado, para comparar con el papel', async () => {
    const wrapper = await montar()
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20.35')
    await emitir(precioInput(wrapper), '1490')

    // 20,35 × 1.490 = 30.321,5, que en pesos se muestra 30.322 (lo que dice la factura).
    expect(wrapper.find('[data-qa="compra-total-linea"]').text()).toContain('30.322')
    wrapper.unmount()
  })

  it('el descuento al total está deshabilitado y dice por qué', async () => {
    const wrapper = await montar()
    const descuento = wrapper.findAllComponents({ name: 'MoneyInput' }).find(m => m.props('disabled'))
    expect(descuento).toBeTruthy()
    expect(wrapper.find('[data-qa="compra-descuento-ayuda"]').text())
      .toContain('Se carga cuando todas las líneas tienen precio')
    wrapper.unmount()
  })

  it('"Sin documento" oculta el folio', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    expect(wrapper.find('[data-qa="compra-folio"]').exists()).toBe(true)

    await emitir(selectConOpcion(wrapper, SIN_DOC.id), SIN_DOC.id)
    expect(wrapper.find('[data-qa="compra-folio"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('guardar manda un body que el DTO acepta: strings, precio null si falta y sin tenantId', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR.id), PROVEEDOR.id)
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    await wrapper.find('input[data-qa="compra-folio"]').setValue('4521')
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectConOpcion(wrapper, HARINA.id), HARINA.id)
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(1)
    const body = enviados[0]!.body!
    expect(body).not.toHaveProperty('tenantId')
    expect(body.folio).toBe('4521')
    expect(body.proveedorId).toBe(PROVEEDOR.id)
    expect(body.ubicacionId).toBe(BODEGA.id)
    expect(body.lineas).toEqual([
      { itemId: HARINA.id, cantidad: '20', unidadCodigo: 'kg', precioUnitario: null },
    ])
    wrapper.unmount()
  })
})
