import Decimal from 'decimal.js'

/**
 * Conversión de cantidades y costos entre unidades de medida de una misma
 * magnitud. Misma aritmética que el backend (`CatalogService.convertirUnidad`):
 * `valor × (factorDesde / factorHacia)`, redondeada a 4 decimales.
 */
export function useUnidadConversion() {
  const store = useUnidadesMedidaStore()

  /** cantidad expresada en `desdeCodigo` → cantidad equivalente en `haciaCodigo`. */
  function convertirCantidad(
    cantidad: string,
    desdeCodigo: string,
    haciaCodigo: string,
  ): Decimal | null {
    if (desdeCodigo === haciaCodigo) {
      try {
        return new Decimal(cantidad)
      }
      catch {
        return null
      }
    }
    const uDesde = store.getByCodigo(desdeCodigo)
    const uHacia = store.getByCodigo(haciaCodigo)
    if (!uDesde || !uHacia || uDesde.magnitud !== uHacia.magnitud) return null
    try {
      return new Decimal(cantidad)
        .mul(uDesde.factorBase)
        .div(uHacia.factorBase)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    }
    catch {
      return null
    }
  }

  /**
   * Costo por unidad `desdeCodigo` → costo equivalente por unidad `haciaCodigo`,
   * preservando el valor total (cantidad × costo). Es el inverso de
   * `convertirCantidad`: mismo factor, argumentos invertidos.
   */
  function convertirCosto(
    costo: string,
    desdeCodigo: string,
    haciaCodigo: string,
  ): Decimal | null {
    return convertirCantidad(costo, haciaCodigo, desdeCodigo)
  }

  return { convertirCantidad, convertirCosto }
}
