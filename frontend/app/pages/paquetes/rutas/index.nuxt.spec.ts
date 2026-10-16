// @vitest-environment nuxt
//
// Rutas: el rango por defecto, las cuatro tarjetas (salen de `/resumen`, la página no suma nada),
// una fila por hoja con su link al detalle, y que cambiar el rango recargue las dos consultas.
// El mock de `useApiFetch` contesta lo que se le pida, así que cada caso afirma la URL de las
// llamadas: un test que solo mira la pantalla pasaría aunque la página no pidiera nada.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Rutas from './index.vue'
import { hoyLocal } from '~/composables/useVigenciaRegla'
import type { HojaRutaFila, ResumenPaqueteria } from '~/types/paqueteria'

type Llamada = { url: string, method: string }

function hoja(parcial: Partial<HojaRutaFila> & { id: string }): HojaRutaFila {
  return {
    repartidorId: 'r-1',
    repartidorNombre: 'Juan Pérez',
    fecha: '2026-10-14',
    estado: 'abierta',
    rendidaEl: null,
    asignados: 10,
    enRuta: 0,
    entregados: 8,
    cobroDestino: 3,
    montoCobradoDestino: '30000',
    montoPagoRepartidor: '8000',
    montoTotalGeneral: '20000',
    netoARendir: '22000',
    ...parcial,
  }
}

const RESUMEN: ResumenPaqueteria = {
  asignados: 25,
  entregados: 21,
  cobroDestino: 7,
  montoCobradoDestino: '70000',
  montoTotalGeneral: '52500',
  montoPagoRepartidor: '21000',
}

let llamadas: Llamada[] = []
let diaNegocio: { horaCorte: number, diaNegocioHoy: string } | null = null
let filas: HojaRutaFila[] = []
let resumen: ResumenPaqueteria = RESUMEN
let falloLista: string | null = null
// Compuertas por `desde`: la lista de ese rango no contesta hasta que el test la abra.
let compuertas: Record<string, () => void> = {}
let esperando: Record<string, Promise<void>> = {}
let filasPorDesde: Record<string, HojaRutaFila[]> = {}
let toasts: { title?: string, color?: string }[] = []

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title?: string, color?: string }) => { toasts.push(t) } })
})

mockNuxtImport('useApiFetch', () => {
  return async (url: string, opts?: { method?: string }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method })
    if (url.includes('/tenants/me')) {
      return diaNegocio ? { ...diaNegocio } : Promise.reject(new Error('sin red'))
    }
    const desde = new URL(url, 'http://x').searchParams.get('desde') ?? ''
    if (esperando[desde] && !url.includes('/resumen')) await esperando[desde]
    if (url.includes('/hojas-ruta/resumen')) return { ...resumen }
    if (url.includes('/hojas-ruta?')) {
      if (falloLista) return Promise.reject({ data: { message: falloLista } })
      return (filasPorDesde[desde] ?? filas).map(f => ({ ...f }))
    }
    return []
  }
})

async function esperar(ms = 20) {
  await new Promise(r => setTimeout(r, ms))
}

async function montar() {
  useMonedasStore().hydrate([{
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
  }], 'tenant-1')
  const wrapper = await mountSuspended(Rutas, { attachTo: document.body })
  await esperar(40)
  return wrapper
}

const qa = (id: string) => document.body.querySelector<HTMLElement>(`[data-qa="${id}"]`)
const texto = (id: string) => qa(id)?.textContent?.replace(/\s+/g, ' ').trim()
const listas = () => llamadas.filter(l => /\/hojas-ruta\?/.test(l.url))
const resumenes = () => llamadas.filter(l => l.url.includes('/hojas-ruta/resumen'))

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas = []
  diaNegocio = { horaCorte: 3, diaNegocioHoy: '2026-10-14' }
  filas = [
    hoja({ id: 'h-1' }),
    hoja({ id: 'h-2', repartidorId: 'r-3', repartidorNombre: 'Beto Rojas', fecha: '2026-10-13', netoARendir: '-5000', estado: 'rendida' }),
  ]
  resumen = { ...RESUMEN }
  falloLista = null
  compuertas = {}
  esperando = {}
  filasPorDesde = {}
  toasts = []
})

describe('rutas: el rango por defecto', () => {
  it('son los últimos 7 días terminando en el día del negocio, y cada consulta sale una sola vez', async () => {
    await montar()

    expect(listas().map(l => l.url)).toEqual([expect.stringContaining('/hojas-ruta?desde=2026-10-08&hasta=2026-10-14')])
    expect(resumenes().map(l => l.url)).toEqual([expect.stringContaining('/hojas-ruta/resumen?desde=2026-10-08&hasta=2026-10-14')])
  })

  it('espera al día del negocio antes de pedir nada (si no, pediría con la fecha equivocada)', async () => {
    await montar()

    const orden = llamadas.map(l => l.url)
    expect(orden[0]).toContain('/tenants/me')
    expect(orden.findIndex(u => u.includes('/hojas-ruta'))).toBeGreaterThan(0)
  })

  it('cruza el borde de mes sin pasar por UTC', async () => {
    diaNegocio = { horaCorte: 3, diaNegocioHoy: '2026-03-03' }
    await montar()

    expect(listas()[0]!.url).toContain('desde=2026-02-25&hasta=2026-03-03')
  })

  it('sin día del negocio parte de la fecha local del navegador', async () => {
    diaNegocio = null
    await montar()

    const q = new URL(listas()[0]!.url, 'http://x').searchParams
    expect(q.get('hasta')).toBe(hoyLocal())
    const [a1, m1, d1] = q.get('desde')!.split('-').map(Number) as [number, number, number]
    const [a2, m2, d2] = q.get('hasta')!.split('-').map(Number) as [number, number, number]
    expect((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000).toBe(6)
  })
})

describe('rutas: las cuatro tarjetas', () => {
  it('muestran lo que dice /resumen: entregados con asignados, cobro en destino, total general y total a pagar', async () => {
    await montar()

    expect(texto('rutas-kpi-entregados')).toBe('21')
    expect(texto('rutas-kpi-asignados')).toBe('de 25 asignados')
    expect(texto('rutas-kpi-cobro-monto')).toBe('$70.000')
    expect(texto('rutas-kpi-cobro-cantidad')).toBe('7 paquetes')
    expect(texto('rutas-kpi-total-general')).toBe('$52.500')
    expect(texto('rutas-kpi-total-pagar')).toBe('$21.000')
  })

  it('un solo paquete con cobro va en singular', async () => {
    resumen = { ...RESUMEN, cobroDestino: 1 }
    await montar()

    expect(texto('rutas-kpi-cobro-cantidad')).toBe('1 paquete')
  })

  it('no suman las filas de la tabla: el total es el del servidor', async () => {
    resumen = { ...RESUMEN, montoPagoRepartidor: '99999' }
    await montar()

    expect(texto('rutas-kpi-total-pagar')).toBe('$99.999')
  })
})

describe('rutas: una fila por hoja', () => {
  it('el link de la fila es el nombre del repartidor y lleva al detalle', async () => {
    await montar()

    const link = qa('rutas-fila-h-1') as HTMLAnchorElement
    expect(link.textContent?.trim()).toBe('Juan Pérez')
    expect(link.getAttribute('href')).toBe('/paquetes/rutas/h-1')
    expect((qa('rutas-fila-h-2') as HTMLAnchorElement).getAttribute('href')).toBe('/paquetes/rutas/h-2')
  })

  it('la fecha va día-mes, el estado con su rótulo y los montos con el formateador', async () => {
    await montar()

    const fila = qa('rutas-fila-h-2')!.closest('tr')!.textContent!.replace(/\s+/g, ' ')
    expect(fila).toContain('13-10')
    expect(fila).toContain('Rendida')
    expect(fila).toContain('$30.000')
    expect(qa('rutas-fila-h-1')!.closest('tr')!.textContent).toContain('Abierta')
  })

  it('el neto negativo dice cuánto se le paga al repartidor y va en color de error; el positivo no', async () => {
    await montar()

    const negativa = qa('rutas-fila-h-2')!.closest('tr')!
    const celdaNegativa = [...negativa.querySelectorAll('span')].find(s => s.textContent?.includes('Se le pagan'))!
    expect(celdaNegativa.textContent?.trim()).toBe('Se le pagan $5.000')
    expect(celdaNegativa.className).toContain('text-error')

    const positiva = qa('rutas-fila-h-1')!.closest('tr')!
    const celdaPositiva = [...positiva.querySelectorAll('span')].find(s => s.textContent?.trim() === '$22.000')!
    expect(celdaPositiva.className).not.toContain('text-error')
  })

  it('sin hojas en el rango muestra el vacío', async () => {
    filas = []
    await montar()

    expect(texto('rutas-vacio')).toContain('No hay hojas de ruta en estas fechas.')
  })
})

describe('rutas: cambiar el rango', () => {
  it('recarga la lista y el resumen con las fechas nuevas', async () => {
    const w = await montar()
    llamadas = []

    const rango = w.findComponent({ name: 'AppRangoFechas' })
    rango.vm.$emit('update:desde', '2026-10-01')
    await esperar(40)

    expect(listas().map(l => l.url)).toEqual([expect.stringContaining('/hojas-ruta?desde=2026-10-01&hasta=2026-10-14')])
    expect(resumenes().map(l => l.url)).toEqual([expect.stringContaining('/hojas-ruta/resumen?desde=2026-10-01&hasta=2026-10-14')])
  })

  it('limpiar una punta no pide nada y pide elegir el rango', async () => {
    const w = await montar()
    llamadas = []

    w.findComponent({ name: 'AppRangoFechas' }).vm.$emit('update:hasta', null)
    await esperar(40)

    expect(llamadas).toEqual([])
    expect(texto('rutas-vacio')).toContain('Elige el rango de fechas')
    expect(texto('rutas-kpi-entregados')).toBe('—')
  })

  it('si la respuesta del rango viejo llega tarde, no pisa la del nuevo', async () => {
    const w = await montar()
    filasPorDesde = {
      '2026-10-01': [hoja({ id: 'h-viejo', repartidorNombre: 'Del rango viejo' })],
      '2026-10-05': [hoja({ id: 'h-nuevo', repartidorNombre: 'Del rango nuevo' })],
    }
    esperando['2026-10-01'] = new Promise<void>((resolve) => { compuertas['2026-10-01'] = resolve })

    const rango = w.findComponent({ name: 'AppRangoFechas' })
    rango.vm.$emit('update:desde', '2026-10-01')
    await esperar(10)
    rango.vm.$emit('update:desde', '2026-10-05')
    await esperar(40)
    compuertas['2026-10-01']!()
    await esperar(40)

    expect(qa('rutas-fila-h-nuevo')).not.toBeNull()
    expect(qa('rutas-fila-h-viejo')).toBeNull()
  })
})

describe('rutas: cuando falla la carga', () => {
  it('avisa con el mensaje del servidor y deja la tabla vacía, sin tarjetas con números viejos', async () => {
    falloLista = 'El rango es demasiado largo'
    await montar()

    expect(toasts).toEqual([{ title: 'El rango es demasiado largo', color: 'error' }])
    expect(qa('rutas-fila-h-1')).toBeNull()
    expect(texto('rutas-kpi-entregados')).toBe('—')
  })
})
