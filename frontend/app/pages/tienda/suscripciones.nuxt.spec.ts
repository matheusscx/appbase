// @vitest-environment nuxt
//
// Primer spec de `pages/tienda/suscripciones.vue`. Cubre UNA cosa: el
// catálogo de ítems suscribibles del drawer "Nueva suscripción" pide solo lo
// vendible. Hasta 2026-08-09 la pantalla traía todo y descartaba los
// pausados con un `.filter(i => i.activo)` en el cliente — no era
// equivalente, porque el pausado igual ocupaba uno de los 100 lugares
// pedidos. Ahora el filtro va en la query (`activo=true`), y esto es lo
// único que lo sostiene del lado del cliente: borrar el param de la URL no
// rompe ninguna otra cosa, así que sin este test se puede borrar con la
// suite entera en verde.
//
// Diferencia con `salones/index.nuxt.spec.ts` y las otras dos hermanas
// (`ventas/pos.nuxt.spec.ts`, `tienda/index.nuxt.spec.ts`): acá la consulta
// NO sale en `onMounted` sino recién al abrir el drawer (`abrirCrear`), así
// que el test necesita clickear "Nueva suscripción" primero — lo que a su vez
// exige `puedeCrear`, gateado por `usePermissionsStore`. El molde de ESE
// mock es `terceros.nuxt.spec.ts`: Nuxt instala su propia instancia de
// Pinia, así que espiar un store creado con `setActivePinia` no sirve, hay
// que mockear el auto-import.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Suscripciones from './suscripciones.vue'

let esAdmin = true

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: () => false,
  })
})

/**
 * Las URLs COMPLETAS pedidas al catálogo de suscribibles, con query string.
 * Igual que en `salones/index.nuxt.spec.ts`: cortar en el `?` haría
 * invisible el filtro que este spec existe para sostener.
 */
let urlsCatalogo: string[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const ruta = url.split('?')[0] ?? ''

    if (ruta.endsWith('/suscripciones')) {
      return Promise.resolve([])
    }
    if (ruta.endsWith('/online/medios-pago')) {
      return Promise.resolve({ oneclickDisponible: true, medios: [] })
    }
    if (ruta.includes('/items')) {
      urlsCatalogo.push(url)
      return Promise.resolve({ data: [] })
    }
    // El resto (arranque de permisos, etc.) no interviene en este flujo.
    return Promise.resolve([])
  }
})

let montado: { unmount: () => void } | null = null

afterEach(() => {
  montado?.unmount()
  montado = null
})

beforeEach(() => {
  esAdmin = true
  urlsCatalogo = []
})

async function montar() {
  const wrapper = await mountSuspended(Suscripciones)
  montado = wrapper
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('tienda/suscripciones — el catálogo de suscribibles pide solo ítems vendibles', () => {
  it('al abrir "Nueva suscripción" la consulta lleva `activo=true`', async () => {
    const wrapper = await montar()

    // Antes de abrir el drawer no se pidió nada: la consulta es perezosa.
    expect(urlsCatalogo).toHaveLength(0)

    const boton = wrapper.findAll('button')
      .find(b => b.text().trim() === 'Nueva suscripción')
    expect(boton, 'botón "Nueva suscripción"').toBeTruthy()
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(urlsCatalogo).toHaveLength(1)
    expect(urlsCatalogo[0]).toContain('activo=true')
    expect(urlsCatalogo[0]).toContain('tipo=suscripcion')
  })
})
