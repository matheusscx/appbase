import Decimal from 'decimal.js'
import { formatStock as formatStockDisplay } from '~/utils/stock-format'

const dateFmt = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateOnlyFmt = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' })
const horaFmt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' })
/** `21:14` siempre en 24 h, sin depender de cómo el motor de `es-CL` resuelva el ciclo de horas. */
const hora24Fmt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const diaSemanaFmt = new Intl.DateTimeFormat('es-CL', { weekday: 'long' })

/**
 * "hace 45 min", "hace 2 h 10 min", "hace 2 d": cuánto lleva abierto algo (una cuenta, una
 * sesión). `ahora` se pasa para poder medirlo; un reloj adelantado no da un tiempo negativo.
 */
export function textoHace(iso: string | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return ''
  const minutos = Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60_000))
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) {
    const resto = minutos % 60
    return resto === 0 ? `hace ${horas} h` : `hace ${horas} h ${resto} min`
  }
  return `hace ${Math.floor(horas / 24)} d`
}

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

  /** `HH:MM` en 24 h — para decir cuándo pasó algo ("Ya salió a las 21:14"). */
  function formatHora24(fecha: Date): string {
    return hora24Fmt.format(fecha)
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

  /**
   * Cantidad con su unidad SIEMPRE a la vista: "1 unidad", "3 unidades",
   * "20 g". `formatStock` omite la unidad de conteo ("98"), lo que sirve en una
   * tabla con la unidad en el encabezado pero no en una frase suelta
   * ("Máximo 1 unidad"). Presentación pura: no toca el valor.
   */
  function formatCantidadConUnidad(
    value: string | Decimal | null | undefined,
    unidadMedida?: string | null,
  ): string {
    const texto = formatStock(value, unidadMedida)
    if (texto === '—' || !unidadMedida) return texto
    const unidadesStore = useUnidadesMedidaStore()
    if (unidadesStore.esFraccionaria(unidadMedida)) return texto
    if (unidadMedida === 'unidad') return `${texto} ${texto === '1' ? 'unidad' : 'unidades'}`
    return `${texto} ${unidadMedida}`
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

  /**
   * Porcentaje para una lista: hasta 2 decimales y sin ceros de cola
   * ("0.025" → "2,5%", "0.1" → "10%"). Con `toFixed(0)` un 2,5 % se leía "3 %":
   * la persona veía una regla distinta de la guardada.
   */
  function formatPorcentajeCorto(value: string | Decimal | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—'
    try {
      const pct = new Decimal(value).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      return `${pct.toFixed().replace('.', ',')}%`
    } catch {
      return '—'
    }
  }

  // `formatCosto` se reexpone tal cual: un costo es una tasa y su formato tiene
  // su propia regla (los decimales de la moneda son el piso, ver `useCurrency`).
  // Va por acá y no importando `useCurrency` en la página porque las pantallas
  // formatean por `useFormatters` — una sola puerta, no dos.
  return { formatMonto, formatCosto, formatFecha, formatHora, formatHora24, formatHace: textoHace, formatDiaSemana, formatStock, formatCantidadConUnidad, formatTipoPago, formatPorcentaje, formatPorcentajeCorto, formatCostoPorMoneda, esAjusteDeValor }
}

/**
 * Movimientos del kardex que no mueven cantidad sino valor: el costo pasa de
 * `costoAnterior` a `costoUnitario`. Espejo de `MOTIVOS_DE_VALOR` del backend
 * (`backend/src/modules/inventario/inventario.service.ts`): `ajuste_costo` lo
 * tipea una persona, `correccion_compra` lo deja completar o corregir el precio
 * de una compra. Las dos tablas de kardex (inventario e historial del ítem) los
 * dibujan igual, así que la lista vive en un solo lugar.
 */
const MOTIVOS_DE_VALOR = ['ajuste_costo', 'correccion_compra']

export function esAjusteDeValor(motivo: string): boolean {
  return MOTIVOS_DE_VALOR.includes(motivo)
}
