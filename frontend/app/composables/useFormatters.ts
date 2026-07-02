import Decimal from 'decimal.js'

const dateFmt = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function useFormatters() {
  const { format: formatCurrency, formatOficial } = useCurrency()

  function formatMonto(
    value: string | Decimal | null | undefined,
    monedaId?: string,
  ): string {
    if (monedaId) return formatCurrency(value, monedaId)
    return formatOficial(value)
  }

  function formatFecha(iso: string | null | undefined): string {
    if (!iso) return '—'
    return dateFmt.format(new Date(iso))
  }

  return { formatMonto, formatFecha }
}
