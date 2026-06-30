import Decimal from 'decimal.js'

const numberFmt = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFmt = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function useFormatters() {
  function formatMonto(value: string | Decimal | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—'
    const d = value instanceof Decimal ? value : new Decimal(value)
    return numberFmt.format(d.toNumber())
  }

  function formatFecha(iso: string | null | undefined): string {
    if (!iso) return '—'
    return dateFmt.format(new Date(iso))
  }

  return { formatMonto, formatFecha }
}
