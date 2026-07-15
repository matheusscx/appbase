import Decimal from 'decimal.js'

/**
 * Cantidad legible: enteros para unidades de conteo, decimales significativos
 * para magnitudes continuas. La decisión de qué es fraccionario la toma el
 * catálogo (`useUnidadesMedidaStore.esFraccionaria`), no este módulo.
 */
export function formatStockCantidad(
  value: string | Decimal | null | undefined,
  fraccionaria: boolean,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)

  if (!fraccionaria) {
    return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)
  }

  const fixed = d.toFixed(4)
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
  return trimmed.replace('.', ',')
}

/** Etiqueta completa para UI: "98" o "2,5 kg". */
export function formatStock(
  value: string | Decimal | null | undefined,
  unidadMedida: string | null | undefined,
  fraccionaria: boolean,
): string {
  const cantidad = formatStockCantidad(value, fraccionaria)
  if (cantidad === '—') return cantidad
  if (fraccionaria && unidadMedida) return `${cantidad} ${unidadMedida}`
  return cantidad
}
