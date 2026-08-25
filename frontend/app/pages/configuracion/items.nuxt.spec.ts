// @vitest-environment nuxt
//
// `configuracion/items` es la excepción de su carpeta: NO es admin-only, va con
// `@RequiresPermiso('Items', …)`. Lo que se afirma acá es justamente eso — que
// un usuario con el permiso ve sus controles aunque no sea admin — y que las
// entradas del menú de acciones se arman por permiso: "Ajustar stock" escribe,
// "Historial" solo lee, y quedaron en el mismo dropdown.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
  descuentosIds: [] as string[],
  recargosIds: [] as string[],
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

const IMPUESTO_OTRO_PAUSADO = {
  id: 'otro-pausado',
  nombre: 'Impuesto Verde',
  porcentaje: '0.03',
  tipo: 'otro',
  activo: false,
  origen: 'personalizado',
}
const RECARGO_ACTIVO = { id: 'rec-activo', nombre: 'Recargo tarjeta', activo: true }
const RECARGO_PAUSADO = { id: 'rec-pausado', nombre: 'Recargo viejo', activo: false }
let recargosMock: Record<string, unknown>[] = [RECARGO_ACTIVO, RECARGO_PAUSADO]

const DESCUENTO_ACTIVO = { id: 'desc-activo', nombre: 'Promo verano', activo: true }
// Una regla pausada que el ítem YA tiene asociada: el selector la excluye de
// sus opciones (pausada = no se ofrece), y sin una opción que resuelva
// id → nombre terminaba pintando el UUID crudo en la pantalla.
const DESCUENTO_PAUSADO = { id: 'desc-pausado', nombre: 'Promo vieja', activo: false }
// Nivel venta: se elige al cobrar, NO se asocia a un ítem. El backend rechaza
// la asociación con 400, así que ofrecerla acá sería ofrecer una opción que
// siempre falla al guardar.
const DESCUENTO_DE_VENTA = { id: 'desc-venta', nombre: 'Promo del total', activo: true, nivel: 'venta' }
const RECARGO_DE_VENTA = { id: 'rec-venta', nombre: 'Recargo del total', activo: true, nivel: 'venta' }
let descuentosMock: Record<string, unknown>[] = [DESCUENTO_ACTIVO, DESCUENTO_PAUSADO]

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

// Estado SOLO para el describe de la papelera (abajo): un item vivo cuyo
// `DELETE` lo muta, para que un `GET` posterior con `incluirEliminados` lo
// traiga marcado. `null` en el resto de los tests — no interfiere con el
// mock de arriba, que sigue devolviendo `ITEM_PRODUCTO` como siempre.
interface ItemPapelera {
  id: string
  nombre: string
  tipo: string
  activo: boolean
  precioBase: string
  monedaId: string
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}
let itemPapeleraBackend: ItemPapelera | null = null

// Solo para el describe de la carrera (abajo): un segundo item, ya
// eliminado, para que la respuesta "con eliminados" traiga algo que la
// respuesta "sin eliminados" no trae — las dos distinguibles en el DOM.
// `null` en el resto de los tests, no interfiere con nada de arriba.
let itemPapeleraExtra: ItemPapelera | null = null

// Retienen la respuesta del GET a `/items` (paginado) según traiga o no
// `incluirEliminados=true` — mismo mecanismo que
// `overrideConEliminados`/`overrideSinEliminados` en
// `categorias.nuxt.spec.ts`, para forzar a mano el orden en que "llegan"
// dos respuestas en vuelo. `null` = comportamiento normal.
let overrideItemsConEliminados: Promise<unknown> | null = null
let overrideItemsSinEliminados: Promise<unknown> | null = null

// La página dispara varias cargas al montar (catálogos, vendibles, grupos) y
// cada una espera una forma distinta. Se responde por URL: lo que importa es
// que la tabla tenga UNA fila para que se rendericen los controles de fila.
let usoCalls: string[] = []
let usoOverride: Record<string, Promise<unknown>> = {}

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string }) => {
    if (typeof url === 'string' && url.includes('/impuestos'))
      return impuestosPromiseOverride ?? Promise.resolve(impuestosMock)
    if (typeof url === 'string' && url.includes('/descuentos'))
      return Promise.resolve(descuentosMock)
    if (typeof url === 'string' && url.includes('/recargos'))
      return Promise.resolve(recargosMock)
    // `/uso` de cualquier item: se registra la llamada y se permite retener la
    // respuesta por id, para poder montar la carrera del guard de reentrancia.
    const uso = typeof url === 'string' ? /\/items\/([^/]+)\/uso$/.exec(url) : null
    if (uso) {
      usoCalls.push(uso[1]!)
      return usoOverride[uso[1]!] ?? Promise.resolve({ bloqueos: [], advertencias: [] })
    }
    if (
      itemPapeleraBackend
      && typeof url === 'string'
      && url.includes(`/items/${itemPapeleraBackend.id}`)
      && (opts?.method ?? 'GET') === 'DELETE'
    ) {
      itemPapeleraBackend.eliminadoEl = '2026-07-31T21:00:00.000Z'
      itemPapeleraBackend.eliminadoPorNombre = 'admin.paris'
      return Promise.resolve(undefined)
    }
    // Detalle de un item puntual (`abrirEditar`): sin query string y sin
    // segmento después del id, a diferencia de `/items/:id/unidades` o del
    // listado paginado `/items?page=...`.
    if (typeof url === 'string' && /\/items\/[^/?]+$/.test(url))
      return Promise.resolve(itemDetalleMock)
    if (itemPapeleraBackend && typeof url === 'string' && url.includes('/items')) {
      const incluirEliminados = url.includes('incluirEliminados=true')
      if (incluirEliminados && overrideItemsConEliminados) return overrideItemsConEliminados
      if (!incluirEliminados && overrideItemsSinEliminados) return overrideItemsSinEliminados
      const base = [itemPapeleraBackend, itemPapeleraExtra]
        .filter((i): i is ItemPapelera => !!i)
      const data = incluirEliminados
        ? base
        : base.filter(i => !i.eliminadoEl)
      return Promise.resolve({
        data: data.map(i => ({ ...i })),
        meta: { total: data.length, page: 1, pageSize: 15, totalPages: 1 },
      })
    }
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
describe('configuracion/items — una regla pausada ya asociada se nombra', () => {
  beforeEach(() => {
    esAdmin = true
    permisos = []
    impuestosMock = [IMPUESTO_IVA, IMPUESTO_OTRO, IMPUESTO_OTRO_PAUSADO]
    impuestosPromiseOverride = null
    descuentosMock = [DESCUENTO_ACTIVO, DESCUENTO_PAUSADO]
    recargosMock = [RECARGO_ACTIVO, RECARGO_PAUSADO]
  })

  async function abrirEditar() {
    const wrapper = await montar()
    await wrapper.find('[title="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    return wrapper
  }

  /**
   * Se afirma sobre las OPCIONES que recibe cada `USelectMenu`, no sobre el
   * DOM. Un select cerrado solo pinta lo seleccionado —su lista vive en el
   * portal de reka-ui y no llega al `document.body` hasta que se abre—, así que
   * un `not.toContain(...)` sobre el body es vacuo: no observa opciones,
   * observa selección, y pasa con CUALQUIER implementación. Medido con un
   * mutante que ofrecía todas las pausadas: 15/15 en verde.
   */
  function opcionesPorSelect(wrapper: Awaited<ReturnType<typeof montar>>) {
    return wrapper
      .findAllComponents({ name: 'USelectMenu' })
      .map(c => ((c.props('items') as { label: string }[] | undefined) ?? []).map(o => o.label))
  }

  function listaCon(listas: string[][], etiqueta: string) {
    return listas.find(l => l.includes(etiqueta)) ?? []
  }

  it('las pausadas YA asociadas figuran con "(en pausa)" en los tres selectores', async () => {
    itemDetalleMock = {
      ...ITEM_PRODUCTO,
      impuestosIds: [IMPUESTO_OTRO_PAUSADO.id],
      descuentosIds: [DESCUENTO_PAUSADO.id],
      recargosIds: [RECARGO_PAUSADO.id],
    }
    const wrapper = await abrirEditar()
    try {
      const listas = opcionesPorSelect(wrapper)
      expect(listaCon(listas, 'Impuesto Adicional (Sistema)')).toContain('Impuesto Verde (en pausa)')
      expect(listaCon(listas, 'Promo verano')).toContain('Promo vieja (en pausa)')
      expect(listaCon(listas, 'Recargo tarjeta')).toContain('Recargo viejo (en pausa)')
      // Y el UUID no se filtra a la pantalla, que es el bug que esto cierra.
      expect(document.body.textContent).not.toContain(DESCUENTO_PAUSADO.id)
    } finally {
      wrapper.unmount()
    }
  })

  // El control de la regla del owner: pausada = no se ofrece. Cae si alguien
  // simplifica el filtro y mete TODAS las pausadas en la lista, que es la
  // simplificación obvia si no se lee el docblock.
  it('las pausadas que el ítem NO tiene asociadas no figuran en ningún selector', async () => {
    itemDetalleMock = { ...ITEM_PRODUCTO, impuestosIds: [], descuentosIds: [], recargosIds: [] }
    const wrapper = await abrirEditar()
    try {
      const listas = opcionesPorSelect(wrapper)
      // Anclas positivas: sin ellas, un drawer que no montó pasaría los tres
      // negativos por vacuidad.
      expect(listaCon(listas, 'Promo verano')).toEqual(['Promo verano'])
      expect(listaCon(listas, 'Recargo tarjeta')).toEqual(['Recargo tarjeta'])
      expect(listaCon(listas, 'Impuesto Adicional (Sistema)')).toEqual(['Impuesto Adicional (Sistema)'])
      expect(listas.flat().filter(l => l.includes('(en pausa)'))).toEqual([])
    } finally {
      wrapper.unmount()
    }
  })

  // Gemelo del de arriba en un eje DISTINTO: la pausa dice "hoy no se ofrece",
  // el nivel dice "acá no va nunca". Una regla de venta ni siquiera aparece
  // como pausada, porque no es que esté apagada: es que no se asocia a ítems.
  it('las reglas de nivel venta no figuran en ningún selector', async () => {
    descuentosMock = [DESCUENTO_ACTIVO, DESCUENTO_DE_VENTA]
    recargosMock = [RECARGO_ACTIVO, RECARGO_DE_VENTA]
    itemDetalleMock = { ...ITEM_PRODUCTO, impuestosIds: [], descuentosIds: [], recargosIds: [] }
    const wrapper = await abrirEditar()
    try {
      const listas = opcionesPorSelect(wrapper)
      // Anclas positivas: sin ellas un drawer que no montó pasaría los dos
      // negativos por vacuidad.
      expect(listaCon(listas, 'Promo verano')).toEqual(['Promo verano'])
      expect(listaCon(listas, 'Recargo tarjeta')).toEqual(['Recargo tarjeta'])
      expect(listas.flat()).not.toContain('Promo del total')
      expect(listas.flat()).not.toContain('Recargo del total')
    } finally {
      wrapper.unmount()
    }
  })

  // El drawer se teletransporta a `document.body`: un `unmount()` que no corre
  // por una aserción fallida contamina tests POSTERIORES. Por eso los `finally`
  // de arriba. Medido: sin ellos, romper el arreglo hacía caer además el test
  // del chip de IVA y la señal apuntaba al lugar equivocado.
})

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

// Mismo caso que `categorias.nuxt.spec.ts` ("papelera: eliminar respeta el
// toggle"), adaptado a la versión paginada (`usePaginatedList`) de esta
// página: `eliminar()` recargaba (o no) según `verEliminados`, y acá el
// refetch lo dispara el `watch` de filtros que ya tenía `usePaginatedList`
// (no se tocó), sumando `incluirEliminados` a `listFilters`.
describe('configuracion/items — papelera: eliminar respeta el toggle', () => {
  const ITEM_PAPELERA_ID = 'item-papelera-1'

  beforeEach(() => {
    esAdmin = true
    permisos = []
    impuestosMock = [IMPUESTO_IVA, IMPUESTO_OTRO]
    impuestosPromiseOverride = null
    itemPapeleraBackend = {
      id: ITEM_PAPELERA_ID,
      nombre: 'Item Papelera Test',
      tipo: 'servicio',
      activo: true,
      precioBase: '1000.0000',
      monedaId: 'clp',
      eliminadoEl: null,
      eliminadoPorNombre: null,
    }
  })

  afterEach(() => {
    itemPapeleraBackend = null
  })

  /** El menú "Más acciones" y el modal de confirmación los teletransporta
   * Reka UI fuera del wrapper — mismo camino que `abrirDrawerDeMesa()` en
   * `permisos-escritura.nuxt.spec.ts`: hay que abrirlos por el evento real y
   * mirar `document.body`. */
  async function eliminarPorMenu(wrapper: Awaited<ReturnType<typeof montar>>) {
    await wrapper.find('[title="Más acciones"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    const itemEliminar = [...document.body.querySelectorAll('[role="menuitem"]')]
      .find(el => el.textContent?.trim() === 'Eliminar')
    expect(itemEliminar, 'entrada "Eliminar" del menú').toBeTruthy()
    ;(itemEliminar as HTMLElement).click()
    await new Promise(r => setTimeout(r, 20))

    const confirmar = [...document.body.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Eliminar')
    expect(confirmar, 'botón "Eliminar" del modal de confirmación').toBeTruthy()
    confirmar!.click()
    await new Promise(r => setTimeout(r, 50))
  }

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Item Papelera Test')

    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    await eliminarPorMenu(wrapper)

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, la aserción negativa de abajo pasaría vacuamente.
    expect(itemPapeleraBackend!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Item Papelera Test')
    expect(wrapper.text()).toContain('Eliminado')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Item Papelera Test')

    await eliminarPorMenu(wrapper)

    expect(wrapper.text()).not.toContain('Item Papelera Test')

    wrapper.unmount()
  })
})

// Regresión: `usePaginatedList` dispara el refetch de `/items` desde su
// propio `watch` de filtros (`incluirEliminados` es uno más de
// `listFilters`), sin ninguna protección — a diferencia de
// `configuracion/categorias.vue`, que serializa `cargar()` a mano
// (`cargaEnCurso`). El fix va en el composable (`usePaginatedList.ts` →
// `fetch()`), no acá: lo comparten 14 pantallas y el mismo `watch` puede
// disparar dos GET en vuelo por cualquiera de sus filtros, no solo por este
// toggle. Mismo caso que "papelera: la carrera de `cargar()` bajo toggles
// rápidos" en `categorias.nuxt.spec.ts`, adaptado a la respuesta paginada.
describe('configuracion/items — papelera: la carrera del toggle vía usePaginatedList', () => {
  const ITEM_VIVO_ID = 'item-carrera-vivo'
  const ITEM_BORRADO_ID = 'item-carrera-borrado'

  beforeEach(() => {
    esAdmin = true
    permisos = []
    impuestosMock = [IMPUESTO_IVA, IMPUESTO_OTRO]
    impuestosPromiseOverride = null
    itemPapeleraBackend = {
      id: ITEM_VIVO_ID,
      nombre: 'Item Vivo',
      tipo: 'servicio',
      activo: true,
      precioBase: '1000.0000',
      monedaId: 'clp',
      eliminadoEl: null,
      eliminadoPorNombre: null,
    }
    itemPapeleraExtra = {
      id: ITEM_BORRADO_ID,
      nombre: 'Item Ya Borrado',
      tipo: 'servicio',
      activo: true,
      precioBase: '1000.0000',
      monedaId: 'clp',
      eliminadoEl: '2026-07-30T12:00:00.000Z',
      eliminadoPorNombre: 'admin.paris',
    }
    overrideItemsConEliminados = null
    overrideItemsSinEliminados = null
  })

  afterEach(() => {
    itemPapeleraBackend = null
    itemPapeleraExtra = null
    overrideItemsConEliminados = null
    overrideItemsSinEliminados = null
  })

  it('si la respuesta del primer toggle llega DESPUÉS que la del segundo, el listado final igual corresponde al último toggle', async () => {
    const wrapper = await montar()

    // 1) Prender "Ver eliminados": dispara el `watch` de `usePaginatedList`
    //    con `incluirEliminados=true`. Se retiene la respuesta — no
    //    resuelve todavía.
    let resolverConEliminados: (v: unknown) => void = () => {}
    overrideItemsConEliminados = new Promise((resolve) => { resolverConEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 2) Apagar "Ver eliminados" MIENTRAS la respuesta anterior sigue
    //    pendiente: dispara un segundo fetch. Se retiene también su
    //    respuesta, para controlar a mano en qué orden "llegan" las dos.
    let resolverSinEliminados: (v: unknown) => void = () => {}
    overrideItemsSinEliminados = new Promise((resolve) => { resolverSinEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 3) Resolver en el orden INVERSO al que se dispararon: la del segundo
    //    toggle (sin eliminados) responde primero; la del primero (con
    //    eliminados) responde después — el caso que la serialización tiene
    //    que blindar.
    resolverSinEliminados({
      data: [{ ...itemPapeleraBackend }],
      meta: { total: 1, page: 1, pageSize: 15, totalPages: 1 },
    })
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados({
      data: [{ ...itemPapeleraBackend }, { ...itemPapeleraExtra }],
      meta: { total: 2, page: 1, pageSize: 15, totalPages: 1 },
    })
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado (solo el item vivo), sin importar que la respuesta "con
    // eliminados" haya llegado después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Item Vivo')
    expect(wrapper.text()).not.toContain('Item Ya Borrado')

    wrapper.unmount()
  })
})

// Regresión del guard de reentrancia de "Eliminar" (`verificandoEliminarId`).
// El bug que arregló: `confirmarEliminar` pedía `GET /items/:id/uso` y con la
// respuesta seteaba `usoItem`/`confirmDeleteId`. Si el usuario clickeaba
// "Eliminar" en OTRA fila antes de que llegara la primera, la respuesta vieja
// pisaba el estado del click nuevo — y el modal terminaba apuntando a un item
// que no era el último que se pidió borrar.
//
// El observable que distingue NO es a qué item apunta el modal al final: sin
// el guard, la respuesta tardía del primero igual termina pisando al segundo,
// así que los dos caminos aterrizan en el mismo item. Lo que distingue es
// **cuántas verificaciones se disparan**, y que el modal no llegue a abrirse
// con el item equivocado en el medio.
describe('configuracion/items — guard de reentrancia de "Eliminar"', () => {
  const ITEM_A = 'item-guard-a'
  const ITEM_B = 'item-guard-b'

  beforeEach(() => {
    esAdmin = true
    permisos = []
    impuestosMock = [IMPUESTO_IVA, IMPUESTO_OTRO]
    impuestosPromiseOverride = null
    usoCalls = []
    usoOverride = {}
    itemPapeleraBackend = {
      id: ITEM_A,
      nombre: 'Aaa Item Guard',
      tipo: 'servicio',
      activo: true,
      precioBase: '1000.0000',
      monedaId: 'clp',
      eliminadoEl: null,
      eliminadoPorNombre: null,
    }
    itemPapeleraExtra = {
      id: ITEM_B,
      nombre: 'Bbb Item Guard',
      tipo: 'servicio',
      activo: true,
      precioBase: '1000.0000',
      monedaId: 'clp',
      eliminadoEl: null,
      eliminadoPorNombre: null,
    }
    overrideItemsConEliminados = null
    overrideItemsSinEliminados = null
  })

  afterEach(() => {
    itemPapeleraBackend = null
    itemPapeleraExtra = null
    usoCalls = []
    usoOverride = {}
  })

  async function clickEliminarEnFila(
    wrapper: Awaited<ReturnType<typeof montar>>,
    indice: number,
  ) {
    const menus = wrapper.findAll('[title="Más acciones"]')
    expect(menus.length, 'filas con menú de acciones').toBeGreaterThan(indice)
    await menus[indice]!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const eliminar = [...document.body.querySelectorAll('[role="menuitem"]')]
      .find(el => el.textContent?.trim() === 'Eliminar')
    expect(eliminar, 'entrada "Eliminar" del menú').toBeTruthy()
    ;(eliminar as HTMLElement).click()
    await new Promise(r => setTimeout(r, 20))
  }

  it('un segundo "Eliminar" mientras /uso está en vuelo no dispara otra verificación', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Aaa Item Guard')
    expect(wrapper.text()).toContain('Bbb Item Guard')

    // El /uso del PRIMERO queda retenido: es el que llega tarde.
    let resolverUsoA: (v: unknown) => void = () => {}
    usoOverride[ITEM_A] = new Promise((resolve) => { resolverUsoA = resolve })

    await clickEliminarEnFila(wrapper, 0)
    // Ancla positiva: si el primer click no llegó a pedir /uso, la aserción de
    // abajo pasaría vacuamente con la lista vacía.
    expect(usoCalls).toEqual([ITEM_A])

    // Segundo click en la OTRA fila, con la primera verificación todavía en
    // vuelo. Sin el guard, acá sale un segundo GET.
    await clickEliminarEnFila(wrapper, 1)
    expect(usoCalls).toEqual([ITEM_A])

    // Y el modal no se abrió con el segundo item en el medio.
    expect(document.body.textContent).not.toContain('Bbb Item Guard')

    resolverUsoA({ bloqueos: [], advertencias: [] })
    await new Promise(r => setTimeout(r, 30))

    // Al llegar la respuesta retenida, el modal apunta al item que SÍ se estaba
    // verificando.
    expect(document.body.textContent).toContain('Aaa Item Guard')

    wrapper.unmount()
  })

  it('mientras verifica, el menú de esa fila queda deshabilitado', async () => {
    // La otra mitad del guard: sin el feedback visual, los clicks se los traga
    // en silencio y el usuario no entiende por qué la fila no responde.
    const wrapper = await montar()

    let resolverUsoA: (v: unknown) => void = () => {}
    usoOverride[ITEM_A] = new Promise((resolve) => { resolverUsoA = resolve })

    const antes = wrapper.findAll('[title="Más acciones"]')
      .filter(b => b.attributes('disabled') !== undefined).length
    expect(antes).toBe(0)

    await clickEliminarEnFila(wrapper, 0)

    const deshabilitados = wrapper.findAll('[title="Más acciones"]')
      .filter(b => b.attributes('disabled') !== undefined)
    expect(deshabilitados).toHaveLength(1)

    resolverUsoA({ bloqueos: [], advertencias: [] })
    await new Promise(r => setTimeout(r, 30))

    wrapper.unmount()
  })

  it('cuando la verificación termina, el guard se libera y el siguiente click funciona', async () => {
    // La otra mitad: un guard que no se libera deja la pantalla muerta después
    // del primer borrado, que sería peor que el bug original.
    const wrapper = await montar()

    await clickEliminarEnFila(wrapper, 0)
    await new Promise(r => setTimeout(r, 20))
    expect(usoCalls).toEqual([ITEM_A])

    // Se afirma en vez de `if (cerrar)`: un click condicional degrada en
    // silencio a una versión más débil del test si mañana cambia el label.
    const cerrar = [...document.body.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Cancelar')
    expect(cerrar, 'botón "Cancelar" del modal').toBeTruthy()
    cerrar!.click()
    await new Promise(r => setTimeout(r, 20))

    await clickEliminarEnFila(wrapper, 1)
    expect(usoCalls).toEqual([ITEM_A, ITEM_B])

    wrapper.unmount()
  })
})

/**
 * Los campos de dinero de esta pantalla son TODOS de escala fija 4 en el
 * backend (`@EsCosto()`): `precioBase`, `costo`, y los dos `precioExtra` —el de
 * extras de receta y el de opciones de grupo—, más el `costoUnitario` del
 * ajuste. Son precios **por unidad**, o sea tasas, y la frontera tasa→monto se
 * cruza al multiplicar por la cantidad, no acá.
 *
 * `MoneyInput` sin el prop `decimales` sigue los decimales de la MONEDA, y con
 * CLP (0) la máscara no deja abrir parte decimal: un costo de `5,0500`/g es
 * válido para el backend y no se podía tipear.
 *
 * El guard es sobre el fuente y no sobre el render a propósito: lo que hay que
 * evitar es que el PRÓXIMO campo de dinero de esta pantalla nazca sin el prop,
 * y un test que monta solo ve los que ya están dibujados. Cuenta aperturas de
 * tag para no contar de más si alguien lo menciona en un comentario.
 */
describe('configuracion/items — los campos de dinero son de escala fija', () => {
  it('todo MoneyInput de la pantalla fija decimales en 4', () => {
    // Desde la raíz del proyecto: en el entorno `nuxt` de vitest,
    // `import.meta.url` no es un `file:` usable.
    const ruta = resolve(process.cwd(), 'app/pages/configuracion/items.vue')
    const fuente = readFileSync(ruta, 'utf8')

    const tags = fuente.match(/<MoneyInput[\s\S]*?\/>/g) ?? []
    expect(tags.length).toBeGreaterThan(0)

    const sinDecimales = tags.filter(t => !t.includes(':decimales="4"'))
    expect(sinDecimales).toEqual([])
  })
})
