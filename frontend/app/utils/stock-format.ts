import Decimal from 'decimal.js'

export type UnidadMedida = 'unidad' | 'kg' | 'l' | 'm'

const UNIDADES_FRACCIONARIAS = new Set<UnidadMedida>(['kg', 'l', 'm'])

export function isUnidadFraccionaria(
  unidadMedida: string | null | undefined,
): unidadMedida is UnidadMedida {
  return !!unidadMedida && UNIDADES_FRACCIONARIAS.has(unidadMedida as UnidadMedida)
}

/** Cantidad legible según unidad: enteros para `unidad`, decimales significativos para kg/l/m. */
export function formatStockCantidad(
  value: string | Decimal | null | undefined,
  unidadMedida?: string | null,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)

  if (!isUnidadFraccionaria(unidadMedida)) {
    return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)
  }

  const fixed = d.toFixed(4)
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
  return trimmed.replace('.', ',')
}

/** Etiqueta completa para UI: "98" o "2,5 kg". */
export function formatStock(
  value: string | Decimal | null | undefined,
  unidadMedida?: string | null,
): string {
  const cantidad = formatStockCantidad(value, unidadMedida)
  if (cantidad === '—') return cantidad
  if (isUnidadFraccionaria(unidadMedida)) return `${cantidad} ${unidadMedida}`
  return cantidad
}
