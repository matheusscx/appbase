// @vitest-environment nuxt
//
// Nueva rendición: hojas sin rendir del repartidor, la previa que se vuelve a pedir al cambiar la
// selección y el POST. Cada caso afirma método, URL y body: el mock de `useApiFetch` contesta lo
// que se le pida, así que un test que solo mira la pantalla pasaría aunque la página no mandara nada.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Nueva from './nueva.vue'
import type { EntregaRepartidorFila, HojaRutaFila, RendicionDetalle } from '~/types/paqueteria'

type Llamada = { url: string, method: string, body?: Record<string, unknown> }

function hoja(id: string, fecha: string, parcial: Partial<HojaRutaFila> = {}): HojaRutaFila {
  return {
    id,
    repartidorId: 'r-1',
    repartidorNombre: 'Juan Pérez',
    fecha,
    estado: 'abierta',
    rendidaEl: null,
    asignados: 3,
    enRuta: 0,
    entregados: 3,
    cobroDestino: 0,
    montoCobradoDestino: '0',
    montoCobradoEfectivo: '0',
    montoCobradoTransferencia: '0',
    montoPagoRepartidor: '5700',
    montoTotalGeneral: '0',
    netoARendir: '-5700',
    ...parcial,
  }
}

function previaCon(saldo: string, parcial: Partial<RendicionDetalle> = {}): RendicionDetalle {
  return {
    id: null,
    repartidorId: 'r-1',
    repartidorNombre: 'Juan Pérez',
    rendidaEl: null,
    dias: [],
    tarifas: [],
    entregas: [],
    totales: {
      entregados: 6,
      montoCobradoDestino: '10000',
      montoCobradoEfectivo: '7000',
      montoCobradoTransferencia: '3000',
      montoPagoRepartidor: '11400',
      montoEntregadoACuenta: '0',
      saldo,
    },
    ...parcial,
  }
}

const ENTREGA: EntregaRepartidorFila = {
  id: 'e-1',
  repartidorId: 'r-1',
  repartidorNombre: 'Juan Pérez',
  fecha: '2026-10-14',
  monto: '2000',
  medio: 'efectivo',
  nota: null,
  rendicionId: null,
  creadoEl: '2026-10-14T12:00:00.000Z',
}

let llamadas: Llamada[] = []
let hojas: HojaRutaFila[] = []
let entregas: EntregaRepartidorFila[] = []
// Respuesta de la previa por pedido: la función recibe la lista de ids pedida.
let responderPrevia: (ids: string[]) => Promise<RendicionDetalle> = async () => previaCon('1000')
let postRespuesta: RendicionDetalle | { fallo: string } = previaCon('0', { id: 'rend-9' })
let falloEntrega: string | null = null
let toasts: { title?: string, color?: string }[] = []
let navegaciones: string[] = []

mockNuxtImport('useRoute', () => () => ({ params: {}, query: { repartidorId: 'r-1' } }))
mockNuxtImport('navigateTo', () => async (to: string) => { navegaciones.push(to) })
mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title?: string, color?: string }) => { toasts.push(t) } })
})

mockNuxtImport('useApiFetch', () => {
  return async (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    const ruta = url.replace(/^.*?\/api/, '').replace(/^https?:\/\/[^/]+/, '')
    if (ruta.includes('/repartidores')) return [{ id: 'r-1', nombre: 'Juan Pérez', telefono: null, activo: true, tarifaPagoId: null }]
    if (ruta.includes('/hojas-ruta?')) return hojas
    if (ruta.includes('/entregas-repartidor') && method === 'GET') return entregas
    if (ruta.includes('/entregas-repartidor')) {
      if (falloEntrega && method !== 'DELETE') return Promise.reject({ status: 400, data: { message: falloEntrega } })
      return {}
    }
    if (ruta.includes('/rendiciones/previa')) {
      const ids = new URL(url, 'http://x').searchParams.get('hojaIds')!.split(',')
      return responderPrevia(ids)
    }
    if (ruta.endsWith('/rendiciones') && method === 'POST') {
      if ('fallo' in postRespuesta) return Promise.reject({ status: 400, data: { message: postRespuesta.fallo } })
      return postRespuesta
    }
    throw new Error(`URL sin mock: ${method} ${url}`)
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
  const wrapper = await mountSuspended(Nueva, { attachTo: document.body })
  await esperar(60)
  return wrapper
}

const qa = (id: string) => document.body.querySelector<HTMLElement>(`[data-qa="${id}"]`)
const texto = (id: string) => qa(id)?.textContent?.replace(/\s+/g, ' ').trim()
async function clic(id: string) {
  qa(id)!.click()
  await esperar(40)
}
// UCheckbox pone el `data-qa` en el botón mismo (role="checkbox").
const casilla = (id: string) => qa(`nueva-hoja-${id}`)!
const previas = () => llamadas.filter(l => l.url.includes('/rendiciones/previa'))
const idsPedidos = (l: Llamada) => new URL(l.url, 'http://x').searchParams.get('hojaIds')

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas = []
  toasts = []
  navegaciones = []
  falloEntrega = null
  entregas = []
  hojas = [hoja('h-1', '2026-10-13'), hoja('h-2', '2026-10-14'), hoja('h-3', '2026-10-15', { enRuta: 2, entregados: 1 })]
  responderPrevia = async () => previaCon('1000')
  postRespuesta = previaCon('0', { id: 'rend-9' })
})

describe('nueva rendición: las hojas', () => {
  it('pide las hojas sin rendir y las entregas pendientes del repartidor de la URL', async () => {
    await montar()

    const urls = llamadas.map(l => l.url)
    expect(urls.some(u => u.includes('/hojas-ruta?pendientes=true&repartidorId=r-1'))).toBe(true)
    expect(urls.some(u => u.includes('/entregas-repartidor?repartidorId=r-1&pendientes=true'))).toBe(true)
  })

  it('preselecciona las hojas sin paquetes en ruta y deshabilita las que los tienen', async () => {
    await montar()

    expect(casilla('h-1').getAttribute('aria-checked')).toBe('true')
    expect(casilla('h-2').getAttribute('aria-checked')).toBe('true')
    expect(casilla('h-3').getAttribute('aria-checked')).toBe('false')
    expect(casilla('h-3').hasAttribute('disabled')).toBe(true)
    expect(texto('nueva-hoja-bloqueo-h-3')).toContain('Tiene 2 en ruta')
  })

  it('una hoja abierta sin paquetes no se preselecciona y dice por qué', async () => {
    hojas = [hoja('h-1', '2026-10-13'), hoja('h-4', '2026-10-16', { asignados: 0, entregados: 0 })]
    await montar()

    expect(casilla('h-1').getAttribute('aria-checked')).toBe('true')
    expect(casilla('h-4').getAttribute('aria-checked')).toBe('false')
    expect(casilla('h-4').hasAttribute('disabled')).toBe(true)
    expect(texto('nueva-hoja-bloqueo-h-4')).toContain('No tiene paquetes')
    const previa = llamadas.map(l => l.url).filter(u => u.includes('/rendiciones/previa'))
    expect(previa.every(u => !u.includes('h-4'))).toBe(true)
  })

  it('pide la previa con la forma de comas y los ids de las hojas elegidas', async () => {
    await montar()

    expect(previas()).toHaveLength(1)
    expect(previas()[0]!.url).toContain('repartidorId=r-1&hojaIds=h-1,h-2')
    expect(texto('nueva-saldo')).toBe('Debe rendir $1.000')
  })
})

describe('nueva rendición: la previa sigue a la selección', () => {
  it('al desmarcar una hoja vuelve a pedir la previa sin ella', async () => {
    await montar()

    casilla('h-2').click()
    await esperar(40)

    expect(previas()).toHaveLength(2)
    expect(idsPedidos(previas()[1]!)).toBe('h-1')
  })

  it('sin ninguna hoja elegida no hay previa ni se puede rendir', async () => {
    await montar()

    casilla('h-1').click()
    await esperar(30)
    casilla('h-2').click()
    await esperar(40)

    expect(qa('nueva-saldo')).toBeNull()
    expect((qa('nueva-rendir') as HTMLButtonElement).disabled).toBe(true)
    expect(previas().map(idsPedidos)).toEqual(['h-1,h-2', 'h-2'])
  })

  it('la respuesta vieja no pisa a la nueva aunque llegue después', async () => {
    const pendientes: { ids: string, resolver: (r: RendicionDetalle) => void }[] = []
    responderPrevia = ids => new Promise((resolver) => { pendientes.push({ ids: ids.join(','), resolver }) })
    await montar()
    expect(pendientes.map(p => p.ids)).toEqual(['h-1,h-2'])

    casilla('h-2').click()
    await esperar(40)
    expect(pendientes.map(p => p.ids)).toEqual(['h-1,h-2', 'h-1'])

    pendientes[1]!.resolver(previaCon('111'))
    await esperar(30)
    pendientes[0]!.resolver(previaCon('999'))
    await esperar(30)

    expect(texto('nueva-saldo')).toBe('Debe rendir $111')
  })
})

describe('nueva rendición: rendir', () => {
  it('confirmar manda POST con el repartidor y las hojas, y abre la rendición que devolvió', async () => {
    await montar()

    await clic('nueva-rendir')
    expect(texto('nueva-confirmar-texto')).toBe('Debe rendir $1.000')
    await clic('nueva-confirmar')

    const posts = llamadas.filter(l => l.method === 'POST')
    expect(posts).toEqual([{
      url: expect.stringMatching(/\/rendiciones$/),
      method: 'POST',
      body: { repartidorId: 'r-1', hojaIds: ['h-1', 'h-2'] },
    }])
    expect(navegaciones).toEqual(['/paquetes/rendiciones/rend-9'])
  })

  it('un 400 queda en la pantalla, no navega y deja rendir de nuevo', async () => {
    postRespuesta = { fallo: 'La hoja h-2 ya está rendida' }
    await montar()
    await clic('nueva-rendir')

    await clic('nueva-confirmar')

    expect(texto('nueva-error-rendir')).toContain('La hoja h-2 ya está rendida')
    expect(navegaciones).toEqual([])
    expect((qa('nueva-rendir') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('nueva rendición: entregas de plata', () => {
  it('lista las pendientes y anular manda DELETE y vuelve a pedir lista y previa', async () => {
    entregas = [ENTREGA]
    await montar()
    expect(texto('nueva-entrega-e-1')).toContain('$2.000')

    entregas = []
    await clic('nueva-entrega-anular-e-1')

    const borrados = llamadas.filter(l => l.method === 'DELETE')
    expect(borrados).toHaveLength(1)
    expect(borrados[0]!.url).toMatch(/\/entregas-repartidor\/e-1$/)
    expect(qa('nueva-entrega-e-1')).toBeNull()
    expect(previas()).toHaveLength(2)
  })
})

describe('nueva rendición: anotar y corregir una entrega de plata', () => {
  type Wrapper = Awaited<ReturnType<typeof montar>>
  const monto = (w: Wrapper) => w.findAllComponents({ name: 'MoneyInput' }).at(-1)!
  async function escribirMonto(w: Wrapper, valor: string) {
    monto(w).vm.$emit('update:modelValue', valor)
    await esperar(10)
  }
  async function escribirNota(texto: string) {
    const campo = qa('nueva-entrega-nota')!
    const input = campo instanceof HTMLInputElement ? campo : campo.querySelector('input')!
    input.value = texto
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await esperar(10)
  }
  async function enviar() {
    document.body.querySelector<HTMLFormElement>('form#entrega-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await esperar(60)
  }
  const escrituras = () => llamadas.filter(l => l.method === 'POST' && l.url.includes('/entregas-repartidor') || l.method === 'PATCH')

  it('anotar manda { repartidorId, fecha, monto (string), medio, nota } y vuelve a pedir lista y previa', async () => {
    const wrapper = await montar()

    await clic('nueva-entrega-anotar')
    expect((qa('nueva-entrega-guardar') as HTMLButtonElement).disabled).toBe(true)
    await escribirMonto(wrapper, '3500')
    await escribirNota('  Dejó en la oficina ')
    expect((qa('nueva-entrega-guardar') as HTMLButtonElement).disabled).toBe(false)
    await enviar()

    expect(escrituras()).toEqual([{
      url: expect.stringMatching(/\/entregas-repartidor$/),
      method: 'POST',
      body: {
        repartidorId: 'r-1',
        fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        monto: '3500',
        medio: 'efectivo',
        nota: 'Dejó en la oficina',
      },
    }])
    expect(typeof escrituras()[0]!.body!.monto).toBe('string')
    expect(qa('nueva-entrega-form')).toBeNull()
    expect(previas()).toHaveLength(2)
    expect(toasts).toEqual([{ title: 'Entrega anotada', color: 'success' }])
  })

  it('sin nota no manda la clave', async () => {
    const wrapper = await montar()

    await clic('nueva-entrega-anotar')
    await escribirMonto(wrapper, '3500')
    await enviar()

    expect(escrituras()[0]!.body).not.toHaveProperty('nota')
  })

  it('corregir precarga la entrega y manda PATCH con lo que cambió, sin el repartidor', async () => {
    entregas = [{ ...ENTREGA, nota: 'Primera' }]
    const wrapper = await montar()

    await clic('nueva-entrega-corregir-e-1')
    expect(monto(wrapper).props('modelValue')).toBe('2000')
    await escribirMonto(wrapper, '2500')
    await enviar()

    expect(escrituras()).toEqual([{
      url: expect.stringMatching(/\/entregas-repartidor\/e-1$/),
      method: 'PATCH',
      body: { fecha: '2026-10-14', monto: '2500', medio: 'efectivo', nota: 'Primera' },
    }])
    expect(toasts).toEqual([{ title: 'Entrega corregida', color: 'success' }])
  })

  it('un 400 (ya rendida) queda dentro del modal, sin cerrarlo ni avisar éxito', async () => {
    entregas = [ENTREGA]
    falloEntrega = 'La entrega ya está rendida: no se puede corregir'
    const wrapper = await montar()

    await clic('nueva-entrega-corregir-e-1')
    await escribirMonto(wrapper, '2500')
    await enviar()

    expect(texto('nueva-entrega-error')).toBe('La entrega ya está rendida: no se puede corregir')
    expect(qa('nueva-entrega-form')).not.toBeNull()
    expect(toasts).toEqual([])
    expect(previas()).toHaveLength(1)
  })
})
