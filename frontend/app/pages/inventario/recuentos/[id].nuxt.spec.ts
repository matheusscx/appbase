// @vitest-environment nuxt
//
// Frente de bodegas y traslados: el detalle de la sesión muestra la ubicación
// en el encabezado, no editable, solo si hayBodegas (con una sola
// ubicación, decirla siempre dice lo mismo — `docs/features/bodegas-y-traslados.md`,
// «Frontend»).
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import RecuentoDetalle from './[id].vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }

const LINEA = {
  lineaId: 'l1', itemId: 'i1', itemNombre: 'Harina', itemEliminado: false, unidadMedida: 'kg',
  stockSistema: '10', cantidadContada: '8', diferencia: '-2', motivoDiferenciaId: null as string | null,
}

const DETALLE_EN_BODEGA = {
  id: 'recuento-1',
  ubicacionId: BODEGA.id,
  ubicacionNombre: BODEGA.nombre,
  estado: 'borrador',
  motivoDiferenciaDefaultId: null,
  comentario: null,
  creadoEl: '2026-09-06T10:00:00.000Z',
  aplicadoEl: null,
  lineas: [],
}

let lineasBackend: typeof LINEA[] = []
let ubicacionesBackend: typeof LOCAL[] = [LOCAL]

// Un aprobador tiene Inventario:Leer + Actualizar y no Crear (no cuenta, no pone causas).
let puedeContarBackend = true
let detalleExtra: Record<string, unknown> = {}
let patches: { url: string, body: Record<string, unknown> }[] = []
let liberarPatch: Promise<void> | null = null
mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return false },
    can: (_modulo: string, accion: string) => accion !== 'Crear' || puedeContarBackend,
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ params: { id: DETALLE_EN_BODEGA.id } })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (opts?.method === 'PATCH') {
      patches.push({ url, body: opts.body ?? {} })
      const respuesta = { ...lineasBackend[0], cantidadContada: opts.body?.cantidadContada ?? null, diferencia: '0.0000' }
      return liberarPatch ? liberarPatch.then(() => respuesta) : Promise.resolve(respuesta)
    }
    if (url.includes('/ubicaciones')) return Promise.resolve(ubicacionesBackend)
    if (url.includes(`/recuentos/${DETALLE_EN_BODEGA.id}`)) return Promise.resolve({ ...DETALLE_EN_BODEGA, ...detalleExtra, lineas: lineasBackend })
    if (url.includes('/motivos-diferencia-inventario')) return Promise.resolve([{ id: 'm1', nombre: 'Merma', activo: true, esFijo: false }])
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(RecuentoDetalle)
  await new Promise(r => setTimeout(r, 150))
  return wrapper
}

describe('inventario/recuentos/[id] — la ubicación en el encabezado', () => {
  it('con una bodega en el tenant, muestra el nombre de la ubicación de la sesión', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()

    expect(wrapper.text()).toContain(BODEGA.nombre)
    wrapper.unmount()
  })

  it('con una sola ubicación en el tenant, no la muestra (siempre diría lo mismo)', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()

    // La sesión en sí sigue siendo de la bodega (dato del backend, no
    // editable) — lo que cambia es que la pantalla no lo repite en el
    // encabezado cuando el tenant no tiene más de una ubicación.
    expect(wrapper.text()).not.toContain(BODEGA.nombre)
    wrapper.unmount()
  })
})

// Lote 4 (05.13): a 768 el selector de causa se cortaba ("Usar la causa por de…"): tabla de 772 en 672.
describe('inventario/recuentos/[id] — forma de la tabla en tablet', () => {
  it('el selector de causa mide 192 px (w-48), no 224', async () => {
    ubicacionesBackend = [LOCAL]
    lineasBackend = [LINEA]
    const wrapper = await montar()
    const celda = wrapper.findAll('tbody td').at(-1)!
    expect(celda.find('.w-48').exists()).toBe(true)
    expect(celda.find('.w-56').exists()).toBe(false)
    wrapper.unmount()
    lineasBackend = []
  })
})

const SIN_CAUSA_LINEA = { ...LINEA, lineaId: 'l2', itemId: 'i2', itemNombre: 'Pan de hamburguesa', unidadMedida: 'unidad', stockSistema: '10', cantidadContada: '8', diferencia: '-2.0000', motivoDiferenciaId: null }

function reiniciar() {
  puedeContarBackend = true
  detalleExtra = {}
  patches = []
  liberarPatch = null
  lineasBackend = []
  ubicacionesBackend = [LOCAL]
}

// Auditoría UX 05.1: el aprobador apretaba "Aplicar", el servidor rechazaba y no había salida.
describe('inventario/recuentos/[id] — Aplicar con líneas sin causa (05.1)', () => {
  beforeEach(reiniciar)
  const aplicar = (w: Awaited<ReturnType<typeof montar>>) =>
    w.findAll('button').find(b => b.text().trim() === 'Aplicar')!

  it('queda apagado, nombra la línea que falta y dice quién la pone', async () => {
    puedeContarBackend = false
    lineasBackend = [SIN_CAUSA_LINEA]
    const wrapper = await montar()
    expect(aplicar(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-qa="aplicar-falta"]').text())
      .toBe('Falta la causa en Pan de hamburguesa. La pone quien contó, y después vuelves a aplicar.')
    wrapper.unmount()
  })

  it('quien puede contar sabe que la elige en la tabla', async () => {
    lineasBackend = [SIN_CAUSA_LINEA]
    const wrapper = await montar()
    expect(wrapper.find('[data-qa="aplicar-falta"]').text())
      .toBe('Falta la causa en Pan de hamburguesa. Elígela en la tabla y vuelve a aplicar.')
    wrapper.unmount()
  })

  it('con la causa puesta, Aplicar se habilita y no hay aviso', async () => {
    puedeContarBackend = false
    lineasBackend = [{ ...SIN_CAUSA_LINEA, motivoDiferenciaId: 'm1' }]
    const wrapper = await montar()
    expect(aplicar(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-qa="aplicar-falta"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

// Auditoría UX 05.3: al guardar, el campo se deshabilitaba y Tab dejaba el foco en <body>.
describe('inventario/recuentos/[id] — contar con teclado (05.3)', () => {
  beforeEach(reiniciar)

  it('el campo sigue habilitado mientras se guarda', async () => {
    lineasBackend = [LINEA]
    liberarPatch = new Promise<void>(() => {})
    const wrapper = await montar()
    const input = wrapper.find('input[inputmode="decimal"]')
    await input.setValue('9')
    await input.trigger('blur')
    await new Promise(r => setTimeout(r, 20))
    expect(patches).toHaveLength(1)
    expect(wrapper.find('input[inputmode="decimal"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('un segundo guardado de la misma línea espera al primero (no llegan cruzados)', async () => {
    lineasBackend = [LINEA]
    let soltar!: () => void
    liberarPatch = new Promise<void>((r) => { soltar = r })
    const wrapper = await montar()
    const input = wrapper.find('input[inputmode="decimal"]')
    await input.setValue('9')
    await input.trigger('blur')
    await new Promise(r => setTimeout(r, 20))
    await input.setValue('5')
    await input.trigger('blur')
    await new Promise(r => setTimeout(r, 20))
    expect(patches).toHaveLength(1)

    soltar()
    await new Promise(r => setTimeout(r, 40))
    expect(patches.map(p => p.body.cantidadContada)).toEqual(['9', '5'])
    wrapper.unmount()
  })

  it('Enter pasa al "Contado" de la fila siguiente', async () => {
    lineasBackend = [LINEA, { ...LINEA, lineaId: 'l2', itemId: 'i2', itemNombre: 'Sal' }]
    const wrapper = await mountSuspended(RecuentoDetalle, { attachTo: document.body })
    await new Promise(r => setTimeout(r, 150))
    const inputs = wrapper.findAll('input[inputmode="decimal"]')
    ;(inputs[0]!.element as HTMLInputElement).focus()
    await inputs[0]!.trigger('keydown', { key: 'Enter' })
    expect(document.activeElement).toBe(inputs[1]!.element)
    wrapper.unmount()
  })
})

// Auditoría UX 05.7: un recuento aplicado no decía qué hizo, ni quién ni cuándo.
describe('inventario/recuentos/[id] — recuento aplicado (05.7)', () => {
  beforeEach(reiniciar)

  it('dice cuándo, quién, cuántas líneas movió y cuántas no tenían diferencia, y no muestra una tarjeta vacía', async () => {
    detalleExtra = { estado: 'aplicado', aplicadoEl: '2026-10-16T15:00:00.000Z', usuarioAplicadorNombre: 'Aprobador Paris' }
    lineasBackend = [LINEA, { ...LINEA, lineaId: 'l2', itemId: 'i2', cantidadContada: '10', diferencia: '0.0000' }]
    const wrapper = await montar()
    const resumen = wrapper.find('[data-qa="recuento-resumen-aplicado"]').text()
    expect(resumen).toContain('Aplicado el')
    expect(resumen).toContain('por Aprobador Paris')
    expect(resumen).toContain('1 línea movida')
    expect(resumen).toContain('1 sin diferencia')
    expect(wrapper.text()).not.toContain('Sin causa por defecto')
    wrapper.unmount()
  })

  it('si los campos están grises por permiso, lo dice', async () => {
    puedeContarBackend = false
    lineasBackend = [LINEA]
    const wrapper = await montar()
    expect(wrapper.find('[data-qa="recuento-solo-lectura"]').text()).toBe('Los conteos y las causas los carga quien cuenta.')
    wrapper.unmount()
  })
})
