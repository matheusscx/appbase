// @vitest-environment nuxt
//
// `configuracion/items` es la excepción de su carpeta: NO es admin-only, va con
// `@RequiresPermiso('Items', …)`. Lo que se afirma acá es justamente eso — que
// un usuario con el permiso ve sus controles aunque no sea admin — y que las
// entradas del menú de acciones se arman por permiso: "Ajustar stock" escribe,
// "Historial" solo lee, y quedaron en el mismo dropdown.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { markRaw } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Items from './items.vue'

/**
 * Para poder CERRAR el drawer en un test. La transición de salida de `vaul`/`reka-ui`
 * `Presence` guarda el objeto vivo de `getComputedStyle()` dentro de un `ref`, y Vue lo
 * envuelve en un segundo Proxy sobre el de happy-dom: leer `display` rompe los traps
 * («Receiver must be an instance of class CSSStyleDeclaration») como **unhandled
 * rejection**, con los tests en verde y el proceso en exit 1. `markRaw` lo deja fuera de
 * la reactividad, así que happy-dom ve solo SU proxy.
 *
 * Medido sobre esta página el 2026-09-11, cada falla aislada con `-t`: cerrar el drawer sin
 * esto da exit 1 con 2 rejections, y con esto exit 0. Mismo parche y mismo alcance —LOCAL a
 * un archivo, no `test.setup.ts`— que `salones.nuxt.spec.ts:35-43`.
 *
 * ⚠️ No arregla la otra falla del mismo entorno: un `UModal` abierto con este drawer abierto
 * tumba al worker por heap igual (`docs/patterns/frontend.md` §15).
 */
let getComputedStyleOriginal: typeof window.getComputedStyle
beforeAll(() => {
  getComputedStyleOriginal = window.getComputedStyle
  window.getComputedStyle = ((el: Element, pseudo?: string | null) =>
    markRaw(getComputedStyleOriginal.call(window, el, pseudo) as object)) as typeof window.getComputedStyle
})
afterAll(() => {
  window.getComputedStyle = getComputedStyleOriginal
})

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
  // La API lo manda para todo ítem guardado (`COALESCE` de las tres extensiones), así que
  // el fixture sin él era una ficha que el backend nunca devuelve.
  costoActual: '400',
  // `null`: un ítem que todavía no se usó, así que su unidad se puede cambiar.
  unidadBloqueada: null as string | null,
}

const MONEDA_CLP = {
  monedaId: 'clp',
  nombre: 'Peso Chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

const MONEDA_USD = {
  ...MONEDA_CLP,
  monedaId: 'usd',
  nombre: 'Dólar',
  codigoIso: 'USD',
  simbolo: 'US$',
  decimales: 2,
  separadorDecimal: '.',
  separadorMiles: ',',
  locale: 'en-US',
  esOficial: false,
}

// Una receta con plata en los otros dos lugares del drawer: el precio de un extra
// (`receta_extras_permitidos`) y el override de una opción de modificador
// (`item_grupo_modificador_opciones`). Los dos son plata de ESTE ítem, y por eso
// cambiarle la moneda los alcanza. Todas las filas vienen CON precio: la API no
// devuelve ninguna sin él —`RecetaExtraInputDto.precioExtra` es requerido y el
// efectivo de una opción viene resuelto—, así que las que el test necesita vacías
// para distinguir "contar plata" de "contar filas" las vacía por la pantalla.
const ITEM_RECETA = {
  ...ITEM_PRODUCTO,
  id: 'item-receta',
  nombre: 'Hamburguesa',
  tipo: 'receta',
  precioBase: '8900',
  // Con un ingrediente que tiene costo, el "Costo actual" que la pantalla calcula da
  // distinto de cero — que es lo que lo hace un monto y no un adorno.
  ingredientes: [
    { ingredienteItemId: 'item-1', cantidad: '2', unidadCodigo: 'unidad', bloqueante: true },
  ],
  extrasPermitidos: [
    { ingredienteItemId: 'ing-queso', cantidad: '1', unidadCodigo: 'unidad', precioExtra: '500' },
    { ingredienteItemId: 'ing-palta', cantidad: '1', unidadCodigo: 'unidad', precioExtra: '800' },
  ],
  grupos: [
    {
      grupoModificadorId: 'grupo-1',
      min: 0,
      max: 1,
      orden: 0,
      opciones: [
        {
          grupoOpcionId: 'op-cheddar',
          itemNombre: 'Cheddar',
          cantidad: '1',
          cantidadDefault: '1',
          unidadCodigo: 'unidad',
          precioExtra: '1200',
        },
        {
          grupoOpcionId: 'op-pepinillo',
          itemNombre: 'Pepinillo',
          cantidad: '1',
          cantidadDefault: '1',
          unidadCodigo: 'unidad',
          precioExtra: '300',
        },
      ],
    },
  ],
}

// Un ingrediente ya guardado con costo vigente: el caso donde el drawer no muestra NI UN
// campo de plata editable —el ingrediente no tiene precio base, y el costo solo se teclea al
// alta—, así que sin contar el costo vigente no hay nada que nombrar y la moneda cambiaba
// sola.
const ITEM_INGREDIENTE = {
  ...ITEM_PRODUCTO,
  id: 'item-ingrediente',
  nombre: 'Harina',
  tipo: 'ingrediente',
  costoActual: '1200',
}

// Un combo guardado: su drawer no muestra "Costo vigente" —eso es de producto e
// ingrediente— sino el "Costo actual" que la pantalla calcula desde sus componentes. El
// componente es `item-1`, que el mock de `/items` devuelve con `costoActual: '400'`.
const ITEM_COMBO = {
  ...ITEM_PRODUCTO,
  id: 'item-combo',
  nombre: 'Combo del día',
  tipo: 'combo',
  precioBase: '0',
  componentes: [
    { componenteItemId: 'item-1', cantidad: '2', bloqueante: true },
  ],
}

// El catálogo de grupos: `onSelectGrupo` pre-llena los precios de las opciones con estos
// defaults, que es como una receta nueva termina con plata en las opciones sin que nadie
// teclee un número.
const GRUPO_CATALOGO = {
  grupoModificadorId: 'grupo-1',
  nombre: 'Proteína',
  familia: 'producto',
  opciones: [
    { grupoOpcionId: 'op-cheddar', itemNombre: 'Cheddar', cantidad: '1', unidadCodigo: null, precioExtra: '1200' },
  ],
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
let itemDetalleMock:
  | typeof ITEM_PRODUCTO
  | typeof ITEM_RECETA
  | typeof ITEM_INGREDIENTE
  | typeof ITEM_COMBO
  = ITEM_PRODUCTO

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

// El store de monedas sale del auth (`ensureLoaded` corta sin `activeTenantId`), y
// sin monedas todos los `MoneyInput` de la pantalla se montan DESHABILITADOS y sin
// emitir: los tests de abajo pasarían igual con el `v-model` desconectado. Con esto
// el campo de dinero está vivo, y es el mismo que ve una persona.
mockNuxtImport('useAuthStore', () => {
  return () => ({ activeTenantId: 'tenant-1' })
})

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
    if (typeof url === 'string' && url.includes('/grupos-modificadores'))
      return Promise.resolve([GRUPO_CATALOGO])
    if (typeof url === 'string' && url.includes('/monedas')) return Promise.resolve([MONEDA_CLP, MONEDA_USD])
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
    // Riesgo cubierto además del principal: `GET /items/:id` lee
    // `item_impuestos` tal cual, sin filtrar tipo. Si quedó una fila vieja
    // (dato previo a este cambio o una BD sin resembrar), sin este filtro al
    // cargar el ítem se reenviaría en el guardado y el backend respondería 400
    // — al usuario se le rompería el guardado de un ítem que no tocó.
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
 * Los campos de dinero de esta pantalla siguen los decimales de la MONEDA del
 * ítem, no una escala fija (owner, 2026-08-28; aplicado acá el 2026-09-08). La
 * escala del backend sigue en 4 —`@EsCosto()`, porque el motor promedia y genera
 * fracciones—, pero lo que una persona teclea sigue a la moneda: en CLP la
 * máscara no deja abrir parte decimal, y la precisión de un costo por gramo la da
 * elegir la unidad, no tipear `5,0500`.
 *
 * El guard es sobre el fuente y no sobre el render a propósito: lo que hay que
 * evitar es que el PRÓXIMO campo de dinero de esta pantalla nazca forzando una
 * escala, y un test que monta solo ve los que ya están dibujados. Cuenta aperturas
 * de tag para no contar de más si alguien lo menciona en un comentario.
 */
describe('configuracion/items — los campos de dinero siguen a la moneda', () => {
  it('ningún MoneyInput de la pantalla fuerza decimales', () => {
    // Desde la raíz del proyecto: en el entorno `nuxt` de vitest,
    // `import.meta.url` no es un `file:` usable.
    const ruta = resolve(process.cwd(), 'app/pages/configuracion/items.vue')
    const fuente = readFileSync(ruta, 'utf8')

    const tags = fuente.match(/<MoneyInput[\s\S]*?\/>/g) ?? []
    expect(tags.length).toBeGreaterThan(0)

    const conDecimales = tags.filter(t => t.includes('decimales'))
    expect(conDecimales).toEqual([])
  })
})

/**
 * Costo y precio base son dinero **por la unidad de medida del ítem**. Desde que
 * los dos siguen los decimales de la moneda, la unidad es lo único que fija la
 * magnitud del número, así que tiene que estar a la vista y no puede quedar
 * pegada a un número tipeado para otra.
 */
describe('configuracion/items — la unidad manda en costo y precio', () => {
  beforeEach(() => {
    esAdmin = true
    permisos = []
  })

  async function abrirAlta() {
    const wrapper = await montar()
    const boton = wrapper.findAll('button').find(b => b.text().includes('Nuevo item'))
    expect(boton, 'botón "Nuevo item"').toBeTruthy()
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    return wrapper
  }

  /**
   * El `UFormField` cuya etiqueta empieza con `prefijo`, con su input adentro.
   *
   * ⚠️ Es `startsWith` porque las etiquetas llevan la unidad al final —"Costo (por kg)"—, así
   * que `'Costo'` **también matchea "Costo vigente"**, y devuelve el primero que encuentre. En
   * un test de edición hay que pedir `'Costo vigente'` completo.
   */
  function campo(wrapper: Awaited<ReturnType<typeof montar>>, prefijo: string) {
    return wrapper.findAllComponents({ name: 'UFormField' })
      .find(f => String(f.props('label') ?? '').startsWith(prefijo))
  }

  it('las etiquetas de costo y precio nombran la unidad elegida', async () => {
    const wrapper = await abrirAlta()

    // Arranca en `unidad`, el default de `emptyForm`.
    expect(campo(wrapper, 'Costo')?.props('label')).toBe('Costo (por unidad)')
    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por unidad)')

    const unidad = campo(wrapper, 'Unidad de medida')!.findComponent({ name: 'USelectMenu' })
    unidad.vm.$emit('update:modelValue', 'kg')
    await new Promise(r => setTimeout(r, 20))

    expect(campo(wrapper, 'Costo')?.props('label')).toBe('Costo (por kg)')
    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por kg)')

    wrapper.unmount()
  })

  it('cambiar la unidad limpia lo tipeado en costo y en precio', async () => {
    // Lo que se evita: `5000` tipeado por unidad quedándose en el campo cuando la
    // unidad pasa a ser kilo, o sea el mismo número significando otra cosa. Se
    // limpia y no se convierte: `1500` por kilo son `1,5` por gramo, un número que
    // una moneda sin decimales no puede expresar, así que convertir dejaría
    // guardado algo que nadie tecleó (`docs/patterns/frontend.md` §8).
    const wrapper = await abrirAlta()

    campo(wrapper, 'Costo')!.findComponent({ name: 'MoneyInput' })
      .vm.$emit('update:modelValue', '5000')
    campo(wrapper, 'Precio base')!.findComponent({ name: 'MoneyInput' })
      .vm.$emit('update:modelValue', '9000')
    await new Promise(r => setTimeout(r, 20))

    // Ancla: sin esto, un `v-model` roto haría pasar el test por el lado vacío.
    expect(campo(wrapper, 'Costo')!.findComponent({ name: 'MoneyInput' }).props('modelValue')).toBe('5000')
    expect(campo(wrapper, 'Precio base')!.findComponent({ name: 'MoneyInput' }).props('modelValue')).toBe('9000')

    const unidad = campo(wrapper, 'Unidad de medida')!.findComponent({ name: 'USelectMenu' })
    unidad.vm.$emit('update:modelValue', 'kg')
    await new Promise(r => setTimeout(r, 20))

    expect(campo(wrapper, 'Costo')!.findComponent({ name: 'MoneyInput' }).props('modelValue')).toBe('')
    expect(campo(wrapper, 'Precio base')!.findComponent({ name: 'MoneyInput' }).props('modelValue')).toBe('')

    wrapper.unmount()
  })

  // La contracara, y el modo de falla que más caro salía: abrir la ficha de un ítem
  // NO puede cambiarle la plata. Son dos mecanismos distintos y este test los cubre a
  // la vez, porque en la pantalla real ocurren juntos:
  //   1. `abrirEditar` carga la unidad del ítem, así que el `watch` de arriba ve un
  //      cambio de unidad que ninguna persona hizo — lo frena el guard de `editingId`;
  //   2. el precio que trae la API puede no caber en la escala de la moneda, y
  //      `MoneyInput` lo re-emitía redondeado al montarse — se cerró el 2026-09-08
  //      haciendo que solo emita lo que la persona escribe.
  // Con cualquiera de los dos vivo, editarle la descripción a un ítem le cambia el
  // precio guardado.
  it('abrir un ítem con un precio que el peso no puede expresar NO se lo reescribe', async () => {
    itemDetalleMock = { ...ITEM_PRODUCTO, unidadMedida: 'kg', precioBase: '1234.5678' }

    const wrapper = await montar()
    await wrapper.find('[title="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    const money = campo(wrapper, 'Precio base')!.findComponent({ name: 'MoneyInput' })
    // Ancla: sin moneda resuelta `MoneyInput` se monta DESHABILITADO y sin emitir, y
    // todo lo de abajo pasaría por el lado trivial.
    expect(money.find('input').element.disabled).toBe(false)
    // Se muestra lo único que se puede mostrar en pesos…
    expect(money.find('input').element.value).toBe('1.235')
    // …y el formulario sigue teniendo lo que mandó la API, que es lo que se guardaría.
    expect(money.props('modelValue')).toBe('1234.5678')
    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por kg)')

    wrapper.unmount()
  })
})

/**
 * Cambiar la MONEDA del ítem reinterpreta lo tipeado igual de fuerte que cambiar la
 * unidad —`1500` en pesos no es `1500` en dólares—, así que también limpia (owner,
 * 2026-09-09; `docs/patterns/frontend.md` §8). Lo que este describe fija, y que no
 * tiene equivalente en el vecino de la unidad, sale de que este selector **no se
 * bloquea al editar**: el gesto frena pidiendo confirmación porque alcanza hasta
 * cuatro lugares —algunos, filas que trajo el servidor—, y cuelga del gesto de la
 * persona y no de un `watch`, que no distingue una elección de la carga de la ficha.
 */
describe('configuracion/items — cambiar la moneda vacía la plata del formulario', () => {
  beforeEach(() => {
    esAdmin = true
    permisos = []
    itemDetalleMock = ITEM_PRODUCTO
  })

  afterEach(() => {
    itemDetalleMock = ITEM_PRODUCTO
  })

  /**
   * El `UFormField` cuya etiqueta empieza con `prefijo`, con su input adentro.
   *
   * ⚠️ Es `startsWith` porque las etiquetas llevan la unidad al final —"Costo (por kg)"—, así
   * que `'Costo'` **también matchea "Costo vigente"**, y devuelve el primero que encuentre. En
   * un test de edición hay que pedir `'Costo vigente'` completo.
   */
  function campo(wrapper: Awaited<ReturnType<typeof montar>>, prefijo: string) {
    return wrapper.findAllComponents({ name: 'UFormField' })
      .find(f => String(f.props('label') ?? '').startsWith(prefijo))
  }

  function money(wrapper: Awaited<ReturnType<typeof montar>>, prefijo: string) {
    return campo(wrapper, prefijo)!.findComponent({ name: 'MoneyInput' })
  }

  /** El aviso que frena el cambio, si está en pantalla. */
  function aviso(wrapper: Awaited<ReturnType<typeof montar>>) {
    return wrapper.findAllComponents({ name: 'UAlert' })
      .find(a => String(a.props('title') ?? '').startsWith('Cambiar la moneda'))
  }

  function accion(wrapper: Awaited<ReturnType<typeof montar>>, texto: string) {
    const panel = aviso(wrapper)
    expect(panel, 'aviso de cambio de moneda').toBeTruthy()
    const boton = panel!.findAllComponents({ name: 'UButton' })
      .find(b => b.text().includes(texto))
    expect(boton, `botón "${texto}" en el aviso`).toBeTruthy()
    return boton!
  }

  function elegirMoneda(wrapper: Awaited<ReturnType<typeof montar>>, monedaId: string) {
    campo(wrapper, 'Moneda')!.findComponent({ name: 'USelectMenu' })
      .vm.$emit('update:modelValue', monedaId)
  }

  async function abrirAlta() {
    const wrapper = await montar()
    const boton = wrapper.findAll('button').find(b => b.text().includes('Nuevo item'))
    expect(boton, 'botón "Nuevo item"').toBeTruthy()
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    return wrapper
  }

  async function abrirEditar(wrapper: Awaited<ReturnType<typeof montar>>) {
    await wrapper.find('[title="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
  }

  it('con el formulario sin plata, elegir otra moneda no pregunta nada', async () => {
    const wrapper = await abrirAlta()

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)).toBeUndefined()
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('usd')

    wrapper.unmount()
  })

  it('con plata tipeada, elegir otra moneda frena: pregunta y todavía no toca nada', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Costo').vm.$emit('update:modelValue', '5000')
    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '9000')
    await new Promise(r => setTimeout(r, 20))

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)?.props('description')).toContain('el precio base y el costo')
    // Lo que se prueba es que FRENA: hasta que alguien elija, el formulario sigue
    // siendo el de antes del click, moneda incluida.
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('clp')
    expect(money(wrapper, 'Costo').props('modelValue')).toBe('5000')
    expect(money(wrapper, 'Precio base').props('modelValue')).toBe('9000')

    wrapper.unmount()
  })

  it('confirmar cambia la moneda y vacía costo y precio', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Costo').vm.$emit('update:modelValue', '5000')
    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '9000')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    await accion(wrapper, 'Cambiar y vaciar').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('usd')
    expect(money(wrapper, 'Costo').props('modelValue')).toBe('')
    expect(money(wrapper, 'Precio base').props('modelValue')).toBe('')
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  it('desistir deja la moneda vieja y los montos donde estaban', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '9000')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    await accion(wrapper, 'Dejar la moneda como está').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)).toBeUndefined()
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('clp')
    expect(money(wrapper, 'Precio base').props('modelValue')).toBe('9000')

    wrapper.unmount()
  })

  // El modo de falla que descartó al `watch`: `abrirEditar` asigna `form.monedaId`
  // con lo que trae la API, y un watch no puede distinguir esa carga de una
  // elección. Con él vivo, abrir una ficha para editarle la descripción le vacía el
  // precio guardado — y `editingId` no sirve de guard, porque editar es justamente
  // cuando este selector se puede tocar.
  it('abrir una ficha guardada no vacía nada ni pregunta nada', async () => {
    // En OTRA moneda que la que el alta trae por default, a propósito: si la ficha
    // viniera en la misma, `form.monedaId` no cambiaría al cargarla y el test pasaría
    // con el `watch` ingenuo vivo, que es justo lo que viene a descartar.
    itemDetalleMock = { ...ITEM_PRODUCTO, monedaId: 'usd', precioBase: '12.50' }

    const wrapper = await montar()
    await abrirEditar(wrapper)

    expect(aviso(wrapper)).toBeUndefined()
    expect(money(wrapper, 'Precio base').props('modelValue')).toBe('12.50')
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('usd')

    wrapper.unmount()
  })

  // La primera versión de esto **se aplicaba sola** cuando ya no quedaba nada que vaciar, y
  // la revisión independiente midió las dos salidas que abría: borrar el campo para
  // retipearlo, y cambiar la unidad de medida —que vacía costo y precio por su cuenta—,
  // pasaban a cambiar la moneda sin que nadie confirmara. En un campo de plata la regla es
  // la contraria: nada cambia de moneda sin un click, aunque el cambio ya no cueste nada.
  it('si se vacía a mano lo que había, el aviso lo dice y sigue esperando el click', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '9000')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))
    expect(aviso(wrapper)?.props('description')).toContain('Se vacía el precio base')

    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)?.props('description')).toContain('no se vacía nada')
    // El encabezado tampoco puede prometer un vaciado que el cuerpo desmiente: es neutro
    // en los dos estados, y por eso no conmuta con ellos.
    expect(aviso(wrapper)?.props('title')).toBe('Cambiar la moneda del ítem')
    // Y sobre todo: NO se aplicó solo.
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('clp')

    await accion(wrapper, 'Cambiar la moneda').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('usd')
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  // Misma raíz, por el otro camino que la revisión midió: el watcher de `unidadMedida` vacía
  // costo y precio, y eso no puede arrastrar un cambio de moneda que nadie confirmó.
  it('cambiar la unidad, que vacía los campos, no aplica el cambio de moneda', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Costo').vm.$emit('update:modelValue', '5000')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    campo(wrapper, 'Unidad de medida')!.findComponent({ name: 'USelectMenu' })
      .vm.$emit('update:modelValue', 'kg')
    await new Promise(r => setTimeout(r, 20))

    expect(money(wrapper, 'Costo').props('modelValue')).toBe('')
    expect(money(wrapper, 'Costo').props('monedaId')).toBe('clp')

    wrapper.unmount()
  })

  // Medido por la revisión independiente en un navegador real: el camino rápido de `elegirMoneda` —el que aplica sin preguntar cuando no hay nada que
  // vaciar— aplicaba la moneda y dejaba el aviso vivo. Ese aviso huérfano prometía un cambio
  // que ya había ocurrido, y el click posterior vaciaba la plata recién tipeada sin cambiar
  // ninguna moneda.
  it('aplicar el cambio por el camino rápido no deja el aviso vivo', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '9000')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))
    expect(aviso(wrapper), 'el aviso tiene que estar antes de vaciar').toBeTruthy()

    // Ahora no queda nada que vaciar, así que elegir otra vez aplica de una…
    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('usd')
    expect(aviso(wrapper)).toBeUndefined()

    // …y lo que se tipee después es plata de la moneda nueva: nadie la puede vaciar con un
    // botón que quedó de un gesto anterior.
    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '12')
    await new Promise(r => setTimeout(r, 20))
    expect(money(wrapper, 'Precio base').props('modelValue')).toBe('12')
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  // El aviso solo puede nombrar lo que la persona ve: `form` conserva lo tipeado para un
  // tipo anterior, y ese monto ni se muestra ni se guarda.
  it('el aviso no nombra el costo de un tipo que ya no lo muestra', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Costo').vm.$emit('update:modelValue', '5000')
    await new Promise(r => setTimeout(r, 20))

    campo(wrapper, 'Tipo')!.findComponent({ name: 'USelectMenu' })
      .vm.$emit('update:modelValue', 'servicio')
    await new Promise(r => setTimeout(r, 20))
    expect(campo(wrapper, 'Costo'), 'el costo no se muestra para un servicio').toBeUndefined()

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    // Nada visible que perder: se aplica sin prometer una pérdida que no se puede ver.
    expect(aviso(wrapper)).toBeUndefined()
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('usd')

    wrapper.unmount()
  })

  // Medido por la revisión independiente: el **costo vigente** es plata de
  // este ítem que se muestra formateada con la moneda del formulario y que nadie teclea —sale
  // de los movimientos de inventario—. En un ingrediente ya guardado es el ÚNICO monto en
  // pantalla, así que sin contarlo no había nada que nombrar y la moneda cambiaba sin
  // preguntar, con el `PATCH` persistiéndola y el costo reinterpretado.
  it('un ingrediente guardado, sin un solo campo de plata, igual pregunta por su costo vigente', async () => {
    itemDetalleMock = ITEM_INGREDIENTE

    const wrapper = await montar()
    await abrirEditar(wrapper)

    // Ancla: para este tipo, en edición, no hay ni un `MoneyInput` en el drawer.
    expect(wrapper.findAllComponents({ name: 'MoneyInput' })).toHaveLength(0)
    const vigente = () => campo(wrapper, 'Costo vigente')!.text()
    expect(vigente()).toContain('1.200')

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    const texto = aviso(wrapper)?.props('description') as string
    expect(texto).toContain('El costo vigente no se puede vaciar')
    // Y NO nombra el precio base: el ingrediente trae uno guardado, pero su drawer no lo
    // muestra. Sin este `not`, quitar el corte por tipo de `camposDePlataVisibles` pasaría.
    expect(texto).not.toContain('Se vacía el precio base')
    // Y hasta que alguien confirme, el costo sigue leyéndose en la moneda de antes.
    expect(vigente()).toContain('1.200')

    await accion(wrapper, 'Cambiar la moneda').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(vigente()).toContain('1,200')
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  it('en un producto guardado el aviso nombra las dos cosas: lo que vacía y lo que reinterpreta', async () => {
    itemDetalleMock = { ...ITEM_PRODUCTO, costoActual: '400' }

    const wrapper = await montar()
    await abrirEditar(wrapper)

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    const texto = aviso(wrapper)?.props('description') as string
    expect(texto).toContain('Se vacía el precio base')
    expect(texto).toContain('El costo vigente no se puede vaciar')

    wrapper.unmount()
  })

  // Receta y combo **también** traen `costoActual` de la API, pero su drawer no muestra
  // "Costo vigente" —eso es de producto e ingrediente— sino el "Costo actual" que calcula la
  // pantalla desde los ítems que lo componen. Nombrar el primero ahí es nombrar un campo que
  // no está, y atribuirle un origen que no es el suyo.
  it('en una receta el aviso nombra el costo calculado, no el costo vigente', async () => {
    itemDetalleMock = ITEM_RECETA

    const wrapper = await montar()
    await abrirEditar(wrapper)

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    const texto = aviso(wrapper)?.props('description') as string
    expect(texto).toContain('El costo actual que se muestra abajo')
    expect(texto).not.toContain('costo vigente')

    wrapper.unmount()
  })

  // Y ese costo calculado cuenta para decidir si se pregunta: con todos los montos tipeados
  // en cero —cero es cero en cualquier moneda— es lo único que queda en pantalla, y sin
  // contarlo la moneda cambiaría sola con ese número a la vista.
  it('una receta con todos los montos en cero igual pregunta por el costo calculado', async () => {
    itemDetalleMock = {
      ...ITEM_RECETA,
      precioBase: '0',
      extrasPermitidos: ITEM_RECETA.extrasPermitidos.map(e => ({ ...e, precioExtra: '0' })),
    }

    const wrapper = await montar()
    await abrirEditar(wrapper)

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)?.props('description')).toContain('No hay montos tipeados que vaciar')
    expect(aviso(wrapper)?.props('description')).toContain('El costo actual que se muestra abajo')

    wrapper.unmount()
  })

  // El gemelo de la receta, por la otra rama: un combo tampoco muestra "Costo vigente", y su
  // "Costo actual" lo calcula la pantalla desde sus componentes. Con el precio base en cero
  // —cero es cero en cualquier moneda— ese costo es lo único que queda en pantalla, así que
  // es lo único que puede frenar el camino rápido.
  it('un combo con el precio en cero igual pregunta por su costo calculado', async () => {
    itemDetalleMock = ITEM_COMBO

    const wrapper = await montar()
    await abrirEditar(wrapper)

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    const texto = aviso(wrapper)?.props('description') as string
    expect(texto).toContain('No hay montos tipeados que vaciar')
    expect(texto).toContain('El costo actual que se muestra abajo')
    expect(texto).not.toContain('costo vigente')

    wrapper.unmount()
  })

  // La rama singular del conteo, que es el caso más común: una receta con UN extra pagado.
  it('con un solo extra pagado el aviso lo dice en singular', async () => {
    itemDetalleMock = {
      ...ITEM_RECETA,
      precioBase: '0',
      extrasPermitidos: ITEM_RECETA.extrasPermitidos.map((e, i) => ({
        ...e,
        precioExtra: i === 0 ? e.precioExtra : '0',
      })),
    }

    const wrapper = await montar()
    await abrirEditar(wrapper)

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)?.props('description')).toContain('Se vacía 1 precio de extra.')

    wrapper.unmount()
  })

  // El precio de cada opción de modificador es el único monto del drawer que es campo
  // editable, se persiste, y aun así no se vacía. No se vacía —la pantalla no puede distinguir el override de
  // este ítem del compartido del catálogo— pero cuenta igual para preguntar: si no, una receta
  // sin ningún otro monto cambia de moneda sola y `guardar` manda esos números como override
  // en la moneda nueva.
  it('con plata solo en las opciones de modificadores, igual pregunta y no las vacía', async () => {
    itemDetalleMock = {
      ...ITEM_RECETA,
      precioBase: '0',
      ingredientes: [],
      extrasPermitidos: ITEM_RECETA.extrasPermitidos.map(e => ({ ...e, precioExtra: '0' })),
    }

    const wrapper = await montar()
    await abrirEditar(wrapper)

    const precios = () => wrapper.findAllComponents({ name: 'MoneyInput' })
      .map(m => m.props('modelValue'))
    expect(precios()).toEqual(expect.arrayContaining(['1200', '300']))

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    const texto = aviso(wrapper)?.props('description') as string
    expect(texto).toContain('No hay montos tipeados que vaciar')
    expect(texto).toContain('Los precios de las opciones de modificadores tampoco se vacían')

    await accion(wrapper, 'Cambiar la moneda').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    // Se avisó, se cambió, y no se tocó ninguno: son los que no se pueden distinguir.
    expect(precios()).toEqual(expect.arrayContaining(['1200', '300']))
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  // Y el corte por tipo de esa cuenta: `form.gruposModificadores` sobrevive al cambio de tipo
  // —como el costo—, pero un servicio no muestra ninguna opción. Nombrarlas ahí es prometer
  // sobre algo que no está en pantalla.
  it('un tipo que no muestra opciones no las nombra, aunque el form las conserve', async () => {
    const wrapper = await abrirAlta()

    campo(wrapper, 'Tipo')!.findComponent({ name: 'USelectMenu' })
      .vm.$emit('update:modelValue', 'receta')
    await new Promise(r => setTimeout(r, 20))
    const agregarGrupo = wrapper.findAllComponents({ name: 'UButton' })
      .find(b => b.text().includes('Agregar grupo'))
    expect(agregarGrupo, 'botón "Agregar grupo"').toBeTruthy()
    await agregarGrupo!.trigger('click')
    campo(wrapper, 'Grupo')!.findComponent({ name: 'USelectMenu' })
      .vm.$emit('update:modelValue', 'grupo-1')
    await new Promise(r => setTimeout(r, 20))

    // Ancla: la opción quedó con el precio del catálogo, sin que nadie tipee.
    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))
    expect(aviso(wrapper)?.props('description')).toContain('opciones de modificadores')
    elegirMoneda(wrapper, 'clp')
    await new Promise(r => setTimeout(r, 20))

    campo(wrapper, 'Tipo')!.findComponent({ name: 'USelectMenu' })
      .vm.$emit('update:modelValue', 'servicio')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  // 📌 Cerrar el drawer acá **ya se puede**, desde el 2026-09-11: lo destraba el wrapper de
  // `getComputedStyle` del tope del archivo (el `Presence` de Reka leía `display` sobre un
  // objeto que happy-dom rechaza, y eso dejaba la corrida en rojo con los tests en verde).
  // Hay un caso que lo ejerce al final del describe de la unidad. Lo que NINGÚN entorno
  // discrimina —medido— es si el pendiente lo limpia el cierre o la reapertura: `abrirEditar`
  // llama a `resetDrawer()` igual. El detalle, en `docs/patterns/frontend.md` §15.

  // El tercer lugar donde el drawer guarda plata de este ítem: el precio de cada extra
  // de la receta, que vive en `receta_extras_permitidos` con FK a esta receta. El de las
  // opciones de modificadores NO se toca y esto lo fija: lo que la pantalla muestra ahí es
  // el **efectivo** (`COALESCE(override, default)`), así que un número que parece de este
  // ítem puede ser el compartido del catálogo, en uso en otras recetas.
  it('en una receta, el aviso cuenta los extras con monto y confirmar deja quietas las opciones', async () => {
    itemDetalleMock = ITEM_RECETA

    const wrapper = await montar()
    await abrirEditar(wrapper)

    const precios = () => wrapper.findAllComponents({ name: 'MoneyInput' })
      .map(m => m.props('modelValue'))
    // Ancla: sin esto el test pasaría por el lado vacío, con el drawer sin renderizar
    // ni un solo campo de plata.
    expect(precios()).toEqual(expect.arrayContaining(['8900', '500', '800', '1200', '300']))

    // Un extra en 0 —gratis, que el backend acepta— por el camino por el que se llega:
    // agregar la fila y tipear. Cero pesos son cero dólares, así que ni se cuenta ni se
    // vacía; vaciarlo dejaría sin `precioExtra` una fila que el DTO exige.
    const agregarExtra = wrapper.findAllComponents({ name: 'UButton' })
      .find(b => b.text().includes('Agregar extra'))
    expect(agregarExtra, 'botón "Agregar extra"').toBeTruthy()
    await agregarExtra!.trigger('click')
    wrapper.findAllComponents({ name: 'MoneyInput' })
      .find(m => m.props('modelValue') === '')!
      .vm.$emit('update:modelValue', '0')
    await new Promise(r => setTimeout(r, 20))

    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)?.props('description')).toContain(
      'Se vacía el precio base y 2 precios de extras.',
    )

    await accion(wrapper, 'Cambiar y vaciar').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    const despues = precios()
    expect(despues).not.toContain('8900')
    expect(despues).not.toContain('500')
    expect(despues).not.toContain('800')
    // El 0 sigue siendo 0, y los precios de las opciones no eran de este ítem.
    expect(despues).toEqual(expect.arrayContaining(['0', '1200', '300']))
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('usd')

    wrapper.unmount()
  })

  // Las dos formas de que el aviso quede describiendo algo que ya no es cierto, y que no
  // pasan por vaciar los campos: rechazar el cambio eligiendo de nuevo la moneda que ya
  // estaba, y rearmar el formulario cambiándole el tipo.
  it('volver a elegir la moneda que ya está puesta cancela el aviso', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Precio base').vm.$emit('update:modelValue', '9000')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))
    expect(aviso(wrapper), 'el aviso tiene que estar antes de rechazar').toBeTruthy()

    elegirMoneda(wrapper, 'clp')
    await new Promise(r => setTimeout(r, 20))

    expect(aviso(wrapper)).toBeUndefined()
    expect(money(wrapper, 'Precio base').props('monedaId')).toBe('clp')
    expect(money(wrapper, 'Precio base').props('modelValue')).toBe('9000')

    wrapper.unmount()
  })

  it('cambiar el tipo del ítem cancela el aviso, que ya nombraba otro formulario', async () => {
    const wrapper = await abrirAlta()

    money(wrapper, 'Costo').vm.$emit('update:modelValue', '5000')
    await new Promise(r => setTimeout(r, 20))
    elegirMoneda(wrapper, 'usd')
    await new Promise(r => setTimeout(r, 20))
    expect(aviso(wrapper)?.props('description')).toContain('el costo')

    campo(wrapper, 'Tipo')!.findComponent({ name: 'USelectMenu' })
      .vm.$emit('update:modelValue', 'servicio')
    await new Promise(r => setTimeout(r, 20))

    // El costo ya no está en pantalla: un aviso que lo nombre describe otro formulario.
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })
})

/**
 * Cambiar la UNIDAD de un ítem ya guardado (owner, 2026-09-11): se puede mientras el ítem no
 * se usó —sin movimientos de stock ni recetas que lo referencien— y vacía el precio con la
 * misma confirmación que la moneda, porque el precio es por esa unidad. Por qué no se puede lo
 * dice el backend (`unidadBloqueada`), con el mismo motivo con el que el `PATCH` rechaza.
 */
describe('configuracion/items — cambiar la unidad de un ítem guardado', () => {
  beforeEach(() => {
    esAdmin = true
    permisos = []
    itemDetalleMock = ITEM_PRODUCTO
    // Los tests de acá desmontan con el drawer abierto, y `unmount()` **no** se lleva el
    // contenido teleportado: queda un `[role="dialog"]` fantasma con su propio "Cancelar" y
    // —el de "cambiar la unidad frena"— con el MISMO título que busca el test del cierre, así
    // que anclar por texto tampoco lo distingue. Esta purga es la garantía que no depende del
    // orden de inserción, igual que `grupos-modificadores.nuxt.spec.ts:591-596` e
    // `inventario/index.nuxt.spec.ts:247-251`.
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  afterEach(() => {
    itemDetalleMock = ITEM_PRODUCTO
  })

  function campo(wrapper: Awaited<ReturnType<typeof montar>>, prefijo: string) {
    return wrapper.findAllComponents({ name: 'UFormField' })
      .find(f => String(f.props('label') ?? '').startsWith(prefijo))
  }

  function selectorUnidad(wrapper: Awaited<ReturnType<typeof montar>>) {
    return campo(wrapper, 'Unidad de medida')!.findComponent({ name: 'USelectMenu' })
  }

  function precio(wrapper: Awaited<ReturnType<typeof montar>>) {
    return campo(wrapper, 'Precio base')!.findComponent({ name: 'MoneyInput' })
  }

  function aviso(wrapper: Awaited<ReturnType<typeof montar>>) {
    return wrapper.findAllComponents({ name: 'UAlert' })
      .find(a => String(a.props('title') ?? '').startsWith('Cambiar la unidad'))
  }

  function accion(wrapper: Awaited<ReturnType<typeof montar>>, texto: string) {
    const panel = aviso(wrapper)
    expect(panel, 'aviso de cambio de unidad').toBeTruthy()
    const boton = panel!.findAllComponents({ name: 'UButton' })
      .find(b => b.text().includes(texto))
    expect(boton, `botón "${texto}" en el aviso`).toBeTruthy()
    return boton!
  }

  async function abrirEditar() {
    const wrapper = await montar()
    await wrapper.find('[title="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    return wrapper
  }

  async function elegirUnidad(wrapper: Awaited<ReturnType<typeof montar>>, unidad: string) {
    selectorUnidad(wrapper).vm.$emit('update:modelValue', unidad)
    await new Promise(r => setTimeout(r, 20))
  }

  it('un ítem que no se usó deja cambiar la unidad al editar', async () => {
    const wrapper = await abrirEditar()

    expect(selectorUnidad(wrapper).props('disabled')).toBe(false)

    wrapper.unmount()
  })

  it('un ítem que ya se usó la bloquea, y dice por qué', async () => {
    itemDetalleMock = {
      ...ITEM_PRODUCTO,
      unidadBloqueada: 'No se puede cambiar la unidad de medida de un producto con movimientos registrados',
    }
    const wrapper = await abrirEditar()

    expect(selectorUnidad(wrapper).props('disabled')).toBe(true)
    expect(String(campo(wrapper, 'Unidad de medida')!.props('help') ?? ''))
      .toContain('movimientos registrados')

    wrapper.unmount()
  })

  it('con precio cargado, cambiar la unidad frena: pregunta y todavía no toca nada', async () => {
    const wrapper = await abrirEditar()
    // Ancla: sin el precio cargado, lo de abajo pasaría por el lado vacío.
    expect(precio(wrapper).props('modelValue')).toBe('1500.0000')

    await elegirUnidad(wrapper, 'kg')

    expect(aviso(wrapper)?.props('description')).toContain('el precio base')
    // El costo vigente no se vacía: lo convierte el backend al guardar, y el aviso lo dice.
    expect(aviso(wrapper)?.props('description')).toContain('costo vigente')
    expect(precio(wrapper).props('modelValue')).toBe('1500.0000')
    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por unidad)')

    wrapper.unmount()
  })

  it('confirmar cambia la unidad y vacía el precio', async () => {
    const wrapper = await abrirEditar()

    await elegirUnidad(wrapper, 'kg')
    await accion(wrapper, 'Cambiar y vaciar').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por kg)')
    expect(precio(wrapper).props('modelValue')).toBe('')
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  it('dejarla como está no toca nada', async () => {
    const wrapper = await abrirEditar()

    await elegirUnidad(wrapper, 'kg')
    await accion(wrapper, 'Dejar la unidad como está').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por unidad)')
    expect(precio(wrapper).props('modelValue')).toBe('1500.0000')
    expect(aviso(wrapper)).toBeUndefined()

    wrapper.unmount()
  })

  // Lo levantó la revisión independiente: un precio 0 no se reinterpreta —0 por unidad es 0
  // por kilo—, así que no se pregunta y tampoco se vacía, igual que en el cambio de moneda.
  // Vaciarlo mandaba `''` en el PATCH, y el backend lo rechazaba con un 400 de validación que
  // no decía por qué.
  it('con precio 0 no pregunta, y el 0 se queda', async () => {
    itemDetalleMock = { ...ITEM_PRODUCTO, precioBase: '0.0000' }
    const wrapper = await abrirEditar()

    await elegirUnidad(wrapper, 'kg')

    expect(aviso(wrapper)).toBeUndefined()
    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por kg)')
    expect(precio(wrapper).props('modelValue')).toBe('0.0000')

    wrapper.unmount()
  })

  /**
   * Cierra el drawer de verdad, que hasta ahora NO se ejercía en este entorno —vivía solo en
   * `e2e/configuracion/items-moneda.spec.ts`— porque la transición de salida dejaba rechazos
   * sin manejar. Lo destraba el wrapper de `getComputedStyle` del tope del archivo.
   *
   * **Lo que afirma, que es la propiedad que le importa a una persona:** después de dejar una
   * unidad a medio confirmar y cerrar, volver a entrar **no arrastra** ese aviso ni un precio
   * reinterpretado. Si lo arrastrara, confirmarlo sobre el ítem SIGUIENTE le vaciaría el
   * precio por una unidad que nadie eligió para él.
   *
   * ⚠️ **Lo que NO mide, y lo levantó la revisión independiente:** la limpieza del CIERRE.
   * `abrirEditar` (`items.vue:1351`) arranca con `resetDrawer()` síncrono, así que reabrir
   * limpia el pendiente aunque cerrar no lo limpiara. Medido: comentar
   * `watch(drawerOpen, … resetDrawer())` deja este test en **verde, exit 0** — el mutante
   * sobrevive, y eso ES el hallazgo: por este camino esa línea no es observable. El mutante
   * que sí cae —comentar `unidadPendiente.value = null` DENTRO de `resetDrawer`, que es el
   * código anterior a `b9637fdc`: 1 failed / 49 passed— cae por la reapertura, no por el
   * cierre. Es la trampa que `descuentos.nuxt.spec.ts:1196-1199` ya tenía escrita: abrir y
   * cerrar comparten `resetDrawer`, así que el mutante no distingue cuál de los dos lo llamó.
   */
  it('volver a entrar después de cerrar no arrastra el cambio de unidad a medio confirmar', async () => {
    const wrapper = await abrirEditar()
    await elegirUnidad(wrapper, 'kg')
    // Ancla: sin el aviso presente acá, lo de abajo pasaría por el lado vacío.
    expect(aviso(wrapper), 'el aviso está antes de cerrar').toBeTruthy()

    // El drawer se teletransporta a `document.body`, así que su "Cancelar" se busca ahí y no
    // en el wrapper. El `beforeEach` de este describe purga los `[role="dialog"]` colgados
    // —`unmount()` no se lleva el contenido teleportado
    // (`grupos-modificadores.nuxt.spec.ts:591-596`)—, así que acá hay exactamente uno. Se toma
    // el **más reciente** de todos modos, que es la regla del repo para cuando el `body` puede
    // venir sucio (`salones.nuxt.spec.ts:286`).
    const dialogs = [...document.body.querySelectorAll('[role="dialog"]')]
    const vivo = dialogs[dialogs.length - 1]
    expect(vivo, 'el drawer abierto en el body').toBeTruthy()
    // Defensa en profundidad, no la garantía: la garantía es la purga del `beforeEach`, y con
    // ella esta aserción **no puede fallar**. Queda porque los tests de este describe desmontan
    // con el drawer abierto —y uno, con el aviso abierto y su mismo título—: si alguien saca la
    // purga, esto hace fallar el test en vez de dejarlo "cerrar" un fantasma y pasar igual.
    expect(vivo!.textContent, 'el dialog elegido es el drawer de este test')
      .toContain('Cambiar la unidad de medida')
    const cancelar = [...vivo!.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Cancelar')
    expect(cancelar, 'botón "Cancelar" del drawer').toBeTruthy()
    cancelar!.click()
    await new Promise(r => setTimeout(r, 50))

    await wrapper.find('[title="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    // Se afirma sobre los TÍTULOS —strings— y no con `toBeUndefined()` sobre el componente:
    // si el aviso sobrevive, chai intenta serializar el `VueWrapper` del `UAlert` para armar
    // el diff y revienta con `RangeError: Maximum call stack size exceeded` en vez de decir
    // qué pasó. Medido con el mutante de `resetDrawer` el 2026-09-11.
    // `filter` + `toEqual([])` en vez de `not.toContain('<título exacto>')`: con el título
    // exacto, agregarle cualquier cosa al `title` del `UAlert` volvería la aserción verde por
    // construcción. El prefijo es el mismo criterio que usa `aviso()`.
    expect(wrapper.findAllComponents({ name: 'UAlert' })
      .map(a => String(a.props('title') ?? ''))
      .filter(t => t.startsWith('Cambiar la unidad')))
      .toEqual([])
    expect(campo(wrapper, 'Precio base')?.props('label')).toBe('Precio base (por unidad)')
    expect(precio(wrapper).props('modelValue')).toBe('1500.0000')

    wrapper.unmount()
  })
})
