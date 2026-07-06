import { ref, watch } from 'vue'
import Decimal from 'decimal.js'
import { useCalculoPrecios, type ResultadoVenta, type CalcularVentaInput } from './useCalculoPrecios'

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface ItemCatalogo {
  id: string
  nombre: string
  descripcion: string | null
  precioBase: string
  monedaId: string
  monedaSimbolo: string | null
  stock: string | null
  unidadMedida: string | null
  tipo: string
}

export interface CarritoLinea {
  item: ItemCatalogo
  cantidad: string
}

export interface PagoInput {
  metodoPagoId: string
  monto: string
  referencia?: string
}

// ── Helpers de carrito (puros, inmutables) ──────────────────────────────────

export function agregarLinea(
  lineas: CarritoLinea[],
  item: ItemCatalogo,
): CarritoLinea[] {
  const existente = lineas.find((l) => l.item.id === item.id)
  if (existente) {
    return lineas.map((l) =>
      l.item.id === item.id
        ? { ...l, cantidad: new Decimal(l.cantidad || '0').plus(1).toString() }
        : l,
    )
  }
  return [...lineas, { item, cantidad: '1' }]
}

export function quitarLinea(
  lineas: CarritoLinea[],
  itemId: string,
): CarritoLinea[] {
  return lineas.filter((l) => l.item.id !== itemId)
}

export function setCantidad(
  lineas: CarritoLinea[],
  itemId: string,
  cantidad: string,
): CarritoLinea[] {
  return lineas.map((l) =>
    l.item.id === itemId ? { ...l, cantidad } : l,
  )
}

export function toCalcularInput(lineas: CarritoLinea[]): CalcularVentaInput {
  return {
    lineas: lineas.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad })),
  }
}

/** Descuenta del catálogo las cantidades vendidas (sin recargar desde API). */
export function descontarStockCatalogo(
  items: ItemCatalogo[],
  lineas: CarritoLinea[],
): ItemCatalogo[] {
  if (lineas.length === 0) return items

  const vendidoPorItem = new Map<string, Decimal>()
  for (const linea of lineas) {
    const prev = vendidoPorItem.get(linea.item.id) ?? new Decimal(0)
    vendidoPorItem.set(linea.item.id, prev.plus(linea.cantidad || '0'))
  }

  return items.map((item) => {
    const vendido = vendidoPorItem.get(item.id)
    if (!vendido || item.stock === null || item.stock === '') return item
    try {
      const nuevo = Decimal.max(0, new Decimal(item.stock).minus(vendido))
      return { ...item, stock: nuevo.toString() }
    } catch {
      return item
    }
  })
}

// ── Helpers de pagos (puros) ────────────────────────────────────────────────

export function sumaPagos(pagos: PagoInput[]): string {
  return pagos
    .reduce((acc, p) => acc.plus(new Decimal(p.monto || '0')), new Decimal(0))
    .toString()
}

export function resumenCobro(
  total: string,
  pagos: PagoInput[],
  metodos: { metodoPagoId: string; permiteVuelto: boolean }[],
): { restante: string; vuelto: string; excedenteSinVuelto: boolean } {
  const totalD = new Decimal(total || '0')
  const suma = new Decimal(sumaPagos(pagos))
  const excedente = suma.minus(totalD)

  if (excedente.lte(0)) {
    return {
      restante: totalD.minus(suma).toString(),
      vuelto: '0',
      excedenteSinVuelto: false,
    }
  }

  // El vuelto se devuelve en efectivo: el excedente solo es válido si los
  // métodos sin vuelto (tarjeta, transferencia) no superan el total entre
  // todos — lo cobrado de más por esos métodos no se puede devolver.
  const sumaNoVuelto = pagos.reduce((acc, p) => {
    const permiteVuelto = metodos.find(
      (m) => m.metodoPagoId === p.metodoPagoId,
    )?.permiteVuelto
    return permiteVuelto === false ? acc.plus(new Decimal(p.monto || '0')) : acc
  }, new Decimal(0))
  const excedenteSinVuelto = sumaNoVuelto.gt(totalD)
  return {
    restante: '0',
    vuelto: excedenteSinVuelto ? '0' : excedente.toString(),
    excedenteSinVuelto,
  }
}

/**
 * Fija el monto del pago `indice` y hace las cuentas por el cajero: si la suma
 * supera el total, los demás pagos absorben el excedente (se reducen empezando
 * por el primero, con piso 0). Nunca aumenta un monto que el cajero no editó,
 * y lo escrito en el pago editado se respeta siempre — si él solo supera el
 * total, el excedente restante se resuelve como vuelto/validación al confirmar.
 */
export function setMontoPago(
  total: string,
  pagos: PagoInput[],
  indice: number,
  monto: string,
): PagoInput[] {
  const nuevos = pagos.map((p, i) => (i === indice ? { ...p, monto } : p))
  let exceso = new Decimal(sumaPagos(nuevos)).minus(new Decimal(total || '0'))
  if (exceso.lte(0)) return nuevos

  return nuevos.map((p, i) => {
    if (i === indice || exceso.lte(0)) return p
    const actual = new Decimal(p.monto || '0')
    const rebaja = Decimal.min(actual, exceso)
    if (rebaja.lte(0)) return p
    exceso = exceso.minus(rebaja)
    return { ...p, monto: actual.minus(rebaja).toString() }
  })
}

// ── Gate ────────────────────────────────────────────────────────────────────

export function puedeCobrar(args: {
  tieneCaja: boolean
  lineas: CarritoLinea[]
  customerRequerido: boolean
  customerExpandido: boolean
  customerNombre: string
  tipoDocumentoId: string | undefined
}): boolean {
  if (!args.tieneCaja) return false
  if (args.lineas.length === 0) return false
  if (!args.tipoDocumentoId) return false
  if ((args.customerRequerido || args.customerExpandido) && args.customerNombre.trim() === '') return false
  return true
}

// ── Composable reactivo con estado y recálculo ──────────────────────────────

export function useVenta() {
  const { calcular } = useCalculoPrecios()
  const lineas = ref<CarritoLinea[]>([])
  const resultado = ref<ResultadoVenta | null>(null)
  const loadingCalculo = ref(false)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function recalcular() {
    if (lineas.value.length === 0) {
      resultado.value = null
      return
    }
    loadingCalculo.value = true
    try {
      resultado.value = await calcular(toCalcularInput(lineas.value))
    } finally {
      loadingCalculo.value = false
    }
  }

  watch(
    lineas,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void recalcular()
      }, 300)
    },
    { deep: true },
  )

  function add(item: ItemCatalogo) {
    lineas.value = agregarLinea(lineas.value, item)
  }
  function quitar(itemId: string) {
    lineas.value = quitarLinea(lineas.value, itemId)
  }
  function cambiarCantidad(itemId: string, cantidad: string) {
    lineas.value = setCantidad(lineas.value, itemId, cantidad)
  }
  function limpiar() {
    lineas.value = []
    resultado.value = null
  }

  return { lineas, resultado, loadingCalculo, add, quitar, cambiarCantidad, limpiar }
}
