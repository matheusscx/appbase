import { ref, watch } from 'vue'
import Decimal from 'decimal.js'
import { useCalculoPrecios, type ResultadoVenta, type CalcularVentaInput } from './useCalculoPrecios'
import type { CustomerForm } from '~/components/ventas/ClienteForm.vue'
import type { PersonalizacionPayload } from './useRecetaPersonalizacion'
import {
  aCantidadCanonica,
  desdeCantidadCanonica,
  unidadBaseItem,
  type UnidadCat,
} from '~/utils/cantidad-presentacion'

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
  disponible?: number | null
}

export interface CarritoLinea {
  item: ItemCatalogo
  /** Cantidad canónica (unidad base del ítem) — precio y stock. */
  cantidad: string
  cantidadPresentacion?: string
  unidadCodigoPresentacion?: string
  personalizacion?: PersonalizacionPayload
  /** texto UI precomputado al confirmar drawer */
  personalizacionResumen?: string
  /** base+extras cuando la receta está personalizada */
  precioUnitarioOverride?: string
}

export interface PagoInput {
  metodoPagoId: string
  monto: string
  referencia?: string
}

// ── Helpers de carrito (puros, inmutables) ──────────────────────────────────

function personalizacionVacia(p?: PersonalizacionPayload): boolean {
  if (!p) return true
  return p.omitidos.length === 0 && p.extras.length === 0 && !p.comentario?.trim()
}

function canonicalPersonalizacion(p?: PersonalizacionPayload): string {
  if (!p || personalizacionVacia(p)) return ''
  const omitidos = [...p.omitidos].sort()
  const extras = p.extras.map((e) => `${e.ingredienteItemId}:${e.unidades}`).sort()
  const comentario = p.comentario?.trim() ?? ''
  return JSON.stringify({ omitidos, extras, comentario })
}

export function mismaPersonalizacion(
  a?: PersonalizacionPayload,
  b?: PersonalizacionPayload,
): boolean {
  return canonicalPersonalizacion(a) === canonicalPersonalizacion(b)
}

export function agregarLinea(
  lineas: CarritoLinea[],
  item: ItemCatalogo,
  catalogo: UnidadCat[],
  personalizacion?: PersonalizacionPayload,
  personalizacionResumen?: string,
  precioUnitarioOverride?: string,
): CarritoLinea[] {
  const pers = personalizacionVacia(personalizacion) ? undefined : personalizacion
  const resumen = pers ? personalizacionResumen : undefined
  const precioOverride = pers ? precioUnitarioOverride : undefined
  const unidadBase = unidadBaseItem(item)

  const idx = lineas.findIndex(
    (l) => l.item.id === item.id && mismaPersonalizacion(l.personalizacion, pers),
  )
  if (idx >= 0) {
    const linea = lineas[idx]!
    const unidadPres = linea.unidadCodigoPresentacion ?? unidadBase
    const canonNueva = new Decimal(linea.cantidad || '0').plus(1).toString()
    const presNueva = desdeCantidadCanonica(canonNueva, unidadBase, unidadPres, catalogo)
    return lineas.map((l, i) =>
      i === idx
        ? {
            ...l,
            cantidad: canonNueva,
            cantidadPresentacion: presNueva,
            unidadCodigoPresentacion: unidadPres,
          }
        : l,
    )
  }

  const cantidadPresentacion = '1'
  const unidadCodigoPresentacion = unidadBase
  const cantidad = aCantidadCanonica(
    cantidadPresentacion,
    unidadCodigoPresentacion,
    unidadBase,
    catalogo,
  )

  const nueva: CarritoLinea = {
    item,
    cantidad,
    cantidadPresentacion,
    unidadCodigoPresentacion,
  }
  if (pers) {
    nueva.personalizacion = pers
    if (resumen) nueva.personalizacionResumen = resumen
    if (precioOverride) nueva.precioUnitarioOverride = precioOverride
  }
  return [...lineas, nueva]
}

export function quitarLinea(
  lineas: CarritoLinea[],
  index: number,
): CarritoLinea[] {
  return lineas.filter((_, i) => i !== index)
}

export function setCantidadPresentacion(
  lineas: CarritoLinea[],
  index: number,
  presentacion: string,
  unidadCodigo: string,
  cantidadCanonica: string,
): CarritoLinea[] {
  return lineas.map((l, i) =>
    i === index
      ? {
          ...l,
          cantidad: cantidadCanonica,
          cantidadPresentacion: presentacion,
          unidadCodigoPresentacion: unidadCodigo,
        }
      : l,
  )
}

export function setCantidad(
  lineas: CarritoLinea[],
  index: number,
  cantidad: string,
): CarritoLinea[] {
  return lineas.map((l, i) => (i === index ? { ...l, cantidad } : l))
}

export function toCalcularInput(lineas: CarritoLinea[]): CalcularVentaInput {
  return {
    lineas: lineas.map((l) => ({
      itemId: l.item.id,
      cantidad: l.cantidad,
      ...(l.cantidadPresentacion && l.unidadCodigoPresentacion
        ? {
            cantidadPresentacion: l.cantidadPresentacion,
            unidadCodigoPresentacion: l.unidadCodigoPresentacion,
          }
        : {}),
      ...(l.precioUnitarioOverride
        ? { precioUnitario: l.precioUnitarioOverride }
        : {}),
    })),
  }
}

export function toVentaLineasBody(lineas: CarritoLinea[]) {
  return lineas.map((l) => ({
    itemId: l.item.id,
    cantidad: l.cantidad,
    ...(l.cantidadPresentacion && l.unidadCodigoPresentacion
      ? {
          cantidadPresentacion: l.cantidadPresentacion,
          unidadCodigoPresentacion: l.unidadCodigoPresentacion,
        }
      : {}),
    ...(l.personalizacion
      ? {
          personalizacion: {
            omitidos: l.personalizacion.omitidos,
            extras: l.personalizacion.extras.map((e) => ({
              ingredienteItemId: e.ingredienteItemId,
              unidades: e.unidades,
            })),
            ...(l.personalizacion.comentario
              ? { comentario: l.personalizacion.comentario }
              : {}),
          },
        }
      : {}),
  }))
}

/**
 * Descuenta del catálogo cantidades reservadas/vendidas (sin recargar desde API).
 * Productos: baja `stock`. Recetas: baja `disponible` (porciones).
 * Acepta líneas de carrito o de cuenta (`{ item: { id }, cantidad }`).
 */
export function descontarStockCatalogo(
  items: ItemCatalogo[],
  lineas: { item: { id: string }, cantidad: string }[],
): ItemCatalogo[] {
  if (lineas.length === 0) return items

  const vendidoPorItem = new Map<string, Decimal>()
  for (const linea of lineas) {
    const prev = vendidoPorItem.get(linea.item.id) ?? new Decimal(0)
    vendidoPorItem.set(linea.item.id, prev.plus(linea.cantidad || '0'))
  }

  return items.map((item) => {
    const vendido = vendidoPorItem.get(item.id)
    if (!vendido) return item

    let next = item
    if (item.stock !== null && item.stock !== '') {
      try {
        next = {
          ...next,
          stock: Decimal.max(0, new Decimal(item.stock).minus(vendido)).toString(),
        }
      }
      catch { /* mantener stock */ }
    }
    if (item.disponible !== null && item.disponible !== undefined) {
      try {
        next = {
          ...next,
          disponible: Decimal.max(0, new Decimal(item.disponible).minus(vendido))
            .floor()
            .toNumber(),
        }
      }
      catch { /* mantener disponible */ }
    }
    return next
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

export type { CustomerForm }

export function tieneCustomerData(customer: CustomerForm): boolean {
  return Boolean(customer.nombre.trim() || customer.terceroId)
}

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
  const unidadesStore = useUnidadesMedidaStore()
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

  function catalogo(): UnidadCat[] {
    return unidadesStore.unidades.map(u => ({
      codigo: u.codigo,
      magnitud: u.magnitud,
      factorBase: u.factorBase,
    }))
  }

  function add(
    item: ItemCatalogo,
    personalizacion?: PersonalizacionPayload,
    personalizacionResumen?: string,
    precioUnitarioOverride?: string,
  ) {
    lineas.value = agregarLinea(
      lineas.value,
      item,
      catalogo(),
      personalizacion,
      personalizacionResumen,
      precioUnitarioOverride,
    )
  }
  function quitar(index: number) {
    lineas.value = quitarLinea(lineas.value, index)
  }
  function cambiarCantidadPresentacion(
    index: number,
    presentacion: string,
    unidadCodigo: string,
    cantidadCanonica: string,
  ) {
    lineas.value = setCantidadPresentacion(
      lineas.value,
      index,
      presentacion,
      unidadCodigo,
      cantidadCanonica,
    )
  }
  function cambiarCantidad(index: number, cantidad: string) {
    lineas.value = setCantidad(lineas.value, index, cantidad)
  }
  function limpiar() {
    lineas.value = []
    resultado.value = null
  }

  return {
    lineas,
    resultado,
    loadingCalculo,
    add,
    quitar,
    cambiarCantidad,
    cambiarCantidadPresentacion,
    limpiar,
  }
}
