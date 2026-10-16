// @vitest-environment nuxt
//
// Auditoría UX 03.26: "Marcar visto" actuaba al primer toque y no hay cómo deshacerlo (el backend
// rechaza con 400 un cierre ya revisado). Entonces pregunta antes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaMarcarVisto from './CajaMarcarVisto.vue'

const marcarRevisado = vi.fn<(id: string) => Promise<void>>()
mockNuxtImport('useCajaStore', () => () => ({ marcarRevisado }))
const toastAdd = vi.hoisted(() => vi.fn())
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))

async function abrir() {
  const w = await mountSuspended(CajaMarcarVisto, { props: { cajaId: 'caja-9', cajero: 'Ana Pérez' } })
  await w.find('[data-qa="marcar-visto-caja-9"]').trigger('click')
  await new Promise(r => setTimeout(r, 50))
  return w
}
const confirmar = () => document.body.querySelector('[data-qa="marcar-visto-confirmar"]') as HTMLButtonElement

beforeEach(() => {
  document.body.innerHTML = ''
  marcarRevisado.mockReset().mockResolvedValue(undefined)
  toastAdd.mockReset()
})

describe('CajaMarcarVisto', () => {
  it('el primer toque pregunta y dice que no se deshace; no llama al backend', async () => {
    await abrir()
    expect(marcarRevisado).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('¿Marcar visto el cierre de Ana Pérez?')
    expect(document.body.textContent).toContain('No se puede deshacer')
  })

  it('al confirmar marca, avisa y emite "marcado"', async () => {
    const w = await abrir()
    confirmar().click()
    await new Promise(r => setTimeout(r, 20))
    expect(marcarRevisado).toHaveBeenCalledExactlyOnceWith('caja-9')
    expect(w.emitted('marcado')).toHaveLength(1)
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
  })

  it('cancelar no marca nada', async () => {
    const w = await abrir()
    const cancelar = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Cancelar')!
    cancelar.click()
    await new Promise(r => setTimeout(r, 20))
    expect(marcarRevisado).not.toHaveBeenCalled()
    expect(w.emitted('marcado')).toBeUndefined()
  })

  it('si el backend rechaza, avisa y no emite "marcado"', async () => {
    marcarRevisado.mockRejectedValueOnce(new Error('400'))
    const w = await abrir()
    confirmar().click()
    await new Promise(r => setTimeout(r, 20))
    expect(w.emitted('marcado')).toBeUndefined()
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })
})
