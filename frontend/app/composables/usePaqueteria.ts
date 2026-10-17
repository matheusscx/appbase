import Decimal from 'decimal.js'
import type { MedioCobro, EstadoHoja, EstadoLinea, EstadoPaquete, LineaHoja, TarifaEnvioFila, TarifaPagoFila } from '~/types/paqueteria'

type ColorEstadoPaquete = 'neutral' | 'info' | 'success'
type ColorEstadoLinea = 'info' | 'success' | 'warning'
type ColorEstadoHoja = 'info' | 'success'

// `Record` completo: sumar un estado al tipo no compila hasta darle rótulo y color.
const PAQUETE: Record<EstadoPaquete, { rotulo: string, color: ColorEstadoPaquete }> = {
  disponible: { rotulo: 'Disponible', color: 'neutral' },
  en_ruta: { rotulo: 'En ruta', color: 'info' },
  entregado: { rotulo: 'Entregado', color: 'success' },
}

const LINEA: Record<EstadoLinea, { rotulo: string, color: ColorEstadoLinea }> = {
  en_ruta: { rotulo: 'En ruta', color: 'info' },
  entregado: { rotulo: 'Entregado', color: 'success' },
  no_entregado: { rotulo: 'No entregado', color: 'warning' },
}

const MEDIO: Record<MedioCobro, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia' }

const HOJA: Record<EstadoHoja, { rotulo: string, color: ColorEstadoHoja }> = {
  abierta: { rotulo: 'Abierta', color: 'info' },
  rendida: { rotulo: 'Rendida', color: 'success' },
}

/**
 * Presentación de Paquetería: rótulos y colores de estado, y la frase de la rendición.
 *
 * El estado del paquete (derivado de sus líneas) y el de una línea de la hoja no son el mismo
 * enum —la línea suma `no_entregado`, el paquete suma `disponible`—, por eso van separados
 * aunque compartan dos rótulos.
 */
export function usePaqueteria() {
  const { formatOficial } = useCurrency()

  /**
   * Lo que dice el modal de rendir. `neto` es cobrado − pago (puede ser negativo): positivo, el
   * repartidor entrega esa plata; negativo, el local le paga la diferencia. Se compara como
   * `Decimal` y no como `number` ni como texto: `'0.00'` también es cero.
   */
  function textoNeto(nombre: string, neto: string): string {
    const monto = new Decimal(neto)
    if (monto.isZero()) return `${nombre} no entrega ni recibe plata`
    if (monto.isNegative()) return `Se le pagan ${formatOficial(monto.abs().toFixed())} a ${nombre}`
    return `${nombre} entrega ${formatOficial(monto.toFixed())}`
  }

  /**
   * El saldo de una rendición (cobrado − pago − entregado a cuenta): positivo, lo debe el
   * repartidor; negativo, la empresa le paga. Comparte con `textoNeto` la forma de leer el signo
   * (`Decimal`: `'0.00'` también es cero), pero sin nombre: va en el pie de la planilla.
   */
  function presentarSaldo(saldo: string): { texto: string, negativo: boolean } {
    const monto = new Decimal(saldo)
    if (monto.isZero()) return { texto: 'Sin saldo', negativo: false }
    if (monto.isNegative()) return { texto: `La empresa le paga ${formatOficial(monto.abs().toFixed())}`, negativo: true }
    return { texto: `Debe rendir ${formatOficial(monto.toFixed())}`, negativo: false }
  }

  const textoSaldo = (saldo: string): string => presentarSaldo(saldo).texto

  /**
   * El neto de una hoja para una celda o un cartel (sin el nombre del repartidor): positivo y cero
   * se muestran como monto; negativo, como lo que el local le paga, con `negativo` para pintarlo
   * de otro color. Misma comparación por `Decimal` que `textoNeto`.
   */
  function presentarNeto(neto: string): { texto: string, negativo: boolean } {
    const monto = new Decimal(neto)
    if (monto.isNegative() && !monto.isZero()) {
      return { texto: `Se le pagan ${formatOficial(monto.abs().toFixed())}`, negativo: true }
    }
    return { texto: formatOficial(monto.toFixed()), negativo: false }
  }

  /**
   * Cuántas líneas de la hoja cobran en destino. Cuenta las `en_ruta` y las `entregado`: lo que el
   * repartidor cobra o ya cobró. Una `no_entregado` no cobra, así que no entra; por eso este número
   * puede ser menor que `asignados` aun si todas tienen el interruptor prendido (`asignados`
   * cuenta toda línea). No es el `cobroDestino` del servidor, que cuenta solo los entregados y
   * mientras se escanea vale siempre 0.
   */
  function lineasConCobro(lineas: LineaHoja[]): number {
    return lineas.filter(l => l.estado !== 'no_entregado' && l.cobroEnDestino).length
  }

  /** `YYYY-MM-DD` -> `DD-MM`, sobre el string: una fecha pura no pasa por `Date` (corre un día según la zona). */
  function fechaCorta(fecha: string): string {
    return fecha.split('-').slice(1).reverse().join('-')
  }

  /** `YYYY-MM-DD` menos `dias` días, por componentes locales: una fecha pura no pasa por `toISOString` (daría el día en UTC). */
  function diasAntes(fecha: string, dias: number): string {
    const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number]
    const d = new Date(anio, mes - 1, dia - dias)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
  }

  /** «05-10» si es un solo día, «05-10 al 10-10» si no; `formato` cambia cómo se escribe cada día. */
  function periodo(desde: string, hasta: string, formato: (fecha: string) => string = fechaCorta): string {
    return desde === hasta ? formato(desde) : `${formato(desde)} al ${formato(hasta)}`
  }

  /**
   * Items de `USelect` para elegir la tarifa de un paquete (de pago o de envío: la forma es la
   * misma). La primera, con `value: null`, es `rotuloBase` («Según repartidor» en el pago, «Por
   * defecto» en el envío): el servidor resuelve al entregar, y entre paréntesis va la que valdría
   * hoy (`heredada`). Después, las tarifas activas con su monto.
   * `actualId` mantiene visible una tarifa ya asignada que se desactivó después; sin eso el
   * selector quedaría en blanco y guardar la borraría sin que nadie lo pida.
   */
  function opcionesTarifa(
    tarifas: (TarifaPagoFila | TarifaEnvioFila)[],
    heredada: TarifaPagoFila | TarifaEnvioFila | null,
    actualId: string | null = null,
    rotuloBase = 'Según repartidor',
  ): { label: string, value: string | null }[] {
    const etiqueta = (t: TarifaPagoFila | TarifaEnvioFila) => `${t.nombre} ${formatOficial(t.monto)}`
    return [
      { label: heredada ? `${rotuloBase} (${etiqueta(heredada)})` : rotuloBase, value: null },
      ...tarifas.filter(t => t.activa || t.id === actualId).map(t => ({
        label: t.activa ? etiqueta(t) : `${etiqueta(t)} (inactiva)`,
        value: t.id,
      })),
    ]
  }

  return {
    opcionesTarifa,
    fechaCorta,
    diasAntes,
    periodo,
    lineasConCobro,
    rotuloEstadoPaquete: (estado: EstadoPaquete) => PAQUETE[estado].rotulo,
    colorEstadoPaquete: (estado: EstadoPaquete) => PAQUETE[estado].color,
    rotuloEstadoHoja: (estado: EstadoHoja) => HOJA[estado].rotulo,
    colorEstadoHoja: (estado: EstadoHoja) => HOJA[estado].color,
    rotuloEstadoLinea: (estado: EstadoLinea) => LINEA[estado].rotulo,
    colorEstadoLinea: (estado: EstadoLinea) => LINEA[estado].color,
    textoNeto,
    textoSaldo,
    presentarSaldo,
    rotuloMedio: (medio: MedioCobro) => MEDIO[medio],
    presentarNeto,
  }
}
