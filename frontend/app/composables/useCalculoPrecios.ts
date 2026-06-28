import { useApiFetch } from './useApiFetch'

// ── Tipos del contrato del motor de cálculo de precios ──────────────────────

export interface CalcularLineaInput {
  itemId: string
  cantidad: string
  /** Override opcional del precio_base del ítem. */
  precioUnitario?: string
  /** Si se pasa, reemplaza las reglas asociadas al ítem. */
  descuentoIds?: string[]
  recargoIds?: string[]
  impuestoIds?: string[]
}

export interface CalcularVentaInput {
  lineas: CalcularLineaInput[]
  metodoPagoId?: string
  descuentosVentaIds?: string[]
  recargosVentaIds?: string[]
}

export interface TrazaRegla {
  id: string
  nombre: string
  monto: string
}
export interface TrazaImpuesto extends TrazaRegla {
  tasa: string
}

export interface ResultadoLinea {
  itemId: string
  cantidad: string
  precioUnitario: string
  subtotalNeto: string
  descuentoAplicado: string
  recargoAplicado: string
  impuestoAplicado: string
  totalLinea: string
  trazas: {
    descuentos: TrazaRegla[]
    recargos: TrazaRegla[]
    impuestos: TrazaImpuesto[]
  }
}

export interface ResultadoVenta {
  lineas: ResultadoLinea[]
  totales: {
    subtotalNeto: string
    totalDescuentos: string
    totalRecargos: string
    totalImpuestos: string
    totalFinal: string
  }
  trazasVenta: {
    descuentos: TrazaRegla[]
    recargos: TrazaRegla[]
  }
}

/**
 * Motor de cálculo de precios — wrapper de la API.
 * Devuelve el desglose (neto → descuentos → recargos → impuestos → total)
 * para una venta sin persistir nada. Pensado para el carrito/checkout del POS.
 */
export function useCalculoPrecios() {
  const config = useRuntimeConfig()

  function calcular(input: CalcularVentaInput): Promise<ResultadoVenta> {
    return useApiFetch<ResultadoVenta>(
      `${config.public.apiUrl}/calculo-precios/calcular`,
      { method: 'POST', body: input },
    )
  }

  return { calcular }
}
