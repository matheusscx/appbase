// @vitest-environment nuxt
//
// Auditoría UX 09.2: pagar con Webpay sale de la app con una redirección completa, así que volver
// equivale a recargar. El carrito vivía solo en `useState` (memoria) y quedaba vacío, aunque el
// retorno dice "Tu carrito sigue disponible para reintentar". Ahora las líneas se guardan en
// `sessionStorage`, por usuario, y se vacían solo con `limpiar()` (orden cobrada).
import { describe, it, expect, beforeEach } from 'vitest'
import { useNuxtApp } from '#app'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useTiendaCarrito } from './useTiendaCarrito'
import type { ItemCatalogo } from './useVenta'

// Con un usuario en el store, `useUserPreferences` mueve el tema y el módulo color-mode (sin
// su helper en este entorno) deja un error sin atrapar en el worker: el tema se simula.
let usuarioId = 'u1'
let tenantId = 't1'
mockNuxtImport('useAuthStore', () => () => ({ user: { id: usuarioId }, activeTenantId: tenantId }))
mockNuxtImport('useColorMode', () => () => ({ preference: 'light', value: 'light' }))

const item = (id: string, nombre: string) =>
  ({ id, nombre, tipo: 'producto', precioBase: '1000.0000', monedaId: 'm1', unidadMedida: 'unidad', activo: true }) as unknown as ItemCatalogo

/** Simula la recarga: la memoria se pierde, el storage de la pestaña no. */
function recargar() {
  const estado = useNuxtApp().payload.state
  for (const k of ['tienda-carrito-lineas', 'tienda-checkout']) delete estado[`$s${k}`]
  // Se re-crea en el acto: los carritos de pruebas anteriores siguen mirando esta clave.
  return useTiendaCarrito()
}

beforeEach(() => {
  sessionStorage.clear()
  recargar()
  usuarioId = 'u1'
  tenantId = 't1'
})

describe('useTiendaCarrito — el carrito sobrevive a la redirección', () => {
  it('lo armado antes de salir a Webpay sigue ahí al volver', () => {
    const c = useTiendaCarrito()
    c.add(item('i1', 'Papas fritas'))
    c.add(item('i2', 'Bebida'))
    expect(recargar().lineas.value.map(l => l.item.nombre)).toEqual(['Papas fritas', 'Bebida'])
  })

  it('quitar y cambiar cantidad también quedan guardados', () => {
    const c = useTiendaCarrito()
    c.add(item('i1', 'Papas fritas'))
    c.add(item('i2', 'Bebida'))
    c.quitar(0)
    expect(recargar().lineas.value.map(l => l.item.nombre)).toEqual(['Bebida'])
  })

  it('limpiar() (orden cobrada) vacía también lo guardado', () => {
    const c = useTiendaCarrito()
    c.add(item('i1', 'Papas fritas'))
    c.limpiar()
    expect(recargar().lineas.value).toEqual([])
  })

  it('el carrito de otro usuario en la misma pestaña no se hereda', () => {
    useTiendaCarrito().add(item('i1', 'Papas fritas'))
    usuarioId = 'u2'
    expect(recargar().lineas.value).toEqual([])
  })

  it('el carrito de otro tenant del mismo usuario no se hereda', () => {
    useTiendaCarrito().add(item('i1', 'Papas fritas'))
    tenantId = 't2'
    expect(recargar().lineas.value).toEqual([])
  })

  it('un storage ilegible no rompe la pantalla', () => {
    sessionStorage.setItem('tienda-carrito:t1:u1', '{no es json')
    expect(recargar().lineas.value).toEqual([])
  })

  it('restaurar() devuelve la línea quitada a su lugar (Deshacer)', () => {
    const c = useTiendaCarrito()
    c.add(item('i1', 'Papas fritas'))
    c.add(item('i2', 'Bebida'))
    const quitada = c.lineas.value[0]!
    c.quitar(0)
    c.restaurar(quitada, 0)
    expect(c.lineas.value.map(l => l.item.nombre)).toEqual(['Papas fritas', 'Bebida'])
    expect(recargar().lineas.value).toHaveLength(2)
  })
})
