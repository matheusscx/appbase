// @vitest-environment nuxt
//
// Un reembolso sin confirmar (ADR-029, owner 2026-10-04): primero se vuelve a
// consultar; recién si la consulta no lo aclara (409) aparece "Salió / No
// salió", y "Salió" no se manda sin el código de autorización del portal.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ReembolsoSinConfirmar from './ReembolsoSinConfirmar.vue'

type Opts = { method?: string, body?: Record<string, unknown> }
const { apiFetch, toastAdd } = vi.hoisted(() => ({ apiFetch: vi.fn(), toastAdd: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useApiFetch', () => apiFetch)

const montar = () =>
  mountSuspended(ReembolsoSinConfirmar, {
    props: { ordenId: 'orden-1', transaccionId: 'tx-1', monto: '17000' },
  })
const boton = (texto: string) =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === texto)
const conflicto = () => Object.assign(new Error('x'), { status: 409, data: { message: 'revisalo en el portal' } })

describe('ReembolsoSinConfirmar', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    toastAdd.mockClear()
    document.body.innerHTML = ''
  })

  it('al principio solo ofrece volver a consultar: marcar a mano no aparece', async () => {
    const wrapper = await montar()
    document.body.append(wrapper.element)

    expect(boton('Volver a consultar')).toBeTruthy()
    expect(boton('Salió')).toBeUndefined()
    expect(boton('No salió')).toBeUndefined()
  })

  it('si la consulta lo aclara, avisa la orden para que se recargue', async () => {
    apiFetch.mockResolvedValueOnce({ aclarado: 'salio' })
    const wrapper = await montar()
    document.body.append(wrapper.element)

    boton('Volver a consultar')!.click()
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/pasarela/admin/ordenes/orden-1/reembolsos/aclarar'),
      { method: 'POST' },
    )
    expect(wrapper.emitted('resuelto')).toHaveLength(1)
  })

  it('si la consulta no lo aclara, ofrece marcarlo; "Salió" exige el código y lo manda', async () => {
    apiFetch.mockRejectedValueOnce(conflicto())
    const wrapper = await montar()
    document.body.append(wrapper.element)

    boton('Volver a consultar')!.click()
    await flushPromises()
    expect(wrapper.emitted('resuelto')).toBeUndefined()
    expect(boton('Salió')!.disabled).toBe(true)

    await wrapper.find('input').setValue(' 1213 ')
    apiFetch.mockResolvedValueOnce({ reembolsoAprobado: true })
    boton('Salió')!.click()
    await flushPromises()

    const [url, opts] = apiFetch.mock.calls.at(-1) as [string, Opts]
    expect(url).toContain('/pasarela/admin/ordenes/orden-1/reembolsos/tx-1/resolucion')
    expect(opts.body).toEqual({ salio: true, codigoAutorizacion: '1213' })
    expect(wrapper.emitted('resuelto')).toHaveLength(1)
  })

  it('"No salió" no pide código', async () => {
    apiFetch.mockRejectedValueOnce(conflicto())
    const wrapper = await montar()
    document.body.append(wrapper.element)
    boton('Volver a consultar')!.click()
    await flushPromises()

    apiFetch.mockResolvedValueOnce({ reembolsoAprobado: false })
    boton('No salió')!.click()
    await flushPromises()

    expect((apiFetch.mock.calls.at(-1) as [string, Opts])[1].body).toEqual({ salio: false })
    expect(wrapper.emitted('resuelto')).toHaveLength(1)
  })
})
