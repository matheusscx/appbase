// @vitest-environment nuxt
//
// Trampa del brief de la papelera de `configuracion/impresoras.vue`:
// `useImpresoras().listar()` gana un segundo parámetro `incluirEliminados`
// para alimentar esa pantalla. Esa MISMA función la llaman los caminos de
// impresión real — `imprimirComanda()` → `listar('comanda')` y el helper
// interno `obtenerImpresoraBoleta()` → `listar('boleta')` —, los dos SIN
// pasar el segundo argumento. Si el default de `incluirEliminados` pasara a
// `true`, esas dos llamadas empezarían a traer impresoras borradas y el
// sistema intentaría imprimir en una que ya no existe. Este spec fija que el
// default sigue siendo `false` y que el camino real de `imprimirComanda()`
// (no solo `listar()` aislada) no lo pisa.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useImpresoras } from './useImpresoras'

let calls: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    calls.push(url)
    return Promise.resolve([])
  }
})

describe('useImpresoras — listar() no trae borradas por default (caminos de impresión)', () => {
  beforeEach(() => {
    calls = []
  })

  it('listar() sin argumentos no pide eliminadas', async () => {
    await useImpresoras().listar()

    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('incluirEliminados')
  })

  it('listar(\'comanda\') —lo que llama imprimirComanda()— no pide eliminadas', async () => {
    await useImpresoras().listar('comanda')

    expect(calls[0]).toContain('rol=comanda')
    expect(calls[0]).not.toContain('incluirEliminados')
  })

  it('listar(\'boleta\') —lo que llama el helper interno obtenerImpresoraBoleta()— no pide eliminadas', async () => {
    await useImpresoras().listar('boleta')

    expect(calls[0]).toContain('rol=boleta')
    expect(calls[0]).not.toContain('incluirEliminados')
  })

  it('listar(rol, true) sí las pide —lo que usa la papelera de configuracion/impresoras.vue—', async () => {
    await useImpresoras().listar(undefined, true)

    expect(calls[0]).toContain('incluirEliminados=true')
  })

  it('imprimirComanda() en el camino real —no solo listar() aislada— tampoco ve impresoras borradas', async () => {
    // Sin impresoras de comanda activas (el mock devuelve []), corta ANTES de
    // reclamar la comanda o tocar QZ Tray: la única llamada de red es el listar.
    const resultado = await useImpresoras().imprimirComanda('cuenta-1', {
      mesaNombre: 'Mesa 1',
      cuentaNumero: 1,
      garzonNombre: null,
    })

    expect(resultado).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('rol=comanda')
    expect(calls[0]).not.toContain('incluirEliminados')
  })
})
