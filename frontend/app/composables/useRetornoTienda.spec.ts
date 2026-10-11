import { describe, it, expect } from 'vitest'
import { useRetornoTienda } from './useRetornoTienda'

const { resolverRetorno } = useRetornoTienda()

describe('useRetornoTienda', () => {
  // La tabla entera: cada estado que puede devolver `GET /online/orden` con su
  // vista y lo que pasa con el carrito. Un estado nuevo en el backend que no se
  // sume acá cae al caso de abajo, nunca a "rechazado".
  it.each([
    ['pagada', 'aprobada', true],
    ['conciliada', 'aprobada', true],
    ['pagada_sin_venta', 'sin_venta', true],
    ['reembolsada', 'devuelto', true],
    ['pendiente', 'pendiente', false],
    ['en_proceso', 'pendiente', false],
    ['procesando', 'pendiente', false],
    ['creada', 'pendiente', false],
    ['fallida', 'rechazada', false],
    ['expirada', 'rechazada', false],
  ] as const)('%s → vista %s, vacía el carrito: %s', (estado, vista, limpiaCarrito) => {
    expect(resolverRetorno(estado)).toEqual({ vista, limpiaCarrito })
  })

  // La regresión que motivó el composable (pendientes.md § 2): la orden que el
  // retorno todavía no resolvió caía en "Pago rechazado… Tu carrito sigue
  // disponible para reintentar", y el cargo pudo haber salido.
  it('una orden sin resolver no se muestra como rechazada', () => {
    expect(resolverRetorno('procesando').vista).not.toBe('rechazada')
    expect(resolverRetorno('en_proceso').vista).not.toBe('rechazada')
  })

  it('un estado desconocido no dice "rechazado" ni vacía el carrito: dice que no se pudo verificar', () => {
    expect(resolverRetorno('estado_nuevo_del_backend')).toEqual({ vista: 'error', limpiaCarrito: false })
  })
})
