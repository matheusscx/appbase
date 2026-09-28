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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useMonedasStore } from '~/stores/monedas'
import type { DocumentoDte, LecturaDteRespuesta } from '~/composables/useDte'
import { leerDte } from '~/composables/useDte'
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
// Para la escena del XML (andina-33.xml): Coca ya con un producto en el
// catálogo, Fanta todavía sin uno (se asocia a mano en el test).
const COCA = { id: 'item-coca', nombre: 'Coca-Cola 350ml CJ12', modoInventario: 'cantidad', unidadMedida: 'unidad' }
const FANTA = { id: 'item-fanta', nombre: 'Fanta 350ml CJ12', modoInventario: 'cantidad', unidadMedida: 'unidad' }
const PROVEEDOR_ANDINA = { id: 'prov-andina', nombre: 'Distribuidora Andina', rut: '76.543.210-3' }
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

/**
 * El guard de salida (tarea 4 § 6). `mountSuspended` no deja el componente en
 * el registro de la ruta —mismo hueco medido en `salones/index.nuxt.spec.ts`—
 * así que el guard real nunca se engancha y hay que capturarlo para invocarlo
 * a mano.
 */
let capturedGuard: (() => unknown) | null = null
mockNuxtImport('onBeforeRouteLeave', () => {
  return (guard: () => unknown) => { capturedGuard = guard }
})

/** Si el guard de salida llamó a `confirm` (solo debería pasar con
 *  `origenDte` puesto: mutante "no limpiar antes del replace", § 6). */
let confirmLlamado = false
vi.stubGlobal('confirm', () => {
  confirmLlamado = true
  return true
})

let replaceCalls: string[] = []
/**
 * Si el guard de salida, evaluado EN EL INSTANTE del `router.replace` (como
 * haría el router real), tuvo que preguntar con `confirm`. Es lo único que
 * distingue "se limpió `origenDte` antes del replace" de "se limpió después"
 * (mutante b): después de que `guardar()` termina, los dos casos dejan
 * `origenDte` en null igual, así que comprobarlo ahí no discrimina nada.
 */
let confirmDuranteReplace: boolean | null = null

const FIXTURES_DTE = join(__dirname, '../../composables/__fixtures__/dte')
function documentoAndina(): DocumentoDte {
  const buf = readFileSync(join(FIXTURES_DTE, 'andina-33.xml'))
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const resultado = leerDte(bytes)
  if (!resultado.ok) throw new Error(`fixture inválido: ${resultado.error}`)
  return resultado.documentos[0]!
}

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
    if (url.includes('/compras/proveedores')) return Promise.resolve([PROVEEDOR, PROVEEDOR2, PROVEEDOR_ANDINA])
    if (url.includes('/ubicaciones')) return Promise.resolve([BODEGA])
    // La lista de Compras, no `/items`: el encargado no tiene permiso de Ítems.
    if (url.includes('/compras/productos')) return Promise.resolve([HARINA, LATAS, BOTELLA_SERIE, COCA, FANTA])
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

// ── Tarea 4: cargar desde el XML de la factura ──────────────────────────────

function respuestaAndina(): LecturaDteRespuesta {
  return {
    receptorEsDelTenant: true,
    proveedor: { id: PROVEEDOR_ANDINA.id, nombre: PROVEEDOR_ANDINA.nombre },
    candidatos: [],
    tipoDocumento: { id: FACTURA.id, nombre: FACTURA.nombre },
    compraExistente: null,
    asociaciones: [
      { clave: 'CODIGO:INT1:CC350-12', destino: { itemId: COCA.id, unidadCodigo: 'unidad' } },
      { clave: 'CODIGO:INT1:FA350-12', destino: null },
      { clave: 'NOMBRE:FLETE', destino: 'no_mercaderia' },
    ],
  }
}

/**
 * F1 (ronda 1): la PRIMERA vez que llega esta factura, nadie aprendió
 * todavía que el FLETE "no es mercadería" — a diferencia de `respuestaAndina`,
 * que ya lo trae apartado. Acá `asociaciones` no tiene fila para su clave, así
 * que `repartirLineas` la deja como una línea más "por asociar", sin precio.
 */
function respuestaAndinaFleteSinAprender(): LecturaDteRespuesta {
  return {
    ...respuestaAndina(),
    asociaciones: [
      { clave: 'CODIGO:INT1:CC350-12', destino: { itemId: COCA.id, unidadCodigo: 'unidad' } },
      { clave: 'CODIGO:INT1:FA350-12', destino: null },
    ],
  }
}

/**
 * Espía el router REAL de la app montada (no uno mockeado: Nuxt registra
 * `beforeEach`/`afterEach`/`beforeResolve` en el arranque, y un mock
 * incompleto lo revienta ahí). Solo se usa en el test del mutante "limpiar
 * antes del replace": ahí importa el INSTANTE en que se llama `replace`, no
 * solo que se haya llamado.
 */
function espiarReplace(wrapper: Wrapper) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = (wrapper.vm as any).$router
  vi.spyOn(router, 'replace').mockImplementation((to: unknown) => {
    replaceCalls.push(String(typeof to === 'string' ? to : JSON.stringify(to)))
    confirmLlamado = false
    if (capturedGuard) capturedGuard()
    confirmDuranteReplace = confirmLlamado
    return Promise.resolve()
  })
}

async function emitirCargar(
  wrapper: Wrapper,
  payload: { documento: DocumentoDte, lectura: LecturaDteRespuesta, proveedorId: string, rutProveedor: string | null },
) {
  const modal = wrapper.findComponent({ name: 'ComprasCargarDteModal' })
  expect(modal.exists(), 'ComprasCargarDteModal').toBe(true)
  modal.vm.$emit('cargar', payload)
  await new Promise(r => setTimeout(r, 20))
}

describe('compras/[id] — cargar desde el XML (tarea 4)', () => {
  beforeEach(() => {
    enviados = []
    avisos = []
    routeId = 'nueva'
    capturedGuard = null
    confirmLlamado = false
    replaceCalls = []
    confirmDuranteReplace = null
  })

  it('el botón "Cargar desde la factura (XML)" no aparece en un borrador existente', async () => {
    routeId = 'compra-existente-1'
    const wrapper = await montar()
    expect(wrapper.find('[data-qa="compra-cargar-dte"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('con proveedor ya elegido, pide confirmar que reemplaza lo cargado antes de abrir el modal', async () => {
    const wrapper = await montar()
    await emitir(selectConOpcion(wrapper, PROVEEDOR.id), PROVEEDOR.id)

    await wrapper.find('[data-qa="compra-cargar-dte"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(document.body.querySelector('[data-qa="compra-reemplazar-resumen"]')).not.toBeNull()
    expect(wrapper.findComponent({ name: 'ComprasCargarDteModal' }).props('open')).toBe(false)

    ;(document.body.querySelector('[data-qa="compra-reemplazar-si"]') as HTMLButtonElement).click()
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.findComponent({ name: 'ComprasCargarDteModal' }).props('open')).toBe(true)
    wrapper.unmount()
  })

  it('sin nada cargado, el botón abre el modal directo, sin preguntar', async () => {
    const wrapper = await montar()
    await wrapper.find('[data-qa="compra-cargar-dte"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(document.body.querySelector('[data-qa="compra-reemplazar-resumen"]')).toBeNull()
    expect(wrapper.findComponent({ name: 'ComprasCargarDteModal' }).props('open')).toBe(true)
    wrapper.unmount()
  })

  it('al recibir cargar: precarga encabezado, líneas (calzada y por asociar), apartadas y el descuento', async () => {
    const wrapper = await montar()
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })

    const franja = wrapper.find('[data-qa="compra-dte-franja"]')
    expect(franja.text()).toContain('Cargado desde la factura Factura N° 1 · Distribuidora Andina')
    expect(franja.text()).toContain('Aceptar o reclamar esta factura se sigue haciendo en el SII')

    expect(wrapper.find('[data-qa="compra-dte-calzo"]').exists()).toBe(true)
    expect(wrapper.find('[data-qa="compra-dte-por-asociar"]').exists()).toBe(true)
    // 2% de (91.200 + 8.800 + 5.000) = 2.100 (fixture andina-33.xml).
    expect(descuentoInput(wrapper).props('modelValue')).toBe('2100')

    expect(wrapper.find('[data-qa="compra-dte-apartadas"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('F1: el FLETE sin aprender bloquea el descuento (vacío, con aviso) hasta que se aparta — recién ahí calza', async () => {
    const wrapper = await montar()
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndinaFleteSinAprender(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })

    // Bloqueado: el FLETE (sin cantidad ni precio en el XML) sigue en la
    // compra, así que no se puede cargar el descuento todavía.
    expect(descuentoInput(wrapper).props('modelValue')).toBe('')
    expect(wrapper.find('[data-qa="compra-dte-aviso"]').text()).toContain('sin precio')

    // Se aparta el FLETE (es la última línea: Coca, Fanta, FLETE).
    await wrapper.findAll('[data-qa="compra-dte-no-mercaderia"]').at(-1)!.trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // Ya no queda ninguna línea sin precio en la compra: el descuento se
    // destraba solo, y el aviso de "sin precio" desaparece.
    expect(descuentoInput(wrapper).props('modelValue')).toBe('2100')
    expect(wrapper.find('[data-qa="compra-dte-aviso"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('F1: un borrador existente (sin XML) nunca se autocompleta el descuento', async () => {
    routeId = 'compra-existente-1'
    const wrapper = await montar()

    expect(descuentoInput(wrapper).props('modelValue')).toBe('')
    wrapper.unmount()
  })

  it('elegir un producto en la línea "por asociar" (Fanta) deja la unidad vacía y Guardar deshabilitado', async () => {
    const wrapper = await montar()
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })
    // Todavía falta la ubicación (no la trae el XML): Guardar ya estaba deshabilitado.
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    expect(wrapper.find('[data-qa="compra-guardar"]').attributes('disabled')).toBeDefined()

    // La segunda línea (índice 1) es la Fanta, "por asociar".
    const selects = wrapper.findAllComponents({ name: 'USelectMenu' })
    const productoFanta = selects.find((s) => {
      const items = (s.props('items') ?? []) as { value: string }[]
      return items.some(i => i?.value === FANTA.id)
    })
    // Hay un USelectMenu de Producto por línea: el de la Fanta es el que
    // todavía no tiene a Coca elegido (su modelValue está vacío).
    const fantaSelect = wrapper.findAllComponents({ name: 'USelectMenu' })
      .filter(s => (s.props('items') as { value: string }[] | undefined)?.some(i => i?.value === FANTA.id))
      .find(s => !s.props('modelValue'))
    expect(fantaSelect, 'USelectMenu de la línea Fanta').toBeTruthy()
    await emitir(fantaSelect!, FANTA.id)

    expect(unidadSelect(wrapper, 1).props('modelValue')).toBe('')
    expect(wrapper.find('[data-qa="compra-guardar"]').attributes('disabled')).toBeDefined()
    expect(productoFanta).toBeTruthy()
    wrapper.unmount()
  })

  it('"No es mercadería" mueve la línea (y sus gemelas por clave) a apartadas; "Traer de vuelta" la devuelve por asociar', async () => {
    const wrapper = await montar()
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })

    // La Coca (calzada) se aparta a mano.
    await wrapper.find('[data-qa="compra-dte-no-mercaderia"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.find('[data-qa="compra-dte-calzo"]').exists()).toBe(false)
    const apartadaTextos = wrapper.findAll('[data-qa="compra-dte-apartada-texto"]').map(w => w.text())
    expect(apartadaTextos.some(t => t.includes('COCA COLA'))).toBe(true)

    await wrapper.find('[data-qa="compra-dte-traer-de-vuelta"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // Vuelve por asociar (itemId vacío), no con el destino que tenía antes.
    expect(wrapper.find('[data-qa="compra-dte-por-asociar"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('puedeGuardar exige asociar toda línea del XML: el pie dice "Faltan N líneas por asociar"', async () => {
    const wrapper = await montar()
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })

    // Solo la Fanta está sin asociar (Coca ya calzó, FLETE está apartado).
    expect(wrapper.find('[data-qa="compra-dte-por-asociar-pie"]').text()).toContain('Faltan 1 línea por asociar')
    wrapper.unmount()
  })

  it('armarBody: el body completo de la escena Andina, comparado con toEqual', async () => {
    const wrapper = await montar()
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)

    // Se asocia la Fanta a mano: producto + unidad (la unidad queda vacía al
    // elegir el producto — se completa acá, como haría el encargado).
    const fantaSelect = wrapper.findAllComponents({ name: 'USelectMenu' })
      .filter(s => (s.props('items') as { value: string }[] | undefined)?.some(i => i?.value === FANTA.id))
      .find(s => !s.props('modelValue'))
    await emitir(fantaSelect!, FANTA.id)
    await emitir(unidadSelect(wrapper, 1), 'u:unidad')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.body).toEqual({
      proveedorId: PROVEEDOR_ANDINA.id,
      tipoDocumentoCompraId: FACTURA.id,
      folio: '1',
      fechaDocumento: '2026-09-20',
      ubicacionId: BODEGA.id,
      observacion: null,
      descuentoTotal: '2100',
      lineas: [
        {
          itemId: COCA.id, cantidad: '10', unidadCodigo: 'unidad', precioUnitario: '9120',
          claveProveedor: 'CODIGO:INT1:CC350-12', descripcionProveedor: 'COCA COLA 350ML CJ12',
        },
        {
          itemId: FANTA.id, cantidad: '1', unidadCodigo: 'unidad', precioUnitario: '8800',
          claveProveedor: 'CODIGO:INT1:FA350-12', descripcionProveedor: 'FANTA 350ML CJ12',
        },
      ],
      apartadas: [{ clave: 'NOMBRE:FLETE', descripcion: 'FLETE' }],
    })
    wrapper.unmount()
  })

  it('rutProveedor viaja en el body SOLO si el proveedor se eligió a mano', async () => {
    const wrapper = await montar()
    const doc = documentoAndina()
    await emitirCargar(wrapper, {
      documento: doc,
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: doc.emisorRut, // simula que se eligió a mano
    })
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    const fantaSelect = wrapper.findAllComponents({ name: 'USelectMenu' })
      .filter(s => (s.props('items') as { value: string }[] | undefined)?.some(i => i?.value === FANTA.id))
      .find(s => !s.props('modelValue'))
    await emitir(fantaSelect!, FANTA.id)
    await emitir(unidadSelect(wrapper, 1), 'u:unidad')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados[0]!.body!.rutProveedor).toBe(doc.emisorRut)
    wrapper.unmount()
  })

  it('sin origenDte, el guard de salida deja ir sin preguntar', async () => {
    const wrapper = await montar()
    expect(capturedGuard).toBeTruthy()
    const resultado = await capturedGuard!()
    expect(resultado).not.toBe(false)
    expect(confirmLlamado).toBe(false)
    wrapper.unmount()
  })

  it('con origenDte, el guard de salida pregunta con confirm', async () => {
    const wrapper = await montar()
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })

    expect(capturedGuard).toBeTruthy()
    await capturedGuard!()
    expect(confirmLlamado).toBe(true)
    wrapper.unmount()
  })

  it('guardar limpia origenDte y apartadas ANTES del router.replace: el guard no bloquea esa navegación', async () => {
    const wrapper = await montar()
    espiarReplace(wrapper)
    await emitirCargar(wrapper, {
      documento: documentoAndina(),
      lectura: respuestaAndina(),
      proveedorId: PROVEEDOR_ANDINA.id,
      rutProveedor: null,
    })
    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    const fantaSelect = wrapper.findAllComponents({ name: 'USelectMenu' })
      .filter(s => (s.props('items') as { value: string }[] | undefined)?.some(i => i?.value === FANTA.id))
      .find(s => !s.props('modelValue'))
    await emitir(fantaSelect!, FANTA.id)
    await emitir(unidadSelect(wrapper, 1), 'u:unidad')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 20))

    expect(replaceCalls).toEqual(['/compras/compra-1'])
    // El guard, evaluado en el instante mismo del `replace` (como haría el
    // router real), no tuvo que preguntar: `origenDte` ya estaba en null.
    expect(confirmDuranteReplace).toBe(false)
    wrapper.unmount()
  })
})
