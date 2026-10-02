// @vitest-environment nuxt
//
// Un abono que se repite no se registra dos veces
// (`docs/adr/026-idempotencia-de-cobros.md`).
//
// Entorno nuxt porque lo que se prueba es el botón REAL del modal: el cajero
// confirma, se corta la red, cierra el modal, lo reabre y confirma de nuevo.
// Ese reintento tiene que ser el mismo intento, o el cliente fiado queda con
// dos abonos y la caja esperando plata que nunca entró.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import AbonoModal from './AbonoModal.vue'
import { AVISO_COBRO_REPETIDO, useIntentoCobro } from '~/composables/useIntentoCobro'

let toasts: { title?: string, actions?: { label: string }[] }[] = []
mockNuxtImport('useToast', () => () => ({
  add: (t: { title?: string }) => { toasts.push(t) },
}))

interface PostAbono { body: Record<string, unknown>, clave?: string }
let abonos: PostAbono[] = []
/** Lo que contesta cada `POST /pagos`: un `Error` lo rechaza; vacía = éxito. */
let respuestas: (Error | Record<string, unknown>)[] = []

mockNuxtImport('useApiFetch', () => {
  return (_url: string, opts?: { body?: Record<string, unknown>, headers?: Record<string, string> }) => {
    abonos.push({ body: opts?.body ?? {}, clave: opts?.headers?.['Idempotency-Key'] })
    const respuesta = respuestas.shift()
    if (respuesta instanceof Error) return Promise.reject(respuesta)
    return Promise.resolve({
      pagos: [],
      venta: { id: 'venta-1', estado: 'pagada_parcial', saldo: '500', puedeAbonar: true },
      ...respuesta,
    })
  }
})

interface Metodo {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
  emisor: 'sistema' | 'maquina' | 'nadie'
}

const EFECTIVO: Metodo = { metodoPagoId: 'mp-efectivo', nombre: 'Efectivo', permiteVuelto: true, habilitada: true, emisor: 'sistema' }
const TARJETA: Metodo = { metodoPagoId: 'mp-tarjeta', nombre: 'Tarjeta de débito', permiteVuelto: false, habilitada: true, emisor: 'maquina' }
const METODOS = [EFECTIVO]

function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
}

async function esperar(ms = 50) {
  await new Promise(r => setTimeout(r, ms))
}

/**
 * Monta cerrado y lo abre: el `watch(open)` que precarga el pago con el saldo
 * solo corre al abrir de verdad (mismo criterio que `AnularVentaModal`).
 */
async function montar(
  ventaId = 'venta-1',
  { metodos = METODOS, abonoConMaquinaDuplica = false }: { metodos?: Metodo[], abonoConMaquinaDuplica?: boolean } = {},
) {
  const wrapper = await mountSuspended(AbonoModal, {
    props: { ventaId, saldo: '1000', metodos, abonoConMaquinaDuplica, open: false },
  })
  await wrapper.setProps({ open: true })
  await esperar()
  return wrapper
}

async function reabrir(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.setProps({ open: false })
  await esperar()
  await wrapper.setProps({ open: true })
  await esperar()
}

async function confirmar() {
  const boton = [...(dialogo()?.querySelectorAll('button') ?? [])]
    .find(b => b.textContent?.includes('Confirmar pago')) as HTMLButtonElement | undefined
  expect(boton, 'el botón Confirmar pago').toBeTruthy()
  expect(boton!.disabled, 'habilitado').toBe(false)
  boton!.click()
  await esperar()
}

beforeEach(() => {
  document.body.innerHTML = ''
  toasts = []
  abonos = []
  respuestas = []
  for (const v of ['venta-1', 'venta-2']) useIntentoCobro().terminar(`abono:${v}`)
})

describe('AbonoModal — un abono que se repite no se registra dos veces', () => {
  it('un corte, cerrar y reabrir el modal, y confirmar de nuevo: la MISMA clave', async () => {
    respuestas = [new Error('fetch failed')]
    const wrapper = await montar()

    await confirmar()
    await reabrir(wrapper)
    await confirmar()

    expect(abonos).toHaveLength(2)
    expect(abonos[0]!.clave).toBeTruthy()
    expect(abonos[1]!.clave, 'el reintento es el mismo intento').toBe(abonos[0]!.clave)
  })

  it('otra venta es otro intento', async () => {
    respuestas = [new Error('fetch failed')]
    await montar('venta-1')
    await confirmar()
    document.body.innerHTML = ''
    await montar('venta-2')
    await confirmar()

    expect(abonos[1]!.clave).not.toBe(abonos[0]!.clave)
  })

  it('un abono que salió bien cierra el intento: el siguiente a esa venta lleva otra clave', async () => {
    const wrapper = await montar()
    await confirmar()
    await reabrir(wrapper)
    await confirmar()

    expect(abonos).toHaveLength(2)
    expect(abonos[1]!.clave).not.toBe(abonos[0]!.clave)
  })

  it('un abono reproducido sigue el flujo de éxito y avisa que ya había entrado', async () => {
    respuestas = [{ repetida: true }]
    const wrapper = await montar()
    await confirmar()

    expect(toasts.some(t => t.title === 'Pago registrado')).toBe(true)
    expect(toasts.some(t => t.title === AVISO_COBRO_REPETIDO)).toBe(true)
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('el 422 de otros datos: "Ver venta" en vez del error genérico', async () => {
    const err = new Error('x') as Error & { status?: number, data?: unknown }
    err.status = 422
    err.data = { statusCode: 422, message: 'Este cobro ya se había registrado con otros datos. Revisá la venta antes de cobrar de nuevo.', ventaId: 'venta-1' }
    respuestas = [err]
    await montar()
    await confirmar()

    const aviso = toasts.find(t => (t.title ?? '').includes('otros datos'))
    expect(aviso?.actions?.map(a => a.label)).toEqual(['Ver venta'])
    expect(toasts.some(t => t.title === 'Error al registrar pago')).toBe(false)
  })
})

describe('AbonoModal — el voucher que duplica la boleta (E1b)', () => {
  const AVISO = 'Esta venta ya tiene su boleta. El voucher de este pago también vale como boleta y la duplica. El cobro sigue, y queda marcado para que el contador lo corrija.'

  const avisoVisible = () => dialogo()?.querySelector('[data-qa="aviso-voucher-duplicado"]') ?? null

  function escribirNumero(valor: string) {
    const input = dialogo()!.querySelector<HTMLInputElement>('[data-qa="comprobante-numero"]')
    expect(input, 'el campo de número').toBeTruthy()
    input!.value = valor
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('con la bandera del backend y un medio de la máquina: avisa antes de confirmar', async () => {
    await montar('venta-1', { metodos: [TARJETA, EFECTIVO], abonoConMaquinaDuplica: true })

    expect(avisoVisible()).toBeTruthy()
    expect(dialogo()!.textContent).toContain(AVISO)
  })

  it('el aviso no bloquea: confirmar sigue habilitado y el pago sale con el número', async () => {
    const wrapper = await montar('venta-1', { metodos: [TARJETA, EFECTIVO], abonoConMaquinaDuplica: true })

    escribirNumero('  445566  ')
    wrapper.findComponent({ name: 'VentasDocumentoNumeroCampos' }).vm.$emit('update:clase', 'voucher')
    await esperar()
    await confirmar()

    expect(abonos).toHaveLength(1)
    expect(abonos[0]!.body.pagos).toEqual([
      { metodoPagoId: 'mp-tarjeta', monto: '1000', numeroDocumento: '445566', claseDocumento: 'voucher' },
    ])
  })

  it('sin la bandera del backend no avisa ni pide número, aunque el medio sea de la máquina', async () => {
    await montar('venta-1', { metodos: [TARJETA, EFECTIVO], abonoConMaquinaDuplica: false })

    expect(avisoVisible()).toBeNull()
    expect(dialogo()!.querySelector('[data-qa="comprobante-numero"]')).toBeNull()
    await confirmar()
    expect(abonos[0]!.body.pagos).toEqual([{ metodoPagoId: 'mp-tarjeta', monto: '1000' }])
  })

  it('sin la bandera el número que hubiera quedado en el pago tampoco viaja', async () => {
    // La bandera puede cambiar con el modal abierto (el detalle se resincroniza):
    // un número tipeado antes no debe llegar como si fuera el voucher duplicado.
    const wrapper = await montar('venta-1', { metodos: [TARJETA, EFECTIVO], abonoConMaquinaDuplica: false })
    ;(wrapper.vm as unknown as { pagos: { numeroDocumento?: string }[] }).pagos[0]!.numeroDocumento = '445566'
    await confirmar()

    expect(abonos[0]!.body.pagos).toEqual([{ metodoPagoId: 'mp-tarjeta', monto: '1000' }])
  })

  it('con la bandera pero un medio que no es de la máquina: no avisa', async () => {
    await montar('venta-1', { metodos: [EFECTIVO, TARJETA], abonoConMaquinaDuplica: true })

    expect(avisoVisible()).toBeNull()
    expect(dialogo()!.querySelector('[data-qa="comprobante-numero"]')).toBeNull()
  })
})
