import Decimal from 'decimal.js'
import { formatStock as formatStockDisplay } from '~/utils/stock-format'

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

  function formatStock(
    value: string | Decimal | null | undefined,
    unidadMedida?: string | null,
  ): string {
    return formatStockDisplay(value, unidadMedida)
  }

  return { formatMonto, formatFecha, formatStock }
}
