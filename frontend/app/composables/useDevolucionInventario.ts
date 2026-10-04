import { ref, computed } from 'vue'
import Decimal from 'decimal.js'

// ── Tipos ───────────────────────────────────────────────────────────────────

/**
 * Qué se le pregunta a una línea al devolverla, según lo que salió del
 * inventario por ella (GET /ventas/:id, `devolucionStock`): nada, las dos
 * respuestas, o solo "se perdió" (serie o lote no vuelven solos al stock).
 */
export type DevolucionStock = 'sin_stock' | 'recuperable' | 'solo_perdida'

/** Lo que pasa con lo devuelto: vuelve al stock, o se perdió (merma "Devolución"). */
export type DestinoStock = 'recupera' | 'pierde'

/** Línea de venta tal como la expone GET /ventas/:id (subset para devoluciones). */
export interface DetalleVentaDevolucion {
  itemId: string
  descripcion: string | null
  cantidad: string
  modoInventario: string | null
  devolucionStock: DevolucionStock
  /** Total ya devuelto del ÍTEM — el backend repite el mismo total en cada línea del ítem. */
  cantidadDevuelta: string
  /** Bruto de la línea, con descuentos y recargos ya adentro. */
  totalLinea: string
}

export interface FilaDevolucion {
  itemId: string
  descripcion: string
  disponible: string
  modoInventario: string | null
  cantidad: string
  /** Si se pregunta y qué respuestas admite; lo decide el backend. */
  devolucionStock: DevolucionStock
  /**
   * La respuesta a "¿vuelve al stock o se perdió?" (owner, 2026-08-23). Nace
   * sin responder a propósito: no hay default, porque los dos destinos son
   * comunes —la botella que vuelve cerrada y la hamburguesa ya armada— y
   * cualquiera elegido de antemano se confirmaría sin mirar.
   */
  stock: DestinoStock | null
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
        devolucionStock: d.devolucionStock,
        stock: null,
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

/**
 * ¿Falta contestar "¿vuelve al stock o se perdió?" en alguna fila que se va a
 * devolver? Es lo que el backend rechaza con 400 (`Falta decir si…`): el botón
 * no se habilita hasta contestarlas todas.
 */
export function faltaDestinoStock(filas: FilaDevolucion[]): boolean {
  return filas.some(f =>
    f.cantidad
    && esDecimalValido(f.cantidad)
    && new Decimal(f.cantidad).gt(0)
    && f.devolucionStock !== 'sin_stock'
    && f.stock === null,
  )
}

export function setStockFila(
  filas: FilaDevolucion[],
  itemId: string,
  valor: DestinoStock,
): FilaDevolucion[] {
  // Solo lo que el backend acepta: una fila sin stock no lleva respuesta, y la
  // que solo puede perderse no se recupera (serie o lote).
  return filas.map((f) => {
    if (f.itemId !== itemId || f.devolucionStock === 'sin_stock') return f
    if (valor === 'recupera' && f.devolucionStock === 'solo_perdida') return f
    return { ...f, stock: valor }
  })
}

/**
 * El criterio de redondeo CONGELADO de la venta (`venta.configCalculo`), el
 * subconjunto que hace falta para cuantizar como el motor. Nace acá y no en
 * `VentaDetalleDrawer.vue` porque es este composable el que lo consume.
 */
export interface CriterioRedondeoCongelado {
  decimalesMoneda: number
  modoRedondeo: string
}

/**
 * Gemela de `ROUNDING_POR_MODO` en
 * `backend/src/modules/calculo-precios/calculo-precios.engine.ts:399`: los
 * mismos cuatro modos, a la misma constante de Decimal.js (la librería las
 * expone iguales en Node y en el navegador). Un modo que no está cae a
 * HALF_UP, igual que `modoToRounding` en el backend — ahí el motivo es un
 * valor que el tipo no puede garantizar en runtime porque sale de un JSONB;
 * acá es el mismo motivo, un nivel más abajo (el campo llega tipado `string`
 * desde la API).
 */
const ROUNDING_POR_MODO: Record<string, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  FLOOR: Decimal.ROUND_FLOOR,
  CEIL: Decimal.ROUND_CEIL,
}

/**
 * Gemela de `cuantizar` en
 * `backend/src/modules/calculo-precios/calculo-precios.engine.ts:444`: lleva
 * un monto a la escala de la moneda (`decimalesMoneda`) con el modo de
 * redondeo congelado. Mismo `toDecimalPlaces`, mismo mapeo de modo.
 */
function cuantizar(d: Decimal, cfg: CriterioRedondeoCongelado): Decimal {
  return d.toDecimalPlaces(
    cfg.decimalesMoneda,
    ROUNDING_POR_MODO[cfg.modoRedondeo] ?? Decimal.ROUND_HALF_UP,
  )
}

/**
 * Las líneas a devolver, con `stock` solo donde se pregunta: el backend
 * rechaza la respuesta en una línea sin stock, igual que la falta de ella en una
 * que lo tiene. Es el contrato de `devoluciones` de la nota y del reembolso.
 */
export function devolucionesPayload(
  filas: FilaDevolucion[],
): { itemId: string, cantidad: string, stock?: DestinoStock }[] {
  return filas
    .filter(f => f.cantidad && esDecimalValido(f.cantidad) && new Decimal(f.cantidad).gt(0))
    .map(f =>
      f.devolucionStock === 'sin_stock' || f.stock === null
        ? { itemId: f.itemId, cantidad: f.cantidad }
        : { itemId: f.itemId, cantidad: f.cantidad, stock: f.stock },
    )
}

/**
 * Lo que vale, EN ESTA BOLETA, lo que el operador marcó — para decidir si el
 * modal le **pide** el motivo.
 *
 * Con `cfg` (el caso real: `venta.configCalculo`, cuando hay criterio
 * congelado) es gemela exacta de la valuación que hace `ventas.service.ts`
 * (`crearNotaCreditoEnTransaccion`, desde el comentario "1. Lo que vale la
 * mercadería devuelta EN ESTA BOLETA" ~línea 1481): cada línea a
 * `Σ total_linea / Σ cantidad` — **se divide antes de multiplicar**, mismo
 * orden que `valorUnitarioBruto` en `validarDevolucionesReembolso` (línea
 * ~2511), porque Decimal.js redondea a su precisión por defecto (20 cifras
 * significativas, igual en los dos lados) y el orden de las operaciones puede
 * mover el último dígito antes de cuantizar — multiplicada por lo marcado y
 * cuantizada a `decimalesMoneda` con el `modoRedondeo` de `cfg`, **por línea,
 * antes de sumar** (el backend tampoco vuelve a cuantizar la suma).
 *
 * Con `cfg: null` (ventas anteriores al congelado) no hay nada que cuantizar,
 * y el orden vuelve a ser el de ANTES de este gemelo —multiplica antes de
 * dividir, para no dejar el residuo de la división a la vista (5.000 / 3 × 3
 * = 5000,0000000000000001)—: no hace diferencia funcional, porque
 * `crearNotaCreditoDesdeVenta` —el único camino que arma este modal— fija
 * `validarVentaElegible: true`, y con eso el backend rechaza CUALQUIER nota
 * de crédito manual sobre una venta sin `config_calculo`
 * (`ventas.service.ts:1416-1439`, antes de llegar a valuar nada); el 400 de
 * esa venta no depende de este número.
 */
export function valorDevueltoCuantizado(
  detalles: DetalleVentaDevolucion[],
  filas: FilaDevolucion[],
  cfg: CriterioRedondeoCongelado | null,
): string {
  const porItem = new Map<string, { total: Decimal, cantidad: Decimal }>()
  for (const d of detalles) {
    const acc = porItem.get(d.itemId) ?? { total: new Decimal(0), cantidad: new Decimal(0) }
    porItem.set(d.itemId, {
      total: acc.total.plus(d.totalLinea),
      cantidad: acc.cantidad.plus(d.cantidad),
    })
  }
  return filas
    .reduce((acc, f) => {
      if (!f.cantidad || !esDecimalValido(f.cantidad)) return acc
      const v = porItem.get(f.itemId)
      if (!v || v.cantidad.isZero()) return acc
      if (cfg) {
        const bruto = v.total.dividedBy(v.cantidad).times(f.cantidad)
        return acc.plus(cuantizar(bruto, cfg))
      }
      return acc.plus(v.total.times(f.cantidad).dividedBy(v.cantidad))
    }, new Decimal(0))
    .toString()
}

/** Por qué una fila no pregunta, o no deja recuperar. `null` si admite las dos. */
export function notaDevolucion(fila: FilaDevolucion): string | null {
  if (fila.devolucionStock === 'sin_stock') return 'No sacó nada del inventario'
  if (fila.devolucionStock === 'solo_perdida')
    return 'Tiene serie o lote: si vuelve, se registra desde Inventario'
  return null
}

/**
 * ¿La fila se puede acreditar en una nota de crédito? **Cualquier ítem vendido**
 * con disponible: desde el 2026-09-04 acreditar dejó de exigir que el ítem
 * pudiera volver al stock; lo que se pregunta por el stock va aparte
 * (`devolucionStock`).
 */
export function filaAcreditable(fila: FilaDevolucion): boolean {
  return new Decimal(fila.disponible).gt(0)
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

  function setStock(itemId: string, valor: DestinoStock) {
    filas.value = setStockFila(filas.value, itemId, valor)
  }

  const filasValidas = computed(() => filasDevolucionValidas(filas.value))
  const faltaDestino = computed(() => faltaDestinoStock(filas.value))
  const devoluciones = computed(() => devolucionesPayload(filas.value))

  return {
    filas,
    cargarDesdeDetalles,
    limpiar,
    setCantidad,
    setStock,
    filasValidas,
    faltaDestino,
    devoluciones,
  }
}
