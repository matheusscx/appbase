import Decimal from 'decimal.js'

/** 10% default; half-up a 0 decimales (pesos enteros). */
export function sugerirPropina(
  total: string,
  porcentaje = '0.10',
): string {
  return new Decimal(total || '0')
    .mul(porcentaje)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toFixed(0)
}

export function usePropina() {
  return { sugerirPropina }
}
