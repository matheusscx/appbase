import Decimal from 'decimal.js'
import type { EstadoLinea, EstadoPaquete, LineaHoja } from '~/types/paqueteria'

type ColorEstadoPaquete = 'neutral' | 'info' | 'success'
type ColorEstadoLinea = 'info' | 'success' | 'warning'

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
   * Cuántas líneas de la hoja cobran en destino. Cuenta las `en_ruta` y las `entregado`: lo que el
   * repartidor cobra o ya cobró. Una `no_entregado` no cobra, así que no entra; por eso este número
   * puede ser menor que `asignados` aun si todas tienen el interruptor prendido (`asignados`
   * cuenta toda línea). No es el `cobroDestino` del servidor, que cuenta solo los entregados y
   * mientras se escanea vale siempre 0.
   */
  function lineasConCobro(lineas: LineaHoja[]): number {
    return lineas.filter(l => l.estado !== 'no_entregado' && l.cobroEnDestino).length
  }

  return {
    lineasConCobro,
    rotuloEstadoPaquete: (estado: EstadoPaquete) => PAQUETE[estado].rotulo,
    colorEstadoPaquete: (estado: EstadoPaquete) => PAQUETE[estado].color,
    rotuloEstadoLinea: (estado: EstadoLinea) => LINEA[estado].rotulo,
    colorEstadoLinea: (estado: EstadoLinea) => LINEA[estado].color,
    textoNeto,
  }
}
