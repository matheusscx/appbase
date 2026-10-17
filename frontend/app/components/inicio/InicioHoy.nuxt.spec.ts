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
//   7. Vendido y cobrado son NETOS: debajo de cada uno, el desglose
//      `bruto $X · notas de crédito −$Y` / `cobrado $X · devuelto −$Y`, solo si
//      hay algo que restar; el rótulo viejo "(antes de notas de crédito)" ya no
//      está, y un neto negativo se muestra con su signo.
//
// Molde: `InicioAhora.nuxt.spec.ts` y `pages/salones/anulaciones.nuxt.spec.ts`
// (moneda oficial hidratada a mano tras montar). El body simulado tiene la
// forma exacta de `ResumenNegocioHoy` (`~/types/resumen-negocio.ts`, copiada
// campo por campo de `resumen-negocio.service.ts`) — el mock de `useApiFetch`
// contesta 200 a lo que sea, así que un DTO inventado no se vería acá.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    // 873000 − 23000 = 850000: el neto es lo que sale grande, el desglose va debajo.
    vendidoDesglose: { bruto: '873000.0000', notasCredito: '23000.0000' },
    cobrado: { hoy: '780000', semanaPasada: '0', variacion: null },
    // 791500 − 11500 = 780000.
    cobradoDesglose: { cobrado: '791500.0000', devuelto: '11500.0000' },
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
let falla500 = false

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string' || !url.includes('/resumen-negocio/hoy')) {
      return Promise.resolve(null)
    }
    llamadas.push(url)
    if (falla403) return Promise.reject({ response: { status: 403 } })
    if (falla500) return Promise.reject({ status: 500 })
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
  falla500 = false
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

// Auditoría UX 04.16: en la tablet, "Actualizar" medía 92×24 y los enlaces
// "Ver anulaciones" / "Ver mermas" 16 px de alto, uno bajo el otro.
describe('zona "Hoy" — tamaño táctil', () => {
  const M44 = /(^|\s)(min-h-11|h-11|size-11)(\s|$)/

  it('"Actualizar" y los enlaces de pérdidas miden 44 px', async () => {
    const wrapper = await montarHoy()
    const actualizar = wrapper.findAll('button').find(b => b.text().includes('Actualizar'))
    expect(actualizar!.classes().join(' ')).toMatch(M44)
    for (const texto of ['Ver anulaciones', 'Ver mermas']) {
      const enlace = wrapper.findAll('a').find(a => a.text() === texto)
      expect(enlace, texto).toBeTruthy()
      expect(enlace!.classes().join(' '), texto).toMatch(M44)
    }
    wrapper.unmount()
  })
})

describe('zona "Hoy" — tarjetas como links reales', () => {
  it('Ventas es <a href="/ventas"> y Por cobrar lleva a las ventas con saldo (04.10), focuseables con Tab', async () => {
    const wrapper = await montarHoy()

    const hrefs = wrapper.findAll('a').map(a => a.attributes('href'))
    expect(hrefs.filter(h => h === '/ventas')).toHaveLength(1)
    expect(hrefs.filter(h => h === '/ventas?porCobrar=true')).toHaveLength(1)

    wrapper.unmount()
  })

  // Auditoría UX 04.15: el `@click.prevent` incondicional se comía Cmd/Ctrl+clic y el
  // clic medio, que son la forma de comparar "Ventas" y "Cajas" lado a lado.
  it('Ctrl/Cmd+clic lo resuelve el navegador (pestaña nueva); el clic simple, el router', async () => {
    const wrapper = await montarHoy()
    const tarjeta = wrapper.findAll('a').find(a => a.attributes('href') === '/ventas')!

    const conCtrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    tarjeta.element.dispatchEvent(conCtrl)
    expect(conCtrl.defaultPrevented, 'Ctrl+clic no se frena').toBe(false)

    const conMeta = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    tarjeta.element.dispatchEvent(conMeta)
    expect(conMeta.defaultPrevented, 'Cmd+clic no se frena').toBe(false)

    const simple = new MouseEvent('click', { bubbles: true, cancelable: true })
    tarjeta.element.dispatchEvent(simple)
    expect(simple.defaultPrevented, 'el clic simple navega por el router').toBe(true)

    wrapper.unmount()
  })
})

describe('zona "Hoy" — formato', () => {
  it('la variación se escribe donde hay dato; donde es null (Cobrado) no hay línea (04.24)', async () => {
    const wrapper = await montarHoy()

    // vendido: 21%, cantidad: 20%, ticketPromedio: 1%; cobrado es null y no repite "vs. viernes pasado: —".
    expect(wrapper.text()).toContain('vs. viernes pasado: 21%')
    expect(wrapper.text()).toContain('vs. viernes pasado: 20%')
    expect(wrapper.text()).toContain('vs. viernes pasado: 1%')
    expect(wrapper.text()).not.toContain('vs. viernes pasado: —')
    expect(wrapper.text().split('vs. viernes pasado').length - 1).toBe(3)

    wrapper.unmount()
  })

  it('Vendido, Cobrado y Por cobrar llevan la cifra grande (30 px) y el rótulo chico (04.11)', async () => {
    const wrapper = await montarHoy()
    for (const qa of ['hoy-vendido', 'hoy-cobrado', 'hoy-por-cobrar']) {
      const cifra = wrapper.find(`[data-qa="${qa}"]`)
      expect(cifra.exists(), qa).toBe(true)
      expect(cifra.classes(), qa).toContain('text-3xl')
    }
    expect(wrapper.find('[data-qa="hoy-por-cobrar"]').text()).toBe('$145.000')
    expect(wrapper.text()).toContain('7 ventas por cobrar')

    wrapper.unmount()
  })

  it('Pérdidas no parte "tipo" y "N platos" en dos renglones: el renglón puede bajar entero (04.26)', async () => {
    const wrapper = await montarHoy()
    const fila = wrapper.find('[data-qa="perdida-anulacion-merma"]')
    expect(fila.exists()).toBe(true)
    expect(fila.classes()).toContain('flex-wrap')
    wrapper.unmount()
  })

  it('las tarjetas miden lo suyo: ninguna grilla de Hoy iguala los altos (04.26)', async () => {
    const wrapper = await montarHoy()
    expect(wrapper.find('[data-qa="hoy-grilla"]').classes()).toContain('items-start')
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

describe('zona "Hoy" — el neto y su desglose', () => {
  function conDesglose(
    vendidoDesglose: { bruto: string, notasCredito: string },
    cobradoDesglose: { cobrado: string, devuelto: string },
    vendidoHoy = RESUMEN_HOY.ventas.vendido.hoy,
  ): ResumenNegocioHoy {
    return {
      ...RESUMEN_HOY,
      ventas: {
        ...RESUMEN_HOY.ventas,
        vendido: { ...RESUMEN_HOY.ventas.vendido, hoy: vendidoHoy },
        vendidoDesglose,
        cobradoDesglose,
      },
    }
  }

  it('con notas de crédito, debajo del vendido se ve bruto y notas de crédito', async () => {
    respuesta = conDesglose(
      { bruto: '300000.0000', notasCredito: '20000.0000' },
      RESUMEN_HOY.ventas.cobradoDesglose,
    )
    const wrapper = await montarHoy()

    expect(wrapper.text()).toContain('bruto $300.000 · notas de crédito −$20.000')

    wrapper.unmount()
  })

  it('sin notas de crédito, la línea del vendido no está', async () => {
    respuesta = conDesglose(
      { bruto: '300000.0000', notasCredito: '0.0000' },
      RESUMEN_HOY.ventas.cobradoDesglose,
    )
    const wrapper = await montarHoy()

    expect(wrapper.text()).not.toContain('notas de crédito')
    expect(wrapper.text()).not.toContain('bruto')

    wrapper.unmount()
  })

  it('con devuelto, debajo del cobrado se ve cobrado y devuelto', async () => {
    const wrapper = await montarHoy()

    expect(wrapper.text()).toContain('cobrado $791.500 · devuelto −$11.500')

    wrapper.unmount()
  })

  it('sin devuelto, la línea del cobrado no está', async () => {
    respuesta = conDesglose(
      RESUMEN_HOY.ventas.vendidoDesglose,
      { cobrado: '791500.0000', devuelto: '0.0000' },
    )
    const wrapper = await montarHoy()

    expect(wrapper.text()).not.toContain('devuelto')
    // La del vendido sigue: una línea no tapa a la otra.
    expect(wrapper.text()).toContain('bruto $873.000 · notas de crédito −$23.000')

    wrapper.unmount()
  })

  it('el rótulo "antes de notas de crédito" ya no aparece', async () => {
    const wrapper = await montarHoy()

    expect(wrapper.text()).not.toContain('antes de notas de crédito')

    wrapper.unmount()
  })

  it('un vendido negativo se muestra con su signo', async () => {
    respuesta = conDesglose(
      { bruto: '13000.0000', notasCredito: '20000.0000' },
      RESUMEN_HOY.ventas.cobradoDesglose,
      '-7000.0000',
    )
    const wrapper = await montarHoy()

    expect(wrapper.text()).toContain('-$7.000')

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

describe('zona "Hoy" — un fallo no se queda en "Cargando…" (lote 7, 04.7)', () => {
  it('con un 500 dice que no pudo cargar y ofrece Reintentar, sin toast que se vaya', async () => {
    falla500 = true
    permisos = ['Resumen del negocio:Leer']
    const wrapper = await mountSuspended(InicioHoy)
    await new Promise(r => setTimeout(r, 20))

    expect(wrapper.text()).toContain('No pudimos cargar los datos. Reintenta.')
    expect(wrapper.text()).not.toContain('Cargando…')
    expect(wrapper.find('[data-qa="inicio-reintentar"]').exists()).toBe(true)
    expect(toasts).toEqual([])

    wrapper.unmount()
  })
})

describe('zona "Hoy" — dice de qué hora es y se refresca sola (04.3)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('junto a "Actualizar" dice "Actualizado hh:mm"', async () => {
    const wrapper = await montarHoy()
    expect(wrapper.find('[data-qa="hoy-actualizado"]').text()).toMatch(/Actualizado \d{2}:\d{2}/)
    wrapper.unmount()
  })

  it('cada 60 s vuelve a pedir el resumen, sin tocar nada', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const wrapper = await montarHoy()
    expect(llamadas.length).toBe(1)

    vi.advanceTimersByTime(60_000)
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas.length).toBe(2)

    wrapper.unmount()
  })

  it('si la última carga falló y hay números viejos, los marca como atrasados con su hora', async () => {
    const wrapper = await montarHoy()
    expect(wrapper.find('[data-qa="hoy-atrasado"]').exists()).toBe(false)

    falla500 = true
    const boton = wrapper.findAll('button').find(b => b.text().includes('Actualizar'))
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))

    const aviso = wrapper.find('[data-qa="hoy-atrasado"]')
    expect(aviso.exists()).toBe(true)
    expect(aviso.text()).toMatch(/No pudimos actualizar. Estos números son de las \d{2}:\d{2}/)
    // Los números viejos siguen a la vista.
    expect(wrapper.text()).toContain('$850.000')

    // Y cuando una carga sale bien, la marca se va.
    falla500 = false
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.find('[data-qa="hoy-atrasado"]').exists()).toBe(false)

    wrapper.unmount()
  })
})
