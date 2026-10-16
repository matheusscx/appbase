// @vitest-environment nuxt
//
// Escanear: la pistola tipea el código + Enter en el campo. Cada caso afirma la URL, el body y el
// ORDEN de las llamadas: el mock de `useApiFetch` contesta lo que se le pida, así que un test que
// solo mira la pantalla pasaría aunque la página no mandara nada o mandara el contexto equivocado.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Escanear from './escanear.vue'
import { hoyLocal } from '~/composables/useVigenciaRegla'
import type { HojaRutaDetalle, LineaHoja, ResultadoEscaneo } from '~/types/paqueteria'

type Llamada = { url: string, method: string, body?: Record<string, unknown> }

const repartidoresBackend = [
  { id: 'r-1', nombre: 'Juan Pérez', telefono: null, activo: true },
  { id: 'r-2', nombre: 'Ana Soto', telefono: null, activo: false },
  { id: 'r-3', nombre: 'Beto Rojas', telefono: null, activo: true },
]

function linea(parcial: Partial<LineaHoja> & { paqueteId: string, codigo: string }): LineaHoja {
  return {
    destinatarioNombre: 'María González',
    direccion: 'Av. Los Leones 1234',
    comuna: 'Providencia',
    cobroEnDestino: false,
    precioEnvio: '2500',
    pagoRepartidor: '1000',
    estado: 'en_ruta',
    ...parcial,
  }
}

function hojaDe(
  repartidorId: string,
  fecha: string,
  lineas: LineaHoja[],
  parcial: Partial<HojaRutaDetalle> = {},
): HojaRutaDetalle {
  const nombre = repartidoresBackend.find(r => r.id === repartidorId)!.nombre
  return {
    id: `h-${repartidorId}-${fecha}`,
    repartidorId,
    repartidorNombre: nombre,
    fecha,
    estado: 'abierta',
    rendidaEl: null,
    asignados: lineas.length,
    enRuta: lineas.filter(l => l.estado === 'en_ruta').length,
    entregados: lineas.filter(l => l.estado === 'entregado').length,
    cobroDestino: 0,
    montoCobradoDestino: '0',
    montoPagoRepartidor: '0',
    montoTotalGeneral: '0',
    netoARendir: '0',
    lineas,
    ...parcial,
  }
}

let llamadas: Llamada[] = []
let diaNegocio: { horaCorte: number, diaNegocioHoy: string } | null = null
// Hojas que ya existen en el backend, por `repartidor|fecha`.
let hojasExistentes: Record<string, HojaRutaDetalle> = {}
// Qué contesta el escaneo de cada código: un resultado, o un error con su message.
let respuestasEscaneo: Record<string, { resultado: ResultadoEscaneo } | { error: string }> = {}
// Si un código tiene compuerta, su POST no contesta hasta que el test la abra.
let compuertas: Record<string, () => void> = {}
let esperandoCompuerta: Record<string, Promise<void>> = {}
let falloPatch: string | null = null
let falloListaHojas: string | null = null
let toasts: { title?: string, color?: string }[] = []

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title?: string, color?: string }) => { toasts.push(t) } })
})

mockNuxtImport('useApiFetch', () => {
  return async (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (url.includes('/tenants/me')) {
      return diaNegocio ? { ...diaNegocio } : Promise.reject(new Error('sin red'))
    }
    if (url.includes('/repartidores')) return repartidoresBackend.map(r => ({ ...r }))
    if (url.endsWith('/hojas-ruta/escanear')) {
      const { codigo, repartidorId, fecha } = opts!.body as { codigo: string, repartidorId: string, fecha: string }
      if (esperandoCompuerta[codigo]) await esperandoCompuerta[codigo]
      const programada = respuestasEscaneo[codigo] ?? { resultado: 'asignado_nuevo' as const }
      if ('error' in programada) return Promise.reject({ data: { message: programada.error } })
      const clave = `${repartidorId}|${fecha}`
      const previa = hojasExistentes[clave]?.lineas ?? []
      const nueva = hojaDe(repartidorId, fecha, [
        linea({ paqueteId: `p-${codigo}`, codigo, cobroEnDestino: opts!.body!.cobroEnDestino as boolean }),
        ...previa,
      ])
      hojasExistentes[clave] = nueva
      return { resultado: programada.resultado, codigo, hoja: nueva }
    }
    if (method === 'GET' && /\/hojas-ruta\?/.test(url)) {
      if (falloListaHojas) return Promise.reject({ data: { message: falloListaHojas } })
      const q = new URL(url, 'http://x').searchParams
      const hoja = hojasExistentes[`${q.get('repartidorId')}|${q.get('desde')}`]
      return hoja ? [{ ...hoja, lineas: undefined }] : []
    }
    if (method === 'GET' && /\/hojas-ruta\/[^/]+$/.test(url)) {
      const id = url.split('/').pop()
      return Object.values(hojasExistentes).find(h => h.id === id)
    }
    if (method === 'DELETE') {
      const [, , hojaId, , paqueteId] = new URL(url, 'http://x').pathname.split('/').slice(-5)
      const hoja = Object.values(hojasExistentes).find(h => h.id === hojaId)!
      const nueva = hojaDe(hoja.repartidorId, hoja.fecha, hoja.lineas.filter(l => l.paqueteId !== paqueteId))
      hojasExistentes[`${hoja.repartidorId}|${hoja.fecha}`] = nueva
      return nueva
    }
    if (method === 'PATCH') {
      if (falloPatch) return Promise.reject({ data: { message: falloPatch } })
      return { id: url.split('/').pop(), ...opts!.body }
    }
    return []
  }
})

async function esperar(ms = 20) {
  await new Promise(r => setTimeout(r, ms))
}

async function montar() {
  const wrapper = await mountSuspended(Escanear, { attachTo: document.body })
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
  await esperar(30)
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

const campo = () => document.body.querySelector<HTMLInputElement>('[data-qa="escanear-codigo"]')!

async function emitir(comp: { vm: { $emit: (e: string, v: unknown) => void } }, valor: unknown) {
  comp.vm.$emit('update:modelValue', valor)
  await esperar(0)
}

function selectDeRepartidor(w: Wrapper) {
  return w.findAllComponents({ name: 'USelectMenu' })
    .find(s => (s.props('items') as { value: string }[]).some(i => i.value === 'r-1'))!
}

async function elegirRepartidor(w: Wrapper, id: string) {
  await emitir(selectDeRepartidor(w), id)
  await esperar(30)
}

async function escanear(codigo: string) {
  const input = campo()
  input.value = codigo
  input.dispatchEvent(new Event('input', { bubbles: true }))
  // La pistola manda cada tecla en su propio evento: Vue repinta entre una y otra.
  await esperar(0)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await esperar(0)
}

const posts = () => llamadas.filter(l => l.method === 'POST')
const interruptor = (qa: string) => document.body.querySelector<HTMLButtonElement>(`[data-qa="${qa}"] button, button[data-qa="${qa}"]`)!
const cobroPrincipal = () => interruptor('escanear-cobro')
const interruptorDeLinea = (codigo: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-qa="escanear-linea-cobro-${codigo}"]`)!
const banner = (tipo: string) => document.body.querySelector(`[data-qa="escanear-resultado-${tipo}"]`)

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas = []
  diaNegocio = { horaCorte: 3, diaNegocioHoy: '2026-10-14' }
  hojasExistentes = {}
  respuestasEscaneo = {}
  compuertas = {}
  esperandoCompuerta = {}
  falloPatch = null
  falloListaHojas = null
  toasts = []
})

function conCompuerta(codigo: string) {
  esperandoCompuerta[codigo] = new Promise<void>((resolve) => { compuertas[codigo] = resolve })
}

describe('escanear: antes de elegir repartidor', () => {
  it('el campo está deshabilitado y dice "Elegí un repartidor"; solo se listan los activos', async () => {
    const w = await montar()
    expect(campo().disabled).toBe(true)
    expect(campo().placeholder).toBe('Elegí un repartidor')
    const items = selectDeRepartidor(w).props('items') as { label: string }[]
    expect(items.map(i => i.label)).toEqual(['Juan Pérez', 'Beto Rojas'])
  })

  it('al elegir repartidor el campo se habilita, pide la hoja del día y recibe el foco', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(campo().disabled).toBe(false)
    expect(campo().placeholder).toBe('Escaneá o tipeá el código')
    expect(document.activeElement).toBe(campo())
    const get = llamadas.find(l => /\/hojas-ruta\?/.test(l.url))!
    const q = new URL(get.url, 'http://x').searchParams
    expect(q.get('desde')).toBe('2026-10-14')
    expect(q.get('hasta')).toBe('2026-10-14')
    expect(q.get('repartidorId')).toBe('r-1')
  })
})

describe('escanear: un escaneo', () => {
  it('Enter manda el POST con repartidor, fecha, código y cobro, limpia el campo y pinta verde', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('461')
    await esperar(30)

    expect(posts()).toHaveLength(1)
    expect(posts()[0]!.url.endsWith('/hojas-ruta/escanear')).toBe(true)
    expect(posts()[0]!.body).toEqual({
      repartidorId: 'r-1',
      fecha: '2026-10-14',
      codigo: '461',
      cobroEnDestino: false,
    })
    expect(campo().value).toBe('')
    const verde = banner('success')!
    expect(verde.textContent).toContain('461 · nuevo, asignado')
    expect(verde.textContent).toContain('Hoja de Juan Pérez del 14-10')
    expect(w.text()).toContain('1 asignados')
  })

  it('con el interruptor prendido el body lleva cobroEnDestino: true', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    cobroPrincipal().click()
    await esperar(0)
    await escanear('461')
    await esperar(30)
    expect(posts()[0]!.body!.cobroEnDestino).toBe(true)
  })

  it('"asignado" sale verde y "ya escaneado" sale amarillo', async () => {
    respuestasEscaneo = { A: { resultado: 'asignado' }, B: { resultado: 'ya_escaneado' } }
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('A')
    await esperar(30)
    expect(banner('success')!.textContent).toContain('A · asignado')

    await escanear('B')
    await esperar(30)
    expect(banner('success')).toBeNull()
    expect(banner('warning')!.textContent).toContain('B · ya estaba en la hoja')
  })

  it('un 409 sale rojo con el message del servidor y el código escaneado', async () => {
    respuestasEscaneo = { X: { error: 'El paquete X está con Pedro (hoja del 14-10).' } }
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('X')
    await esperar(30)
    const rojo = banner('error')!
    expect(rojo.textContent).toContain('El paquete X está con Pedro (hoja del 14-10).')
    expect(rojo.textContent).toContain('Código escaneado: X')
    expect(rojo.textContent).toContain('Hoja de Juan Pérez del 14-10')
    expect(campo().value).toBe('')
  })

  it('un rechazo queda en la lista de rechazados aunque lleguen escaneos buenos después, hasta descartarlo', async () => {
    respuestasEscaneo = { B: { error: 'El paquete B está con Pedro (hoja del 14-10).' } }
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(document.body.querySelector('[data-qa="escanear-rechazados"]')).toBeNull()

    await escanear('A')
    await escanear('B')
    await escanear('C')
    await esperar(60)

    // El banner ya es el de C (verde), pero B sigue a la vista con su motivo y su hoja.
    expect(banner('success')!.textContent).toContain('C · nuevo, asignado')
    const panel = document.body.querySelector('[data-qa="escanear-rechazados"]')!
    expect(panel.textContent).toContain('Rechazados (1)')
    const filas = document.body.querySelectorAll('[data-qa="escanear-rechazado"]')
    expect(filas).toHaveLength(1)
    expect(filas[0]!.textContent).toContain('B')
    expect(filas[0]!.textContent).toContain('El paquete B está con Pedro (hoja del 14-10).')
    expect(filas[0]!.textContent).toContain('Hoja de Juan Pérez del 14-10')

    document.body.querySelector<HTMLButtonElement>('[data-qa="escanear-rechazado-descartar"]')!.click()
    await esperar(10)
    expect(document.body.querySelector('[data-qa="escanear-rechazados"]')).toBeNull()
  })

  it('"Limpiar" descarta todos los rechazados; los más nuevos van arriba', async () => {
    respuestasEscaneo = { X: { error: 'rechazado X' }, Y: { error: 'rechazado Y' } }
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('X')
    await escanear('Y')
    await esperar(60)
    const filas = [...document.body.querySelectorAll('[data-qa="escanear-rechazado"]')]
    expect(filas.map(f => f.querySelector('p')!.textContent!.trim())).toEqual(['Y', 'X'])
    expect(document.body.querySelector('[data-qa="escanear-rechazados"]')!.textContent).toContain('Rechazados (2)')

    document.body.querySelector<HTMLButtonElement>('[data-qa="escanear-rechazados-limpiar"]')!.click()
    await esperar(10)
    expect(document.body.querySelector('[data-qa="escanear-rechazados"]')).toBeNull()
  })

  it('si la fecha cambió (la pistola tipeó en ella), el resultado y el rechazo dicen a qué día fueron', async () => {
    respuestasEscaneo = { X: { error: 'rechazado' } }
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await emitir(w.findComponent({ name: 'AppDateInput' }), '2026-10-12')
    await esperar(30)
    await escanear('A')
    await esperar(30)
    expect(banner('success')!.textContent).toContain('Hoja de Juan Pérez del 12-10')
    await escanear('X')
    await esperar(30)
    expect(document.body.querySelector('[data-qa="escanear-rechazado"]')!.textContent).toContain('Hoja de Juan Pérez del 12-10')
  })

  it('el campo recupera el foco después de cada respuesta, también la de un error', async () => {
    respuestasEscaneo = { X: { error: 'rechazado' } }
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    campo().blur()
    await escanear('461')
    await esperar(30)
    expect(document.activeElement).toBe(campo())

    campo().blur()
    await escanear('X')
    await esperar(30)
    expect(document.activeElement).toBe(campo())
  })

  it('un clic en el interruptor devuelve el foco al campo', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    cobroPrincipal().focus()
    expect(document.activeElement).toBe(cobroPrincipal())
    cobroPrincipal().click()
    await esperar(10)
    expect(document.activeElement).toBe(campo())
  })

  it('un clic en el fondo devuelve el foco al campo; un clic en un botón no se lo roba', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    campo().blur()
    document.body.querySelector<HTMLElement>('[data-qa="escanear-pantalla"] h2')!.click()
    await esperar(10)
    expect(document.activeElement).toBe(campo())

    const boton = document.body.querySelector<HTMLButtonElement>('button[aria-label="Seleccionar fecha"]')!
    boton.focus()
    boton.click()
    await esperar(10)
    // El calendario se abrió y se quedó con el foco: la página no se lo sacó.
    expect(document.activeElement).not.toBe(campo())
    void w
  })

  it('una tecla imprimible con el foco en un botón lo trae al campo', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    cobroPrincipal().focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }))
    expect(document.activeElement).toBe(campo())
    void w
  })

  it('un código en blanco no manda nada', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('   ')
    await esperar(30)
    expect(posts()).toHaveLength(0)
  })
})

describe('escanear: la cola', () => {
  it('tres Enter seguidos se mandan de a uno y en el orden en que se escanearon', async () => {
    conCompuerta('A')
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('A')
    await escanear('B')
    await escanear('C')
    await esperar(10)

    // A sigue en vuelo: B y C esperan, no se mandaron todavía.
    expect(posts().map(p => p.body!.codigo)).toEqual(['A'])
    expect(w.text()).toContain('Procesando 2…')

    compuertas.A!()
    await esperar(60)
    expect(posts().map(p => p.body!.codigo)).toEqual(['A', 'B', 'C'])
    expect(w.text()).not.toContain('Procesando')
    expect(w.text()).toContain('3 asignados')
  })

  it('un escaneo rechazado no frena a los siguientes', async () => {
    respuestasEscaneo = { B: { error: 'rechazado' } }
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('A')
    await escanear('B')
    await escanear('C')
    await esperar(60)
    expect(posts().map(p => p.body!.codigo)).toEqual(['A', 'B', 'C'])
    expect(banner('success')!.textContent).toContain('C · nuevo, asignado')
  })

  it('cambiar de repartidor, de fecha o el interruptor con la cola andando no re-dirige lo ya escaneado', async () => {
    conCompuerta('A')
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('A')
    await escanear('B')

    await elegirRepartidor(w, 'r-3')
    await emitir(w.findComponent({ name: 'AppDateInput' }), '2026-10-12')
    await esperar(30)
    cobroPrincipal().click()
    await esperar(0)
    await escanear('C')
    compuertas.A!()
    await esperar(80)

    expect(posts().map(p => p.body)).toEqual([
      { repartidorId: 'r-1', fecha: '2026-10-14', codigo: 'A', cobroEnDestino: false },
      { repartidorId: 'r-1', fecha: '2026-10-14', codigo: 'B', cobroEnDestino: false },
      { repartidorId: 'r-3', fecha: '2026-10-12', codigo: 'C', cobroEnDestino: true },
    ])
    // La pantalla muestra la hoja de Beto: lo escaneado para Juan no la pisó.
    expect(w.text()).toContain('Hoja de Beto Rojas del 12-10')
    expect(w.text()).toContain('1 asignados')
    expect(document.body.querySelector('[data-qa="escanear-linea-A"]')).toBeNull()
    expect(document.body.querySelector('[data-qa="escanear-linea-C"]')).not.toBeNull()
  })

  it('el aviso de un escaneo que salió para otra hoja dice a cuál', async () => {
    conCompuerta('A')
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('A')
    await elegirRepartidor(w, 'r-3')
    compuertas.A!()
    await esperar(60)
    expect(banner('success')!.textContent).toContain('Hoja de Juan Pérez del 14-10')
  })
})

describe('escanear: la hoja del día', () => {
  it('si la hoja ya existe la carga (lista por repartidor y día, luego el detalle) y la muestra', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-9', codigo: 'EXIST-9', cobroEnDestino: true }),
      linea({ paqueteId: 'p-8', codigo: 'EXIST-8' }),
    ])
    const w = await montar()
    await elegirRepartidor(w, 'r-1')

    const gets = llamadas.filter(l => l.method === 'GET' && l.url.includes('/hojas-ruta'))
    expect(gets).toHaveLength(2)
    expect(gets[0]!.url).toMatch(/\/hojas-ruta\?desde=2026-10-14&hasta=2026-10-14&repartidorId=r-1$/)
    expect(gets[1]!.url.endsWith('/hojas-ruta/h-r-1-2026-10-14')).toBe(true)
    expect(w.text()).toContain('2 asignados')
    expect(w.text()).toContain('1 a cobrar en destino')
    expect(w.text()).toContain('EXIST-9')
  })

  it('si falla la carga de la hoja avisa con un toast rojo y no deja una hoja a medias', async () => {
    falloListaHojas = 'No se pudo leer la hoja'
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(toasts).toEqual([{ title: 'No se pudo leer la hoja', color: 'error' }])
    expect(document.body.querySelector('[data-qa="escanear-lineas"]')).toBeNull()
    void w
  })

  it('si no hay hoja ese día muestra la lista vacía y no pide el detalle', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(llamadas.filter(l => /\/hojas-ruta\/[^/?]+$/.test(l.url))).toHaveLength(0)
    expect(w.text()).toContain('Esta hoja todavía no tiene paquetes')
  })

  it('cambiar la fecha vuelve a pedir la hoja de ese día', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    llamadas = []
    await emitir(w.findComponent({ name: 'AppDateInput' }), '2026-10-12')
    await esperar(30)
    const get = llamadas.find(l => /\/hojas-ruta\?/.test(l.url))!
    expect(new URL(get.url, 'http://x').searchParams.get('desde')).toBe('2026-10-12')
  })

  it('la fecha por defecto es el día de negocio; sin él, el calendario local', async () => {
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('A')
    await esperar(30)
    expect(posts()[0]!.body!.fecha).toBe('2026-10-14')
  })

  it('sin día de negocio la fecha por defecto es hoy', async () => {
    diaNegocio = null
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    await escanear('A')
    await esperar(30)
    expect(posts()[0]!.body!.fecha).toBe(hoyLocal())
  })

  it('una hoja rendida bloquea el campo y las filas', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-9', codigo: 'EXIST-9', estado: 'entregado' }),
    ], { estado: 'rendida' })
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(campo().disabled).toBe(true)
    expect(campo().placeholder).toBe('La hoja ya está rendida')
    expect(w.text()).toContain('Esta hoja ya está rendida')
    expect(document.body.querySelector('[data-qa="escanear-linea-quitar-EXIST-9"]')).toBeNull()
  })
})

describe('escanear: filas de la hoja', () => {
  const hojaConDos = () => hojaDe('r-1', '2026-10-14', [
    linea({ paqueteId: 'p-9', codigo: 'EN-RUTA' }),
    linea({ paqueteId: 'p-8', codigo: 'ENTREGADO', estado: 'entregado' }),
  ])

  it('el interruptor de una fila manda PATCH /paquetes/:id y actualiza la fila', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaConDos()
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    interruptorDeLinea('EN-RUTA').click()
    await esperar(30)

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.url.endsWith('/paquetes/p-9')).toBe(true)
    expect(patch.body).toEqual({ cobroEnDestino: true })
    expect(interruptorDeLinea('EN-RUTA').getAttribute('aria-checked')).toBe('true')
    expect(w.text()).toContain('1 a cobrar en destino')
  })

  it('si el PATCH falla la fila vuelve a su valor y avisa', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaConDos()
    falloPatch = 'El paquete ya se rindió'
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    interruptorDeLinea('EN-RUTA').click()
    await esperar(30)

    expect(llamadas.filter(l => l.method === 'PATCH')).toHaveLength(1)
    expect(interruptorDeLinea('EN-RUTA').getAttribute('aria-checked')).toBe('false')
    expect(w.text()).toContain('0 a cobrar en destino')
  })

  it('el interruptor de una fila que no está en ruta está deshabilitado y no manda nada', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaConDos()
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(interruptorDeLinea('ENTREGADO').disabled).toBe(true)
    interruptorDeLinea('ENTREGADO').click()
    await esperar(20)
    expect(llamadas.filter(l => l.method === 'PATCH')).toHaveLength(0)
    expect(document.body.querySelector('[data-qa="escanear-linea-quitar-ENTREGADO"]')).toBeNull()
    void w
  })

  it('Quitar manda DELETE /hojas-ruta/:id/paquetes/:paqueteId y pinta la hoja que vuelve', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaConDos()
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    document.body.querySelector<HTMLButtonElement>('[data-qa="escanear-linea-quitar-EN-RUTA"]')!.click()
    await esperar(30)

    const del = llamadas.find(l => l.method === 'DELETE')!
    expect(del.url.endsWith('/hojas-ruta/h-r-1-2026-10-14/paquetes/p-9')).toBe(true)
    expect(document.body.querySelector('[data-qa="escanear-linea-EN-RUTA"]')).toBeNull()
    expect(w.text()).toContain('1 asignados')
  })

  it('el interruptor principal es el único con el texto "Cobro en destino": las filas se llaman distinto', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaConDos()
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    const iguales = [...document.body.querySelectorAll('*')].filter(e =>
      e.children.length === 0 && e.textContent?.trim() === 'Cobro en destino')
    expect(iguales).toHaveLength(1)
    expect(interruptorDeLinea('EN-RUTA').getAttribute('aria-label')).toBe('Cobro en destino de EN-RUTA')
    expect(document.body.querySelectorAll('[data-qa="escanear-cobro"]')).toHaveLength(1)
    expect(document.body.querySelectorAll('[data-qa="escanear-codigo"]')).toHaveLength(1)
    expect(document.body.querySelectorAll('[data-qa="escanear-repartidor"]')).toHaveLength(1)
    expect(document.body.querySelectorAll('[data-qa="escanear-asignados"]')).toHaveLength(1)
    void w
  })

  it('con paquetes todavía en ruta no se muestra el neto, que sería solo el de lo entregado', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-8', codigo: 'ENTREGADO', estado: 'entregado' }),
      linea({ paqueteId: 'p-9', codigo: 'EN-RUTA' }),
    ], { netoARendir: '-1000' })
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(document.body.querySelector('[data-qa="escanear-neto"]')).toBeNull()
    expect(w.text()).not.toContain('Se le pagan')
  })

  it('con entregas, la hoja dice qué plata se entrega o se recibe', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-8', codigo: 'ENTREGADO', estado: 'entregado' }),
    ], { netoARendir: '-1000' })
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(document.body.querySelector('[data-qa="escanear-neto"]')!.textContent).toContain('Se le pagan')
    void w
  })
})

describe('escanear: montos de cada paquete', () => {
  const lapiz = (codigo: string) =>
    document.body.querySelector<HTMLButtonElement>(`[data-qa="escanear-linea-montos-${codigo}"]`)
  const texto = (qa: string) => document.body.querySelector(`[data-qa="${qa}"]`)?.textContent?.trim()
  const botonGuardar = () => document.body.querySelector<HTMLButtonElement>('[data-qa="escanear-montos-guardar"]')!

  async function cargarMontos(w: Wrapper, precioEnvio: string, pagoRepartidor: string) {
    const [envio, pago] = w.findAllComponents({ name: 'MoneyInput' })
    await emitir(envio!, precioEnvio)
    await emitir(pago!, pagoRepartidor)
  }

  it('cada fila muestra el precio del envío y el pago al repartidor', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-9', codigo: 'EN-RUTA', precioEnvio: '2500.0000', pagoRepartidor: '1000.0000' }),
    ])
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(texto('escanear-linea-envio-EN-RUTA')).toBe('$2.500')
    expect(texto('escanear-linea-pago-EN-RUTA')).toBe('$1.000')
    void w
  })

  it('el lápiz abre el modal con los montos del paquete y Guardar manda PATCH /paquetes/:id', async () => {
    // El backend devuelve los montos con la escala de la columna (numeric 18,4).
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-9', codigo: 'EN-RUTA', precioEnvio: '2500.0000', pagoRepartidor: '1000.0000' }),
    ])
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    lapiz('EN-RUTA')!.click()
    await esperar(30)

    const [envio, pago] = w.findAllComponents({ name: 'MoneyInput' })
    expect(envio!.props('modelValue')).toBe('2500.0000')
    expect(pago!.props('modelValue')).toBe('1000.0000')
    await cargarMontos(w, '3000', '1500')
    const getsAntes = llamadas.filter(l => l.method === 'GET').length
    botonGuardar().click()
    await esperar(30)

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.url.endsWith('/paquetes/p-9')).toBe(true)
    expect(patch.body).toEqual({ precioEnvio: '3000', pagoRepartidor: '1500' })
    expect(texto('escanear-linea-envio-EN-RUTA')).toBe('$3.000')
    expect(texto('escanear-linea-pago-EN-RUTA')).toBe('$1.500')
    // Sin entregados los totales del servidor no cambian: no se relee la hoja.
    expect(llamadas.filter(l => l.method === 'GET')).toHaveLength(getsAntes)
    expect(toasts.some(t => t.title === 'Montos de EN-RUTA guardados')).toBe(true)
  })

  it('con entregados en la hoja, después de guardar se relee la hoja para los totales', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-8', codigo: 'ENTREGADO', estado: 'entregado' }),
    ])
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    lapiz('ENTREGADO')!.click()
    await esperar(30)
    await cargarMontos(w, '4000', '2000')
    botonGuardar().click()
    await esperar(40)

    const orden = llamadas.filter(l => l.method !== 'GET' || /\/hojas-ruta\/[^/?]+$/.test(l.url))
    const iPatch = orden.findIndex(l => l.method === 'PATCH')
    expect(iPatch).toBeGreaterThanOrEqual(0)
    expect(orden.slice(iPatch + 1).some(l => l.method === 'GET' && l.url.endsWith('/hojas-ruta/h-r-1-2026-10-14'))).toBe(true)
  })

  it('si el PATCH falla, el error queda en el modal y la fila no cambia', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-9', codigo: 'EN-RUTA' }),
    ])
    falloPatch = 'El precio de envío admite como máximo 0 decimales.'
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    lapiz('EN-RUTA')!.click()
    await esperar(30)
    await cargarMontos(w, '3000', '1500')
    botonGuardar().click()
    await esperar(30)

    expect(texto('escanear-montos-error')).toContain('El precio de envío admite como máximo 0 decimales.')
    expect(document.body.querySelector('[data-qa="escanear-montos-modal"]')).not.toBeNull()
    expect(texto('escanear-linea-envio-EN-RUTA')).toBe('$2.500')
  })

  it('Enter en un campo de monto no guarda: la pistola no puede escribir un precio', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-9', codigo: 'EN-RUTA' }),
    ])
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    lapiz('EN-RUTA')!.click()
    await esperar(30)
    await cargarMontos(w, '46123456789', '1000')
    const input = document.body.querySelector<HTMLInputElement>('[data-qa="escanear-montos-envio"] input, input[data-qa="escanear-montos-envio"]')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await esperar(30)

    expect(llamadas.filter(l => l.method === 'PATCH')).toHaveLength(0)
    expect(llamadas.filter(l => l.method === 'POST')).toHaveLength(0)
  })

  it('con la hoja rendida no hay lápiz: los montos no se pueden cambiar', async () => {
    hojasExistentes['r-1|2026-10-14'] = hojaDe('r-1', '2026-10-14', [
      linea({ paqueteId: 'p-8', codigo: 'ENTREGADO', estado: 'entregado' }),
    ], { estado: 'rendida' })
    const w = await montar()
    await elegirRepartidor(w, 'r-1')
    expect(texto('escanear-linea-envio-ENTREGADO')).toBe('$2.500')
    expect(lapiz('ENTREGADO')).toBeNull()
    void w
  })
})
