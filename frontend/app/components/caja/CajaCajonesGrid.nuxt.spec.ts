// @vitest-environment nuxt
//
// Auditoría UX 03.11: las tarjetas de cajón eran un `div` con `@click`, sin rol
// ni `tabindex`. El encargado no podía entrar a una caja con teclado.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CajaCajonesGrid from './CajaCajonesGrid.vue'

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)
mockNuxtImport('useCajaStore', () => () => ({
  cajonesEstado: [
    { cajonId: 'c1', nombre: 'Caja 1', sesion: { cajaId: 'caja-9', usuarioNombre: 'Ana', esPropia: false, saldoInicial: '0', abiertaEl: '2026-10-16T10:00:00Z' } },
    { cajonId: 'c2', nombre: 'Caja 2', sesion: null },
  ],
  cargarCajonesEstado: vi.fn().mockResolvedValue(undefined),
}))

describe('CajaCajonesGrid — se opera con teclado', () => {
  it('cada cajón es un botón con Tab y Enter entra a la caja', async () => {
    const w = await mountSuspended(CajaCajonesGrid)
    await new Promise(r => setTimeout(r, 0))
    const tarjetas = w.findAll('[role="button"]')
    expect(tarjetas).toHaveLength(2)
    for (const t of tarjetas) expect(t.attributes('tabindex')).toBe('0')

    await tarjetas[0]!.trigger('keydown', { key: 'Enter' })
    expect(navegar).toHaveBeenCalledWith('/cajas/caja-9')
    await tarjetas[1]!.trigger('keydown', { key: ' ' })
    expect(navegar).toHaveBeenCalledWith('/cajas/historial?cajonId=c2')
  })
})
