import { describe, it, expect, vi } from 'vitest'
import { conTimeout } from './con-timeout'

describe('conTimeout', () => {
  it('resuelve si la promesa termina antes del límite', async () => {
    await expect(conTimeout(Promise.resolve('ok'), 50, 'timeout')).resolves.toBe('ok')
  })

  it('rechaza con el mensaje si supera el límite', async () => {
    vi.useFakeTimers()
    const lenta = new Promise<string>((resolve) => {
      setTimeout(() => resolve('tarde'), 10_000)
    })
    const pending = conTimeout(lenta, 5_000, 'La impresora no respondió (timeout 5 s)')
    const assertion = expect(pending).rejects.toThrow('La impresora no respondió (timeout 5 s)')
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    vi.useRealTimers()
  })

  it('propaga el error original si falla antes del timeout', async () => {
    await expect(
      conTimeout(Promise.reject(new Error('ConnectException')), 5_000, 'timeout'),
    ).rejects.toThrow('ConnectException')
  })
})
