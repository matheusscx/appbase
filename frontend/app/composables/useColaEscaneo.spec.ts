import { describe, it, expect, vi } from 'vitest'
import { useColaEscaneo } from './useColaEscaneo'

describe('useColaEscaneo', () => {
  it('diez códigos encolados de golpe se envían en orden, uno a la vez', async () => {
    const enviados: string[] = []
    let enVuelo = 0
    let maxEnVuelo = 0
    const cola = useColaEscaneo<{ codigo: string }>(async ({ codigo }) => {
      enVuelo++
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
      await new Promise(r => setTimeout(r, 5))
      enviados.push(codigo)
      enVuelo--
    })
    const codigos = Array.from({ length: 10 }, (_, i) => `C${i}`)
    codigos.forEach(codigo => cola.encolar({ codigo }))
    await vi.waitFor(() => expect(enviados).toHaveLength(10))
    expect(enviados).toEqual(codigos)
    expect(maxEnVuelo).toBe(1)
    expect(cola.pendientes.value).toBe(0)
    expect(cola.procesando.value).toBe(false)
  })

  it('un envío que falla no frena a los siguientes y no se reintenta', async () => {
    const intentos: string[] = []
    const enviados: string[] = []
    const cola = useColaEscaneo<{ codigo: string }>(async ({ codigo }) => {
      intentos.push(codigo)
      if (codigo === 'B') throw new Error('409')
      enviados.push(codigo)
    })
    ;['A', 'B', 'C'].forEach(codigo => cola.encolar({ codigo }))
    await vi.waitFor(() => expect(enviados).toEqual(['A', 'C']))
    expect(intentos).toEqual(['A', 'B', 'C'])
  })

  it('un código vacío o de solo espacios no se encola', () => {
    const enviar = vi.fn(async () => {})
    const cola = useColaEscaneo<{ codigo: string }>(enviar)
    cola.encolar({ codigo: '   ' })
    cola.encolar({ codigo: '' })
    expect(cola.pendientes.value).toBe(0)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('cada escaneo viaja con el contexto que tenía al encolarse', async () => {
    const vistos: { codigo: string, cobro: boolean }[] = []
    let liberar!: () => void
    const primero = new Promise<void>((r) => { liberar = r })
    const cola = useColaEscaneo<{ codigo: string, cobro: boolean }>(async (e) => {
      if (e.codigo === 'A') await primero
      vistos.push(e)
    })
    cola.encolar({ codigo: 'A', cobro: false })
    cola.encolar({ codigo: 'B', cobro: true })
    expect(cola.pendientes.value).toBe(1)
    liberar()
    await vi.waitFor(() => expect(vistos).toHaveLength(2))
    expect(vistos).toEqual([{ codigo: 'A', cobro: false }, { codigo: 'B', cobro: true }])
  })
})
