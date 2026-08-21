import Decimal from 'decimal.js'
import { useApiFetch } from './useApiFetch'

export const PROPINA_PORCENTAJE_DEFAULT = '0.10'

/**
 * Propina sugerida, half-up a la escala de la MONEDA.
 *
 * `decimales` es obligatorio y va antes que `porcentaje` a propósito: estaba
 * hardcodeado en 0 —pesos enteros— y para un tenant con moneda de 2 decimales la
 * sugerencia salía redondeada a la unidad, o sea peor que el campo donde se
 * muestra. Un default acá lo dejaría volver a pasar en silencio; que el llamador
 * lo pase obliga a resolver la moneda, que es lo que hace el `MoneyInput` de al
 * lado con su prop `oficial`.
 */
export function sugerirPropina(
  total: string,
  decimales: number,
  porcentaje = PROPINA_PORCENTAJE_DEFAULT,
): string {
  return new Decimal(total || '0')
    .mul(porcentaje)
    .toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP)
    .toFixed(decimales)
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

export async function fetchPorcentajeSugerido(): Promise<{
  porcentajeSugerido: string
  habilitado: boolean
}> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string, habilitado: boolean }>(
      `${apiUrl}/propinas/porcentaje-sugerido`,
    )
    return {
      porcentajeSugerido: res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT,
      habilitado: res.habilitado ?? true,
    }
  }
  catch {
    return { porcentajeSugerido: PROPINA_PORCENTAJE_DEFAULT, habilitado: true }
  }
}

export async function fetchPorcentajeSugeridoVenta(): Promise<{
  porcentajeSugerido: string
  habilitado: boolean
}> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string, habilitado: boolean }>(
      `${apiUrl}/propinas/porcentaje-sugerido-venta`,
    )
    return {
      porcentajeSugerido: res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT,
      habilitado: res.habilitado ?? true,
    }
  }
  catch {
    return { porcentajeSugerido: PROPINA_PORCENTAJE_DEFAULT, habilitado: true }
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
