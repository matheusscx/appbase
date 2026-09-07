// @vitest-environment nuxt
//
// Tarea 15 ("bodegas y traslados"): el 400 de "no hay stock" trae el mensaje
// completo Y los datos sueltos (`itemId`, `itemNombre`, `faltante`,
// `ubicaciones`), y esta función decide si el toast lleva el botón
// "Trasladar" — SOLO si quien mira tiene `Inventario/Crear` (se lo pasa
// quien llama, `usePermisosCrud('Inventario').puedeCrear`) Y el backend
// mandó a dónde ir (`itemId` + al menos una bodega con stock).
//
// El garzón, sin el permiso: mismo mensaje, sin botón — nunca un 403 en
// medio del servicio.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useRechazoPorStock } from './useRechazoPorStock'

interface ToastAction { label: string, onClick?: (e?: Event) => void }
interface Toast { title: string, color?: string, actions?: ToastAction[] }
let toasts: Toast[] = []

mockNuxtImport('useToast', () => {
  return () => ({ add: (t: Toast) => { toasts.push(t) } })
})

interface Navegacion { path: string, query: Record<string, string> }
let navegaciones: Navegacion[] = []

mockNuxtImport('navigateTo', () => {
  return (to: Navegacion) => { navegaciones.push(to); return Promise.resolve() }
})

/** El 400 tal como lo arma `ItemsService.errorStockInsuficiente` (backend). */
function errorStockInsuficiente(over: Partial<{
  message: string
  itemId: string
  itemNombre: string
  faltante: string
  ubicaciones: { ubicacionId: string, nombre: string, stock: string }[]
}> = {}) {
  return {
    data: {
      message: 'Stock insuficiente de "Carne" en el local: quedan 0 kg y lo que se está agregando necesita 5 kg — hay 10.0000 kg en Bodega Subsuelo',
      itemId: 'item-carne',
      itemNombre: 'Carne',
      faltante: '5',
      ubicaciones: [{ ubicacionId: 'bodega-1', nombre: 'Bodega Subsuelo', stock: '10.0000' }],
      ...over,
    },
  }
}

describe('useRechazoPorStock', () => {
  beforeEach(() => {
    toasts = []
    navegaciones = []
  })

  it('con el permiso: el toast lleva el botón "Trasladar", precargado con el item, el origen y lo que falta', async () => {
    const { mostrarRechazoPorStock } = useRechazoPorStock()

    mostrarRechazoPorStock({
      error: errorStockInsuficiente(),
      fallback: 'Error al agregar el producto',
      puedeTrasladar: true,
    })

    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.title).toContain('Bodega Subsuelo')
    expect(toasts[0]!.actions).toHaveLength(1)

    await toasts[0]!.actions![0]!.onClick?.()
    expect(navegaciones).toHaveLength(1)
    expect(navegaciones[0]).toEqual({
      path: '/inventario/traslados',
      query: { itemId: 'item-carne', origenId: 'bodega-1', cantidad: '5' },
    })
  })

  it('sin el permiso (el garzón): el mismo mensaje, sin botón', () => {
    const { mostrarRechazoPorStock } = useRechazoPorStock()

    mostrarRechazoPorStock({
      error: errorStockInsuficiente(),
      fallback: 'Error al agregar el producto',
      puedeTrasladar: false,
    })

    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.title).toContain('Bodega Subsuelo')
    expect(toasts[0]!.actions).toBeUndefined()
  })

  it('sin stock en ninguna bodega, no inventa un origen: sin botón aunque el permiso esté', () => {
    const { mostrarRechazoPorStock } = useRechazoPorStock()

    mostrarRechazoPorStock({
      error: errorStockInsuficiente({
        message: 'Stock insuficiente de "Carne" en el local: quedan 0 kg y lo que se está agregando necesita 5 kg',
        ubicaciones: [],
      }),
      fallback: 'Error al agregar el producto',
      puedeTrasladar: true,
    })

    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.actions).toBeUndefined()
  })

  it('un 400 sin la forma enriquecida (otro error cualquiera) cae al mensaje de siempre, nunca al botón', () => {
    const { mostrarRechazoPorStock } = useRechazoPorStock()

    mostrarRechazoPorStock({
      error: { data: { message: 'El item no tiene control de stock' } },
      fallback: 'Error al agregar el producto',
      puedeTrasladar: true,
    })

    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.title).toBe('El item no tiene control de stock')
    expect(toasts[0]!.actions).toBeUndefined()
  })

  it('un error sin body de servidor (red caída) usa el fallback, no revienta', () => {
    const { mostrarRechazoPorStock } = useRechazoPorStock()

    mostrarRechazoPorStock({
      error: new Error('network error'),
      fallback: 'Error al agregar el producto',
      puedeTrasladar: true,
    })

    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.actions).toBeUndefined()
  })
})
