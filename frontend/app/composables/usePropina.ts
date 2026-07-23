import Decimal from 'decimal.js'
import { useApiFetch } from './useApiFetch'

export const PROPINA_PORCENTAJE_DEFAULT = '0.10'

/** half-up a 0 decimales (pesos enteros). */
export function sugerirPropina(
  total: string,
  porcentaje = PROPINA_PORCENTAJE_DEFAULT,
): string {
  return new Decimal(total || '0')
    .mul(porcentaje)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toFixed(0)
}

/** UI humano (10) → API decimal (0.100000). */
export function porcentajeHumanoADecimal(humano: string): string {
  return new Decimal(humano || '0').div(100).toFixed(6)
}

/** API decimal (0.10) → UI humano (10). */
export function porcentajeDecimalAHumano(decimal: string): string {
  const n = new Decimal(decimal || '0').times(100)
  return n.equals(n.toDecimalPlaces(0)) ? n.toFixed(0) : n.toString()
}

export async function fetchPorcentajeSugerido(): Promise<string> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string }>(
      `${apiUrl}/propinas/porcentaje-sugerido`,
    )
    return res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT
  }
  catch {
    return PROPINA_PORCENTAJE_DEFAULT
  }
}

export async function fetchPorcentajeSugeridoVenta(): Promise<string> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string }>(
      `${apiUrl}/propinas/porcentaje-sugerido-venta`,
    )
    return res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT
  }
  catch {
    return PROPINA_PORCENTAJE_DEFAULT
  }
}

export function usePropina() {
  return {
    sugerirPropina,
    fetchPorcentajeSugerido,
    fetchPorcentajeSugeridoVenta,
    porcentajeHumanoADecimal,
    porcentajeDecimalAHumano,
  }
}
