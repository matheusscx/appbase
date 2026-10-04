// @vitest-environment nuxt
//
// Todo reembolso aprobado de una orden con venta deja su corrección en el
// backend (spec `2026-10-01-emision-por-venta`, § 3.6): ya no hay casilla que la
// pida. Y el DTO del backend rechaza con 400 lo que no declara, así que si la
// pantalla siguiera mandando `generarNotaCredito`, el reembolso entero fallaría.
// Es lógica de TEMPLATE + `confirmar()`: ni el build ni el typecheck la ven.
//
// Y un reembolso por intento (ADR-029, owner 2026-10-04): la misma clave en el
// reintento —aunque se cierre y reabra el modal—, el aviso si ya había salido,
// "Transbank no hizo el reembolso" cuando no salió, y el 422 de otros datos que
// cierra el modal y hace recargar la orden.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ReembolsoModal from './ReembolsoModal.vue'

type Opts = { method?: string, body?: Record<string, unknown>, headers?: Record<string, string> }
let llamadas: { url: string, opts?: Opts }[] = []
let respuestaPost: () => Promise<unknown>
const APROBADO = { ordenId: 'orden-1', estado: 'reembolsada', reembolsoAprobado: true, notaCreditoId: 'nc-1' }

const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: Opts) => {
    llamadas.push({ url, opts })
    if (opts?.method === 'POST') return respuestaPost()
    return Promise.resolve({ detalles: [] })
  }
})

async function abrir(ventaId: string | null, ordenId = 'orden-1') {
  const wrapper = await mountSuspended(ReembolsoModal, {
    props: { open: false, ordenId, disponible: '100000', ventaId },
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

const botonConfirmar = () =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('Confirmar reembolso'))

describe('ReembolsoModal — el reembolso siempre deja su corrección', () => {
  beforeEach(() => {
    llamadas = []
    respuestaPost = () => Promise.resolve(APROBADO)
    toastAdd.mockClear()
    document.body.innerHTML = ''
  })

  it('no ofrece la casilla "Generar nota de crédito": no hay nada que elegir', async () => {
    await abrir('venta-1')

    expect(document.body.textContent).not.toContain('Generar nota de crédito')
    expect(document.body.querySelector('[role="checkbox"]')).toBeNull()
  })

  it('confirmar manda solo el monto: ni `generarNotaCredito` ni devoluciones sin ítems marcados', async () => {
    await abrir('venta-1')

    botonConfirmar()!.click()
    await flushPromises()

    const post = llamadas.find(l => l.opts?.method === 'POST')!
    expect(post.url).toContain('/pasarela/admin/ordenes/orden-1/reembolsos')
    expect(post.opts!.body).toEqual({ monto: '100000' })
    expect(post.opts!.body).not.toHaveProperty('generarNotaCredito')
  })

  it('una orden sin venta tampoco manda el campo', async () => {
    await abrir(null)

    botonConfirmar()!.click()
    await flushPromises()

    const post = llamadas.find(l => l.opts?.method === 'POST')!
    expect(post.opts!.body).toEqual({ monto: '100000' })
  })
})

describe('ReembolsoModal — un reembolso por intento', () => {
  const posts = () => llamadas.filter(l => l.opts?.method === 'POST')
  const clave = (i: number) => posts()[i]!.opts!.headers!['Idempotency-Key']
  const confirmarYEsperar = async () => {
    botonConfirmar()!.click()
    await flushPromises()
  }
  const error = (status: number, data: Record<string, unknown>) =>
    Object.assign(new Error('x'), { status, data })
  const reabrir = async (wrapper: Awaited<ReturnType<typeof abrir>>) => {
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
  }

  beforeEach(() => {
    llamadas = []
    respuestaPost = () => Promise.resolve(APROBADO)
    toastAdd.mockClear()
    document.body.innerHTML = ''
  })

  it('tras un error (Transbank no confirmó) el reintento lleva la MISMA clave, aunque se cierre y reabra el modal', async () => {
    respuestaPost = () => Promise.reject(error(502, { message: 'no sabemos si salió' }))
    const wrapper = await abrir('venta-1', 'orden-reintento')
    await confirmarYEsperar()
    await reabrir(wrapper)
    respuestaPost = () => Promise.resolve(APROBADO)
    await confirmarYEsperar()

    expect(posts()).toHaveLength(2)
    expect(clave(0)).toMatch(/^[0-9a-f-]{36}$/)
    expect(clave(1)).toBe(clave(0))
  })

  it('tras un éxito, el reembolso siguiente es otro intento (otra clave)', async () => {
    const wrapper = await abrir('venta-1', 'orden-exito')
    await confirmarYEsperar()
    await reabrir(wrapper)
    await confirmarYEsperar()

    expect(clave(1)).not.toBe(clave(0))
  })

  it('el reintento reproducido avisa que ya se había hecho y que el cliente recibe la plata una sola vez', async () => {
    respuestaPost = () => Promise.resolve({
      ...APROBADO,
      repetida: true,
      reembolso: { transaccionId: 'tx-1', monto: '17000' },
    })
    const wrapper = await abrir('venta-1', 'orden-repetida')
    await confirmarYEsperar()

    const aviso = toastAdd.mock.calls.at(-1)![0] as { title: string, color: string }
    expect(aviso.title).toContain('Este reembolso ya se había hecho')
    expect(aviso.title).toContain('una sola vez')
    expect(aviso.color).toBe('warning')
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('si Transbank no hizo el reembolso lo dice con el motivo (no "Reembolso procesado") y el próximo clic es otro intento', async () => {
    respuestaPost = () => Promise.resolve({
      ordenId: 'orden-1',
      estado: 'conciliada',
      reembolsoAprobado: false,
      motivo: 'el saldo de la tarjeta no cambió. Podés reembolsar de nuevo.',
    })
    const wrapper = await abrir('venta-1', 'orden-no-salio')
    await confirmarYEsperar()
    await reabrir(wrapper)
    await confirmarYEsperar()

    const aviso = toastAdd.mock.calls[0]![0] as { title: string, description: string, color: string }
    expect(aviso).toMatchObject({
      title: 'Transbank no hizo el reembolso',
      description: expect.stringContaining('Podés reembolsar de nuevo'),
      color: 'error',
    })
    expect(clave(1)).not.toBe(clave(0))
  })

  it('el 422 de otros datos: cierra el modal, pide recargar la orden y termina el intento', async () => {
    respuestaPost = () => Promise.reject(error(422, {
      message: 'Este reembolso ya se había hecho con otros datos.',
      ordenId: 'orden-otros',
    }))
    const wrapper = await abrir('venta-1', 'orden-otros')
    await confirmarYEsperar()

    expect(wrapper.emitted('otrosDatos')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    respuestaPost = () => Promise.resolve(APROBADO)
    await reabrir(wrapper)
    await confirmarYEsperar()
    expect(clave(1)).not.toBe(clave(0))
  })
})
