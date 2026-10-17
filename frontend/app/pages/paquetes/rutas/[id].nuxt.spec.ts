// @vitest-environment nuxt
//
// Detalle de hoja: marcar líneas, quitar, marcar todas, y rendir con su modal. Cada caso afirma
// método, URL y body de las llamadas y su orden: el mock de `useApiFetch` contesta lo que se le
// pida, así que un test que solo mira la pantalla pasaría aunque la página no mandara nada.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Detalle from './[id].vue'
import type { EstadoLinea, HojaRutaDetalle, LineaHoja } from '~/types/paqueteria'

type Llamada = { url: string, method: string, body?: Record<string, unknown> }

function linea(codigo: string, estado: EstadoLinea, parcial: Partial<LineaHoja> = {}): LineaHoja {
  return {
    paqueteId: `p-${codigo}`,
    codigo,
    destinatarioNombre: 'María González',
    direccion: 'Av. Los Leones 1234',
    comuna: 'Providencia',
    cobroEnDestino: false,
    precioEnvio: '2500',
    tarifaPagoId: 't-moto',
    tarifaPagoNombre: 'Moto',
    tarifaPaqueteId: null,
    pagoRepartidor: '1000',
    pagoEstimado: estado !== 'entregado',
    medioCobro: null,
    estado,
    ...parcial,
  }
}

/** Totales como los calcula el servidor: acá solo se arman para que el mock sea coherente. */
function hojaCon(lineas: LineaHoja[], parcial: Partial<HojaRutaDetalle> = {}): HojaRutaDetalle {
  return {
    id: 'h-1',
    repartidorId: 'r-1',
    repartidorNombre: 'Juan Pérez',
    fecha: '2026-10-14',
    estado: 'abierta',
    rendidaEl: null,
    asignados: lineas.length,
    enRuta: lineas.filter(l => l.estado === 'en_ruta').length,
    entregados: lineas.filter(l => l.estado === 'entregado').length,
    cobroDestino: 0,
    montoCobradoDestino: '0',
    montoCobradoEfectivo: '0',
    montoCobradoTransferencia: '0',
    montoPagoRepartidor: '0',
    montoTotalGeneral: '0',
    netoARendir: '0',
    lineas,
    ...parcial,
  }
}

let llamadas: Llamada[] = []
// Lo que el servidor tiene guardado: cada escritura devuelve la hoja entera tal como la dejó.
let servidor: HojaRutaDetalle
// Qué devuelve cada escritura (por método + final de la URL); si no está, la hoja del servidor.
let respuestas: Record<string, HojaRutaDetalle> = {}
let fallos: Record<string, { status?: number, message: string }> = {}
let compuerta: Promise<void> | null = null
let toasts: { title?: string, color?: string }[] = []

mockNuxtImport('useRoute', () => () => ({ params: { id: 'h-1' }, query: {} }))

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title?: string, color?: string }) => { toasts.push(t) } })
})

mockNuxtImport('useApiFetch', () => {
  return async (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (method !== 'GET' && compuerta) await compuerta
    const clave = `${method} ${url.split('/hojas-ruta/')[1]}`
    const fallo = fallos[clave]
    if (fallo) return Promise.reject({ status: fallo.status, data: { message: fallo.message } })
    return respuestas[clave] ?? servidor
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
  const wrapper = await mountSuspended(Detalle, { attachTo: document.body })
  await esperar(40)
  return wrapper
}

const qa = (id: string) => document.body.querySelector<HTMLElement>(`[data-qa="${id}"]`)
const texto = (id: string) => qa(id)?.textContent?.replace(/\s+/g, ' ').trim()
const boton = (id: string) => qa(id) as HTMLButtonElement
async function clic(id: string) {
  boton(id).click()
  await esperar(30)
}
const escrituras = () => llamadas.filter(l => l.method !== 'GET')
const lecturas = () => llamadas.filter(l => l.method === 'GET')

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas = []
  respuestas = {}
  fallos = {}
  compuerta = null
  toasts = []
  servidor = hojaCon([linea('ML-1', 'en_ruta'), linea('ML-2', 'en_ruta', { cobroEnDestino: true })])
})

describe('detalle: carga y totales', () => {
  it('pide la hoja del id de la ruta, una sola vez', async () => {
    await montar()

    expect(llamadas).toEqual([{ url: expect.stringMatching(/\/hojas-ruta\/h-1$/), method: 'GET', body: undefined }])
    expect(texto('hoja-titulo')).toBe('Juan Pérez')
  })

  it('muestra los totales con el formateador de moneda y el neto destacado', async () => {
    servidor = hojaCon([linea('ML-1', 'entregado')], {
      montoCobradoDestino: '30000',
      montoPagoRepartidor: '8000',
      montoTotalGeneral: '20000',
      cobroDestino: 3,
      netoARendir: '22000',
    })
    await montar()

    expect(texto('hoja-cobrado')).toBe('$30.000')
    expect(texto('hoja-pago')).toBe('$8.000')
    expect(texto('hoja-total-general')).toBe('$20.000')
    expect(texto('hoja-neto-monto')).toBe('$22.000')
    expect(texto('hoja-neto-texto')).toBe('Juan Pérez entrega $22.000')
    expect(qa('hoja-neto-monto')!.className).not.toContain('text-error')
  })

  it('un neto negativo se lee como la empresa pagándole al repartidor, en color de error', async () => {
    servidor = hojaCon([linea('ML-1', 'entregado')], { netoARendir: '-5000' })
    await montar()

    expect(texto('hoja-neto-monto')).toBe('Se le pagan $5.000')
    expect(texto('hoja-neto-texto')).toBe('Se le pagan $5.000 a Juan Pérez')
    expect(qa('hoja-neto-monto')!.className).toContain('text-error')
  })

  it('con paquetes en ruta el neto se rotula parcial: no se lee como el de la rendición', async () => {
    await montar()

    expect(qa('hoja-neto')!.textContent).toContain('Neto parcial')
  })

  it('cada línea muestra su tarifa y el pago: estimado mientras no se entrega, fijo después', async () => {
    servidor = hojaCon([
      linea('ML-1', 'en_ruta', { tarifaPagoNombre: 'Auto', pagoRepartidor: '1900' }),
      linea('ML-2', 'entregado', { tarifaPagoNombre: 'Moto', pagoRepartidor: '1000' }),
    ])
    await montar()

    expect(texto('hoja-linea-tarifa-ML-1')).toBe('Auto')
    expect(texto('hoja-linea-pago-ML-1')).toBe('$1.900')
    expect(texto('hoja-linea-ML-1')).toContain('Pago estimado')
    expect(texto('hoja-linea-tarifa-ML-2')).toBe('Moto')
    expect(texto('hoja-linea-pago-ML-2')).toBe('$1.000')
    expect(texto('hoja-linea-ML-2')).not.toContain('Pago estimado')
  })

  it('un no entregado de una hoja rendida no muestra "Pago estimado" ni pago alguno', async () => {
    servidor = hojaCon([
      linea('ML-1', 'entregado', { pagoRepartidor: '1000' }),
      linea('ML-2', 'no_entregado', { pagoRepartidor: '1000', pagoEstimado: false }),
    ], { estado: 'rendida', rendidaEl: '2026-10-14T20:00:00.000Z' })
    await montar()

    expect(texto('hoja-linea-pago-ML-1')).toBe('$1.000')
    expect(texto('hoja-linea-ML-2')).not.toContain('Pago')
    expect(qa('hoja-linea-pago-ML-2')).toBeNull()
  })

  it('si la hoja no carga, muestra el motivo y ninguna acción', async () => {
    fallos['GET h-1'] = { message: 'No existe esa hoja' }
    await montar()

    expect(texto('hoja-error')).toBe('No existe esa hoja')
    expect(qa('hoja-rendir')).toBeNull()
  })
})

describe('detalle: marcar una línea', () => {
  it('Entregado manda PATCH con el estado y se queda con la hoja que devuelve, sin otro GET', async () => {
    respuestas['PATCH h-1/paquetes/p-ML-1'] = hojaCon([linea('ML-1', 'entregado'), linea('ML-2', 'en_ruta')], { netoARendir: '1500' })
    await montar()

    await clic('hoja-linea-ML-1-entregado')

    expect(escrituras()).toEqual([{
      url: expect.stringMatching(/\/hojas-ruta\/h-1\/paquetes\/p-ML-1$/),
      method: 'PATCH',
      body: { estado: 'entregado' },
    }])
    expect(lecturas()).toHaveLength(1)
    expect(boton('hoja-linea-ML-1-entregado').getAttribute('aria-pressed')).toBe('true')
    expect(texto('hoja-neto-monto')).toBe('$1.500')
  })

  it('No entregado manda su estado', async () => {
    await montar()

    await clic('hoja-linea-ML-2-no-entregado')

    expect(escrituras().map(e => e.body)).toEqual([{ estado: 'no_entregado' }])
    expect(escrituras()[0]!.url).toMatch(/\/paquetes\/p-ML-2$/)
  })

  it('En ruta deshace una línea ya marcada', async () => {
    servidor = hojaCon([linea('ML-1', 'entregado')])
    await montar()

    await clic('hoja-linea-ML-1-en-ruta')

    expect(escrituras().map(e => e.body)).toEqual([{ estado: 'en_ruta' }])
  })

  it('tocar el estado que la línea ya tiene no manda nada', async () => {
    servidor = hojaCon([linea('ML-1', 'entregado')])
    await montar()

    await clic('hoja-linea-ML-1-entregado')

    expect(escrituras()).toEqual([])
  })

  it('si el servidor rechaza (otro repartidor se lo llevó) avisa con su mensaje y vuelve a pedir la hoja', async () => {
    fallos['PATCH h-1/paquetes/p-ML-1'] = { status: 409, message: 'El paquete salió con otro repartidor' }
    await montar()

    await clic('hoja-linea-ML-1-entregado')

    expect(toasts).toEqual([{ title: 'El paquete salió con otro repartidor', color: 'error' }])
    expect(llamadas.map(l => l.method)).toEqual(['GET', 'PATCH', 'GET'])
  })

  it('mientras una escritura está en vuelo, las demás acciones quedan deshabilitadas', async () => {
    await montar()
    let abrir!: () => void
    compuerta = new Promise<void>((resolve) => { abrir = resolve })

    boton('hoja-linea-ML-1-entregado').click()
    await esperar(20)

    expect(boton('hoja-linea-ML-2-entregado').disabled).toBe(true)
    expect(boton('hoja-entregar-todos').disabled).toBe(true)
    boton('hoja-linea-ML-2-entregado').click()
    expect(escrituras()).toHaveLength(1)

    abrir()
    await esperar(30)
    expect(boton('hoja-linea-ML-2-entregado').disabled).toBe(false)
  })
})

describe('detalle: quitar', () => {
  it('solo las líneas en ruta tienen Quitar, y manda DELETE', async () => {
    servidor = hojaCon([linea('ML-1', 'en_ruta'), linea('ML-2', 'entregado')])
    respuestas['DELETE h-1/paquetes/p-ML-1'] = hojaCon([linea('ML-2', 'entregado')])
    await montar()

    expect(qa('hoja-linea-quitar-ML-2')).toBeNull()
    await clic('hoja-linea-quitar-ML-1')

    expect(escrituras()).toEqual([{
      url: expect.stringMatching(/\/hojas-ruta\/h-1\/paquetes\/p-ML-1$/),
      method: 'DELETE',
      body: undefined,
    }])
    expect(qa('hoja-linea-ML-1')).toBeNull()
    expect(toasts).toEqual([{ title: 'ML-1 salió de la hoja', color: 'success' }])
  })
})

describe('detalle: marcar todos entregados', () => {
  it('manda POST a entregar-todos y reemplaza la hoja', async () => {
    respuestas['POST h-1/entregar-todos'] = hojaCon([linea('ML-1', 'entregado'), linea('ML-2', 'entregado')])
    await montar()

    await clic('hoja-entregar-todos')

    expect(escrituras()).toEqual([{
      url: expect.stringMatching(/\/hojas-ruta\/h-1\/entregar-todos$/),
      method: 'POST',
      body: undefined,
    }])
    expect(lecturas()).toHaveLength(1)
    expect(texto('hoja-entregados')).toBe('2')
    expect(boton('hoja-entregar-todos').disabled).toBe(true)
  })

  it('el botón se llama como lo espera el Playwright', async () => {
    await montar()

    expect(boton('hoja-entregar-todos').textContent?.trim()).toBe('Marcar todos entregados')
  })
})

describe('detalle: medio de cobro', () => {
  const conCobro = () => hojaCon([
    linea('ML-1', 'en_ruta'),
    linea('ML-2', 'en_ruta', { cobroEnDestino: true }),
  ])

  it('una línea sin cobro en destino no ofrece medio y manda solo el estado', async () => {
    await montar()

    expect(qa('hoja-linea-ML-1-medio-efectivo')).toBeNull()
    await clic('hoja-linea-ML-1-entregado')
    expect(escrituras().map(e => e.body)).toEqual([{ estado: 'entregado' }])
  })

  it('con cobro en destino, Entregado manda efectivo y no hay medio que elegir antes de entregar', async () => {
    servidor = conCobro()
    await montar()

    expect(qa('hoja-linea-ML-2-medio-efectivo')).toBeNull()
    expect(qa('hoja-linea-ML-2-medio-transferencia')).toBeNull()
    await clic('hoja-linea-ML-2-entregado')

    expect(escrituras().map(e => e.body)).toEqual([{ estado: 'entregado', medioCobro: 'efectivo' }])
  })

  it('«Entregado por transferencia» marca con transferencia en un solo paso', async () => {
    servidor = conCobro()
    await montar()

    await clic('hoja-linea-ML-2-entregado-transferencia')

    expect(escrituras().map(e => e.body)).toEqual([{ estado: 'entregado', medioCobro: 'transferencia' }])
  })

  it('una línea sin cobro en destino no ofrece entregar por transferencia', async () => {
    servidor = conCobro()
    await montar()

    expect(qa('hoja-linea-ML-1-entregado-transferencia')).toBeNull()
  })

  it('una entregada muestra el medio guardado y ya no ofrece entregar por transferencia', async () => {
    servidor = hojaCon([linea('ML-2', 'entregado', { cobroEnDestino: true, medioCobro: 'transferencia' })])
    await montar()

    expect(boton('hoja-linea-ML-2-medio-transferencia').getAttribute('aria-pressed')).toBe('true')
    expect(boton('hoja-linea-ML-2-medio-efectivo').getAttribute('aria-pressed')).toBe('false')
    expect(qa('hoja-linea-ML-2-entregado-transferencia')).toBeNull()
  })

  it('en una línea ya entregada, cambiar el medio lo manda al servidor', async () => {
    servidor = hojaCon([linea('ML-2', 'entregado', { cobroEnDestino: true, medioCobro: 'efectivo' })])
    await montar()

    await clic('hoja-linea-ML-2-medio-transferencia')

    expect(escrituras().map(e => e.body)).toEqual([{ estado: 'entregado', medioCobro: 'transferencia' }])
  })

  it('no ofrece medio en una línea no entregada', async () => {
    servidor = hojaCon([linea('ML-2', 'no_entregado', { cobroEnDestino: true })])
    await montar()

    expect(qa('hoja-linea-ML-2-medio-efectivo')).toBeNull()
  })
})

describe('detalle: rendir', () => {
  it('el botón lleva a rendir al repartidor, sin escribir nada', async () => {
    await montar()

    expect(qa('hoja-rendir')!.textContent?.trim()).toBe('Rendir a Juan Pérez')
    expect(qa('hoja-rendir')!.getAttribute('href')).toBe('/paquetes/rendiciones/nueva?repartidorId=r-1')
    expect(escrituras()).toEqual([])
  })

  it('con paquetes en ruta avisa que esa hoja todavía no se puede rendir', async () => {
    await montar()

    expect(texto('hoja-rendir-bloqueo')).toContain('Quedan 2 en ruta')
  })
})

describe('detalle: una hoja ya rendida', () => {
  beforeEach(() => {
    servidor = hojaCon([linea('ML-1', 'entregado'), linea('ML-2', 'no_entregado')], {
      estado: 'rendida',
      rendidaEl: '2026-10-14T18:30:00.000Z',
      netoARendir: '1500',
    })
  })

  it('no muestra ninguna acción y sí cuándo se rindió', async () => {
    await montar()

    expect(texto('hoja-rendida')).toMatch(/^Rendida el .*2026/)
    expect(qa('hoja-rendir')).toBeNull()
    expect(qa('hoja-entregar-todos')).toBeNull()
    expect(document.body.querySelectorAll('[data-qa^="hoja-linea-"][data-qa$="-entregado"]')).toHaveLength(0)
    expect(document.body.querySelectorAll('[data-qa^="hoja-linea-quitar-"]')).toHaveLength(0)
    expect(qa('hoja-linea-ML-2')!.textContent).toContain('No entregado')
  })

  it('el neto es el de la rendición, sin rótulo de parcial', async () => {
    await montar()

    expect(qa('hoja-neto')!.textContent).toContain('Neto a rendir')
    expect(texto('hoja-neto-monto')).toBe('$1.500')
  })
})
