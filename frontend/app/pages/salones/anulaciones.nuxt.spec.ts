// @vitest-environment nuxt
//
// Reporte de anulaciones (spec `2026-09-18-reporte-anulaciones-design.md` § 6).
// Lo que este spec fija:
//   1. Las tres tarjetas del resumen (Cortesías / Mermas en mesa / No se hizo)
//      muestran sus cifras (platos, precio de carta, costo por moneda).
//   2. La línea "N platos sin valorizar" aparece cuando `sinValorizar > 0`,
//      con singular correcto ("1 plato sin valorizar").
//   3. El detalle: `—` en la fila `no_aplica`, badge "Sin valorizar" en la
//      fila `sin_valorizar`.
//   4. El aviso fijo de que las mermas también están en Mermas.
//   5. Cambiar el filtro de tipo vuelve a pedir LAS DOS rutas (listado y
//      resumen) con `tipo=cortesia` — comparten filtros, spec § 5.1.
import { describe, it, expect, beforeEach } from 'vitest'
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
  },
]

/** Resumen fijo: cubre TODO el rango, no una página — spec § 5.1. */
const RESUMEN = {
  porTipo: [
    { tipo: 'cortesia', platos: '3.0000', precioCarta: '9000.0000', costo: [{ monedaId: 'clp-1', monto: '1200.0000' }], sinValorizar: 0 },
    { tipo: 'merma', platos: '2.0000', precioCarta: '17000.0000', costo: [], sinValorizar: 1 },
    { tipo: 'no_elaborado', platos: '1.0000', precioCarta: '8500.0000', costo: [], sinValorizar: 0 },
  ],
  porGarzon: [
    { garzonId: 'garzon-ana', garzonNombre: 'Ana', platos: '1.0000', precioCarta: '8500.0000', costo: [], sinValorizar: 0 },
    { garzonId: null, garzonNombre: null, platos: '2.0000', precioCarta: '17000.0000', costo: [], sinValorizar: 1 },
    { garzonId: 'garzon-beto', garzonNombre: 'Beto', platos: '3.0000', precioCarta: '9000.0000', costo: [{ monedaId: 'clp-1', monto: '1200.0000' }], sinValorizar: 0 },
  ],
  porAutorizo: [
    { usuarioId: 'user-carla', usuarioNombre: 'Carla Jefa', platos: '6.0000', precioCarta: '34500.0000', costo: [{ monedaId: 'clp-1', monto: '1200.0000' }], sinValorizar: 1 },
  ],
}

/** URLs con las que se llamó a `useApiFetch`, en orden — Step 1, punto 5. */
let llamadas: string[] = []

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
    // Ojo con el orden: '/salones/anulaciones/resumen' también matchea
    // '/salones/anulaciones', así que el resumen se chequea primero.
    if (url.includes('/salones/anulaciones/resumen')) {
      return Promise.resolve(RESUMEN)
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

beforeEach(() => {
  llamadas = []
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

    expect(filaNoAplica!.text()).toContain('—')
    expect(filaSinValorizar!.text()).toContain('Sin valorizar')

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
