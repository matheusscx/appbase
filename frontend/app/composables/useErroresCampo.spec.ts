import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useErroresCampo } from './useErroresCampo'

describe('useErroresCampo', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('marca los campos y los limpia de a uno', () => {
    const { errores, marcar, limpiar } = useErroresCampo()
    marcar({ nombre: 'Falta el nombre', host: 'Falta el host' })
    expect(errores.value.nombre).toBe('Falta el nombre')
    limpiar('nombre')
    expect(errores.value.nombre).toBeUndefined()
    expect(errores.value.host).toBe('Falta el host')
    limpiar()
    expect(errores.value).toEqual({})
  })

  it('devuelve si hubo algo que marcar', () => {
    const { marcar } = useErroresCampo()
    expect(marcar({})).toBe(false)
    expect(marcar({ a: 'x' })).toBe(true)
  })

  it('lleva el foco al control del primer campo con error', async () => {
    document.body.innerHTML = `
      <div data-slot="root"><input id="a"></div>
      <div data-slot="root"><input id="b"><div data-slot="error">Falta</div></div>`
    const { marcar } = useErroresCampo()
    marcar({ b: 'Falta' })
    await nextTick()
    expect(document.activeElement?.id).toBe('b')
  })
})
