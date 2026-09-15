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
  /** Bruto de la línea, con descuentos y recargos ya adentro. */
  totalLinea: string
}

export interface FilaDevolucion {
  itemId: string
  descripcion: string
  disponible: string
  modoInventario: string | null
  cantidad: string
  /** ¿El ítem admite volver al inventario? Solo `modo_inventario = 'cantidad'`. */
  puedeReponer: boolean
  /**
   * ¿Esta fila vuelve al stock? Arranca en lo que el ítem puede, que es la
   * conducta de antes de que existiera el campo. En una nota de crédito se
   * puede apagar: acreditar y reponer dejaron de ser lo mismo (2026-09-04).
   */
  reponerStock: boolean
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
      const puedeReponer = d.modoInventario === 'cantidad'
      porItem.set(d.itemId, {
        itemId: d.itemId,
        descripcion: d.descripcion ?? d.itemId,
        disponible: new Decimal(d.cantidad).minus(d.cantidadDevuelta).toString(),
        modoInventario: d.modoInventario,
        cantidad: '',
        puedeReponer,
        reponerStock: puedeReponer,
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

export function setReponerFila(
  filas: FilaDevolucion[],
  itemId: string,
  valor: boolean,
): FilaDevolucion[] {
  // Solo donde el ítem puede: encender la reposición de una receta manda al
  // backend un pedido que rechaza con 400, y el switch de esa fila está
  // deshabilitado justamente para que no pase.
  return filas.map(f =>
    f.itemId === itemId && f.puedeReponer ? { ...f, reponerStock: valor } : f,
  )
}

/**
 * Deja las filas como las necesita el camino que SOLO mueve stock. Lo usa el
 * modal de reembolso cuando se destilda "generar nota de crédito": sin
 * documento que las acredite, esas líneas van a `registrarDevolucionesPorReembolso`,
 * que **exige que toda línea reponga** y rechaza con 400 lo que no.
 *
 * Ese 400 llega DESPUÉS del commit del reembolso —la plata ya volvió al
 * cliente— y se degrada a warning: quedaría un reembolso hecho, mercadería que
 * nunca vuelve al stock y ningún camino de reintento. Por eso se normaliza acá
 * y no se confía en que el operador lo note.
 *
 * ⚠️ Son DOS cosas, y filtrar solo por `puedeReponer` deja pasar la peor: una
 * fila que **puede** reponer pero que el operador apagó con el switch. Al
 * destildar, el switch desaparece del DOM, así que ese `false` quedaba
 * invisible e irrecuperable desde la pantalla.
 *
 * - La que puede reponer vuelve a reponer —en este camino no hay nada que
 *   elegir— y conserva la cantidad tipeada.
 * - La que no puede pierde la cantidad: no tiene nada que hacer acá.
 */
export function normalizarParaSoloStock(
  filas: FilaDevolucion[],
): FilaDevolucion[] {
  return filas.map(f =>
    f.puedeReponer
      ? { ...f, reponerStock: true }
      : { ...f, cantidad: '', reponerStock: false },
  )
}

/**
 * ¿La fila admite que se le tipee una cantidad, en el camino que la va a
 * recibir? Vive acá y no suelta en el `.vue` porque es la única decisión de
 * negocio del componente compartido: qué se puede acreditar no es lo mismo que
 * qué se puede devolver a stock.
 */
export function filaEditable(
  fila: FilaDevolucion,
  modo: 'acredita' | 'solo-stock',
): boolean {
  return modo === 'acredita' ? filaAcreditable(fila) : filaDevolvible(fila)
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

export function devolucionesPayload(
  filas: FilaDevolucion[],
): { itemId: string, cantidad: string, reponerStock: boolean }[] {
  return filas
    .filter(f => f.cantidad && esDecimalValido(f.cantidad) && new Decimal(f.cantidad).gt(0))
    .map(f => ({ itemId: f.itemId, cantidad: f.cantidad, reponerStock: f.reponerStock }))
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

export function notaDevolucion(fila: FilaDevolucion): string | null {
  if (fila.modoInventario === null) return 'Servicio: no vuelve al stock'
  if (fila.modoInventario !== 'cantidad')
    return `Modo ${fila.modoInventario}: la vuelta al stock se registra desde Inventario`
  return null
}

/**
 * ¿La fila se puede acreditar en una nota de crédito? **Cualquier ítem vendido**
 * con disponible: desde el 2026-09-04 acreditar dejó de exigir que el ítem
 * pudiera volver al stock, y lo que `modoInventario` decide es solo si el switch
 * de reposición está disponible.
 */
export function filaAcreditable(fila: FilaDevolucion): boolean {
  return new Decimal(fila.disponible).gt(0)
}

/**
 * ¿La fila se puede mandar por el camino que SOLO mueve stock (reembolso sin
 * nota de crédito)? Ahí sigue haciendo falta que el ítem pueda reponer: no hay
 * documento que acredite lo que no vuelve.
 */
export function filaDevolvible(fila: FilaDevolucion): boolean {
  return fila.puedeReponer && new Decimal(fila.disponible).gt(0)
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

  function setReponer(itemId: string, valor: boolean) {
    filas.value = setReponerFila(filas.value, itemId, valor)
  }

  function normalizarSoloStock() {
    filas.value = normalizarParaSoloStock(filas.value)
  }

  const filasValidas = computed(() => filasDevolucionValidas(filas.value))
  const devoluciones = computed(() => devolucionesPayload(filas.value))

  return {
    filas,
    cargarDesdeDetalles,
    limpiar,
    setCantidad,
    setReponer,
    normalizarSoloStock,
    filasValidas,
    devoluciones,
  }
}
