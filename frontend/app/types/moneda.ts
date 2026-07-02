/** Config unificada para Intl (listas) y maska (inputs). */
export interface MonedaDisplayConfig {
  monedaId: string
  codigoIso: string
  nombre: string
  locale: string
  prefix: string
  thousands: string
  decimal: string
  decimals: number
  habilitada: boolean
  esOficial: boolean
  esDefault: boolean
  valorDelDia: string | null
}

/** Respuesta de GET /monedas */
export interface MonedaTenantApi {
  monedaId: string
  nombre: string
  codigoIso: string
  simbolo: string | null
  decimales: number
  separadorDecimal: string
  separadorMiles: string
  locale: string
  habilitada: boolean
  esDefault: boolean
  esOficial: boolean
  valorDelDia: string | null
}

export function toDisplayConfig(m: MonedaTenantApi): MonedaDisplayConfig {
  return {
    monedaId: m.monedaId,
    codigoIso: m.codigoIso.trim(),
    nombre: m.nombre,
    locale: m.locale?.trim() || 'es-CL',
    prefix: m.simbolo ? `${m.simbolo}\u00a0` : '',
    thousands: m.separadorMiles,
    decimal: m.separadorDecimal,
    decimals: m.decimales,
    habilitada: m.habilitada,
    esOficial: m.esOficial,
    esDefault: m.esDefault,
    valorDelDia: m.valorDelDia,
  }
}
