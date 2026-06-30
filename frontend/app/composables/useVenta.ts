import { ref, watch } from 'vue'
import Decimal from 'decimal.js'
import { useCalculoPrecios, type ResultadoVenta, type CalcularVentaInput } from './useCalculoPrecios'

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface ItemCatalogo {
  id: string
  nombre: string
  descripcion: string | null
  precioBase: string
  monedaSimbolo: string | null
  stock: string | null
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

  const algunPermiteVuelto = pagos.some((p) =>
    metodos.find((m) => m.metodoPagoId === p.metodoPagoId)?.permiteVuelto,
  )
  return {
    restante: '0',
    vuelto: algunPermiteVuelto ? excedente.toString() : '0',
    excedenteSinVuelto: !algunPermiteVuelto,
  }
}

/**
 * Recorta el monto de los pagos cuyo método no permite vuelto para que el total
 * cobrado no supere `total`: un método sin vuelto no puede sobrepagar (no hay
 * cómo devolver el excedente). Solo reduce, nunca aumenta. Los métodos que
 * permiten vuelto (efectivo) no se tocan: pueden sobrepagar y generar vuelto.
 * Idempotente; devuelve la misma referencia si no hubo cambios.
 */
export function clampNoVuelto(
  total: string,
  pagos: PagoInput[],
  metodos: { metodoPagoId: string; permiteVuelto: boolean }[],
): PagoInput[] {
  const totalD = new Decimal(total || '0')
  let cambio = false
  const clamped = pagos.map((p, i) => {
    const permiteVuelto = metodos.find(
      (m) => m.metodoPagoId === p.metodoPagoId,
    )?.permiteVuelto
    if (permiteVuelto !== false) return p

    const otros = pagos.reduce(
      (acc, q, j) => (j === i ? acc : acc.plus(new Decimal(q.monto || '0'))),
      new Decimal(0),
    )
    const disponible = Decimal.max(0, totalD.minus(otros))
    const monto = new Decimal(p.monto || '0')
    if (monto.lte(disponible)) return p

    cambio = true
    return { ...p, monto: disponible.toString() }
  })
  return cambio ? clamped : pagos
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
