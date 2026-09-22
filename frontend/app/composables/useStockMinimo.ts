import Decimal from 'decimal.js'

/** Una fila de `GET /inventario/stock-minimo` — forma de `InventarioService.StockMinimoFila`. */
export interface StockMinimoFila {
  itemId: string
  itemNombre: string
  ubicacionId: string
  ubicacionNombre: string
  unidadMedida: string
  /** `null` = nunca se cargó mínimo para este par: sin aviso posible. */
  minimo: string | null
  origen: 'manual' | 'sistema' | null
  stock: string
  bajoMinimo: boolean
  enCamino: boolean
  origenSugerido: { ubicacionId: string, ubicacionNombre: string, stock: string } | null
}

/**
 * El aviso de stock bajo desde la pantalla de mínimos
 * (`docs/features/aviso-stock-bajo.md`): guardar el mínimo de una fila y armar
 * el traslado precargado que la cubre.
 */
export function useStockMinimo() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  /**
   * `''` limpia (viaja `null`). Devuelve la fila recalculada por el backend —
   * `bajoMinimo` y `enCamino` no se derivan acá—, o `null` si el par no se
   * lista (una bodega desactivada).
   */
  async function guardarMinimo(fila: StockMinimoFila, minimo: string) {
    return useApiFetch<StockMinimoFila | null>(
      `${apiUrl}/inventario/stock-minimo/${fila.itemId}/${fila.ubicacionId}`,
      { method: 'PUT', body: { minimo: minimo.trim() === '' ? null : minimo.trim() } },
    )
  }

  /**
   * Lo tipeado es el mismo mínimo que ya tiene la fila: vacío sobre "sin
   * mínimo", o el mismo número aunque se escriba distinto (`5` y `5.0000`).
   * Lo que no es un número no cuenta como igual: que lo rechace el backend.
   */
  function sinCambio(fila: StockMinimoFila, tipeado: string): boolean {
    const nuevo = tipeado.trim()
    if (nuevo === '' || fila.minimo === null) return nuevo === '' && fila.minimo === null
    try {
      return new Decimal(nuevo).eq(fila.minimo)
    }
    catch {
      return false
    }
  }

  /**
   * El traslado que cubre el faltante: desde la ubicación con más stock hacia
   * la que está abajo, por lo que falta para llegar al mínimo — sin pasarse de
   * lo que hay en el origen. `destinoId` viaja explícito porque la ubicación
   * baja puede ser una bodega (la pantalla de traslados cae al local si no
   * viene). `null` si no hay de dónde trasladar.
   */
  function rutaTraslado(fila: StockMinimoFila) {
    if (!fila.bajoMinimo || !fila.minimo || !fila.origenSugerido) return null
    const falta = new Decimal(fila.minimo).minus(fila.stock)
    const cantidad = Decimal.min(falta, fila.origenSugerido.stock)
    return {
      path: '/inventario/traslados',
      query: {
        itemId: fila.itemId,
        origenId: fila.origenSugerido.ubicacionId,
        destinoId: fila.ubicacionId,
        cantidad: cantidad.toString(),
      },
    }
  }

  return { guardarMinimo, sinCambio, rutaTraslado }
}
