// @vitest-environment nuxt
//
// "Generar nota" de un REFUND aprobado que quedó sin nota (spec
// `2026-10-04-generar-nota-de-refund-sin-nota`): las líneas vienen precargadas
// con lo que declaró el reembolso, el body no lleva monto, y una nota por
// intento —misma clave al reintentar, aviso si se reprodujo, y el 422 o el 409
// de "ya hay una nota" cierran el modal y hacen recargar la orden—.
// Es lógica de TEMPLATE + `confirmar()`: ni el build ni el typecheck la ven.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import GenerarNotaModal from './GenerarNotaModal.vue'
import { AVISO_NOTA_REPETIDA } from '~/composables/useReembolsoPasarela'
import type { LineaDeclarada } from '~/composables/useDevolucionInventario'

type Opts = { method?: string, body?: Record<string, unknown>, headers?: Record<string, string> }
let llamadas: { url: string, opts?: Opts }[] = []
let respuestaPost: () => Promise<unknown>
let respuestaVenta: () => Promise<unknown>
const DETALLES = [
  {
    itemId: 'item-1',
    descripcion: 'Bebida',
    cantidad: '2',
    totalLinea: '2380',
    modoInventario: 'cantidad',
    devolucionStock: 'recuperable',
    cantidadDevuelta: '0',
  },
  {
    itemId: 'serv-1',
    descripcion: 'Despacho',
    cantidad: '1',
    totalLinea: '3000',
    modoInventario: null,
    devolucionStock: 'sin_stock',
    cantidadDevuelta: '0',
  },
]

const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: Opts) => {
    llamadas.push({ url, opts })
    if (opts?.method === 'POST') return respuestaPost()
    return respuestaVenta()
  }
})

async function abrir(
  devoluciones: LineaDeclarada[] | null,
  transaccionId = 'tx-r',
) {
  const wrapper = await mountSuspended(GenerarNotaModal, {
    props: {
      open: false,
      ordenId: 'orden-1',
      transaccionId,
      monto: '70000',
      ventaId: 'venta-1',
      devoluciones,
    },
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

const boton = () =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Generar nota')!
const posts = () => llamadas.filter(l => l.opts?.method === 'POST')
const confirmar = async () => {
  boton().click()
  await flushPromises()
}
const reabrir = async (wrapper: Awaited<ReturnType<typeof abrir>>) => {
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  await flushPromises()
}

describe('GenerarNotaModal', () => {
  beforeEach(() => {
    llamadas = []
    respuestaPost = () => Promise.resolve({ notaCreditoId: 'nc-1' })
    respuestaVenta = () => Promise.resolve({ detalles: DETALLES })
    toastAdd.mockClear()
    document.body.innerHTML = ''
  })

  it('precarga lo que declaró el reembolso y lo manda tal cual, sin monto: lo pone el REFUND', async () => {
    const wrapper = await abrir([{ itemId: 'item-1', cantidad: '1', stock: 'pierde' }])
    const input = document.body
      .querySelector('[data-testid="devolucion-fila-item-1"]')!
      .querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('1')

    await confirmar()

    const [post] = posts()
    expect(post!.url).toContain('/pasarela/admin/ordenes/orden-1/reembolsos/tx-r/nota')
    expect(post!.opts!.body).toEqual({
      devoluciones: [{ itemId: 'item-1', cantidad: '1', stock: 'pierde' }],
    })
    expect(post!.opts!.headers!['Idempotency-Key']).toEqual(expect.any(String))
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nota de crédito generada' }))
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('el reembolso no pidió líneas: sale sin devoluciones', async () => {
    await abrir([])
    await confirmar()
    expect(posts()[0]!.opts!.body).toEqual({ devoluciones: [] })
  })

  it('una línea con stock sin respuesta no deja generar (el backend la rechaza con 400)', async () => {
    await abrir([{ itemId: 'item-1', cantidad: '1' }])
    expect(boton().disabled).toBe(true)
  })

  it('si la venta no carga no se genera: la nota saldría sin lo que el reembolso declaró', async () => {
    respuestaVenta = () => Promise.reject(new Error('caída'))
    await abrir([{ itemId: 'item-1', cantidad: '1', stock: 'pierde' }])
    expect(boton().disabled).toBe(true)
  })

  it('un error deja la clave viva: el reintento —aunque se cierre y reabra el modal— va con la misma', async () => {
    respuestaPost = () => Promise.reject(Object.assign(new Error('x'), { status: 500, data: { message: 'caída' } }))
    const wrapper = await abrir([], 'tx-error')
    await confirmar()
    await reabrir(wrapper)
    respuestaPost = () => Promise.resolve({ notaCreditoId: 'nc-1' })
    await confirmar()

    const [a, b] = posts()
    expect(b!.opts!.headers!['Idempotency-Key']).toBe(a!.opts!.headers!['Idempotency-Key'])
    expect(wrapper.emitted('recargar')).toBeUndefined()
  })

  it('después del éxito el próximo intento es otro', async () => {
    const wrapper = await abrir([], 'tx-exito')
    await confirmar()
    await reabrir(wrapper)
    await confirmar()

    const [a, b] = posts()
    expect(b!.opts!.headers!['Idempotency-Key']).not.toBe(a!.opts!.headers!['Idempotency-Key'])
  })

  it('reproducida: avisa que no se emitió dos veces', async () => {
    respuestaPost = () => Promise.resolve({ notaCreditoId: 'nc-1', repetida: true })
    await abrir([])
    await confirmar()
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: AVISO_NOTA_REPETIDA, color: 'warning' }))
  })

  it.each([
    ['422 de otros datos', { status: 422, data: { message: 'Esta nota ya se había generado con otros datos.', ventaId: 'nc-1' } }],
    ['409 de ya ligado', { status: 409, data: { message: 'Este reembolso ya tiene su nota de crédito.', notaCreditoId: 'nc-1' } }],
  ])('%s: cierra el modal, recarga la orden y el próximo intento es otro', async (_caso, error) => {
    respuestaPost = () => Promise.reject(Object.assign(new Error('x'), error))
    const wrapper = await abrir([], `tx-${error.status}`)
    await confirmar()

    expect(wrapper.emitted('recargar')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: error.data.message, color: 'error' }))

    respuestaPost = () => Promise.resolve({ notaCreditoId: 'nc-1' })
    await reabrir(wrapper)
    await confirmar()
    const [a, b] = posts()
    expect(b!.opts!.headers!['Idempotency-Key']).not.toBe(a!.opts!.headers!['Idempotency-Key'])
  })
})
