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
const PROVEEDOR2 = { id: 'prov-2', nombre: 'Distribuidora Y', rut: null }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega', tipo: 'bodega', activo: true }
const HARINA = { id: 'item-harina', nombre: 'Harina', modoInventario: 'cantidad', unidadMedida: 'kg' }
const LATAS = { id: 'item-latas', nombre: 'Coca-Cola lata', modoInventario: 'cantidad', unidadMedida: 'unidad' }
const BOTELLA_SERIE = { id: 'item-botella', nombre: 'Botella premium', modoInventario: 'serie', unidadMedida: 'unidad' }
const CAJA = { id: 'pres-caja', itemId: LATAS.id, nombre: 'Caja', contenido: '12.0000', unidadCodigo: 'unidad' }
const UNIDADES_CATALOGO = [
  { unidadMedidaId: 'u1', codigo: 'unidad', nombre: 'Unidad', magnitud: 'conteo', factorBase: '1' },
  { unidadMedidaId: 'u2', codigo: 'kg', nombre: 'Kilogramo', magnitud: 'peso', factorBase: '1000' },
  { unidadMedidaId: 'u3', codigo: 'g', nombre: 'Gramo', magnitud: 'peso', factorBase: '1' },
]

let enviados: { method?: string, body?: Record<string, unknown> }[] = []
let avisos: { title: string, color?: string }[] = []
/** `'nueva'` (default) o el id de un borrador existente, para el caso del § 8. */
let routeId = 'nueva'

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ params: { id: routeId }, query: {} })
})

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title: string, color?: string }) => avisos.push(t) })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (opts?.method === 'POST' && url.endsWith('/confirmar')) {
      enviados.push({ method: `POST ${url.split('/api').pop()}` })
      return Promise.resolve({
        id: 'compra-1', estado: 'confirmada', faltaCosto: true, fechaDocumento: '2026-09-15',
        proveedorId: PROVEEDOR.id, proveedorNombre: PROVEEDOR.nombre,
        tipoDocumentoCompraId: FACTURA.id, tipoDocumentoNombre: 'Factura', folio: '4521',
        ubicacionId: BODEGA.id, ubicacionNombre: BODEGA.nombre, observacion: null,
        descuentoTotal: null, total: null, lineas: [],
      })
    }
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
    if (url.includes('/compras/presentaciones')) {
      return Promise.resolve(url.includes(`proveedorId=${PROVEEDOR.id}`) ? [CAJA] : [])
    }
    if (url.includes('/compras/tipos-documento')) return Promise.resolve([FACTURA, SIN_DOC])
    if (url.includes('/compras/proveedores')) return Promise.resolve([PROVEEDOR, PROVEEDOR2])
    if (url.includes('/ubicaciones')) return Promise.resolve([BODEGA])
    // La lista de Compras, no `/items`: el encargado no tiene permiso de Ítems.
    if (url.includes('/compras/productos')) return Promise.resolve([HARINA, LATAS, BOTELLA_SERIE])
    if (url.includes('/items')) throw new Error('la carga de compras no debe pedir /items')
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve(UNIDADES_CATALOGO)
    // Un borrador existente (§ 8, caso "presentación retirada"): la línea llega
    // sin unidad ni presentación.
    if (url.includes(`/compras/${routeId}`) && routeId !== 'nueva') {
      return Promise.resolve({
        id: routeId, estado: 'borrador', faltaCosto: false, fechaDocumento: '2026-09-15',
        proveedorId: PROVEEDOR.id, proveedorNombre: PROVEEDOR.nombre,
        tipoDocumentoCompraId: FACTURA.id, tipoDocumentoNombre: 'Factura', folio: '4521',
        ubicacionId: BODEGA.id, ubicacionNombre: BODEGA.nombre, observacion: null,
        descuentoTotal: null, total: null,
        lineas: [{
          id: 'l1', orden: 0, itemId: LATAS.id, itemNombre: LATAS.nombre, modoInventario: 'cantidad',
          unidadMedidaBase: 'unidad', cantidad: '10', unidadCodigo: null, precioUnitario: '9600',
          series: null, lote: null, presentacion: null,
        }],
        cambios: [],
      })
    }
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

/** El `MoneyInput` del descuento: el último, porque el pie va debajo de las líneas. */
function descuentoInput(wrapper: Wrapper) {
  const money = wrapper.findAllComponents({ name: 'MoneyInput' }).at(-1)
  expect(money, 'MoneyInput del descuento').toBeTruthy()
  return money!
}

describe('compras/[id] — carga del borrador', () => {
  beforeEach(() => {
    enviados = []
    avisos = []
    routeId = 'nueva'
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

  it('con todos los precios el descuento se habilita, resta en el total y viaja en el body', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR.id), PROVEEDOR.id)
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    await wrapper.find('input[data-qa="compra-folio"]').setValue('4521')
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectConOpcion(wrapper, HARINA.id), HARINA.id)
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20')
    await emitir(precioInput(wrapper), '1000')

    const descuento = descuentoInput(wrapper)
    expect(descuento.props('disabled')).toBe(false)
    expect(wrapper.find('[data-qa="compra-descuento-ayuda"]').exists()).toBe(false)
    await emitir(descuento, '2000')
    // 20 × $1.000 − $2.000
    expect(wrapper.find('[data-qa="compra-total"]').text()).toContain('18.000')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))
    expect(enviados[0]!.body!.descuentoTotal).toBe('2000')
    wrapper.unmount()
  })

  it('si se borra un precio, el descuento se vacía y no viaja', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR.id), PROVEEDOR.id)
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    await wrapper.find('input[data-qa="compra-folio"]').setValue('4521')
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectConOpcion(wrapper, HARINA.id), HARINA.id)
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20')
    const precio = precioInput(wrapper)
    await emitir(precio, '1000')
    await emitir(descuentoInput(wrapper), '2000')

    await emitir(precio, '')
    expect(descuentoInput(wrapper).props('disabled')).toBe(true)
    expect(wrapper.find('[data-qa="compra-descuento-ayuda"]').exists()).toBe(true)

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))
    expect(enviados[0]!.body!.descuentoTotal).toBeNull()
    wrapper.unmount()
  })

  it('confirmar muestra el resumen, guarda lo que está en pantalla y después confirma', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR.id), PROVEEDOR.id)
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    await wrapper.find('input[data-qa="compra-folio"]').setValue('4521')
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await emitir(selectConOpcion(wrapper, HARINA.id), HARINA.id)
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('20')

    await wrapper.find('[data-qa="compra-confirmar"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    // El modal lo teletransporta UModal fuera del wrapper.
    const resumen = document.body.querySelector('[data-qa="compra-confirmar-resumen"]')
    expect(resumen?.textContent).toContain('Entran 1 línea a')
    expect(resumen?.textContent).toContain('Bodega')
    expect(resumen?.textContent).toContain('1 línea entra sin precio')
    // Nada se mandó todavía: el modal frena.
    expect(enviados).toHaveLength(0)

    ;(document.body.querySelector('[data-qa="compra-confirmar-si"]') as HTMLButtonElement).click()
    await new Promise(r => setTimeout(r, 30))

    // Primero se guarda lo que está en pantalla, después se confirma esa compra.
    expect(enviados.map(e => e.method)).toEqual(['POST', 'POST /compras/compra-1/confirmar'])
    wrapper.unmount()
  })
})

/** El `USelect` de unidad de la línea `index` (0-based: solo hay uno por línea). */
function unidadSelect(wrapper: Wrapper, index = 0) {
  const selects = wrapper.findAllComponents({ name: 'USelect' })
  expect(selects.length, 'USelect de unidad').toBeGreaterThan(index)
  return selects[index]!
}

async function elegirProveedorYProducto(wrapper: Wrapper, proveedorId: string, itemId: string) {
  await emitir(selectConOpcion(wrapper, proveedorId), proveedorId)
  // `presentaciones` se piden por `watch(proveedorId)`: darle una vuelta al loop.
  await new Promise(r => setTimeout(r, 20))
  await emitir(selectConOpcion(wrapper, itemId), itemId)
}

describe('compras/[id] — la unidad de compra por proveedor (pieza 2 § 6)', () => {
  beforeEach(() => {
    enviados = []
    avisos = []
    routeId = 'nueva'
  })

  it('con proveedor y producto elegidos, el selector de unidad ofrece unidad y Caja (12)', async () => {
    const wrapper = await montar()
    await elegirProveedorYProducto(wrapper, PROVEEDOR.id, LATAS.id)

    const items = (unidadSelect(wrapper).props('items') ?? []) as { label: string, value: string }[]
    expect(items.map(i => i.value)).toContain('u:unidad')
    expect(items).toContainEqual({ label: 'Caja (12)', value: 'p:pres-caja' })
    wrapper.unmount()
  })

  it('elegida la caja, con cantidad 10 y precio 9600, la línea muestra la cuenta en unidad base', async () => {
    const wrapper = await montar()
    await elegirProveedorYProducto(wrapper, PROVEEDOR.id, LATAS.id)
    await emitir(unidadSelect(wrapper), 'p:pres-caja')
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('10')
    await emitir(precioInput(wrapper), '9600')

    expect(wrapper.find('[data-qa="compra-cuenta-presentacion"]').text())
      .toBe('= 120 unidad · $800 c/u')
    wrapper.unmount()
  })

  it('guardar manda la línea con presentacionId y sin la clave unidadCodigo', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, FACTURA.id), FACTURA.id)
    await wrapper.find('input[data-qa="compra-folio"]').setValue('4521')
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await elegirProveedorYProducto(wrapper, PROVEEDOR.id, LATAS.id)
    await emitir(unidadSelect(wrapper), 'p:pres-caja')
    await wrapper.find('input[data-qa="compra-cantidad"]').setValue('10')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(1)
    const linea = enviados[0]!.body!.lineas as Record<string, unknown>[]
    expect(linea).toEqual([
      { itemId: LATAS.id, cantidad: '10', presentacionId: 'pres-caja', precioUnitario: null },
    ])
    wrapper.unmount()
  })

  it('cambiar de proveedor deja la línea en unidad y avisa cuántas volvieron', async () => {
    const wrapper = await montar()
    await elegirProveedorYProducto(wrapper, PROVEEDOR.id, LATAS.id)
    await emitir(unidadSelect(wrapper), 'p:pres-caja')
    expect(unidadSelect(wrapper).props('modelValue')).toBe('p:pres-caja')

    await emitir(selectConOpcion(wrapper, PROVEEDOR2.id), PROVEEDOR2.id)
    await new Promise(r => setTimeout(r, 20))

    expect(unidadSelect(wrapper).props('modelValue')).toBe('u:unidad')
    expect(avisos.map(a => a.title)).toContain('1 línea volvió a la unidad base')
    wrapper.unmount()
  })

  it('un producto por serie no ofrece "+ Nueva presentación…"', async () => {
    const wrapper = await montar()
    await elegirProveedorYProducto(wrapper, PROVEEDOR.id, BOTELLA_SERIE.id)

    const items = (unidadSelect(wrapper).props('items') ?? []) as { value: string }[]
    expect(items.map(i => i.value)).not.toContain('nueva')
    wrapper.unmount()
  })

  it('un borrador con una presentación retirada muestra la unidad vacía y Guardar deshabilitado', async () => {
    routeId = 'compra-existente-1'
    const wrapper = await montar()

    expect(unidadSelect(wrapper).props('modelValue')).toBe('')
    expect(wrapper.find('[data-qa="compra-guardar"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
