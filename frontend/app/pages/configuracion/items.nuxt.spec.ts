// @vitest-environment nuxt
//
// `configuracion/items` es la excepción de su carpeta: NO es admin-only, va con
// `@RequiresPermiso('Items', …)`. Lo que se afirma acá es justamente eso — que
// un usuario con el permiso ve sus controles aunque no sea admin — y que las
// entradas del menú de acciones se arman por permiso: "Ajustar stock" escribe,
// "Historial" solo lee, y quedaron en el mismo dropdown.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Items from './items.vue'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

const ITEM_PRODUCTO = {
  id: 'item-1',
  nombre: 'Coca-Cola 500ml',
  tipo: 'producto',
  activo: true,
  precioBase: '1500.0000',
  monedaId: 'clp',
  stock: '10.0000',
  modoInventario: 'cantidad',
  unidadMedida: 'unidad',
  categoriaId: null,
  clasificacionTributaria: 'afecto',
  impuestosIds: [] as string[],
  descuentosIds: [],
  recargosIds: [],
}

const IMPUESTO_IVA = {
  id: 'iva-1',
  nombre: 'IVA',
  porcentaje: '0.19',
  tipo: 'iva',
  activo: true,
  origen: 'sistema',
}
const IMPUESTO_OTRO = {
  id: 'otro-1',
  nombre: 'Impuesto Adicional',
  porcentaje: '0.05',
  tipo: 'otro',
  activo: true,
  origen: 'sistema',
}

// `/impuestos` y el detalle de `/items/:id` son configurables por test: el
// chip fijo del IVA depende de la clasificación tributaria que traiga el
// detalle, y la separación del selector depende de qué trae `/impuestos`.
let impuestosMock: typeof IMPUESTO_IVA[] = [IMPUESTO_IVA, IMPUESTO_OTRO]
let itemDetalleMock: typeof ITEM_PRODUCTO = ITEM_PRODUCTO

// Para reproducir la carrera entre `cargarCatalogos()` (dos saltos) y la
// tabla de items (un salto, `usePaginatedList`, `onMounted` en paralelo): con
// esto seteado, `/impuestos` NO resuelve hasta que el test llame a la función
// guardada acá, en vez de resolver "sincrónicamente" como el resto del mock.
let impuestosPromiseOverride: Promise<typeof IMPUESTO_IVA[]> | null = null

// La página dispara varias cargas al montar (catálogos, vendibles, grupos) y
// cada una espera una forma distinta. Se responde por URL: lo que importa es
// que la tabla tenga UNA fila para que se rendericen los controles de fila.
mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url === 'string' && url.includes('/impuestos'))
      return impuestosPromiseOverride ?? Promise.resolve(impuestosMock)
    // Detalle de un item puntual (`abrirEditar`): sin query string y sin
    // segmento después del id, a diferencia de `/items/:id/unidades` o del
    // listado paginado `/items?page=...`.
    if (typeof url === 'string' && /\/items\/[^/?]+$/.test(url))
      return Promise.resolve(itemDetalleMock)
    if (typeof url === 'string' && url.includes('/items'))
      return Promise.resolve({ data: [ITEM_PRODUCTO], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } })
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Items)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function tieneTexto(wrapper: Awaited<ReturnType<typeof montar>>, texto: string) {
  return wrapper.findAll('button').some(b => b.text().includes(texto))
}

function cuentaPorTitulo(
  wrapper: Awaited<ReturnType<typeof montar>>,
  title: string,
) {
  return wrapper.findAll(`[title="${title}"]`).length
}

describe('configuracion/items — permisos de módulo, no esAdmin', () => {
  it('con Items:Leer no aparece ni crear ni editar', async () => {
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
  })

  it('un NO admin con Items:Crear ve el alta', async () => {
    // El corazón del hallazgo: gatear esta pantalla con `esAdmin` —como sus 15
    // vecinas de `configuracion/`— le escondería el botón a quien sí puede.
    esAdmin = false
    permisos = ['Items:Leer', 'Items:Crear']

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(true)
  })

  it('un NO admin con Items:Actualizar ve editar, sin ver crear', async () => {
    esAdmin = false
    permisos = ['Items:Leer', 'Items:Actualizar']

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
  })

  it('el menú de acciones aparece solo con lectura: "Historial" no escribe', async () => {
    // Un producto ofrece historial y unidades aunque no se pueda escribir; el
    // dropdown solo desaparece si se queda sin NINGUNA entrada.
    esAdmin = false
    permisos = ['Items:Leer']

    const wrapper = await montar()

    expect(cuentaPorTitulo(wrapper, 'Más acciones')).toBeGreaterThan(0)
  })

  it('el admin del tenant ve crear y editar sin permisos listados', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await montar()

    expect(tieneTexto(wrapper, 'Nuevo item')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
  })
})

// El IVA no se administra por ítem (ADR-018): sale de la clasificación
// tributaria. El chip fijo es la señal visual de eso; el candado real es el
// 400 que tira el backend si `impuestosIds` trae un id `tipo: 'iva'`.
describe('configuracion/items — chip fijo del IVA', () => {
  beforeEach(() => {
    esAdmin = true
    permisos = []
    impuestosMock = [IMPUESTO_IVA, IMPUESTO_OTRO]
    impuestosPromiseOverride = null
  })

  // El drawer lo teletransporta `AppDrawer`/`UDrawer` fuera del wrapper: hay
  // que abrirlo por el camino real (click en "Editar", que dispara
  // `abrirEditar` → `GET /items/:id`) y mirar el `body`, mismo patrón que
  // `configuracion/permisos-escritura.nuxt.spec.ts`.
  async function abrirEditarPrimerItem() {
    const wrapper = await montar()
    await wrapper.find('[title="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    return wrapper
  }

  it('con clasificación afecto, el chip fijo del IVA aparece', async () => {
    itemDetalleMock = { ...ITEM_PRODUCTO, clasificacionTributaria: 'afecto' }
    const wrapper = await abrirEditarPrimerItem()

    expect(document.body.textContent).toContain('IVA 19%')

    wrapper.unmount()
  })

  it('con clasificación exento, el chip fijo del IVA no aparece', async () => {
    itemDetalleMock = { ...ITEM_PRODUCTO, clasificacionTributaria: 'exento' }
    const wrapper = await abrirEditarPrimerItem()

    // Ancla positiva: sin esto, un `abrirEditar` que no abre el drawer también
    // pasaría (el negativo de abajo es vacuamente cierto si el drawer nunca
    // se montó).
    expect(document.body.textContent).toContain('Clasificación tributaria')
    expect(document.body.textContent).not.toContain('IVA 19%')

    wrapper.unmount()
  })

  it('el selector de impuestos adicionales nunca ofrece el IVA como opción', async () => {
    // Mutante mínimo: sacar el `&& i.tipo !== 'iva'` del filtro de
    // `impuestosOpts` en items.vue. El IVA vuelve a aparecer acá y esta
    // aserción se pone en rojo.
    itemDetalleMock = { ...ITEM_PRODUCTO, clasificacionTributaria: 'afecto' }
    const wrapper = await abrirEditarPrimerItem()

    const selectMenu = wrapper
      .findAllComponents({ name: 'USelectMenu' })
      .find(c => c.props('placeholder') === 'Sin impuestos adicionales')
    expect(selectMenu).toBeTruthy()

    const opciones = selectMenu!.props('items') as { label: string; value: string }[]
    expect(opciones.some(o => o.value === IMPUESTO_IVA.id)).toBe(false)
    expect(opciones.some(o => o.value === IMPUESTO_OTRO.id)).toBe(true)

    wrapper.unmount()
  })

  it('al editar un item con una fila de IVA vieja en item_impuestos, no la carga en el form', async () => {
    // Riesgo cubierto además del pedido por el brief: `GET /items/:id` lee
    // `item_impuestos` tal cual, sin filtrar tipo. Si quedó una fila vieja
    // (dato previo a este cambio o una BD sin resembrar), sin este filtro al
    // cargar el ítem se reenviaría en el guardado y el backend respondería
    // 400 — al usuario se le rompería el guardado de un ítem que no tocó.
    itemDetalleMock = {
      ...ITEM_PRODUCTO,
      clasificacionTributaria: 'afecto',
      impuestosIds: [IMPUESTO_IVA.id, IMPUESTO_OTRO.id],
    }
    const wrapper = await abrirEditarPrimerItem()

    const selectMenu = wrapper
      .findAllComponents({ name: 'USelectMenu' })
      .find(c => c.props('placeholder') === 'Sin impuestos adicionales')
    expect(selectMenu).toBeTruthy()
    expect(selectMenu!.props('modelValue')).toEqual([IMPUESTO_OTRO.id])

    wrapper.unmount()
  })

  it('si "Editar" se abre antes de que resuelva /impuestos, igual descarta la fila vieja de IVA', async () => {
    // `cargarCatalogos` tiene DOS saltos secuenciales (monedas/unidades →
    // recién después impuestos), mientras la tabla que habilita "Editar"
    // resuelve en uno solo (`usePaginatedList`, otro `onMounted` en
    // paralelo). Bajo latencia normal la tabla puede estar lista y el click
    // puede llegar ANTES de que `/impuestos` resuelva — no hace falta un
    // click extraordinariamente rápido. Se reproduce acá reteniendo
    // `/impuestos` con una promesa que el test controla a mano.
    let resolverImpuestos: (v: typeof IMPUESTO_IVA[]) => void = () => {}
    impuestosPromiseOverride = new Promise((resolve) => {
      resolverImpuestos = resolve
    })
    itemDetalleMock = {
      ...ITEM_PRODUCTO,
      clasificacionTributaria: 'afecto',
      impuestosIds: [IMPUESTO_IVA.id, IMPUESTO_OTRO.id],
    }

    const wrapper = await montar()
    // No se espera este trigger: dispara `abrirEditar`, que sí resuelve el
    // detalle (`/items/item-1`, no diferido) y llega a esperar el catálogo,
    // que todavía no resolvió.
    wrapper.find('[title="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // Recién ahora resuelve `/impuestos` — si el código arma `form.value`
    // antes de esperar esto, ya quedó armado con `ivaDelPais` en `null`.
    resolverImpuestos(impuestosMock)
    await new Promise(r => setTimeout(r, 50))

    const selectMenu = wrapper
      .findAllComponents({ name: 'USelectMenu' })
      .find(c => c.props('placeholder') === 'Sin impuestos adicionales')
    expect(selectMenu).toBeTruthy()
    expect(selectMenu!.props('modelValue')).toEqual([IMPUESTO_OTRO.id])

    wrapper.unmount()
    impuestosPromiseOverride = null
  })
})
