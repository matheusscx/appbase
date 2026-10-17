// @vitest-environment nuxt
//
// 01.19: si falla leer la configuración de propina, la propina parte APAGADA y
// el modal lo dice (owner, 2026-10-16). Antes el `catch` devolvía `habilitado:
// true` con 10 %: un local que apagó la propina la veía activa solo porque la
// lectura falló.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPorcentajeSugerido, fetchPorcentajeSugeridoVenta } from './usePropina'

const { useApiFetch } = vi.hoisted(() => ({ useApiFetch: vi.fn() }))
vi.mock('./useApiFetch', () => ({ useApiFetch }))

beforeEach(() => { useApiFetch.mockReset() })

describe.each([
  ['salones', fetchPorcentajeSugerido],
  ['POS', fetchPorcentajeSugeridoVenta],
])('lectura de la propina sugerida (%s)', (_nombre, leer) => {
  it('con la lectura caída: propina apagada y marcada como fallo', async () => {
    useApiFetch.mockRejectedValue(new Error('Failed to fetch'))

    expect(await leer()).toMatchObject({ habilitado: false, falloLectura: true })
  })

  it('apagada a propósito no es un fallo', async () => {
    useApiFetch.mockResolvedValue({ porcentajeSugerido: '0.10', habilitado: false })

    expect(await leer()).toMatchObject({ habilitado: false, falloLectura: false })
  })

  it('encendida trae su porcentaje', async () => {
    useApiFetch.mockResolvedValue({ porcentajeSugerido: '0.15', habilitado: true })

    expect(await leer()).toEqual({ porcentajeSugerido: '0.15', habilitado: true, falloLectura: false })
  })
})
