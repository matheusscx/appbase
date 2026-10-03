/** Una unidad con serie tal como la guardan el carrito y la línea de la cuenta. */
export interface UnidadElegida {
  id: string
  serie: string
  condicion: string
}

/** Lo que devuelve `GET /items/:id/unidades` (`ItemsService.findUnidades`). */
export interface UnidadSerie extends UnidadElegida {
  estado: string
  garantiaHasta: string | null
  loteId: string | null
  codigoLote: string | null
  ventaId: string | null
  creadoEl: string
  ubicacionId: string | null
}

type ColorCondicion = 'success' | 'warning' | 'info' | 'neutral'

const CONDICIONES: Record<string, { etiqueta: string, color: ColorCondicion }> = {
  nuevo: { etiqueta: 'Nuevo', color: 'success' },
  usado: { etiqueta: 'Usado', color: 'warning' },
  reacondicionado: { etiqueta: 'Reacondicionado', color: 'info' },
}

/** Usado y reacondicionado se distinguen de nuevo a simple vista: es la diferencia que el cajero elige. */
export function etiquetaCondicion(condicion: string): string {
  return CONDICIONES[condicion]?.etiqueta ?? condicion
}

export function colorCondicion(condicion: string): ColorCondicion {
  return CONDICIONES[condicion]?.color ?? 'neutral'
}

export function useUnidadesSerie() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  /**
   * Las unidades que se pueden vender YA en el local: disponibles y que ninguna
   * cuenta abierta tenga apartadas. Las que la cuenta propia tiene en una línea
   * no vienen acá —están apartadas por esa misma cuenta—: las pasa quien abre el
   * selector (`seleccionadas`).
   */
  function cargarVendibles(itemId: string): Promise<UnidadSerie[]> {
    return useApiFetch<UnidadSerie[]>(`${apiUrl}/items/${itemId}/unidades?vendibles=true`)
  }

  return { cargarVendibles, etiquetaCondicion, colorCondicion }
}
