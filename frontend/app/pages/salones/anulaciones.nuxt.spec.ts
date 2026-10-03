// @vitest-environment nuxt
//
// Reporte de anulaciones (spec `2026-09-18-reporte-anulaciones-design.md` § 6).
// Lo que este spec fija:
//   1. Las tres tarjetas del resumen (Cortesías / Mermas en mesa / No se hizo)
//      muestran sus cifras (platos, precio de carta, costo por moneda), con
//      "1 plato" en singular.
//   2. La línea "N platos sin valorizar" aparece cuando `sinValorizar > 0`,
//      con singular correcto ("1 plato sin valorizar").
//   3. El detalle: `—` en la fila `no_aplica`, badge "Sin valorizar" en la
//      fila `sin_valorizar`.
//   4. El aviso fijo de que las mermas también están en Mermas.
//   5. Cambiar el filtro de tipo vuelve a pedir LAS DOS rutas (listado y
//      resumen) con `tipo=cortesia` — comparten filtros, spec § 5.1.
//   6. Entrada 1 de `docs/agent/pendientes.md`: el resumen pedido con el día
//      del navegador y el pedido con el día de negocio ya corregido pueden
//      quedar en vuelo a la vez; el que gana es el que se INVOCÓ último, no
//      el que RESPONDE último (mismo mecanismo que `reportes/varianza.vue`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Anulaciones from './anulaciones.vue'

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

const MOTIVO_CORTESIA = { id: 'motivo-cortesia', nombre: 'Cortesía cumpleaños', activo: true, esFijo: false, tipo: 'cortesia', enUso: true }
const MOTIVO_MERMA = { id: 'motivo-merma', nombre: 'Se cayó', activo: true, esFijo: false, tipo: 'merma', enUso: true }
const MOTIVO_NO_ELABORADO = { id: 'motivo-no-elaborado', nombre: 'Cliente no llegó', activo: true, esFijo: false, tipo: 'no_elaborado', enUso: true }

/** Listado fijo: una fila por cada estado del costo que la pantalla distingue. */
const LISTADO = [
  {
    id: 'anu-no-aplica',
    creadoEl: '2026-09-18T12:00:00.000Z',
    cuentaId: 'cuenta-1',
    cuentaNumero: 5,
    mesaNombre: 'Mesa 3',
    salonNombre: 'Salón Principal',
    itemNombre: 'Ceviche',
    cantidad: '1.0000',
    motivoBajaNombre: MOTIVO_NO_ELABORADO.nombre,
    tipo: 'no_elaborado',
    garzonNombre: 'Ana',
    autorizadoPorNombre: 'Carla Jefa',
    precioCarta: '8500.0000',
    costoEstado: 'no_aplica',
    costo: [],
    fiscal: null,
  },
  {
    id: 'anu-sin-valorizar',
    creadoEl: '2026-09-18T13:00:00.000Z',
    cuentaId: 'cuenta-2',
    cuentaNumero: 7,
    mesaNombre: 'Mesa 5',
    salonNombre: 'Salón Principal',
    itemNombre: 'Lomo Saltado',
    cantidad: '2.0000',
    motivoBajaNombre: MOTIVO_MERMA.nombre,
    tipo: 'merma',
    garzonNombre: null,
    autorizadoPorNombre: 'Carla Jefa',
    precioCarta: '17000.0000',
    costoEstado: 'sin_valorizar',
    costo: [],
    fiscal: null,
  },
  {
    id: 'anu-valorizado',
    creadoEl: '2026-09-18T14:00:00.000Z',
    cuentaId: 'cuenta-3',
    cuentaNumero: 9,
    mesaNombre: 'Mesa 1',
    salonNombre: 'Salón Terraza',
    itemNombre: 'Pisco Sour',
    cantidad: '3.0000',
    motivoBajaNombre: MOTIVO_CORTESIA.nombre,
    tipo: 'cortesia',
    garzonNombre: 'Beto',
    autorizadoPorNombre: 'Carla Jefa',
    precioCarta: '9000.0000',
    costoEstado: 'valorizado',
    costo: [{ monedaId: 'clp-1', monto: '1200.0000' }],
    // Retiro gravado (spec 2026-10-03): 9.000 con IVA incluido → 7.563 + 1.437.
    fiscal: { montoAfecto: '7563.0000', montoExento: '0.0000', montoImpuestos: '1437.0000' },
  },
]

/** Resumen fijo: cubre TODO el rango, no una página — spec § 5.1. */
const RESUMEN = {
  porTipo: [
    { tipo: 'cortesia', platos: '3.0000', precioCarta: '9000.0000', costo: [{ monedaId: 'clp-1', monto: '1200.0000' }], sinValorizar: 0, fiscal: { montoAfecto: '7563.0000', montoExento: '0.0000', montoImpuestos: '1437.0000' } },
    { tipo: 'merma', platos: '2.0000', precioCarta: '17000.0000', costo: [], sinValorizar: 1, fiscal: null },
    { tipo: 'no_elaborado', platos: '1.0000', precioCarta: '8500.0000', costo: [], sinValorizar: 0, fiscal: null },
  ],
  porGarzon: [
    { garzonId: 'garzon-ana', garzonNombre: 'Ana', platos: '1.0000', precioCarta: '8500.0000', costo: [], sinValorizar: 0, pedido: '170000.0000', porcentaje: '0.0500' },
    { garzonId: null, garzonNombre: null, platos: '2.0000', precioCarta: '17000.0000', costo: [], sinValorizar: 1, pedido: '17000.0000', porcentaje: '1.0000' },
    { garzonId: 'garzon-beto', garzonNombre: 'Beto', platos: '3.0000', precioCarta: '9000.0000', costo: [{ monedaId: 'clp-1', monto: '1200.0000' }], sinValorizar: 0, pedido: '0.0000', porcentaje: null },
  ],
  porAutorizo: [
    { usuarioId: 'user-carla', usuarioNombre: 'Carla Jefa', platos: '6.0000', precioCarta: '34500.0000', costo: [{ monedaId: 'clp-1', monto: '1200.0000' }], sinValorizar: 1 },
  ],
}

/** URLs con las que se llamó a `useApiFetch`, en orden — Step 1, punto 5. */
let llamadas: string[] = []
/** Task 5: corte y día de negocio que devuelve `GET /tenants/me`. */
let horaCorteBackend = 0
let diaNegocioHoyBackend = '2026-09-18'
/** Con esto en `true`, `/tenants/me` NO resuelve solo — el test dispara
 *  `tenantMeResolver` cuando quiere, para poder tocar un filtro ANTES de que
 *  el día de negocio llegue y comprobar que el ajuste automático no lo pisa. */
let tenantMePendiente = false
let tenantMeResolver: ((v: { horaCorte: number, diaNegocioHoy: string }) => void) | null = null

/** Solo para el test de la carrera del resumen: cuando está puesto, decide la
 *  respuesta de `/salones/anulaciones/resumen` según el `desde` que trae la
 *  URL (así una llamada puede quedar pendiente y la otra resolver al toque).
 *  `null` = comportamiento normal (responde `RESUMEN`). */
let resumenDispatcher: ((url: string) => Promise<unknown>) | null = null
/** El resolver del resumen pedido con el día del navegador, que ese test
 *  deja pendiente a mano. A nivel de módulo, como `tenantMeResolver`: una
 *  `let` local `T | null = null` queda angostada a `null` en su función — TS
 *  no ve la asignación que hace el callback del `Promise` — y la llamada no
 *  tipa. Leída desde otra función (el `it`), usa el tipo declarado. */
let resolverOptimista: ((v: typeof RESUMEN) => void) | null = null

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve({ data: [], meta: {} })
    llamadas.push(url)
    if (url.includes('/tenants/me')) {
      if (tenantMePendiente) {
        return new Promise((res) => { tenantMeResolver = res })
      }
      return Promise.resolve({ horaCorte: horaCorteBackend, diaNegocioHoy: diaNegocioHoyBackend })
    }
    // Ojo con el orden: '/salones/anulaciones/resumen' también matchea
    // '/salones/anulaciones', así que el resumen se chequea primero.
    if (url.includes('/salones/anulaciones/resumen')) {
      return resumenDispatcher ? resumenDispatcher(url) : Promise.resolve(RESUMEN)
    }
    if (url.includes('/salones/anulaciones')) {
      return Promise.resolve({
        data: LISTADO,
        meta: { page: 1, pageSize: 15, total: LISTADO.length, totalPages: 1 },
      })
    }
    if (url.includes('/motivos-baja')) {
      return Promise.resolve([MOTIVO_CORTESIA, MOTIVO_MERMA, MOTIVO_NO_ELABORADO])
    }
    return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
  }
})

async function montar() {
  const wrapper = await mountSuspended(Anulaciones, {
    attachTo: document.body,
  })
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

/** Mismo criterio que `mermas.nuxt.spec.ts`: los `USelectMenu` se identifican
 *  por sus opciones, no por posición — la pantalla tiene varios filtros. */
function selectConOpcion(wrapper: Wrapper, valor: string) {
  const select = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    return Array.isArray(items) && items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}"`).toBeTruthy()
  return select!
}

async function emitir(comp: ReturnType<typeof selectConOpcion>, valor: string) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

/** 'YYYY-MM-DD' de HOY, mismo criterio que `hoyLocal()` (fecha LOCAL, no
 *  `toISOString()` que da UTC) — la página arranca sus filtros con esa
 *  función y este test necesita el mismo "hoy" para comparar. */
function hoyLocalTest(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

beforeEach(() => {
  llamadas = []
  horaCorteBackend = 0
  diaNegocioHoyBackend = hoyLocalTest()
  tenantMePendiente = false
  tenantMeResolver = null
  resumenDispatcher = null
  resolverOptimista = null
})

describe('anulaciones — resumen', () => {
  it('las tres tarjetas muestran sus cifras (platos, precio de carta, costo por moneda)', async () => {
    const wrapper = await montar()
    const texto = wrapper.text()

    expect(texto).toContain('Cortesías')
    expect(texto).toContain('Mermas en mesa')
    expect(texto).toContain('No se hizo')

    // Cortesías: 3 platos, $9.000 de carta, $1.200 de costo (CLP, 0 decimales).
    expect(texto).toContain('$9.000')
    expect(texto).toContain('$1.200')
    // No se hizo: costo no aplica, nunca una cifra.
    expect(texto).toContain('$8.500')

    wrapper.unmount()
  })

  it('muestra "1 plato sin valorizar" (singular) cuando sinValorizar === 1', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('1 plato sin valorizar')
    // Ningún grupo tiene sinValorizar 0 platos ni más de uno en este fixture.
    expect(wrapper.text()).not.toContain('1 platos sin valorizar')
    wrapper.unmount()
  })

  it('la tarjeta dice "1 plato" en singular y "3 platos" en plural', async () => {
    const wrapper = await montar()
    // Acotado a la tarjeta: en el texto de la página, "1 plato" ya lo cumple
    // "1 plato sin valorizar" de Mermas. No se hizo trae platos '1.0000' y
    // sinValorizar 0; Cortesías, '3.0000' — la rama del plural.
    const tarjeta = (titulo: string) =>
      wrapper.findAll('div.rounded-lg').find(c => c.text().includes(titulo))!.text()
    expect(tarjeta('No se hizo')).toContain('1 plato')
    expect(tarjeta('No se hizo')).not.toContain('1 platos')
    expect(tarjeta('Cortesías')).toContain('3 platos')
    wrapper.unmount()
  })

  it('solo la tarjeta de Cortesías muestra el IVA del retiro', async () => {
    const wrapper = await montar()
    const tarjeta = (titulo: string) =>
      wrapper.findAll('div.rounded-lg').find(c => c.text().includes(titulo))!.text()
    expect(tarjeta('Cortesías')).toContain('IVA: $1.437')
    expect(tarjeta('Mermas en mesa')).not.toContain('IVA')
    expect(tarjeta('No se hizo')).not.toContain('IVA')
    wrapper.unmount()
  })

  it('el aviso fijo dice que las mermas de la lista también están en Mermas', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Las mermas de esta lista también están contadas en Mermas.')
    wrapper.unmount()
  })
})

describe('anulaciones — detalle', () => {
  it('la fila no_aplica muestra "—" en costo, y la sin_valorizar un badge', async () => {
    const wrapper = await montar()

    const filaNoAplica = wrapper.findAll('tbody tr').find(f => f.text().includes('Ceviche'))
    const filaSinValorizar = wrapper.findAll('tbody tr').find(f => f.text().includes('Lomo Saltado'))
    expect(filaNoAplica, 'fila no_aplica (Ceviche)').toBeTruthy()
    expect(filaSinValorizar, 'fila sin_valorizar (Lomo Saltado)').toBeTruthy()

    // La celda de Costo, no la fila: desde que existe la columna IVA, el "—"
    // de esa columna haría pasar este test aunque el costo mostrara otra cosa.
    const COL_IVA = 8
    const COL_COSTO = 9
    expect(filaNoAplica!.findAll('td')[COL_COSTO]!.text()).toBe('—')
    expect(filaSinValorizar!.findAll('td')[COL_COSTO]!.text()).toContain('Sin valorizar')
    expect(filaNoAplica!.findAll('td')[COL_IVA]!.text()).toBe('—')

    wrapper.unmount()
  })

  it('la cortesía muestra su IVA en la columna IVA', async () => {
    const wrapper = await montar()
    const filaCortesia = wrapper.findAll('tbody tr').find(f => f.text().includes('Pisco Sour'))
    expect(filaCortesia, 'fila cortesía (Pisco Sour)').toBeTruthy()
    expect(filaCortesia!.findAll('td')[8]!.text()).toBe('$1.437')
    wrapper.unmount()
  })
})

// Ronda de fix 1 (revisión de dominio): `columnasGarzon`/`columnasAutorizo`
// declaran `platos` pero los `UTable` no tenían `platos-cell` — se veía el
// string crudo a ESCALA_COSTO ('3.0000', '6.0000') en vez de pasar por
// `formatStock`, mismo criterio que ya usan las tarjetas y el detalle.
describe('anulaciones — tablas chicas (por garzón / por quién autorizó)', () => {
  it('"Por garzón" muestra los platos formateados con formatStock, no el string crudo', async () => {
    const wrapper = await montar()

    const filaBeto = wrapper.findAll('tbody tr').find(f => f.text().includes('Beto'))
    expect(filaBeto, 'fila de Beto en "Por garzón"').toBeTruthy()
    const celdaPlatos = filaBeto!.findAll('td')[1]
    expect(celdaPlatos?.text().trim()).toBe('3')
    expect(celdaPlatos?.text()).not.toContain('3.0000')

    wrapper.unmount()
  })

  it('"Por quién autorizó" muestra los platos formateados con formatStock, no el string crudo', async () => {
    const wrapper = await montar()

    const filaCarla = wrapper.findAll('tbody tr').find(f => f.text().includes('Carla Jefa'))
    expect(filaCarla, 'fila de Carla Jefa en "Por quién autorizó"').toBeTruthy()
    const celdaPlatos = filaCarla!.findAll('td')[1]
    expect(celdaPlatos?.text().trim()).toBe('6')
    expect(celdaPlatos?.text()).not.toContain('6.0000')

    wrapper.unmount()
  })

  // Tarea 3 (spec § 5.2): "Por garzón" suma la columna "% de lo pedido",
  // formateada con `formatPorcentaje` (fracción decimal → "5,00%", `—` con
  // `null`, mismo criterio que el resto de la pantalla).
  it('"Por garzón" muestra "% de lo pedido": "5,00%" con porcentaje, "—" con null', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('% de lo pedido')

    const filaAna = wrapper.findAll('tbody tr').find(f => f.text().includes('Ana'))
    const filaBeto = wrapper.findAll('tbody tr').find(f => f.text().includes('Beto'))
    expect(filaAna, 'fila de Ana en "Por garzón"').toBeTruthy()
    expect(filaBeto, 'fila de Beto en "Por garzón"').toBeTruthy()

    // Orden de columnas tras la Tarea 3: garzón, platos, precio de carta,
    // % de lo pedido, costo, sin valorizar.
    const celdaPorcentajeAna = filaAna!.findAll('td')[3]
    const celdaPorcentajeBeto = filaBeto!.findAll('td')[3]
    expect(celdaPorcentajeAna?.text().trim()).toBe('5,00%')
    expect(celdaPorcentajeBeto?.text().trim()).toBe('—')

    wrapper.unmount()
  })
})

describe('anulaciones — filtros comparten las dos rutas', () => {
  it('cambiar el filtro de tipo vuelve a pedir listado Y resumen con tipo=cortesia', async () => {
    const wrapper = await montar()
    llamadas = []

    const selectTipo = selectConOpcion(wrapper, 'cortesia')
    await emitir(selectTipo, 'cortesia')
    await new Promise(r => setTimeout(r, 20))

    const listadoConTipo = llamadas.some(u =>
      u.includes('/salones/anulaciones?') && u.includes('tipo=cortesia'),
    )
    const resumenConTipo = llamadas.some(u =>
      u.includes('/salones/anulaciones/resumen') && u.includes('tipo=cortesia'),
    )
    expect(listadoConTipo, `listado con tipo=cortesia entre: ${JSON.stringify(llamadas)}`).toBe(true)
    expect(resumenConTipo, `resumen con tipo=cortesia entre: ${JSON.stringify(llamadas)}`).toBe(true)

    wrapper.unmount()
  })
})

// Task 5: la nota del día de negocio, debajo de la fila de filtros de fecha.
describe('anulaciones — nota del día de negocio', () => {
  it('con corte configurado, muestra la nota', async () => {
    horaCorteBackend = 5
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    wrapper.unmount()
  })

  it('sin corte (0), no muestra la nota', async () => {
    horaCorteBackend = 0
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Tu día va de')
    wrapper.unmount()
  })
})

// Task 5, brief § Step 4 — fix round 1 (revisión de dominio, BLOQUEA):
// el mecanismo anterior (flag `aplicandoDiaNegocio` + `watch`) no protegía
// nada — el `watch` es `flush: 'pre'` y corre DESPUÉS de que la función ya
// puso el flag en `false`, así que `filtrosTocados` terminaba en `true` tras
// CUALQUIER ajuste automático, tocado o no. El reemplazo lo decide ahora
// comparando el valor ACTUAL contra `hoyLocalInicial` (el `hoyLocal()` con el
// que la página arrancó) al resolver `cargar()` — sin flag, sin watch, sin
// orden de microtasks de por medio.
function ayer(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

describe('anulaciones — arranca en el día de negocio', () => {
  it('sin tocar los filtros, con diaNegocioHoy = ayer, los dos terminan en ayer', async () => {
    horaCorteBackend = 5
    diaNegocioHoyBackend = ayer()

    const wrapper = await montar()
    const vm = wrapper.vm as unknown as { filtroDesde: string, filtroHasta: string }

    expect(vm.filtroDesde).toBe(diaNegocioHoyBackend)
    expect(vm.filtroHasta).toBe(diaNegocioHoyBackend)
    wrapper.unmount()
  })

  it('si el usuario ya cambió "desde" antes de resolver, ningún filtro se pisa', async () => {
    // `/tenants/me` queda PENDIENTE a propósito: el test toca el filtro antes
    // de que el día de negocio llegue.
    tenantMePendiente = true
    horaCorteBackend = 5

    const wrapper = await mountSuspended(Anulaciones, { attachTo: document.body })
    useMonedasStore().hydrate([CLP], 'tenant-1')
    const vm = wrapper.vm as unknown as { filtroDesde: string, filtroHasta: string }
    vm.filtroDesde = '2026-01-01'

    tenantMeResolver?.({ horaCorte: 5, diaNegocioHoy: ayer() })
    await new Promise(r => setTimeout(r, 40))

    expect(vm.filtroDesde).toBe('2026-01-01')
    // "hasta" tampoco se toca: el ajuste es de a dos, y "desde" ya cambió.
    expect(vm.filtroHasta).not.toBe(ayer())
    wrapper.unmount()
  })

  it('si el usuario ya cambió "hasta" antes de resolver, ningún filtro se pisa', async () => {
    tenantMePendiente = true
    horaCorteBackend = 5

    const wrapper = await mountSuspended(Anulaciones, { attachTo: document.body })
    useMonedasStore().hydrate([CLP], 'tenant-1')
    const vm = wrapper.vm as unknown as { filtroDesde: string, filtroHasta: string }
    vm.filtroHasta = '2026-01-31'

    tenantMeResolver?.({ horaCorte: 5, diaNegocioHoy: ayer() })
    await new Promise(r => setTimeout(r, 40))

    expect(vm.filtroHasta).toBe('2026-01-31')
    expect(vm.filtroDesde).not.toBe(ayer())
    wrapper.unmount()
  })

  it('con diaNegocioHoy igual a hoyLocal(), no reasigna ni dispara una recarga extra', async () => {
    // `diaNegocioHoyBackend` por defecto (`beforeEach`) ya es `hoyLocalTest()`
    // — el caso donde el corte no mueve el día de negocio del que ve el
    // navegador, así que no hay nada que corregir.
    horaCorteBackend = 5

    const wrapper = await montar()
    const vm = wrapper.vm as unknown as { filtroDesde: string, filtroHasta: string }
    expect(vm.filtroDesde).toBe(hoyLocalTest())
    expect(vm.filtroHasta).toBe(hoyLocalTest())

    const llamadasTrasMontar = llamadas.length
    await new Promise(r => setTimeout(r, 40))

    // Sin reasignación, `watch(listFilters, cargarResumen)` y el refetch
    // interno de `usePaginatedList` no tienen motivo para disparar de nuevo.
    expect(llamadas.length).toBe(llamadasTrasMontar)
    wrapper.unmount()
  })
})

// Entrada 1 de `docs/agent/pendientes.md`: `cargarResumen()` se pide primero
// con el día del navegador (arranque optimista) y `ajustarAlDiaDeNegocio()`
// —sin `await`, ver `onMounted`— puede corregir desde/hasta, lo que dispara
// el `watch` y encola un SEGUNDO `cargarResumen()`. Sin cola, gana el que
// RESPONDE último; con ella, gana el que se INVOCÓ último — mismo mecanismo
// que `reportes/varianza.nuxt.spec.ts`.
describe('anulaciones — carrera del resumen', () => {
  afterEach(() => { vi.useRealTimers() })

  it('si el resumen pedido con el día del navegador responde DESPUÉS que el del día de negocio corregido, el resumen final es igual el corregido', async () => {
    // Reloj fijo en una fecha que NO es la de hoy (2026-10-01), para no
    // confundir el día del navegador con el día de negocio corregido.
    vi.setSystemTime(new Date(2026, 2, 1, 2, 0, 0))
    horaCorteBackend = 5
    diaNegocioHoyBackend = ayer() // '2026-02-28'

    const RESUMEN_OPTIMISTA = { ...RESUMEN, porAutorizo: [{ ...RESUMEN.porAutorizo[0]!, usuarioNombre: 'Optimista' }] }
    const RESUMEN_CORREGIDO = { ...RESUMEN, porAutorizo: [{ ...RESUMEN.porAutorizo[0]!, usuarioNombre: 'Corregido' }] }
    resumenDispatcher = (url: string) => {
      if (url.includes('desde=2026-03-01')) {
        // El resumen con el día del navegador (marzo): queda pendiente a mano.
        return new Promise<typeof RESUMEN>((res) => { resolverOptimista = res })
      }
      if (url.includes('desde=2026-02-28')) {
        // El resumen ya con el día de negocio corregido (28 de febrero): responde al toque.
        return Promise.resolve(RESUMEN_CORREGIDO)
      }
      return Promise.resolve(RESUMEN)
    }

    const wrapper = await mountSuspended(Anulaciones, { attachTo: document.body })
    useMonedasStore().hydrate([CLP], 'tenant-1')
    // Deja resolver /tenants/me y correr `ajustarAlDiaDeNegocio()`: corrige
    // los filtros → el `watch` encola un SEGUNDO `cargarResumen()` (28 de
    // febrero), detrás del primero (marzo), que queda pendiente a mano.
    await new Promise(r => setTimeout(r, 20))

    // Recién ahora responde el resumen pedido con el día del navegador —
    // tarde, después de que el corregido ya estaba encolado.
    resolverOptimista?.(RESUMEN_OPTIMISTA)
    await new Promise(r => setTimeout(r, 30))

    const vm = wrapper.vm as unknown as { resumen: typeof RESUMEN | null }
    expect(vm.resumen?.porAutorizo[0]?.usuarioNombre).toBe('Corregido')

    wrapper.unmount()
  })
})
