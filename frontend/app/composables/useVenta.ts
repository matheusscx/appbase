import { ref } from 'vue'
import Decimal from 'decimal.js'
import { useResultadoCalculado, type CalcularVentaInput } from './useCalculoPrecios'
import type { CustomerForm } from '~/components/ventas/ClienteForm.vue'
import {
  personalizacionVacia,
  type PersonalizacionPayload,
} from './useRecetaPersonalizacion'
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
  /** Un ítem pausado (`false`) no se ofrece en ningún catálogo de venta. */
  activo: boolean
  disponible?: number | null
  /** Combos con al menos un grupo de modificadores asociado: la disponibilidad final depende de la opción elegida. */
  disponibleCondicional?: boolean
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
}

export interface PagoInput {
  metodoPagoId: string
  monto: string
  referencia?: string
}

// ── Helpers de carrito (puros, inmutables) ──────────────────────────────────

/** Serializa `grupos` de forma determinística (mismo orden para top-level y por componente). */
function canonicalGrupos(grupos?: PersonalizacionPayload['grupos']) {
  return [...(grupos ?? [])]
    .map((g) => ({
      grupoId: g.grupoId,
      opciones: [...g.opciones].map((o) => `${o.itemId}:${o.unidades}`).sort(),
    }))
    .sort((a, b) => a.grupoId.localeCompare(b.grupoId))
}

function canonicalPersonalizacion(p?: PersonalizacionPayload): string {
  if (!p || personalizacionVacia(p)) return ''
  const omitidos = [...p.omitidos].sort()
  const extras = p.extras.map((e) => `${e.ingredienteItemId}:${e.unidades}`).sort()
  const comentario = p.comentario?.trim() ?? ''
  // Dos combos con distinta opción elegida en un grupo (p. ej. bebida distinta)
  // nunca deben fusionarse en la misma línea del carrito.
  const grupos = canonicalGrupos(p.grupos)
  // Combos con componentes (p. ej. burger #1 con chuleta vs burger #1 con carne)
  // tampoco deben fusionarse si la elección de grupo por componente difiere.
  const componentes = [...(p.componentes ?? [])]
    .map((c) => ({
      componenteItemId: c.componenteItemId,
      unidad: c.unidad,
      grupos: canonicalGrupos(c.grupos),
    }))
    .sort((a, b) => a.componenteItemId.localeCompare(b.componenteItemId) || a.unidad - b.unidad)
  return JSON.stringify({ omitidos, extras, comentario, grupos, componentes })
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
): CarritoLinea[] {
  const pers = personalizacionVacia(personalizacion) ? undefined : personalizacion
  const resumen = pers ? personalizacionResumen : undefined
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

/**
 * La personalización tal como la esperan los dos endpoints, en un solo lugar.
 *
 * Que `toCalcularInput` y `toVentaLineasBody` manden **exactamente la misma
 * forma** no es prolijidad: desde el 2026-08-30 el precio de una línea
 * personalizada lo calcula el servidor a partir de esto, así que si las dos
 * formas divergen, la pantalla y el cobro tasan cosas distintas. Antes divergían
 * a propósito —el preview mandaba un `precioUnitario` calculado acá y la venta
 * mandaba la personalización—, y esa era justamente la grieta: el precio
 * viajaba sin convertir a moneda oficial.
 */
function personalizacionBody(p: PersonalizacionPayload) {
  return {
    omitidos: p.omitidos,
    extras: p.extras.map((e) => ({
      ingredienteItemId: e.ingredienteItemId,
      unidades: e.unidades,
    })),
    ...(p.comentario ? { comentario: p.comentario } : {}),
    ...(p.grupos?.length ? { grupos: p.grupos } : {}),
    ...(p.componentes?.length ? { componentes: p.componentes } : {}),
  }
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
      ...(l.personalizacion
        ? { personalizacion: personalizacionBody(l.personalizacion) }
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
      ? { personalizacion: personalizacionBody(l.personalizacion) }
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
  /**
   * Permiso `Ventas:Crear`, el que exige `POST /ventas`. Va acá y no en un
   * `v-if` aparte porque el cobro ya estaba condicionado por estado: un solo
   * lugar decide si el botón se puede apretar. Opcional para no romper a los
   * llamadores que ya validaban solo estado.
   */
  puedeVender?: boolean
  tieneCaja: boolean
  lineas: CarritoLinea[]
  customerRequerido: boolean
  customerExpandido: boolean
  customerNombre: string
  tipoDocumentoId: string | undefined
}): boolean {
  if (args.puedeVender === false) return false
  if (!args.tieneCaja) return false
  if (args.lineas.length === 0) return false
  if (!args.tipoDocumentoId) return false
  if ((args.customerRequerido || args.customerExpandido) && args.customerNombre.trim() === '') return false
  return true
}

// ── Composable reactivo con estado y recálculo ──────────────────────────────

export function useVenta() {
  const unidadesStore = useUnidadesMedidaStore()
  const lineas = ref<CarritoLinea[]>([])

  const {
    resultado,
    loading: loadingCalculo,
    vigente,
    asegurarVigente,
    limpiar: limpiarResultado,
  } = useResultadoCalculado(() => toCalcularInput(lineas.value), { debounceMs: 300 })

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
  ) {
    lineas.value = agregarLinea(
      lineas.value,
      item,
      catalogo(),
      personalizacion,
      personalizacionResumen,
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
    limpiarResultado()
  }

  return {
    lineas,
    resultado,
    loadingCalculo,
    vigente,
    asegurarVigente,
    add,
    quitar,
    cambiarCantidad,
    cambiarCantidadPresentacion,
    limpiar,
  }
}
