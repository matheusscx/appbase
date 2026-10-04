// @vitest-environment nuxt
//
// Tarea 7 del plan del reporte de varianza (spec § 8). Lo que este spec fija:
//   1. La fila `medible: false` muestra "falta contarlo" y NINGÚN número: un
//      cero ahí se leería como "cerró perfecto".
//   2. «Otros» en cero va apagado (`text-muted`) y sin botón; distinto de cero
//      va en color de alerta con un `AppInfoButton` en lenguaje del local.
//   3. La columna «Otros» NO se esconde aunque todas las filas den cero.
//   4. Lo que no se pudo medir sale como dos números: sin contar y a medio contar.
//   5. El resumen NO recibe `soloConVarianza`: su DTO no lo declara —los
//      totales no siguen esa llave— y el pipe global rechaza con 400 lo que el
//      DTO no declara, así que mandarlo tumbaría el resumen.
//   6. Con bodegas, el primer resumen sale una sola vez y ya filtrado al local.
//   7. El aviso de "sin costo" dice el número del resumen y su link filtra el
//      LISTADO (nunca el resumen); con el filtro puesto, la línea queda para
//      poder sacarlo aunque el número baje a cero.
//   8. Arranque optimista "este mes" (entrada 1 de `docs/agent/pendientes.md`):
//      se corrige contra `diaNegocioHoy` (`GET /tenants/me`) con el mismo
//      criterio que `salones/anulaciones.vue` — ver su spec para el porqué del
//      mecanismo (comparar contra el valor de arranque, sin flag ni watch).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Varianza from './varianza.vue'

// La gráfica se mockea igual que en `AppGrafica.nuxt.spec.ts`: happy-dom no
// calcula layout. Acá importa qué le pasa la pantalla, no cómo se dibuja.
vi.mock('@unovis/vue', async () => {
  const { defineComponent, h } = await import('vue')
  const stub = (name: string) => defineComponent({
    name,
    inheritAttrs: false,
    props: ['data', 'x', 'y', 'color', 'orientation', 'type', 'tickFormat', 'tickValues', 'triggers', 'numTicks', 'height', 'roundedCorners', 'gridLine'],
    setup(_, { slots }) { return () => h('div', { 'data-stub': name }, slots.default?.()) },
  })
  return {
    VisXYContainer: stub('VisXYContainer'),
    VisStackedBar: stub('VisStackedBar'),
    VisAxis: stub('VisAxis'),
    VisTooltip: stub('VisTooltip'),
  }
})

const CLP = {
  monedaId: 'clp-1',
  nombre: 'Peso chileno',
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

function fila(over: Record<string, unknown>) {
  return {
    itemId: 'item-x',
    itemNombre: 'X',
    unidadMedida: 'kg',
    ubicacionId: 'ub-local',
    ubicacionNombre: 'Local',
    medible: true,
    desdeEl: '2026-09-02T12:00:00.000Z',
    hastaEl: '2026-09-20T12:00:00.000Z',
    recuentoInicialId: 'r1',
    recuentoFinalId: 'r2',
    teorico: '10.0000',
    merma: '1.0000',
    cortesia: '0.0000',
    personal: '0.0000',
    sinExplicacion: '3.0000',
    otros: '0.0000',
    costoSinExplicacion: [{ monedaId: 'clp-1', monto: '750.0000' }],
    faltaCosto: false,
    ...over,
  }
}

let listado: ReturnType<typeof fila>[] = []

const USD = { ...CLP, monedaId: 'usd-1', nombre: 'Dólar', codigoIso: 'USD', simbolo: 'US$', decimales: 2, esOficial: false }

function top(itemNombre: string, monedaId: string, sinExplicacion: string) {
  return { itemId: itemNombre, itemNombre, merma: '100.0000', cortesia: '0.0000', sinExplicacion, monedaId }
}

const RESUMEN_BASE = {
  totales: {
    teorico: [{ monedaId: 'clp-1', monto: '5000.0000' }],
    merma: [{ monedaId: 'clp-1', monto: '400.0000' }],
    cortesia: [],
    personal: [{ monedaId: 'clp-1', monto: '1300.0000' }],
    sinExplicacion: [{ monedaId: 'clp-1', monto: '750.0000' }],
    otros: [],
  },
  top: [top('Harina', 'clp-1', '750.0000'), top('Vino importado', 'usd-1', '40.0000')],
  fueraDelTop: 7,
  faltaCosto: false,
  perdiendoSinCosto: 0,
  sinConteo: {
    nuncaContado: { total: 2, items: [{ itemId: 'a', nombre: 'Aceite' }, { itemId: 'b', nombre: 'Azúcar' }] },
    contadoUnaSolaVez: { total: 1, items: [{ itemId: 'c', nombre: 'Café' }] },
  },
}

let RESUMEN: typeof RESUMEN_BASE = RESUMEN_BASE
let llamadas: string[] = []
const LOCAL = { id: 'ub-local', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'ub-bodega', nombre: 'Bodega', tipo: 'bodega', activo: true }
let ubicacionesBackend: typeof LOCAL[] = [LOCAL]

/** 'YYYY-MM-DD' de HOY, mismo criterio que `hoyLocal()` (fecha LOCAL, no
 *  `toISOString()` que da UTC) — mismo helper que `anulaciones.nuxt.spec.ts`. */
function hoyLocalTest(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** Task 1 de `docs/agent/pendientes.md`: corte y día de negocio que devuelve
 *  `GET /tenants/me`. Default = HOY (sin `vi.setSystemTime`, el reloj real):
 *  así ningún test preexistente —que no sabe nada de día de negocio— dispara
 *  el ajuste automático sin querer. */
let horaCorteBackend = 0
let diaNegocioHoyBackend = hoyLocalTest()
/** Con esto en `true`, `/tenants/me` NO resuelve solo — el test dispara
 *  `tenantMeResolver` cuando quiere, para tocar un filtro ANTES de que el día
 *  de negocio llegue y comprobar que el ajuste automático no lo pisa. */
let tenantMePendiente = false
let tenantMeResolver: ((v: { horaCorte: number, diaNegocioHoy: string }) => void) | null = null

/** Solo para el test de la carrera del resumen: cuando está puesto, decide la
 *  respuesta de `/reportes/varianza/resumen` según el `desde` que trae la URL
 *  (así una llamada puede quedar pendiente y la otra resolver al toque). `null`
 *  = comportamiento normal (responde `RESUMEN`). */
let resumenDispatcher: ((url: string) => Promise<unknown>) | null = null
/** El resolver del resumen "optimista" que ese test deja pendiente a mano.
 *  A nivel de módulo, como `tenantMeResolver`: una `let` local `T | null = null`
 *  queda angostada a `null` en su función —TS no ve la asignación que hace el
 *  callback del `Promise`— y la llamada no tipa. Leída desde otra función
 *  (el `it`), usa el tipo declarado. */
let resolverOptimista: ((v: typeof RESUMEN_BASE) => void) | null = null

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve({})
    llamadas.push(url)
    if (url.includes('/tenants/me')) {
      if (tenantMePendiente) {
        return new Promise((res) => { tenantMeResolver = res })
      }
      return Promise.resolve({ horaCorte: horaCorteBackend, diaNegocioHoy: diaNegocioHoyBackend })
    }
    if (url.includes('/ubicaciones')) {
      return Promise.resolve(ubicacionesBackend)
    }
    // '/reportes/varianza/resumen' también matchea '/reportes/varianza': primero el resumen.
    if (url.includes('/reportes/varianza/resumen')) {
      return resumenDispatcher ? resumenDispatcher(url) : Promise.resolve(RESUMEN)
    }
    if (url.includes('/reportes/varianza')) {
      return Promise.resolve({
        data: listado,
        meta: { page: 1, pageSize: 15, total: listado.length, totalPages: 1 },
      })
    }
    return Promise.resolve({})
  }
})

async function montar() {
  const wrapper = await mountSuspended(Varianza, { attachTo: document.body })
  useMonedasStore().hydrate([CLP, USD], 'tenant-1')
  await new Promise(r => setTimeout(r, 30))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

function filaDe(wrapper: Wrapper, nombre: string) {
  const tr = wrapper.findAll('tbody tr').find(f => f.text().includes(nombre))
  expect(tr, `fila de "${nombre}"`).toBeTruthy()
  return tr!
}

beforeEach(() => {
  llamadas = []
  ubicacionesBackend = [LOCAL]
  RESUMEN = RESUMEN_BASE
  horaCorteBackend = 0
  diaNegocioHoyBackend = hoyLocalTest()
  tenantMePendiente = false
  tenantMeResolver = null
  resumenDispatcher = null
  resolverOptimista = null
  listado = [
    fila({ itemId: 'harina', itemNombre: 'Harina' }),
    fila({ itemId: 'queso', itemNombre: 'Queso', otros: '2.0000' }),
    fila({
      itemId: 'tomate',
      itemNombre: 'Tomate',
      medible: false,
      hastaEl: null,
      recuentoFinalId: null,
      teorico: null,
      merma: null,
      cortesia: null,
      personal: null,
      sinExplicacion: null,
      otros: null,
      costoSinExplicacion: [],
    }),
  ]
})

describe('varianza — tabla', () => {
  it('la fila que no se puede medir dice "falta contarlo" y no muestra números', async () => {
    const wrapper = await montar()
    const tr = filaDe(wrapper, 'Tomate')
    expect(tr.text()).toContain('falta contarlo')
    // Ni cantidades ni plata: la única cifra permitida es la fecha de la ventana.
    const celdas = tr.findAll('td').map(td => td.text())
    expect(celdas.some(c => /\$|kg/.test(c))).toBe(false)
    wrapper.unmount()
  })

  it('«Otros» en cero va apagado y sin botón; distinto de cero, en alerta con explicación', async () => {
    const wrapper = await montar()

    const cero = filaDe(wrapper, 'Harina').find('[data-qa="varianza-otros"]')
    expect(cero.classes()).toContain('text-muted')
    expect(cero.findComponent({ name: 'AppInfoButton' }).exists()).toBe(false)

    const conResiduo = filaDe(wrapper, 'Queso').find('[data-qa="varianza-otros"]')
    expect(conResiduo.classes()).toContain('text-warning')
    const info = conResiduo.findComponent({ name: 'AppInfoButton' })
    expect(info.exists()).toBe(true)
    expect(String(info.props('text'))).toContain('no supo clasificar')
    wrapper.unmount()
  })

  // Spec 2026-10-04-comida-del-personal § 3.5: columna propia, con su cantidad.
  it('la comida del personal tiene su columna, con la cantidad de la fila', async () => {
    listado = [fila({ itemId: 'harina', itemNombre: 'Harina', personal: '7.0000' })]
    const wrapper = await montar()
    const encabezados = wrapper.findAll('thead th').map(th => th.text())
    expect(encabezados).toContain('Personal')
    const idx = encabezados.indexOf('Personal')
    expect(filaDe(wrapper, 'Harina').findAll('td')[idx]!.text()).toContain('7')
    wrapper.unmount()
  })

  it('la columna «Otros» sigue aunque todas las filas den cero', async () => {
    listado = [fila({ itemId: 'harina', itemNombre: 'Harina' })]
    const wrapper = await montar()
    const encabezados = wrapper.findAll('thead th').map(th => th.text())
    expect(encabezados).toContain('Otros')
    wrapper.unmount()
  })
})

describe('varianza — resumen', () => {
  // Spec 2026-10-04: la comida del personal tiene su total, pero no es pérdida.
  it('la tarjeta de Comida del personal muestra su total', async () => {
    const wrapper = await montar()
    const tarjeta = wrapper.findAll('div').find(d =>
      d.text().startsWith('Comida del personal') && d.text().length < 60)
    expect(tarjeta, 'tarjeta de Comida del personal').toBeTruthy()
    expect(tarjeta!.text()).toContain('$1.300')
    wrapper.unmount()
  })

  it('lo que no se pudo medir sale en dos números: sin contar y a medio contar', async () => {
    const wrapper = await montar()
    const linea = wrapper.find('[data-qa="varianza-sin-conteo"]')
    expect(linea.text()).toContain('2 productos sin contar')
    expect(linea.text()).toContain('1 a medio contar')
    wrapper.unmount()
  })

  /**
   * Con bodegas la pantalla arranca en el local. Si el resumen se pidiera antes
   * de saberlo, saldrían dos —"todas" y "el local"— y nada descarta la vieja:
   * si "todas" vuelve última, las tarjetas no son las de la tabla.
   */
  it('con bodegas pide el resumen una sola vez, y ya para el local', async () => {
    ubicacionesBackend = [BODEGA, LOCAL]
    const wrapper = await montar()
    const resumenes = llamadas.filter(u => u.includes('/reportes/varianza/resumen?'))
    expect(resumenes).toHaveLength(1)
    expect(resumenes[0]).toContain('ubicacionId=ub-local')
    wrapper.unmount()
  })

  it('el listado lleva soloConVarianza y el resumen no', async () => {
    const wrapper = await montar()
    const lista = llamadas.find(u => u.includes('/reportes/varianza?'))
    const resumen = llamadas.find(u => u.includes('/reportes/varianza/resumen?'))
    expect(lista).toContain('soloConVarianza=true')
    expect(resumen).toBeTruthy()
    expect(resumen).not.toContain('soloConVarianza')
    expect(resumen).toMatch(/desde=\d{4}-\d{2}-\d{2}/)
    expect(resumen).toMatch(/hasta=\d{4}-\d{2}-\d{2}/)
    wrapper.unmount()
  })
})

describe('varianza — aviso de sin costo', () => {
  it('sin filas que pierdan sin costo, no hay línea', async () => {
    const wrapper = await montar()
    expect(wrapper.find('[data-qa="varianza-sin-costo"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('dice cuántos, y su link filtra el listado y no el resumen', async () => {
    RESUMEN = { ...RESUMEN_BASE, perdiendoSinCosto: 3 }
    const wrapper = await montar()
    const linea = wrapper.find('[data-qa="varianza-sin-costo"]')
    expect(linea.text()).toContain('3 productos no tienen costo y pueden estar perdiendo plata.')
    expect(llamadas.some(u => u.includes('soloSinCosto'))).toBe(false)

    llamadas = []
    await wrapper.find('[data-qa="varianza-sin-costo-link"]').trigger('click')
    await new Promise(r => setTimeout(r, 30))

    const lista = llamadas.find(u => u.includes('/reportes/varianza?'))
    expect(lista).toContain('soloSinCosto=true')
    // «Solo con diferencia» sigue como estaba: el conjunto del aviso ya está adentro.
    expect(lista).toContain('soloConVarianza=true')
    expect(llamadas.some(u => u.includes('/resumen?') && u.includes('soloSinCosto'))).toBe(false)
    expect(wrapper.find('[data-qa="varianza-sin-costo-link"]').text()).toBe('Ver todos')
    wrapper.unmount()
  })

  it('con el filtro puesto, la línea queda aunque el número baje a cero', async () => {
    RESUMEN = { ...RESUMEN_BASE, perdiendoSinCosto: 1 }
    const wrapper = await montar()
    expect(wrapper.find('[data-qa="varianza-sin-costo"]').text())
      .toContain('1 producto no tiene costo y puede estar perdiendo plata.')
    await wrapper.find('[data-qa="varianza-sin-costo-link"]').trigger('click')

    RESUMEN = { ...RESUMEN_BASE, perdiendoSinCosto: 0 }
    // Otro rango: el resumen se vuelve a pedir y ya no hay ninguno.
    wrapper.findComponent({ name: 'AppRangoFechas' }).vm.$emit('update:desde', '2026-09-10')
    await new Promise(r => setTimeout(r, 30))

    const linea = wrapper.find('[data-qa="varianza-sin-costo"]')
    expect(linea.exists()).toBe(true)
    expect(linea.text()).toContain('Ningún producto sin costo está perdiendo plata.')
    expect(wrapper.find('[data-qa="varianza-sin-costo-link"]').text()).toBe('Ver todos')
    wrapper.unmount()
  })
})

describe('varianza — gráfica', () => {
  /**
   * El top viene ordenado por magnitud cruda, mezclando monedas. En una misma
   * gráfica el largo de una barra en pesos y otra en dólares no se compara:
   * se grafica solo la moneda oficial y el resto se cuenta aparte.
   */
  it('grafica solo la moneda oficial, sin «Otros», y dice cuántos quedaron afuera', async () => {
    const wrapper = await montar()
    const grafica = wrapper.findComponent({ name: 'AppGrafica' })
    expect(grafica.exists()).toBe(true)
    expect(grafica.props('categorias')).toEqual(['Harina'])
    const nombres = (grafica.props('series') as { nombre: string }[]).map(s => s.nombre)
    expect(nombres).toEqual(['Sin explicación', 'Merma', 'Cortesía'])
    expect(nombres).not.toContain('Otros')

    const pie = wrapper.find('[data-qa="varianza-grafica-pie"]').text()
    expect(pie).toContain('Y 7 productos más')
    expect(pie).toContain('1 en otra moneda no se grafica.')
    wrapper.unmount()
  })

  it('el valor se escribe con la moneda de su producto', async () => {
    const wrapper = await montar()
    const formato = wrapper.findComponent({ name: 'AppGrafica' }).props('formato') as
      (v: string, i: number) => string
    expect(formato('750.0000', 0)).toBe('$750')
    wrapper.unmount()
  })

  /**
   * Un sobrante entra con `sinExplicacion` negativo. Apilado junto a la merma se
   * superpondría con ella y acortaría la barra: no es plata perdida, así que no
   * se dibuja —la tabla lo tiene— y el pie lo dice.
   */
  it('un sobrante no se apila con las pérdidas: se grafica en cero y se avisa', async () => {
    RESUMEN = { ...RESUMEN_BASE, top: [top('Harina', 'clp-1', '750.0000'), top('Azúcar', 'clp-1', '-300.0000')] }
    const wrapper = await montar()
    const series = wrapper.findComponent({ name: 'AppGrafica' }).props('series') as
      { nombre: string, valores: string[] }[]
    expect(series.find(s => s.nombre === 'Sin explicación')!.valores).toEqual(['750.0000', '0'])
    expect(wrapper.find('[data-qa="varianza-grafica-pie"]').text()).toContain('1 con sobrante')
    wrapper.unmount()
  })

  /** El store de monedas carga en paralelo con el resumen; sin él, no se adivina. */
  it('sin la moneda oficial todavía, la gráfica espera en vez de mezclar monedas', async () => {
    const wrapper = await montar()
    useMonedasStore().hydrate([], 'tenant-1')
    await new Promise(r => setTimeout(r, 10))
    const grafica = wrapper.findComponent({ name: 'AppGrafica' })
    expect(grafica.props('cargando')).toBe(true)
    expect(grafica.props('categorias')).toEqual([])
    expect(wrapper.find('[data-qa="varianza-grafica-pie"]').text()).not.toContain('otra moneda')
    wrapper.unmount()
  })

  /**
   * Si `/monedas` falló, la moneda oficial no llega nunca: esperarla dejaba el
   * esqueleto de carga para siempre. Es un fallo y se dice como fallo.
   */
  it('si las monedas no cargaron, la gráfica muestra el fallo, no un esqueleto eterno', async () => {
    const wrapper = await montar()
    const monedas = useMonedasStore()
    monedas.reset()
    monedas.error = 'Error al cargar monedas'
    await new Promise(r => setTimeout(r, 10))
    const grafica = wrapper.findComponent({ name: 'AppGrafica' })
    expect(grafica.props('fallo')).toBe(true)
    expect(grafica.props('cargando')).toBe(false)
    monedas.error = null
    wrapper.unmount()
  })

  it('sin top, la gráfica muestra su estado vacío', async () => {
    RESUMEN = { ...RESUMEN_BASE, top: [], fueraDelTop: 0 }
    const wrapper = await montar()
    expect(wrapper.findComponent({ name: 'AppGrafica' }).props('vacio')).toBe(true)
    wrapper.unmount()
  })
})

// Entrada 1 de `docs/agent/pendientes.md`: el arranque "este mes" con
// `hoyLocal()` (reloj del navegador) puede pedir un mes que el tenant no
// empezó — entre las 00:00 y la hora de corte, o con el navegador en otra
// zona. Mismo mecanismo que `anulaciones.vue` § "arranca en el día de
// negocio": comparar el valor ACTUAL contra el de arranque, sin flag ni watch.
//
// El reloj fijo de estos tests es 1-mar-2026 (NO "hoy" del runner): si la
// fecha fija coincidiera con la fecha real, el mutante del punto 1 fallaría
// igual aunque `vi.setSystemTime` no hiciera nada, y el test no probaría lo
// que dice probar.
describe('varianza — arranca en el mes del día de negocio', () => {
  afterEach(() => { vi.useRealTimers() })

  it('con diaNegocioHoy en el mes ANTERIOR al del reloj, desde y hasta terminan ahí', async () => {
    // Reloj del navegador: 1 de marzo de 2026, tempranito, antes de la hora
    // de corte — el caso de riesgo real. `vi.setSystemTime` sin
    // `useFakeTimers` solo fija `Date`; `setTimeout` sigue siendo real.
    vi.setSystemTime(new Date(2026, 2, 1, 2, 0, 0))
    horaCorteBackend = 5
    diaNegocioHoyBackend = '2026-02-28' // el tenant todavía no cerró febrero

    const wrapper = await montar()
    const vm = wrapper.vm as unknown as { filtroDesde: string | null, filtroHasta: string | null }

    expect(vm.filtroDesde).toBe('2026-02-01')
    expect(vm.filtroHasta).toBe('2026-02-28')

    // La corrección llega DESPUÉS del fetch inicial (que salió con el rango
    // optimista): la llamada que importa es la ÚLTIMA de cada ruta, no la primera.
    const lista = llamadas.filter(u => u.includes('/reportes/varianza?')).pop()
    const resumen = llamadas.filter(u => u.includes('/reportes/varianza/resumen?')).pop()
    expect(lista).toContain('desde=2026-02-01')
    expect(lista).toContain('hasta=2026-02-28')
    expect(resumen).toContain('desde=2026-02-01')
    expect(resumen).toContain('hasta=2026-02-28')

    wrapper.unmount()
  })

  // Punto 2 de la ronda de revisión: sin esto, nada en el archivo comprueba
  // que `vi.useRealTimers()` de verdad revierte un `setSystemTime` que se usó
  // SIN `useFakeTimers` (según el código fuente de la versión instalada,
  // `setSystemTime` sin fake timers solo llama a `mockDate`, y `useRealTimers`
  // lo revierte con `resetDate` — pero el código fuente no es el test). Corre
  // JUSTO DESPUÉS del test de arriba, que fijó el reloj a 1-mar-2026.
  it('el afterEach del test anterior ya restauró el reloj real', () => {
    const real = new Date()
    // Si `useRealTimers()` no hubiera revertido el `setSystemTime` del test
    // de arriba, acá seguiría viéndose el 1-mar-2026 (año 2026, mes de marzo
    // = índice 2) en vez de la fecha real de la corrida.
    expect(real.getFullYear() === 2026 && real.getMonth() === 2).toBe(false)
  })

  it('si el usuario ya tocó un filtro antes de que resuelva /tenants/me, no se pisa', async () => {
    vi.setSystemTime(new Date(2026, 2, 1, 2, 0, 0))
    tenantMePendiente = true
    horaCorteBackend = 5

    const wrapper = await mountSuspended(Varianza, { attachTo: document.body })
    useMonedasStore().hydrate([CLP, USD], 'tenant-1')
    const vm = wrapper.vm as unknown as { filtroDesde: string | null, filtroHasta: string | null }
    vm.filtroDesde = '2026-01-01'

    tenantMeResolver?.({ horaCorte: 5, diaNegocioHoy: '2026-02-28' })
    await new Promise(r => setTimeout(r, 40))

    expect(vm.filtroDesde).toBe('2026-01-01')
    // "hasta" tampoco se toca: el ajuste es de a dos, y "desde" ya cambió.
    expect(vm.filtroHasta).not.toBe('2026-02-28')

    wrapper.unmount()
  })

  /**
   * Ronda de revisión: `ajustarAlDiaDeNegocio()` (sin `await`) corre en
   * paralelo con `prepararUbicaciones()`, y las dos pueden invocar
   * `cargarResumen()`. Sin serializar, gana quien RESPONDA último — acá se
   * fuerza justo ese orden adverso (el optimista responde después que el
   * corregido) para comprobar que, de todas formas, gana quien se INVOCÓ
   * último.
   */
  it('si la respuesta del resumen optimista llega DESPUÉS que la del corregido, el resumen final es igual el corregido', async () => {
    vi.setSystemTime(new Date(2026, 2, 1, 2, 0, 0))
    horaCorteBackend = 5
    tenantMePendiente = true // retiene /tenants/me para que ubicaciones resuelva primero

    const RESUMEN_OPTIMISTA = { ...RESUMEN_BASE, fueraDelTop: 111 }
    const RESUMEN_CORREGIDO = { ...RESUMEN_BASE, fueraDelTop: 222 }
    resumenDispatcher = (url: string) => {
      if (url.includes('desde=2026-03-01')) {
        // El resumen con el rango optimista (marzo): queda pendiente a mano.
        return new Promise<typeof RESUMEN_BASE>((res) => { resolverOptimista = res })
      }
      if (url.includes('desde=2026-02-01')) {
        // El resumen ya corregido (febrero): responde al toque.
        return Promise.resolve(RESUMEN_CORREGIDO)
      }
      return Promise.resolve(RESUMEN_BASE)
    }

    const wrapper = await mountSuspended(Varianza, { attachTo: document.body })
    useMonedasStore().hydrate([CLP, USD], 'tenant-1')
    // Deja resolver ubicaciones: dispara el `cargarResumen()` explícito de
    // `onMounted` con el rango optimista (marzo) — y lo deja pendiente.
    await new Promise(r => setTimeout(r, 20))

    // Ahora llega /tenants/me: corrige los filtros → el `watch` encola un
    // SEGUNDO `cargarResumen()` (febrero), detrás del primero.
    tenantMeResolver?.({ horaCorte: 5, diaNegocioHoy: '2026-02-28' })
    await new Promise(r => setTimeout(r, 20))

    // Recién ahora responde el optimista — tarde, después de que el
    // corregido ya estaba encolado.
    resolverOptimista?.(RESUMEN_OPTIMISTA)
    await new Promise(r => setTimeout(r, 30))

    const vm = wrapper.vm as unknown as { resumen: typeof RESUMEN_BASE | null }
    expect(vm.resumen?.fueraDelTop).toBe(222)

    wrapper.unmount()
  })

  it('con diaNegocioHoy igual a hoyLocal(), no reasigna ni dispara una recarga extra', async () => {
    // `diaNegocioHoyBackend` por defecto (`beforeEach`) ya es `hoyLocalTest()`
    // — el corte no mueve el día de negocio del que ve el navegador, así que
    // no hay nada que corregir.
    horaCorteBackend = 5

    const wrapper = await montar()
    const vm = wrapper.vm as unknown as { filtroDesde: string | null, filtroHasta: string | null }
    const hoy = hoyLocalTest()
    expect(vm.filtroDesde).toBe(`${hoy.slice(0, 8)}01`)
    expect(vm.filtroHasta).toBe(hoy)

    const llamadasTrasMontar = llamadas.length
    await new Promise(r => setTimeout(r, 40))

    // Sin reasignación, `watch(filtrosComunes, cargarResumen)` y el refetch
    // interno de `usePaginatedList` no tienen motivo para disparar de nuevo.
    expect(llamadas.length).toBe(llamadasTrasMontar)

    wrapper.unmount()
  })
})
