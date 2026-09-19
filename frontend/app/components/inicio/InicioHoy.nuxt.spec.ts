// @vitest-environment nuxt
//
// Zona "Hoy" del dashboard de inicio (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.2 y § 6). Lo que este spec fija:
//   1. Sin "Resumen del negocio: Leer" no se pide /resumen-negocio/hoy —
//      `index.vue` no monta `InicioHoy` (mismo gate que la zona "Ahora").
//   2. Con el permiso, UNA sola llamada al montar.
//   3. "Actualizar" dispara una segunda llamada.
//   4. `variacion: null` (Cobrado, en el fixture) se muestra "—" —
//      `formatPorcentaje` ya lo hace.
//   5. `perdidas.mermas.sinValorizar`: el aviso "N sin costo cargado" aparece
//      con 2 y NO aparece con 0. Misma regla, mismo aviso, por cada tipo de
//      `perdidas.anulaciones` (`AnulacionPorTipo.sinValorizar` — fix round 1,
//      ver `task-5-report.md`).
//   6. Un 403 esconde la zona entera, sin aviso de error.
//
// Molde: `InicioAhora.nuxt.spec.ts` y `pages/salones/anulaciones.nuxt.spec.ts`
// (moneda oficial hidratada a mano tras montar). El body simulado tiene la
// forma exacta de `ResumenNegocioHoy` (`~/types/resumen-negocio.ts`, copiada
// campo por campo de `resumen-negocio.service.ts`) — el mock de `useApiFetch`
// contesta 200 a lo que sea, así que un DTO inventado no se vería acá.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import InicioHoy from './InicioHoy.vue'
import Index from '~/pages/index.vue'
import type { ResumenNegocioHoy } from '~/types/resumen-negocio'

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

/**
 * `ResumenNegocioHoy` real. `fecha` 2026-09-18 es viernes (medido:
 * `Intl.DateTimeFormat('es-CL', { weekday: 'long' }).format(new Date(2026,8,18))`
 * → `"viernes"`) — "vs. viernes pasado" es lo que el bloque Ventas debe mostrar.
 * Valores todos distintos entre sí, ninguno 1, para que un mutante que cruce
 * dos campos se note.
 */
const RESUMEN_HOY: ResumenNegocioHoy = {
  fecha: '2026-09-18',
  ventas: {
    vendido: { hoy: '850000', semanaPasada: '700000', variacion: '0.2143' },
    cobrado: { hoy: '780000', semanaPasada: '0', variacion: null },
    cantidad: { hoy: 42, semanaPasada: 35, variacion: '0.2000' },
    ticketPromedio: { hoy: '20238.0952', semanaPasada: '20000', variacion: '0.0119' },
    porCanal: { fisico: '600000', online: '250000' },
  },
  porCobrar: { cantidad: 7, saldo: '145000' },
  perdidas: {
    anulaciones: [
      {
        tipo: 'merma',
        platos: '3.0000',
        precioCarta: '15000',
        costo: [{ monedaId: 'clp-1', monto: '4500' }],
        // Distinto del `sinValorizar` de mermas (2, más abajo): un mutante que
        // cruce los dos campos ("le puse el número de mermas a la anulación")
        // tiene que fallar el test.
        sinValorizar: 4,
      },
      {
        tipo: 'cortesia',
        platos: '1.0000',
        precioCarta: '8000',
        costo: [{ monedaId: 'clp-1', monto: '2000' }],
        sinValorizar: 0,
      },
    ],
    mermas: {
      cantidad: 5,
      costo: [{ monedaId: 'clp-1', monto: '12000' }],
      sinValorizar: 2,
    },
  },
  masVendidos: [
    { itemId: 'item-1', itemNombre: 'Pastel de choclo', cantidad: '18.0000', monto: '162000' },
  ],
}

let permisos: string[] = []
let esAdmin = false

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

let llamadas: string[] = []
let respuesta: ResumenNegocioHoy = RESUMEN_HOY
let falla403 = false

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string' || !url.includes('/resumen-negocio/hoy')) {
      return Promise.resolve(null)
    }
    llamadas.push(url)
    if (falla403) return Promise.reject({ response: { status: 403 } })
    return Promise.resolve(respuesta)
  }
})

let toasts: { title?: string, color?: string }[] = []
mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: { title?: string, color?: string }) => { toasts.push(t) },
  })
})

async function montarHoy() {
  const wrapper = await mountSuspended(InicioHoy)
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

async function montarIndex() {
  const wrapper = await mountSuspended(Index)
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

beforeEach(() => {
  llamadas = []
  permisos = []
  esAdmin = false
  falla403 = false
  respuesta = RESUMEN_HOY
  toasts = []
})

describe('zona "Hoy" — gate por permiso (index.vue)', () => {
  it('sin "Resumen del negocio: Leer" no pide /resumen-negocio/hoy', async () => {
    permisos = ['Salones:Ver todas']
    const wrapper = await montarIndex()

    expect(llamadas).toEqual([])

    wrapper.unmount()
  })

  it('con "Resumen del negocio: Leer", pide /resumen-negocio/hoy', async () => {
    permisos = ['Resumen del negocio:Leer']
    const wrapper = await montarIndex()

    expect(llamadas.length).toBe(1)

    wrapper.unmount()
  })
})

describe('zona "Hoy" — una sola carga y "Actualizar"', () => {
  it('hace una sola llamada al montar', async () => {
    const wrapper = await montarHoy()

    expect(llamadas.length).toBe(1)

    wrapper.unmount()
  })

  it('"Actualizar" dispara una segunda llamada', async () => {
    const wrapper = await montarHoy()
    expect(llamadas.length).toBe(1)

    const boton = wrapper.findAll('button').find(b => b.text().includes('Actualizar'))
    expect(boton, 'botón "Actualizar"').toBeTruthy()
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(llamadas.length).toBe(2)

    wrapper.unmount()
  })
})

describe('zona "Hoy" — formato', () => {
  it('variación null (Cobrado) se muestra "—"', async () => {
    const wrapper = await montarHoy()

    // vendido: 21%, cantidad: 20%, ticketPromedio: 1% — todos calculables,
    // así que el único "—" de una variación en el bloque es el de cobrado.
    expect(wrapper.text()).toContain('vs. viernes pasado: 21%')
    expect(wrapper.text()).toContain('vs. viernes pasado: —')
    expect(wrapper.text()).toContain('vs. viernes pasado: 20%')
    expect(wrapper.text()).toContain('vs. viernes pasado: 1%')

    wrapper.unmount()
  })

  it('sinValorizar > 0 muestra el aviso de mermas sin costo', async () => {
    const wrapper = await montarHoy()

    expect(wrapper.text()).toContain('2 sin costo cargado')

    wrapper.unmount()
  })

  it('sinValorizar > 0 en un tipo de anulación muestra su propio aviso, y en 0 no aparece', async () => {
    // Misma regla que mermas (spec § 4.4 / regla 6 del costo sin tipear): un
    // costo que se cae en silencio porque algunas filas no tenían costo no
    // puede desaparecer sin avisar, tampoco del lado de anulaciones. `merma`
    // trae `sinValorizar: 4` (distinto del `2` de mermas — un mutante que
    // cruce los dos campos falla acá) y `cortesia` trae `0`.
    const wrapper = await montarHoy()

    expect(wrapper.text()).toContain('4 sin costo cargado')
    // Ni "0 sin costo cargado" ni un tercer aviso además de los de merma (4)
    // y mermas (2): cortesía, con sinValorizar 0, no agrega ninguno.
    const ocurrencias = wrapper.text().split('sin costo cargado').length - 1
    expect(ocurrencias).toBe(2)

    wrapper.unmount()
  })

  it('sinValorizar = 0 (mermas y todas las anulaciones) no muestra ningún aviso', async () => {
    respuesta = {
      ...RESUMEN_HOY,
      perdidas: {
        anulaciones: RESUMEN_HOY.perdidas.anulaciones.map(a => ({ ...a, sinValorizar: 0 })),
        mermas: { ...RESUMEN_HOY.perdidas.mermas, sinValorizar: 0 },
      },
    }
    const wrapper = await montarHoy()

    expect(wrapper.text()).not.toContain('sin costo cargado')

    wrapper.unmount()
  })
})

describe('zona "Hoy" — 403', () => {
  it('un 403 esconde la zona entera, sin aviso de error', async () => {
    falla403 = true
    const wrapper = await montarHoy()

    expect(wrapper.text().trim()).toBe('')
    expect(toasts).toEqual([])

    wrapper.unmount()
  })
})
