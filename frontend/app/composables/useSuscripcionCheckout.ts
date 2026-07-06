import type { CheckoutResponse } from './useTiendaCarrito'

export interface SuscripcionCheckout {
  checkout: CheckoutResponse
  itemId: string
  itemNombre: string
  frecuencia: 'semanal' | 'quincenal' | 'mensual'
  diaMes: number | null
  diaSemana: number | null
  tarjeta: { marca: string, last4: string } | null
}

/**
 * Intención de alta de suscripción — mismo patrón `useState` que
 * `useTiendaCarrito`: sobrevive la navegación de /tienda/suscripciones a
 * /tienda/pasarela (páginas distintas, no la misma instancia de componente).
 * La consume la pasarela (tarea 9) para completar el alta tras "aprobar".
 */
export function useSuscripcionCheckout() {
  return useState<SuscripcionCheckout | null>('tienda-suscripcion-checkout', () => null)
}
