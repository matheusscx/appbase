// @vitest-environment nuxt
//
// La pantalla de Boleta electrónica contra un `useApiFetch` simulado. Ojo con lo que NO prueba:
// ese mock contesta 200 a todo, así que el 400 real del certificado o del CAF (RUT ajeno, folios
// repetidos, archivo que no es un .pfx) lo cubre Playwright, no este archivo.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import BoletaElectronica from './boleta-electronica.vue'
import type { BoletaSinEmitir, CafPerfil, PerfilFiscal, ResultadoEmitirPendientes } from '~/composables/usePerfilFiscal'

function caf(over: Partial<CafPerfil> = {}): CafPerfil {
  return {
    id: 'caf-1',
    tipo: 39,
    ambiente: 'certificacion',
    desde: 1,
    hasta: 50,
    usados: 0,
    restantes: 50,
    fechaAutorizacion: '2026-10-01',
    idk: 100,
    borrable: true,
    ...over,
  }
}

function perfilCompleto(over: Partial<PerfilFiscal> = {}): PerfilFiscal {
  return {
    emisor: {
      razonSocialId: 'rs-1',
      nombre: 'Almacén Paris SpA',
      rut: '12.345.678-5',
      direccion: 'Av. Ejemplo 123',
      giro: 'Venta de alimentos',
      comuna: 'Providencia',
      ambiente: 'certificacion',
      fechaResolucion: '2026-08-01',
      numeroResolucion: 0,
    },
    certificado: {
      id: 'cert-1',
      rutFirmante: '11.111.111-1',
      nombreFirmante: 'Firmante de Prueba',
      venceEl: '2027-03-15T12:00:00.000Z',
    },
    cafs: [caf()],
    faltantes: [],
    avisos: [],
    emisionActiva: false,
    ...over,
  }
}

let perfil: PerfilFiscal = perfilCompleto()
let llamadas: { url: string, method: string, body?: Record<string, unknown> }[] = []
/** Cuántos `GET /dte/perfil` contestan bien antes de que el siguiente falle; `null` = ninguno falla. */
let getsBuenos: number | null = null
let toasts: { title: string, color?: string }[] = []
let sinEmitir: BoletaSinEmitir[] = []
/** Lo que contesta `POST /dte/emitir-pendientes`; si es una promesa, la respuesta queda en el aire. */
let respuestaEmitir: Promise<ResultadoEmitirPendientes> | ResultadoEmitirPendientes = { emitidas: 0, pendientes: 0, errores: [] }
/** Si no es `null`, `PATCH /dte/emision` falla con un 400 de este mensaje. */
let rechazoEmision: string | null = null

function boleta(over: Partial<BoletaSinEmitir> = {}): BoletaSinEmitir {
  return {
    ventaId: 'venta-1',
    fecha: '2026-10-14T15:00:00.000Z',
    monto: '11900',
    codigo: 'SIN_FOLIOS',
    mensaje: 'No quedan folios de boleta (39) para emitir',
    grupo: 'perfil',
    ...over,
  }
}

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title: string, color?: string }) => { toasts.push(t) } })
})

// El monto lo formatea la moneda oficial del tenant, que viene de un store que acá no se carga.
mockNuxtImport('useFormatters', () => {
  return () => ({ formatMonto: (v: string) => `$${v}` })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (url.endsWith('/dte/perfil') && method === 'GET') {
      if (getsBuenos !== null && getsBuenos-- <= 0) return Promise.reject(new Error('sin conexión'))
      return Promise.resolve(structuredClone(perfil))
    }
    if (url.endsWith('/dte/emision') && method === 'PATCH') {
      if (rechazoEmision !== null) {
        return Promise.reject(Object.assign(new Error('400'), { data: { message: rechazoEmision } }))
      }
      // Como el servidor: lo que se pidió queda guardado y el siguiente GET lo trae.
      perfil.emisionActiva = opts?.body?.activa as boolean
      return Promise.resolve({ emisionActiva: perfil.emisionActiva })
    }
    if (url.endsWith('/dte/boletas-sin-emitir')) return Promise.resolve(structuredClone(sinEmitir))
    if (url.endsWith('/dte/emitir-pendientes')) return Promise.resolve(respuestaEmitir)
    return Promise.resolve({})
  }
})

async function montar() {
  const wrapper = await mountSuspended(BoletaElectronica)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  perfil = perfilCompleto()
  llamadas = []
  getsBuenos = null
  toasts = []
  sinEmitir = []
  respuestaEmitir = { emitidas: 0, pendientes: 0, errores: [] }
  rechazoEmision = null
})

const esperar = () => new Promise(r => setTimeout(r, 0))
const interruptor = (w: Awaited<ReturnType<typeof montar>>) => w.find('button[role="switch"]')
/** El modal de confirmación lo teletransporta `UModal` fuera del wrapper. */
const botonDelModal = (texto: string) =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === texto)

describe('boleta electrónica', () => {
  it('con faltantes muestra cada mensaje y no dice que está lista', async () => {
    perfil = perfilCompleto({
      faltantes: [
        { codigo: 'SIN_GIRO', mensaje: 'Falta el giro de la empresa' },
        { codigo: 'SIN_CERTIFICADO', mensaje: 'Falta cargar el certificado digital' },
      ],
    })

    const wrapper = await montar()
    const texto = wrapper.text()

    expect(texto).toContain('Falta el giro de la empresa')
    expect(texto).toContain('Falta cargar el certificado digital')
    expect(texto).not.toContain('Lista para emitir')
    wrapper.unmount()
  })

  it('sin faltantes dice que está lista para emitir', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Lista para emitir')
    expect(wrapper.text()).not.toContain('Para emitir boletas falta')
    wrapper.unmount()
  })

  it('sin emisor manda a Razones sociales y no deja subir certificado ni folios', async () => {
    perfil = perfilCompleto({
      emisor: null,
      certificado: null,
      cafs: [],
      faltantes: [{ codigo: 'SIN_EMISOR', mensaje: 'Falta cargar los datos de la empresa que emite' }],
    })

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Marca una razón social como preferida')
    expect(wrapper.find('a[href="/configuracion/razones-sociales"]').exists()).toBe(true)
    const botones = wrapper.findAll('button')
    const subir = (nombre: string) => botones.find(b => b.text().includes(nombre))!
    expect(subir('Subir certificado').attributes('disabled')).toBeDefined()
    expect(subir('Subir CAF').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('"Borrar" aparece solo en el CAF borrable', async () => {
    perfil = perfilCompleto({
      cafs: [
        caf({ id: 'caf-libre', desde: 1, hasta: 50, borrable: true }),
        caf({ id: 'caf-usado', desde: 51, hasta: 100, usados: 3, restantes: 47, borrable: false }),
      ],
    })

    const wrapper = await montar()

    const filas = wrapper.findAll('[data-qa="folios"] tbody tr')
    expect(filas).toHaveLength(2)
    expect(filas[0]!.text()).toContain('Borrar')
    expect(filas[1]!.text()).not.toContain('Borrar')
    wrapper.unmount()
  })

  it('marca "otro ambiente" solo en el CAF que no es del ambiente del emisor', async () => {
    perfil = perfilCompleto({
      cafs: [
        caf({ id: 'a', ambiente: 'certificacion' }),
        caf({ id: 'b', ambiente: 'produccion', desde: 51, hasta: 100 }),
      ],
    })

    const wrapper = await montar()

    const filas = wrapper.findAll('[data-qa="folios"] tbody tr')
    expect(filas[0]!.text()).not.toContain('otro ambiente')
    expect(filas[1]!.text()).toContain('otro ambiente')
    wrapper.unmount()
  })

  it('muestra los avisos de folios y de certificado en su tarjeta', async () => {
    perfil = perfilCompleto({
      avisos: [
        { codigo: 'POCOS_FOLIOS', mensaje: 'Quedan 50 folios de boleta (39)' },
        { codigo: 'CERTIFICADO_POR_VENCER', mensaje: 'El certificado digital vence el 15-03-2027' },
      ],
    })

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Quedan 50 folios de boleta (39)')
    expect(wrapper.text()).toContain('El certificado digital vence el 15-03-2027')
    wrapper.unmount()
  })

  it('muestra el certificado con su vencimiento en el día de Chile', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Firmante de Prueba')
    expect(wrapper.text()).toContain('15-03-2027')
    wrapper.unmount()
  })

  it('guardar manda el PATCH y vuelve a pedir el perfil en vez de mezclar la respuesta', async () => {
    const wrapper = await montar()
    await wrapper.find('input[placeholder="Venta de alimentos"]').setValue('Restaurante')
    await wrapper.find('input[placeholder="Providencia"]').setValue('Ñuñoa')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.url).toMatch(/\/dte\/perfil$/)
    expect(patch.body).toMatchObject({
      giro: 'Restaurante',
      comuna: 'Ñuñoa',
      ambienteSii: 'certificacion',
      fechaResolucion: '2026-08-01',
      // El 0 es un número válido (es el de la resolución de certificación): no se pierde.
      numeroResolucion: 0,
    })
    const gets = llamadas.filter(l => l.method === 'GET' && l.url.endsWith('/dte/perfil'))
    expect(gets).toHaveLength(2)
    wrapper.unmount()
  })

  // `UInput type="number"` entrega un number por el v-model, no el texto: un `.trim()` sobre eso
  // reventaba al guardar (visto en Playwright, no en el spec que no tocaba este campo).
  it('guardar con el número de resolución recién tipeado lo manda como número', async () => {
    const wrapper = await montar()
    await wrapper.find('input[type="number"]').setValue('7')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.body).toMatchObject({ numeroResolucion: 7 })
    wrapper.unmount()
  })

  it('con el número de resolución vaciado no lo manda: ninguno de los campos acepta null', async () => {
    const wrapper = await montar()
    await wrapper.find('input[type="number"]').setValue('')

    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.body).not.toHaveProperty('numeroResolucion')
    wrapper.unmount()
  })

  it('si el perfil no se puede volver a pedir tras guardar, avisa el error y no el éxito', async () => {
    const wrapper = await montar()
    getsBuenos = 0
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(llamadas.some(l => l.method === 'PATCH')).toBe(true)
    expect(toasts.some(t => t.color === 'error')).toBe(true)
    expect(toasts.some(t => t.color === 'success')).toBe(false)
    wrapper.unmount()
  })

  it('guardar con el perfil de vuelta avisa el éxito', async () => {
    const wrapper = await montar()
    await wrapper.find('form').trigger('submit')
    await new Promise(r => setTimeout(r, 0))

    expect(toasts).toEqual([{ title: 'Datos de la empresa guardados', color: 'success' }])
    wrapper.unmount()
  })
})

describe('interruptor de la emisión', () => {
  it('con faltantes está deshabilitado y dice qué falta', async () => {
    perfil = perfilCompleto({
      faltantes: [
        { codigo: 'SIN_GIRO', mensaje: 'Falta el giro de la empresa' },
        { codigo: 'SIN_CERTIFICADO', mensaje: 'Falta cargar el certificado digital' },
      ],
    })

    const wrapper = await montar()

    expect(wrapper.text()).toContain('Emitir boletas electrónicas')
    expect(interruptor(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Para emitir falta: Falta el giro de la empresa; Falta cargar el certificado digital')
    // El gancho de Playwright cae en la tarjeta del interruptor, que lleva el texto.
    expect(wrapper.find('[data-qa="emision"]').text()).toContain('Para emitir falta:')
    wrapper.unmount()
  })

  it('con el perfil completo está habilitado y prendido refleja lo que dice el servidor', async () => {
    perfil = perfilCompleto({ emisionActiva: true })

    const wrapper = await montar()

    expect(interruptor(wrapper).attributes('disabled')).toBeUndefined()
    expect(interruptor(wrapper).attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  // Con la emisión prendida y algo que se venció, apagarla tiene que seguir siendo posible.
  it('prendido y con faltantes se puede apagar', async () => {
    perfil = perfilCompleto({
      emisionActiva: true,
      faltantes: [{ codigo: 'CERTIFICADO_VENCIDO', mensaje: 'El certificado digital está vencido' }],
    })

    const wrapper = await montar()

    expect(interruptor(wrapper).attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('prenderlo pide confirmar y no manda nada hasta confirmar', async () => {
    const wrapper = await montar()

    await interruptor(wrapper).trigger('click')
    await esperar()

    expect(document.body.textContent).toContain('Desde ahora cada venta emite una boleta ante el SII.')
    expect(llamadas.some(l => l.method === 'PATCH' && l.url.endsWith('/dte/emision'))).toBe(false)
    expect(interruptor(wrapper).attributes('aria-checked')).toBe('false')

    botonDelModal('Emitir boletas')!.click()
    await new Promise(r => setTimeout(r, 50))

    const patch = llamadas.find(l => l.method === 'PATCH' && l.url.endsWith('/dte/emision'))!
    expect(patch.body).toEqual({ activa: true })
    expect(interruptor(wrapper).attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('cancelar la confirmación no prende nada', async () => {
    const wrapper = await montar()

    await interruptor(wrapper).trigger('click')
    await esperar()
    botonDelModal('Cancelar')!.click()
    await new Promise(r => setTimeout(r, 50))

    expect(llamadas.some(l => l.method === 'PATCH' && l.url.endsWith('/dte/emision'))).toBe(false)
    expect(interruptor(wrapper).attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })

  it('apagarlo no confirma: manda el PATCH de una', async () => {
    perfil = perfilCompleto({ emisionActiva: true })
    const wrapper = await montar()

    await interruptor(wrapper).trigger('click')
    await new Promise(r => setTimeout(r, 50))

    const patch = llamadas.find(l => l.method === 'PATCH' && l.url.endsWith('/dte/emision'))!
    expect(patch.body).toEqual({ activa: false })
    expect(interruptor(wrapper).attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })

  it('el 400 del servidor se muestra tal cual y el interruptor queda apagado', async () => {
    rechazoEmision = 'Para emitir falta: Falta cargar el certificado digital'
    const wrapper = await montar()

    await interruptor(wrapper).trigger('click')
    await esperar()
    botonDelModal('Emitir boletas')!.click()
    await new Promise(r => setTimeout(r, 50))

    expect(toasts).toContainEqual({ title: 'Para emitir falta: Falta cargar el certificado digital', color: 'error' })
    expect(interruptor(wrapper).attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })
})

describe('boletas sin emitir', () => {
  it('con la lista vacía dice que no hay y deja el botón sin efecto', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Boletas sin emitir')
    expect(wrapper.text()).toContain('No hay boletas sin emitir.')
    const boton = wrapper.findAll('button').find(b => b.text().includes('Emitir pendientes'))!
    expect(boton.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('cada fila muestra fecha, monto, el motivo tal cual y el link a la venta', async () => {
    sinEmitir = [
      boleta(),
      boleta({
        ventaId: 'venta-2',
        monto: '5000',
        codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO',
        mensaje: 'El producto lleva un impuesto adicional que la boleta no informa',
        grupo: 'boleta',
      }),
    ]

    const wrapper = await montar()

    const filas = wrapper.findAll('[data-qa="boletas-sin-emitir"] tbody tr')
    expect(filas).toHaveLength(2)
    expect(filas[0]!.text()).toContain('14-10-2026')
    expect(filas[0]!.text()).toContain('$11900')
    expect(filas[0]!.text()).toContain('No quedan folios de boleta (39) para emitir')
    expect(filas[0]!.text()).toContain('Se arregla en esta pantalla; después se emite con el botón.')
    expect(filas[0]!.find('a').attributes('href')).toBe('/ventas?venta=venta-1')
    expect(filas[1]!.text()).toContain('El producto lleva un impuesto adicional que la boleta no informa')
    expect(filas[1]!.text()).toContain('No se puede emitir.')
    expect(filas[1]!.find('a').attributes('href')).toBe('/ventas?venta=venta-2')
    wrapper.unmount()
  })

  it('el botón emite, muestra el resultado con sus errores y vuelve a pedir la lista', async () => {
    sinEmitir = [boleta(), boleta({ ventaId: 'venta-2' })]
    respuestaEmitir = {
      emitidas: 1,
      pendientes: 1,
      errores: [{ ventaId: 'venta-2', codigo: 'TEXTO_INVALIDO', mensaje: 'El nombre del ítem lleva símbolos que la boleta no admite' }],
    }
    const wrapper = await montar()
    const pedidasAntes = llamadas.filter(l => l.url.endsWith('/dte/boletas-sin-emitir')).length

    await wrapper.findAll('button').find(b => b.text().includes('Emitir pendientes'))!.trigger('click')
    await new Promise(r => setTimeout(r, 50))

    const post = llamadas.find(l => l.method === 'POST' && l.url.endsWith('/dte/emitir-pendientes'))!
    expect(post.body).toBeUndefined()
    const resultado = wrapper.find('[data-qa="resultado-emision"]')
    expect(resultado.text()).toContain('1 emitida')
    expect(resultado.text()).toContain('Siguen sin emitir: 1')
    expect(resultado.text()).toContain('El nombre del ítem lleva símbolos que la boleta no admite')
    expect(resultado.find('a').attributes('href')).toBe('/ventas?venta=venta-2')
    expect(llamadas.filter(l => l.url.endsWith('/dte/boletas-sin-emitir')).length).toBe(pedidasAntes + 1)
    wrapper.unmount()
  })

  // Un doble clic o dos pestañas no deben lanzar dos corridas en paralelo: la segunda esperaría el
  // mismo bloqueo de cada boleta y las dos tardarían el doble.
  it('mientras corre, el botón queda deshabilitado y un segundo click no manda otra corrida', async () => {
    sinEmitir = [boleta()]
    let terminar!: (r: ResultadoEmitirPendientes) => void
    respuestaEmitir = new Promise(r => { terminar = r })
    const wrapper = await montar()
    const boton = () => wrapper.findAll('button').find(b => b.text().includes('Emitir pendientes'))!

    await boton().trigger('click')
    await esperar()
    expect(boton().attributes('disabled')).toBeDefined()
    await boton().trigger('click')
    await esperar()
    expect(llamadas.filter(l => l.url.endsWith('/dte/emitir-pendientes'))).toHaveLength(1)

    terminar({ emitidas: 1, pendientes: 0, errores: [] })
    await new Promise(r => setTimeout(r, 50))
    expect(wrapper.find('[data-qa="resultado-emision"]').text()).toContain('1 emitida')
    wrapper.unmount()
  })
})
