import Decimal from 'decimal.js'
import { formatMontoDisplay, parseMontoInput } from '~/utils/currency-format'
import type { MonedaDisplayConfig } from '~/types/moneda'

export function useCurrency() {
  const store = useMonedasStore()

  function getConfig(monedaId: string): MonedaDisplayConfig | undefined {
    return store.getById(monedaId)
  }

  function format(
    value: string | Decimal | null | undefined,
    monedaId: string,
  ): string {
    const cfg = store.getById(monedaId)
    if (!cfg) return '—'
    return formatMontoDisplay(value, cfg)
  }

  function formatOficial(value: string | Decimal | null | undefined): string {
    const oficial = store.monedaOficial
    if (!oficial) return '—'
    return formatMontoDisplay(value, oficial)
  }

  function parse(value: string, monedaId: string): Decimal {
    const cfg = store.getById(monedaId)
    if (!cfg) return new Decimal(0)
    return parseMontoInput(value, cfg)
  }

  function parseOficial(value: string): Decimal {
    const oficial = store.monedaOficial
    if (!oficial) return new Decimal(0)
    return parseMontoInput(value, oficial)
  }

  return {
    format,
    formatOficial,
    parse,
    parseOficial,
    getConfig,
  }
}
