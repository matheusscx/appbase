import Decimal from 'decimal.js'
import type { MonedaDisplayConfig } from '~/types/moneda'

const NON_ISO_CURRENCIES = new Set(['UF'])

export function isIso4217Currency(codigoIso: string): boolean {
  const code = codigoIso.trim().toUpperCase()
  if (NON_ISO_CURRENCIES.has(code)) return false
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(0)
    return true
  }
  catch {
    return false
  }
}

/** Símbolo pegado al monto (sin espacio intermedio). */
function symbolPrefix(cfg: MonedaDisplayConfig): string {
  return cfg.prefix.trim()
}

export function formatMontoManual(d: Decimal, cfg: MonedaDisplayConfig): string {
  const negative = d.isNegative()
  const abs = d.abs()
  const fixed = abs.toFixed(cfg.decimals)
  const [entero, frac] = fixed.split('.')
  const milesRegex = /\B(?=(\d{3})+(?!\d))/g
  const enteroFmt = entero!.replace(milesRegex, cfg.thousands)
  const numero = cfg.decimals > 0 && frac !== undefined
    ? `${enteroFmt}${cfg.decimal}${frac}`
    : enteroFmt
  const formatted = `${symbolPrefix(cfg)}${numero}`
  return negative ? `-${formatted}` : formatted
}

export function formatMontoDisplay(
  value: string | Decimal | null | undefined,
  cfg: MonedaDisplayConfig,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)
  return formatMontoManual(d, cfg)
}

export function parseMontoInput(raw: string, cfg: MonedaDisplayConfig): Decimal {
  const prefix = cfg.prefix.trim()
  let clean = raw
  if (prefix) clean = clean.replace(prefix, '')
  clean = clean.replaceAll(cfg.thousands, '').replace(cfg.decimal, '.').trim()
  if (!clean || clean === '-') return new Decimal(0)
  try {
    return new Decimal(clean)
  }
  catch {
    return new Decimal(0)
  }
}

/**
 * Escala de un costo en el backend (`ESCALA_COSTO`, `common/decorators/es-costo`).
 * Duplicada acá a propósito: no hay workspace compartido entre backend y
 * frontend todavía. Si cambia allá, cambia acá.
 */
const ESCALA_COSTO = 4

/**
 * Un costo es una **tasa**, no un monto cobrado, así que los decimales de la
 * moneda son su **piso, no su techo**: convertir un costo a otra unidad puede
 * dar una fracción que la moneda no representa —$1.500 por kilo son $1,5 por
 * gramo— y formatearla con `formatMontoDisplay` la redondearía a `$2`, un
 * número que no es el costo. Acá se agregan los decimales que el valor traiga,
 * hasta la escala con que el backend lo guarda.
 *
 * Solo para **lectura**. Un campo editable no puede usar esto: ahí la escala la
 * manda la moneda, porque lo que se teclea se cobra
 * (`docs/patterns/frontend.md` §8).
 */
export function formatCostoDisplay(
  value: string | Decimal | null | undefined,
  cfg: MonedaDisplayConfig,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)
  const decimals = Math.max(cfg.decimals, Math.min(d.decimalPlaces(), ESCALA_COSTO))
  return formatMontoManual(d, { ...cfg, decimals })
}
