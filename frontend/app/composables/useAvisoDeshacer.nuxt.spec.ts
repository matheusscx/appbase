// @vitest-environment nuxt
//
// Auditoría UX 07.12: lo que se guarda al instante (un interruptor de una lista) avisa con un toast
// que trae "Deshacer"; lo que toca el cobro pide confirmación antes (CrudModal), no esto.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useAvisoDeshacer } from './useAvisoDeshacer'

const add = vi.fn()
mockNuxtImport('useToast', () => () => ({ add }))

describe('useAvisoDeshacer', () => {
  beforeEach(() => add.mockReset())

  it('muestra el aviso con una acción "Deshacer"', () => {
    useAvisoDeshacer()('Categoría desactivada', vi.fn())
    const arg = add.mock.calls[0]![0]
    expect(arg.title).toBe('Categoría desactivada')
    expect(arg.actions).toHaveLength(1)
    expect(arg.actions[0].label).toBe('Deshacer')
  })

  it('tocar "Deshacer" ejecuta la reversa una vez', () => {
    const reversa = vi.fn()
    useAvisoDeshacer()('Categoría desactivada', reversa)
    add.mock.calls[0]![0].actions[0].onClick()
    expect(reversa).toHaveBeenCalledTimes(1)
  })

  it('no ejecuta la reversa por sí solo', () => {
    const reversa = vi.fn()
    useAvisoDeshacer()('Categoría desactivada', reversa)
    expect(reversa).not.toHaveBeenCalled()
  })

  it('el aviso dura lo suficiente para tocarlo', () => {
    useAvisoDeshacer()('x', vi.fn())
    expect(add.mock.calls[0]![0].duration).toBeGreaterThanOrEqual(6000)
  })
})
