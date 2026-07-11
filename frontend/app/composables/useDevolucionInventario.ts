import { ref, computed } from 'vue'
import Decimal from 'decimal.js'

// ── Tipos ───────────────────────────────────────────────────────────────────

/** Línea de venta tal como la expone GET /ventas/:id (subset para devoluciones). */
export interface DetalleVentaDevolucion {
  itemId: string
  descripcion: string | null
  cantidad: string
  modoInventario: string | null
  /** Total ya devuelto del ÍTEM — el backend repite el mismo total en cada línea del ítem. */
  cantidadDevuelta: string
}

export interface FilaDevolucion {
  itemId: string
  descripcion: string
  disponible: string
  modoInventario: string | null
  cantidad: string
}

// ── Helpers (puros, inmutables) ──────────────────────────────────────────────

export function esDecimalValido(v: string) {
  return /^\d+(\.\d+)?$/.test(v)
}

/**
 * Una fila por ítem: el disponible a devolver es por ítem, no por línea.
 * `cantidadDevuelta` viene repetida por ítem, así que se resta UNA sola vez
 * (en la primera línea) y las líneas siguientes solo suman su cantidad.
 */
export function agruparFilasDevolucion(
  detalles: DetalleVentaDevolucion[],
): FilaDevolucion[] {
  const porItem = new Map<string, FilaDevolucion>()
  for (const d of detalles) {
    const previa = porItem.get(d.itemId)
    if (previa) {
      previa.disponible = new Decimal(previa.disponible).plus(d.cantidad).toString()
    }
    else {
      porItem.set(d.itemId, {
        itemId: d.itemId,
        descripcion: d.descripcion ?? d.itemId,
        disponible: new Decimal(d.cantidad).minus(d.cantidadDevuelta).toString(),
        modoInventario: d.modoInventario,
        cantidad: '',
      })
    }
  }
  return [...porItem.values()]
}

export function setCantidadFila(
  filas: FilaDevolucion[],
  itemId: string,
  valor: string,
): FilaDevolucion[] {
  return filas.map(f => (f.itemId === itemId ? { ...f, cantidad: valor } : f))
}

export function filasDevolucionValidas(filas: FilaDevolucion[]): boolean {
  return filas.every((f) => {
    if (!f.cantidad) return true
    if (!esDecimalValido(f.cantidad)) return false
    return new Decimal(f.cantidad).lte(f.disponible)
  })
}

export function devolucionesPayload(
  filas: FilaDevolucion[],
): { itemId: string, cantidad: string }[] {
  return filas
    .filter(f => f.cantidad && esDecimalValido(f.cantidad) && new Decimal(f.cantidad).gt(0))
    .map(f => ({ itemId: f.itemId, cantidad: f.cantidad }))
}

export function notaDevolucion(fila: FilaDevolucion): string | null {
  if (fila.modoInventario === null) return 'Servicio: sin stock'
  if (fila.modoInventario !== 'cantidad')
    return `Modo ${fila.modoInventario}: devolución manual desde Inventario`
  return null
}

export function filaDevolvible(fila: FilaDevolucion): boolean {
  return fila.modoInventario === 'cantidad' && new Decimal(fila.disponible).gt(0)
}

// ── Composable reactivo ──────────────────────────────────────────────────────

export function useDevolucionInventario() {
  const filas = ref<FilaDevolucion[]>([])

  function cargarDesdeDetalles(detalles: DetalleVentaDevolucion[]) {
    filas.value = agruparFilasDevolucion(detalles)
  }

  function limpiar() {
    filas.value = []
  }

  function setCantidad(itemId: string, valor: string) {
    filas.value = setCantidadFila(filas.value, itemId, valor)
  }

  const filasValidas = computed(() => filasDevolucionValidas(filas.value))
  const devoluciones = computed(() => devolucionesPayload(filas.value))

  return { filas, cargarDesdeDetalles, limpiar, setCantidad, filasValidas, devoluciones }
}
