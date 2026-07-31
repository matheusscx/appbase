/** Los cuatro estados de `ventas.estado` — espejo del enum `EstadoVenta` del backend
 *  (`backend/src/modules/ventas/entities/venta.entity.ts`). */
export type EstadoVenta = 'pendiente' | 'pagada_parcial' | 'pagada' | 'cancelada'

export type EstadoVentaColor = 'warning' | 'info' | 'success' | 'error' | 'neutral'

const COLOR: Record<EstadoVenta, EstadoVentaColor> = {
  pendiente: 'warning',
  pagada_parcial: 'info',
  pagada: 'success',
  cancelada: 'error',
}

const ETIQUETA: Record<EstadoVenta, string> = {
  pendiente: 'Pendiente',
  pagada_parcial: 'Parcial',
  pagada: 'Pagada',
  cancelada: 'Cancelada',
}

/**
 * Color, etiqueta y opciones de filtro del estado de una **venta**.
 *
 * Existe porque los dos mapas estaban copiados palabra por palabra en cuatro
 * archivos —la lista y el drawer de ventas, y los de pagos, que muestran el estado
 * de la venta asociada (`ventaEstado`), no un estado propio del pago—. Copiado no
 * era el problema; el problema es que dos de esos archivos además arman con él las
 * opciones del `USelect` que filtra, y esa lista viaja al backend, donde
 * `@IsEnum(EstadoVenta)` la valida. Cuando las dos cosas viven en archivos
 * distintos, ofrecer un estado que el backend no conoce no falla al escribirlo:
 * falla en producción con un 400 al elegirlo en el filtro. Ya pasó con `borrador`.
 *
 * Por eso `estadoOptions` se **deriva** del mapa de etiquetas en vez de repetir la
 * lista: agregar o sacar un estado no puede dejar el filtro ofreciendo algo que el
 * backend rechaza. Y los mapas son `Record<EstadoVenta, …>` completos, así que
 * sumar un estado a la unión no compila hasta definirle color y etiqueta.
 *
 * Los estados de órdenes, propinas y suscripciones tienen funciones con el mismo
 * nombre en sus propias pantallas: son enums distintos, no copias de este.
 */
export function useEstadoVenta() {
  // El estado llega tipado como `string` desde la API: si el backend suma uno que
  // este front todavía no conoce, se muestra crudo en gris en lugar de romper.
  function estadoColor(estado: string): EstadoVentaColor {
    return (COLOR as Record<string, EstadoVentaColor | undefined>)[estado] ?? 'neutral'
  }

  function estadoLabel(estado: string): string {
    return (ETIQUETA as Record<string, string | undefined>)[estado] ?? estado
  }

  const estadoOptions: { label: string, value: string }[] = Object.entries(ETIQUETA)
    .map(([value, label]) => ({ label, value }))

  return { estadoColor, estadoLabel, estadoOptions }
}
