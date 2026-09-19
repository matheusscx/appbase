import Decimal from 'decimal.js'
import { formatStock as formatStockDisplay } from '~/utils/stock-format'

const dateFmt = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateOnlyFmt = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' })
const horaFmt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' })
const diaSemanaFmt = new Intl.DateTimeFormat('es-CL', { weekday: 'long' })

export function useFormatters() {
  const { format: formatCurrency, formatCosto, formatOficial } = useCurrency()

  function formatMonto(
    value: string | Decimal | null | undefined,
    monedaId?: string,
  ): string {
    if (monedaId) return formatCurrency(value, monedaId)
    return formatOficial(value)
  }

  /** `HH:MM` local — el "Actualizado HH:MM" de los bloques con refresco
   *  periódico (`useRefrescoPeriodico`, zona "Ahora" del dashboard). */
  function formatHora(fecha: Date | null | undefined): string {
    if (!fecha) return '—'
    return horaFmt.format(fecha)
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

  /**
   * Nombre del día de semana (`"miércoles"`) de una fecha `YYYY-MM-DD`, en
   * hora local — mismo cuidado de fecha pura que `formatFecha`: interpretar
   * el string como UTC corre el día hacia atrás en TZ negativas. Lo usa
   * `InicioVentas.vue` para "vs. <día> pasado": el backend siempre compara
   * contra 7 días antes, que cae en el mismo día de semana que `fecha`.
   */
  function formatDiaSemana(fecha: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
    if (!m) return '—'
    const [, y, mo, d] = m
    return diaSemanaFmt.format(new Date(Number(y), Number(mo) - 1, Number(d)))
  }

  function formatStock(
    value: string | Decimal | null | undefined,
    unidadMedida?: string | null,
  ): string {
    const unidadesStore = useUnidadesMedidaStore()
    return formatStockDisplay(
      value,
      unidadMedida,
      unidadesStore.esFraccionaria(unidadMedida),
    )
  }

  // Traduce el payment_type_code de Transbank (Webpay) a una etiqueta legible.
  function formatTipoPago(code: string | null | undefined): string | null {
    if (!code) return null
    const map: Record<string, string> = {
      VD: 'Débito',
      VN: 'Crédito',
      VC: 'Crédito en cuotas',
      SI: 'Crédito 3 cuotas s/interés',
      S2: 'Crédito 2 cuotas s/interés',
      NC: 'Crédito cuotas s/interés',
      VP: 'Prepago',
    }
    return map[code] ?? code
  }

  /**
   * Costo desglosado por moneda (spec `2026-09-18-reporte-anulaciones-design.md`
   * § 4: "el costo nunca se convierte de moneda", va como lista `{ monedaId,
   * monto }`) → texto para la pantalla, `formatMonto(monto, monedaId)` por
   * cada entrada, separadas por coma. `[]` da `—` — cubre los dos casos que
   * la producen (`no_aplica` y, agregado, un grupo de puro `no_elaborado`)
   * sin que la pantalla tenga que distinguirlos.
   */
  function formatCostoPorMoneda(
    costo: { monedaId: string, monto: string }[],
  ): string {
    if (costo.length === 0) return '—'
    return costo.map(c => formatMonto(c.monto, c.monedaId)).join(', ')
  }

  /** Valor decimal (0.19 = 19%) → string localizado con sufijo %. */
  function formatPorcentaje(
    value: string | Decimal | null | undefined,
    decimals = 2,
  ): string {
    if (value === null || value === undefined || value === '') return '—'
    try {
      const pct = new Decimal(value).mul(100).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
      return `${pct.toFixed(decimals).replace('.', ',')}%`
    } catch {
      return '—'
    }
  }

  // `formatCosto` se reexpone tal cual: un costo es una tasa y su formato tiene
  // su propia regla (los decimales de la moneda son el piso, ver `useCurrency`).
  // Va por acá y no importando `useCurrency` en la página porque las pantallas
  // formatean por `useFormatters` — una sola puerta, no dos.
  return { formatMonto, formatCosto, formatFecha, formatHora, formatDiaSemana, formatStock, formatTipoPago, formatPorcentaje, formatCostoPorMoneda }
}
