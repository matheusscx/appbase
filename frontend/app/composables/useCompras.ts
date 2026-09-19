import Decimal from 'decimal.js'

/** Los tres estados de `compras.estado`: espejo de `EstadoCompra` del backend
 *  (`backend/src/modules/compras/entities/compra.entity.ts`). */
export type EstadoCompra = 'borrador' | 'confirmada' | 'anulada'

type ColorInsignia = 'neutral' | 'success' | 'error' | 'warning'

const ETIQUETA: Record<EstadoCompra, string> = {
  borrador: 'Borrador',
  confirmada: 'Confirmada',
  anulada: 'Anulada',
}

const COLOR: Record<EstadoCompra, ColorInsignia> = {
  borrador: 'neutral',
  confirmada: 'success',
  anulada: 'error',
}

/** Un número tipeable: dígitos con punto decimal opcional, sin coma a medias. */
const NUMERO = /^\d+(\.\d+)?$/

function comoDecimal(valor: string | null | undefined): Decimal | null {
  if (valor == null) return null
  const limpio = valor.trim()
  return NUMERO.test(limpio) ? new Decimal(limpio) : null
}

/**
 * Lo que la pantalla de Compras calcula para mostrar.
 *
 * ⚠️ Los totales de acá **no son el costo**: son para que el encargado los
 * compare con el papel. El costo lo calcula el servidor al confirmar (conversión
 * de unidad y descuento repartido), por eso estos números no redondean.
 *
 * Las opciones del filtro de estado se **derivan** del mapa de etiquetas, como
 * en `useEstadoVenta`: ofrecer un estado que el backend no conoce falla recién
 * con el 400 del `@IsIn` del listado.
 */
export function useCompras() {
  function totalLinea(cantidad: string, precioUnitario: string | null): string | null {
    const c = comoDecimal(cantidad)
    const p = comoDecimal(precioUnitario)
    if (!c || !p) return null
    return c.times(p).toString()
  }

  function subtotal(lineas: { cantidad: string, precioUnitario: string | null }[]): string | null {
    let suma = new Decimal(0)
    for (const l of lineas) {
      const t = totalLinea(l.cantidad, l.precioUnitario)
      if (t == null) return null
      suma = suma.plus(t)
    }
    return suma.toString()
  }

  /**
   * El total del pie: subtotal menos el descuento al total. Null si falta el
   * subtotal (alguna línea sin precio); un descuento vacío no descuenta.
   */
  function totalConDescuento(subtotalCompra: string | null, descuento: string | null): string | null {
    if (subtotalCompra == null) return null
    const d = comoDecimal(descuento)
    return new Decimal(subtotalCompra).minus(d ?? 0).toString()
  }

  /** El 0 es un precio (el regalo); el vacío no. */
  function faltaAlgunPrecio(lineas: { precioUnitario: string | null }[]): boolean {
    return lineas.some(l => comoDecimal(l.precioUnitario) == null)
  }

  function insigniaEstado(c: { estado: EstadoCompra, faltaCosto: boolean }) {
    const insignias: { label: string, color: ColorInsignia }[] = [
      { label: ETIQUETA[c.estado] ?? c.estado, color: COLOR[c.estado] ?? 'neutral' },
    ]
    if (c.faltaCosto) insignias.push({ label: 'Falta costo', color: 'warning' })
    return insignias
  }

  const estadoOptions = (Object.keys(ETIQUETA) as EstadoCompra[]).map(value => ({
    label: ETIQUETA[value],
    value,
  }))

  return { totalLinea, subtotal, totalConDescuento, faltaAlgunPrecio, insigniaEstado, estadoOptions }
}
