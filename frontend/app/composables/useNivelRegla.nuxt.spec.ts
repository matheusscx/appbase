// @vitest-environment nuxt
//
// `itemsQueLoTienen` es el pago VISIBLE de todo el cambio del 2026-08-25: el
// backend dejó de filtrar los borrados en `GET /:id/uso` —excepción deliberada
// al invariante de soft delete— para que el admin pueda ver CUÁL es el ítem que
// el 400 del cambio de nivel le está contando. Esta cadena es lo único que
// convierte esa excepción en algo que el usuario nota; sin test, nada la fija.
//
// Vive acá y no en las pantallas porque las dos son gemelas y la función estuvo
// duplicada en las dos: moverla al composable es la regla de `CLAUDE.md` sobre
// utilidades de presentación, y es lo que la hace testeable en aislamiento.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useNivelRegla } from './useNivelRegla'

let respuesta: unknown = { items: [] }
let falla = false
/** Deja la promesa colgada para siempre: el GET que nunca responde. */
let cuelga = false
let urls: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    urls.push(url)
    if (falla) return Promise.reject(new Error('boom'))
    if (cuelga) return new Promise(() => {})
    return Promise.resolve(respuesta)
  }
})

describe('useNivelRegla — itemsQueLoTienen', () => {
  beforeEach(() => {
    urls = []
    falla = false
    cuelga = false
    respuesta = { items: [] }
  })

  it('nombra los ítems vivos', async () => {
    respuesta = { items: [{ nombre: 'Café' }, { nombre: 'Torta' }] }

    const msg = await useNivelRegla().itemsQueLoTienen('descuentos', 'd1')

    expect(msg).toBe('Lo tienen: Café, Torta')
  })

  // El caso que motivó todo el cambio de backend: el ítem que el admin NO puede
  // ver por ningún otro lado. Sin el sufijo, el mensaje nombra un ítem que en el
  // catálogo no aparece y el admin lo busca donde no está.
  it('marca los que están en la papelera', async () => {
    respuesta = {
      items: [{ nombre: 'Café', eliminado: false }, { nombre: 'Torta vieja', eliminado: true }],
    }

    const msg = await useNivelRegla().itemsQueLoTienen('recargos', 'r1')

    expect(msg).toBe('Lo tienen: Café, Torta vieja (en la papelera)')
  })

  it('pega al recurso y al id que se le pasan', async () => {
    respuesta = { items: [{ nombre: 'Café' }] }

    await useNivelRegla().itemsQueLoTienen('recargos', 'r-42')

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/recargos/r-42/uso')
  })

  it('sin ítems no dice nada, en vez de un mensaje vacío', async () => {
    respuesta = { items: [] }

    expect(await useNivelRegla().itemsQueLoTienen('descuentos', 'd1')).toBeUndefined()
  })

  // Corre DENTRO del `catch` del guardado: si tirara, taparía el error que el
  // usuario vino a leer con uno que no explica nada.
  it('si el GET falla no tira: el error del guardado sigue siendo el que se ve', async () => {
    falla = true

    await expect(
      useNivelRegla().itemsQueLoTienen('descuentos', 'd1'),
    ).resolves.toBeUndefined()
  })

  /**
   * Sin tope, una regla asociada a 60 ítems produce un toast de 60 nombres. El
   * conteo del resto no es adorno: sin él, *"los que ves son todos"* es una
   * lectura razonable y falsa, y el admin cierra creyendo que desasoció todo.
   */
  it('con muchos ítems corta y dice cuántos quedan', async () => {
    respuesta = {
      items: Array.from({ length: 8 }, (_, i) => ({ nombre: `Item ${i + 1}` })),
    }

    const msg = await useNivelRegla().itemsQueLoTienen('descuentos', 'd1')

    expect(msg).toBe('Lo tienen: Item 1, Item 2, Item 3, Item 4, Item 5 y 3 más')
  })

  it('justo en el tope no resume', async () => {
    respuesta = {
      items: Array.from({ length: 5 }, (_, i) => ({ nombre: `Item ${i + 1}` })),
    }

    const msg = await useNivelRegla().itemsQueLoTienen('descuentos', 'd1')

    expect(msg).toBe('Lo tienen: Item 1, Item 2, Item 3, Item 4, Item 5')
  })

  /**
   * ⚠️ **El caso que el tope tapaba, y es el que la feature existe para mostrar.**
   * El backend devuelve los borrados AL FINAL, así que recortando la lista entera
   * una regla con 5 vivos + 1 en la papelera decía *"y 1 más"* y el invisible
   * seguía invisible. El tope recorta vivos; los borrados van siempre.
   */
  it('el tope recorta vivos, nunca los de la papelera', async () => {
    respuesta = {
      items: [
        ...Array.from({ length: 7 }, (_, i) => ({ nombre: `Vivo ${i + 1}`, eliminado: false })),
        { nombre: 'Torta vieja', eliminado: true },
      ],
    }

    const msg = await useNivelRegla().itemsQueLoTienen('descuentos', 'd1')

    expect(msg).toContain('Torta vieja (en la papelera)')
    expect(msg).toContain('y 2 más')
  })

  /**
   * El otro modo de fallar, que el `catch` NO cubre: un GET que no responde
   * nunca. Sin el tope, el toast del guardado —que espera esta promesa— no se
   * mostraba jamás y `saving` quedaba en `true`, o sea el botón trabado y ningún
   * error a la vista. Lo peor de los dos mundos: el usuario no sabe que falló.
   */
  it('si el GET cuelga, corta por tiempo en vez de dejar al usuario sin error', async () => {
    cuelga = true

    const msg = await useNivelRegla().itemsQueLoTienen('descuentos', 'd1', 10)

    expect(msg).toBeUndefined()
  })
})
