import Decimal from 'decimal.js'
import { formatStock as formatStockDisplay } from '~/utils/stock-format'

const dateFmt = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateOnlyFmt = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' })

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
    // Fecha sin hora (columna DATE): interpretarla en hora local, no UTC —
    // new Date('YYYY-MM-DD') la corre un día hacia atrás en TZ negativas.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (dateOnly) {
      const [, y, m, d] = dateOnly
      return dateOnlyFmt.format(new Date(Number(y), Number(m) - 1, Number(d)))
    }
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
