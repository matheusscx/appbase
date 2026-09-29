// @vitest-environment nuxt
//
// Compras — la compra al contado en un solo gesto (spec
// `docs/superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md` § 7 y
// § 10, tarea 4). Lo que este spec fija:
//   1. El XML precarga "Total del documento" (`MntTotal`) y "Vence el"
//      (`FchVenc`), y `FmaPago = 1` (contado) propone "Sí, la pagué".
//   2. "¿La pagaste ya?" solo aparece con `Compras:Pagar`.
//   3. Con "Sí, la pagué", `POST /compras/:id/confirmar` manda `{ pago }` con
//      la `Idempotency-Key` de `useIntentoCobro`; sin ella, no manda `pago`
//      ni la cabecera.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import type { DocumentoDte, LecturaDteRespuesta } from '~/composables/useDte'
import { leerDte } from '~/composables/useDte'
import CompraCarga from './[id].vue'

const FACTURA = { id: 'tipo-33', nombre: 'Factura', codigo: '33', requiereFolio: true, totalDocumento: 'obligatorio' }
const PROVEEDOR = { id: 'prov-1', nombre: 'Distribuidora Andina Ltda', rut: null, plazoPagoDias: null }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega', tipo: 'bodega', activo: true }
const CAFE = { id: 'item-cafe', nombre: 'Café en grano', modoInventario: 'cantidad', unidadMedida: 'unidad' }
const COCA = { id: 'item-coca', nombre: 'Coca-Cola 350ml CJ12', modoInventario: 'cantidad', unidadMedida: 'unidad' }
const EFECTIVO = { id: 'medio-efectivo', nombre: 'Efectivo', esEfectivo: true }
const TARJETA = { id: 'medio-tarjeta', nombre: 'Tarjeta', esEfectivo: false }

let permisos = new Set(['Compras:Leer', 'Compras:Crear', 'Compras:Pagar'])
let enviados: { url: string, method?: string, body?: unknown, headers?: Record<string, string> }[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({ get esAdmin() { return false }, can: (m: string, a: string) => permisos.has(`${m}:${a}`) })
})
mockNuxtImport('useRoute', () => () => ({ params: { id: 'nueva' }, query: {} }))
mockNuxtImport('useToast', () => () => ({ add: () => {} }))
mockNuxtImport('onBeforeRouteLeave', () => () => {})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown, headers?: Record<string, string> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (opts?.method === 'POST' && url.endsWith('/compras')) {
      return Promise.resolve({
        id: 'compra-1', estado: 'borrador', faltaCosto: false, fechaDocumento: '2026-10-01',
        proveedorId: PROVEEDOR.id, proveedorNombre: PROVEEDOR.nombre,
        tipoDocumentoCompraId: FACTURA.id, tipoDocumentoNombre: 'Factura', folio: '6',
        ubicacionId: BODEGA.id, ubicacionNombre: BODEGA.nombre, observacion: null,
        descuentoTotal: null, total: null, totalDocumento: null, fechaVencimiento: null, lineas: [],
      })
    }
    if (opts?.method === 'POST' && url.endsWith('/confirmar')) {
      enviados.push({ url: url.split('/api').pop()!, method: opts.method, body: opts.body, headers: opts.headers })
      return Promise.resolve({
        id: 'compra-1', estado: 'confirmada', faltaCosto: false, fechaDocumento: '2026-10-01',
        proveedorId: PROVEEDOR.id, proveedorNombre: PROVEEDOR.nombre,
        tipoDocumentoCompraId: FACTURA.id, tipoDocumentoNombre: 'Factura', folio: '6',
        ubicacionId: BODEGA.id, ubicacionNombre: BODEGA.nombre, observacion: null,
        descuentoTotal: null, total: null, totalDocumento: null, fechaVencimiento: null, lineas: [],
      })
    }
    if (url.includes('/compras/medios-pago')) return Promise.resolve([EFECTIVO, TARJETA])
    if (url.includes('/compras/presentaciones')) return Promise.resolve([])
    if (url.includes('/compras/tipos-documento')) return Promise.resolve([FACTURA])
    if (url.includes('/compras/proveedores')) return Promise.resolve([PROVEEDOR])
    if (url.includes('/ubicaciones')) return Promise.resolve([BODEGA])
    if (url.includes('/compras/productos')) return Promise.resolve([CAFE, COCA])
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve([])
    return Promise.resolve([])
  }
})

const FIXTURES_DTE = join(__dirname, '../../composables/__fixtures__/dte')
function documento(nombre: string): DocumentoDte {
  const buf = readFileSync(join(FIXTURES_DTE, nombre))
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const resultado = leerDte(bytes)
  if (!resultado.ok) throw new Error(`fixture inválido: ${resultado.error}`)
  return resultado.documentos[0]!
}
/** Cada fixture asocia su única línea a un producto del catálogo, para que
 *  `puedeGuardar` no la vea "por asociar" (spec § 6) y el botón Confirmar
 *  quede habilitado. */
const CLAVE_POR_FIXTURE: Record<string, { clave: string, itemId: string }> = {
  'contado-fma-pago-1.xml': { clave: 'CODIGO:INT1:CAF-250', itemId: CAFE.id },
  'credito-fchvenc.xml': { clave: 'CODIGO:INT1:CC350-12', itemId: COCA.id },
}
function lectura(nombreFixture: string): LecturaDteRespuesta {
  const asociacion = CLAVE_POR_FIXTURE[nombreFixture]!
  return {
    receptorEsDelTenant: true,
    proveedor: { id: PROVEEDOR.id, nombre: PROVEEDOR.nombre },
    candidatos: [],
    tipoDocumento: { id: FACTURA.id, nombre: FACTURA.nombre },
    compraExistente: null,
    asociaciones: [{ clave: asociacion.clave, destino: { itemId: asociacion.itemId, unidadCodigo: 'unidad' } }],
  }
}

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

async function cargarXml(wrapper: Wrapper, nombreFixture: string) {
  const doc = documento(nombreFixture)
  const modal = wrapper.findComponent({ name: 'ComprasCargarDteModal' })
  expect(modal.exists(), 'ComprasCargarDteModal').toBe(true)
  modal.vm.$emit('cargar', { documento: doc, lectura: lectura(nombreFixture), proveedorId: PROVEEDOR.id, rutProveedor: null })
  await new Promise(r => setTimeout(r, 20))
}

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

/** Carga el XML y elige la ubicación (spec § 7): lo mínimo para que
 *  `puedeConfirmar` habilite el botón "Confirmar recepción". */
async function prepararParaConfirmar(wrapper: Wrapper, nombreFixture: string) {
  await cargarXml(wrapper, nombreFixture)
  await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
}

async function abrirConfirmar(wrapper: Wrapper) {
  const boton = wrapper.find('[data-qa="compra-confirmar"]')
  expect((boton.element as HTMLButtonElement).disabled, 'compra-confirmar habilitado').toBe(false)
  await boton.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

beforeEach(() => {
  permisos = new Set(['Compras:Leer', 'Compras:Crear', 'Compras:Pagar'])
  enviados = []
})

describe('compras/[id] — el XML precarga total, vencimiento y la forma de pago (spec § 7 y § 10)', () => {
  it('MntTotal y FchVenc precargan "Total del documento" y "Vence el"', async () => {
    const wrapper = await montar()
    await cargarXml(wrapper, 'credito-fchvenc.xml')
    expect((document.body.querySelector('input[data-qa="compra-vencimiento"]') as HTMLInputElement).value)
      .toBe('2026-10-16')
    const totalInput = wrapper.find('[data-qa="compra-total-documento-campo"]').findComponent({ name: 'MoneyInput' })
    expect(totalInput.props('modelValue')).toBe('119000')
    wrapper.unmount()
  })

  it('sin FchVenc en el XML, "Vence el" lo sugiere el plazo del proveedor (no queda vacío)', async () => {
    const wrapper = await montar()
    await cargarXml(wrapper, 'contado-fma-pago-1.xml')
    await new Promise(r => setTimeout(r, 20))
    const valor = (document.body.querySelector('input[data-qa="compra-vencimiento"]') as HTMLInputElement).value
    expect(valor).not.toBe('')
    wrapper.unmount()
  })
})

describe('compras/[id] — "¿La pagaste ya?" (spec § 7, § 10 y decisión 7/12)', () => {
  it('sin Compras:Pagar, la sección no aparece y confirmar no manda pago', async () => {
    permisos = new Set(['Compras:Leer', 'Compras:Crear'])
    const wrapper = await montar()
    await prepararParaConfirmar(wrapper, 'credito-fchvenc.xml')
    await abrirConfirmar(wrapper)
    expect(document.body.querySelector('[data-qa="compra-pago-seccion"]')).toBeNull()

    ;(document.body.querySelector('[data-qa="compra-confirmar-si"]') as HTMLButtonElement).click()
    await new Promise(r => setTimeout(r, 20))
    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.body).toEqual({})
    expect(enviados[0]!.headers).toBeUndefined()
    wrapper.unmount()
  })

  it('con Pagar, "No" por defecto (crédito, sin FmaPago 1): confirmar sin pago y sin Idempotency-Key', async () => {
    const wrapper = await montar()
    await prepararParaConfirmar(wrapper, 'credito-fchvenc.xml')
    await abrirConfirmar(wrapper)
    expect(document.body.querySelector('[data-qa="compra-pago-seccion"]')).not.toBeNull()
    expect(document.body.querySelector('[data-qa="compra-pago-medio"]')).toBeNull()

    ;(document.body.querySelector('[data-qa="compra-confirmar-si"]') as HTMLButtonElement).click()
    await new Promise(r => setTimeout(r, 20))
    expect(enviados[0]!.body).toEqual({})
    expect(enviados[0]!.headers).toBeUndefined()
    wrapper.unmount()
  })

  it('FmaPago = 1 (contado) propone "Sí, la pagué" al abrir el modal de confirmar', async () => {
    const wrapper = await montar()
    await prepararParaConfirmar(wrapper, 'contado-fma-pago-1.xml')
    await abrirConfirmar(wrapper)
    // Con "Sí" preseleccionado, el medio de pago ya se muestra.
    expect(document.body.querySelector('[data-qa="compra-pago-medio"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('FmaPago = 2 (crédito) NO propone "Sí, la pagué"', async () => {
    const wrapper = await montar()
    await prepararParaConfirmar(wrapper, 'credito-fchvenc.xml')
    await abrirConfirmar(wrapper)
    expect(document.body.querySelector('[data-qa="compra-pago-medio"]')).toBeNull()
    wrapper.unmount()
  })

  it('"Sí, la pagué": el monto se propone en el total, y confirmar manda { pago } con Idempotency-Key', async () => {
    const wrapper = await montar()
    await prepararParaConfirmar(wrapper, 'credito-fchvenc.xml')
    await abrirConfirmar(wrapper)

    // Radio "Sí, la pagué".
    wrapper.findComponent({ name: 'URadioGroup' }).vm.$emit('update:modelValue', true)
    await new Promise(r => setTimeout(r, 20))

    expect(document.body.querySelector('[data-qa="compra-pago-medio"]')).not.toBeNull()
    // El monto propuesto es el total (§ 4.1): el transcrito del XML —
    // `MoneyInput` lo muestra formateado ("119.000"), no en el string crudo
    // que viaja al backend (eso lo cubre el body más abajo).
    const montoInput = document.body.querySelector('input[data-qa="compra-pago-monto"]') as HTMLInputElement
    expect(montoInput, 'input compra-pago-monto').toBeTruthy()
    expect(montoInput.value).toBe('119.000')

    ;(document.body.querySelector('[data-qa="compra-confirmar-si"]') as HTMLButtonElement).click()
    await new Promise(r => setTimeout(r, 30))

    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.body).toEqual({
      pago: { monto: '119000', metodoPagoId: EFECTIVO.id },
    })
    expect(enviados[0]!.headers).toHaveProperty('Idempotency-Key')
    wrapper.unmount()
  })

  it('el medio de pago en efectivo muestra el aviso de la caja abierta', async () => {
    const wrapper = await montar()
    await prepararParaConfirmar(wrapper, 'contado-fma-pago-1.xml')
    await abrirConfirmar(wrapper)
    // FmaPago 1 ya propone "Sí" con el primer medio (Efectivo).
    expect(document.body.querySelector('[data-qa="compra-pago-aviso-efectivo"]')).not.toBeNull()
    wrapper.unmount()
  })
})
