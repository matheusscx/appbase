// @vitest-environment nuxt
//
// `useUbicaciones` usa `useState` —compartido entre las cuatro pantallas que
// lo consumen (mermas, recuentos, ajuste de stock/compra, traslados)—, así
// que necesita un `nuxtApp` real: por eso `.nuxt.spec.ts` y no el `.spec.ts`
// liviano del resto de los composables (que stubea los globals de Nuxt en
// `test.setup.ts`, sin `useState` entre ellos).
//
// Cada test llama `cargar()` con su propio fixture: como `cargar` REEMPLAZA
// el array entero (`ubicaciones.value = await ...`, no un push), el estado
// compartido por `useState` no se filtra de un test a otro pese a que los
// tres corren en el mismo `nuxtApp` del archivo.
import { describe, it, expect } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useUbicaciones, type Ubicacion } from './useUbicaciones'

let respuesta: Ubicacion[] = []
let urls: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    urls.push(url)
    return Promise.resolve(respuesta)
  }
})

const LOCAL: Ubicacion = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA: Ubicacion = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }
const BODEGA_INACTIVA: Ubicacion = { id: 'bodega-2', nombre: 'Bodega vieja', tipo: 'bodega', activo: false }

describe('useUbicaciones — hayBodegas (spec § 6)', () => {
  it('con solo el local, hayBodegas es false y local apunta a esa fila', async () => {
    respuesta = [LOCAL]
    const { hayBodegas, local, cargar } = useUbicaciones()

    await cargar()

    expect(hayBodegas.value).toBe(false)
    expect(local.value).toEqual(LOCAL)
  })

  it('con una bodega, hayBodegas es true', async () => {
    respuesta = [LOCAL, BODEGA]
    const { hayBodegas, cargar } = useUbicaciones()

    await cargar()

    expect(hayBodegas.value).toBe(true)
  })

  it('una bodega DESACTIVADA (no borrada) sigue contando: hayBodegas es true', async () => {
    // `hayBodegas` decide si el selector se DIBUJA, no si tiene opciones
    // seleccionables ahora mismo — una bodega inactiva puede tener stock
    // real, y sigue siendo un lugar sobre el que preguntar.
    respuesta = [LOCAL, BODEGA_INACTIVA]
    const { hayBodegas, cargar } = useUbicaciones()

    await cargar()

    expect(hayBodegas.value).toBe(true)
  })

  it('con la bodega eliminada (el backend ya no la devuelve), hayBodegas vuelve a false', async () => {
    // El endpoint filtra `eliminado_el IS NULL` por default: una ubicación
    // borrada simplemente no llega en la respuesta.
    respuesta = [LOCAL]
    const { hayBodegas, cargar } = useUbicaciones()

    await cargar()

    expect(hayBodegas.value).toBe(false)
  })

  it('cargar() pide GET /ubicaciones sin soloActivas', async () => {
    respuesta = [LOCAL]
    urls = []
    const { cargar } = useUbicaciones()

    await cargar()

    expect(urls).toEqual([expect.stringMatching(/\/api\/ubicaciones$/)])
  })
})
