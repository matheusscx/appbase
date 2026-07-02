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

export function formatMontoManual(d: Decimal, cfg: MonedaDisplayConfig): string {
  const negative = d.isNegative()
  const abs = d.abs()
  const fixed = abs.toFixed(cfg.decimals)
  const [entero, frac] = fixed.split('.')
  const milesRegex = /\B(?=(\d{3})+(?!\d))/g
  const enteroFmt = entero.replace(milesRegex, cfg.thousands)
  const numero = cfg.decimals > 0 && frac !== undefined
    ? `${enteroFmt}${cfg.decimal}${frac}`
    : enteroFmt
  const formatted = `${cfg.prefix}${numero}`
  return negative ? `-${formatted}` : formatted
}

export function formatMontoDisplay(
  value: string | Decimal | null | undefined,
  cfg: MonedaDisplayConfig,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)

  if (!isIso4217Currency(cfg.codigoIso)) {
    return formatMontoManual(d, cfg)
  }

  const n = d.toNumber()
  return new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency: cfg.codigoIso,
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  }).format(n)
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
