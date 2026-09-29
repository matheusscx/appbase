import Decimal from 'decimal.js'
import { formatStockCantidad } from '~/utils/stock-format'
import { formatCostoDisplay } from '~/utils/currency-format'
import type { MonedaDisplayConfig } from '~/types/moneda'

/** Los tres estados de `compras.estado`: espejo de `EstadoCompra` del backend
 *  (`backend/src/modules/compras/entities/compra.entity.ts`). */
export type EstadoCompra = 'borrador' | 'confirmada' | 'anulada'

type ColorInsignia = 'neutral' | 'success' | 'error' | 'warning'

const ETIQUETA: Record<EstadoCompra, string> = {
  borrador: 'Borrador',
  confirmada: 'Confirmada',
  anulada: 'Anulada',
}

const COLOR: Record<EstadoCompra, ColorInsignia> = {
  borrador: 'neutral',
  confirmada: 'success',
  anulada: 'error',
}

/** La presentación de una línea del detalle: espejo de `PresentacionLinea` del
 *  backend (pieza 2 § 5). Borrador: la viva, en su unidad. Confirmada: lo
 *  congelado, en la unidad base. */
export interface PresentacionLinea {
  id: string
  nombre: string
  contenido: string
  unidadCodigo: string
}

/** Una presentación de compra (pieza 2 § 3.1): "Caja" de 12 unidad, por
 *  (proveedor, producto). Espejo de `PresentacionCompraVista` del backend. */
export interface PresentacionCompra {
  id: string
  itemId: string
  nombre: string
  contenido: string
  unidadCodigo: string
}

/** Una línea del detalle: espejo de `CompraLineaDetalle` del backend. */
export interface LineaCompra {
  id: string
  orden: number
  itemId: string
  itemNombre: string | null
  modoInventario: string | null
  unidadMedidaBase: string | null
  cantidad: string
  /** Null si la línea va en una presentación (pieza 2 § 3.2). */
  unidadCodigo: string | null
  precioUnitario: string | null
  series: { serie: string }[] | null
  lote: { codigoLote: string, fechaVencimiento?: string } | null
  presentacion: PresentacionLinea | null
}

/** Una fila del historial de correcciones (spec § 3.5). */
export interface CambioCompra {
  compraLineaId: string
  campo: string
  valorAnterior: string | null
  valorNuevo: string | null
  usuarioNombre: string | null
  creadoEl: string
}

/** Espejo de `EstadoPagoCompra` del backend (`compras/deuda.ts`, spec § 4.1). */
export type EstadoPagoCompra = 'pagada' | 'parcial' | 'pendiente' | 'falta_total' | 'falta_precio'

/** Lo aplicado de un pago a una compra: espejo de `AplicacionPagoInfo`. */
export interface AplicacionPagoInfo {
  compraId: string
  monto: string
}

/** Un pago a proveedor, con sus aplicaciones: espejo de `PagoProveedorInfo` (spec § 3 y § 8). */
export interface PagoProveedorInfo {
  /** `null` cuando el pago fue "usar el saldo a favor" (spec § 5.1): no se creó fila. */
  id: string | null
  proveedorId: string
  fecha: string | null
  monto: string
  metodoPagoId: string | null
  metodoPagoNombre: string | null
  referencia: string | null
  cajaId: string | null
  estado: 'vigente' | 'anulado' | null
  anuladoPor: string | null
  anuladoEl: string | null
  motivoAnulacion: string | null
  aplicaciones: AplicacionPagoInfo[]
  /** Lo que quedó a favor del proveedor DESPUÉS de este pago. */
  sobranteAFavor: string
}

/** El detalle de `GET /compras/:id`: espejo de `CompraDetalle` del backend. */
export interface CompraDetalle {
  id: string
  estado: EstadoCompra
  faltaCosto: boolean
  fechaDocumento: string
  proveedorId: string
  proveedorNombre: string | null
  tipoDocumentoCompraId: string
  tipoDocumentoNombre: string | null
  folio: string | null
  ubicacionId: string
  ubicacionNombre: string | null
  observacion: string | null
  descuentoTotal: string | null
  motivoAnulacion: string | null
  total: string | null
  /** Lo transcrito, tal cual (null en un tipo `suma_lineas`, o si no se cargó). */
  totalDocumento: string | null
  /** Se fija al confirmar; null en un borrador. */
  fechaVencimiento: string | null
  lineas: LineaCompra[]
  cambios: CambioCompra[]
  /**
   * Los datos de pago (spec § 8, decisión 12): presentes SOLO con
   * `Compras:Pagar` — el backend los omite (`undefined`, nunca `null`) para
   * quien no tiene el permiso, así que acá siempre se chequea con `!=
   * undefined`/`v-if`, nunca se asume presente.
   */
  estadoPago?: EstadoPagoCompra
  deuda?: string | null
  vencida?: boolean
  /** Σ aplicaciones vivas de pagos vigentes a esta compra. */
  aplicado?: string
  /** Los pagos vigentes que aplicaron algo a esta compra. */
  pagos?: PagoProveedorInfo[]
}

/** Espejo de `TipoDocumentoCompraOpcion.totalDocumento` (spec compras-deuda-proveedor § 3, decisión 10). */
export type TotalDocumentoTipo = 'suma_lineas' | 'obligatorio' | 'opcional'

const ETIQUETA_CAMBIO: Record<string, string> = {
  precio: 'Precio',
  cantidad: 'Cantidad',
  descuento: 'Descuento al total',
}

/** Un número tipeable: dígitos con punto decimal opcional, sin coma a medias. */
const NUMERO = /^\d+(\.\d+)?$/

function comoDecimal(valor: string | null | undefined): Decimal | null {
  if (valor == null) return null
  const limpio = valor.trim()
  return NUMERO.test(limpio) ? new Decimal(limpio) : null
}

/**
 * Lo que la pantalla de Compras calcula para mostrar.
 *
 * ⚠️ Los totales de acá **no son el costo**: son para que el encargado los
 * compare con el papel. El costo lo calcula el servidor al confirmar (conversión
 * de unidad y descuento repartido), por eso estos números no redondean.
 *
 * Las opciones del filtro de estado se **derivan** del mapa de etiquetas, como
 * en `useEstadoVenta`: ofrecer un estado que el backend no conoce falla recién
 * con el 400 del `@IsIn` del listado.
 */
export function useCompras() {
  function totalLinea(cantidad: string, precioUnitario: string | null): string | null {
    const c = comoDecimal(cantidad)
    const p = comoDecimal(precioUnitario)
    if (!c || !p) return null
    return c.times(p).toString()
  }

  function subtotal(lineas: { cantidad: string, precioUnitario: string | null }[]): string | null {
    let suma = new Decimal(0)
    for (const l of lineas) {
      const t = totalLinea(l.cantidad, l.precioUnitario)
      if (t == null) return null
      suma = suma.plus(t)
    }
    return suma.toString()
  }

  /**
   * El total del pie: subtotal menos el descuento al total. Null si falta el
   * subtotal (alguna línea sin precio); un descuento vacío no descuenta.
   */
  function totalConDescuento(subtotalCompra: string | null, descuento: string | null): string | null {
    if (subtotalCompra == null) return null
    const d = comoDecimal(descuento)
    return new Decimal(subtotalCompra).minus(d ?? 0).toString()
  }

  /**
   * Cuánto cambia la cantidad de una línea: si sube o baja, y cuánto. Lo usa
   * la corrección en serie, que al subir pide las series nuevas y al bajar
   * cuáles salen. Null si la nueva no es un número positivo o es la misma.
   */
  function diferenciaCantidad(actual: string, nueva: string): { sube: boolean, cuanto: string } | null {
    const a = comoDecimal(actual)
    const n = comoDecimal(nueva)
    if (!a || !n || n.lessThanOrEqualTo(0) || n.equals(a)) return null
    return { sube: n.greaterThan(a), cuanto: n.minus(a).abs().toString() }
  }

  /**
   * El body de `PATCH /compras/:id/lineas/:lineaId` (spec § 4.4): solo lo que
   * cambió, porque el backend trata la clave ausente como "no se toca" y
   * rechaza el mismo valor. Null si no cambió nada o lo tipeado no es un
   * número: no hay nada que mandar.
   */
  function cuerpoCorreccion(
    actual: { cantidad: string, precioUnitario: string | null },
    nuevo: { cantidad: string, precioUnitario: string },
    serie: { series?: string[], unidadIds?: string[] } = {},
  ): Record<string, unknown> | null {
    const body: Record<string, unknown> = {}
    const precio = comoDecimal(nuevo.precioUnitario)
    if (precio && (actual.precioUnitario == null || !precio.equals(actual.precioUnitario))) {
      body.precioUnitario = nuevo.precioUnitario.trim()
    }
    if (diferenciaCantidad(actual.cantidad, nuevo.cantidad)) {
      body.cantidad = nuevo.cantidad.trim()
      if (serie.series?.length) body.series = serie.series.map(s => ({ serie: s }))
      if (serie.unidadIds?.length) body.unidadIds = serie.unidadIds
    }
    return Object.keys(body).length ? body : null
  }

  /**
   * El pedazo del body de `POST`/`PATCH /compras` para `totalDocumento` y
   * `fechaVencimiento` (spec compras-deuda-proveedor § 3 y § 4.2, Ruling 1).
   * Vacío es "todavía no se sabe" / "se calcula al confirmar" — el 400 de un
   * tipo `suma_lineas` con total lo da el backend, acá solo se arma lo que
   * hay tipeado.
   */
  function cuerpoDocumento(form: {
    totalDocumento: string
    fechaVencimiento: string
  }): { totalDocumento: string | null, fechaVencimiento: string | null } {
    return {
      totalDocumento: form.totalDocumento.trim() || null,
      fechaVencimiento: form.fechaVencimiento || null,
    }
  }

  /**
   * El body de `PATCH /compras/:id/documento` (spec § 6): solo lo que
   * cambió — ausente es "no se toca" para el backend, así que mandar el
   * mismo valor de nuevo (o nada) no tiene que viajar. Comparado en
   * `Decimal`, no como string: lo que llega de `GET` es `numeric(18,4)`
   * ("119000.0000") y lo que se tipea no lo es.
   *
   * `totalDocumento: null` solo cuando el tipo es `opcional` (decisión 10):
   * es la única forma de "borrarlo" — en un tipo `obligatorio` vaciar el
   * campo no manda nada, porque el backend lo exige.
   */
  function cuerpoActualizarDocumento(
    actual: { totalDocumento: string | null, fechaVencimiento: string | null },
    nuevo: { totalDocumento: string, fechaVencimiento: string },
    totalDocumentoOpcional: boolean,
  ): Record<string, unknown> | null {
    const body: Record<string, unknown> = {}
    const nuevoTotal = comoDecimal(nuevo.totalDocumento)
    const actualTotal = comoDecimal(actual.totalDocumento)
    if (nuevoTotal) {
      if (!actualTotal || !nuevoTotal.equals(actualTotal)) body.totalDocumento = nuevo.totalDocumento.trim()
    } else if (totalDocumentoOpcional && actual.totalDocumento != null && !nuevo.totalDocumento.trim()) {
      body.totalDocumento = null
    }
    if (nuevo.fechaVencimiento && nuevo.fechaVencimiento !== (actual.fechaVencimiento ?? '')) {
      body.fechaVencimiento = nuevo.fechaVencimiento
    }
    return Object.keys(body).length ? body : null
  }

  /**
   * La sugerencia de "Vence el" (spec § 4.2): `fechaDocumento` + el plazo del
   * proveedor, o 30 días si no tiene uno cargado — espejo en JS de
   * `backend/src/modules/compras/deuda.ts → vencimiento`, sin la fecha
   * tipeada (acá es solo la sugerencia inicial; editarla después es cosa del
   * encargado). Null si `fechaDocumento` no tiene forma de fecha.
   *
   * Por COMPONENTES locales, nunca `toISOString()` (invariante
   * `fecha-local.invariant.spec.ts`): una fecha pura no lleva zona, así que
   * se arma y se lee con `get*`/`set*` locales, igual que `hoyLocal`.
   */
  function fechaVencimientoSugerida(fechaDocumento: string, plazoPagoDias: number | null): string | null {
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaDocumento)
    if (!partes) return null
    const [, anio, mes, dia] = partes.map(Number)
    const fecha = new Date(anio!, mes! - 1, dia!)
    fecha.setDate(fecha.getDate() + (plazoPagoDias ?? 30))
    const mesTexto = String(fecha.getMonth() + 1).padStart(2, '0')
    const diaTexto = String(fecha.getDate()).padStart(2, '0')
    return `${fecha.getFullYear()}-${mesTexto}-${diaTexto}`
  }

  /**
   * El body de `PATCH /compras/:id/descuento`. La clave va siempre, porque el
   * backend la exige y `null` quita el descuento; vacío es null. Null (sin
   * body) si lo tipeado no es un número o es igual al vigente.
   */
  function cuerpoDescuento(actual: string | null, tipeado: string): { descuentoTotal: string | null } | null {
    const texto = tipeado.trim()
    const nuevo = texto ? comoDecimal(texto) : new Decimal(0)
    if (!nuevo) return null
    if (nuevo.equals(new Decimal(actual ?? 0))) return null
    return { descuentoTotal: texto || null }
  }

  /**
   * La cantidad de una línea para leer: sin los ceros de la columna
   * `numeric(18,4)` y con coma ("20,35 kg", "10 unidad"). Siempre con la
   * unidad de la línea, que es la de la factura, no la del catálogo.
   *
   * No usa `useFormatters().formatStock`, que consulta el catálogo para saber
   * si la unidad es fraccionaria y omite la unidad de conteo: acá la unidad se
   * muestra siempre, y este composable no depende de un store. Una cantidad
   * entera sale igual sin decimales, porque solo se sacan los ceros sobrantes.
   */
  function cantidadConUnidad(cantidad: string, unidad: string): string {
    return `${formatStockCantidad(cantidad, true)} ${unidad}`
  }

  /** La cantidad para un input: "10", no "10.0000", con punto decimal. */
  function cantidadParaEditar(cantidad: string): string {
    const c = comoDecimal(cantidad)
    return c ? c.toString() : cantidad
  }

  /**
   * La etiqueta que ve el encargado (pieza 2 § 3.1): "Caja (12)" si la unidad
   * es `unidad` (no tiene sentido repetirla), "Saco (25 kg)" si no. El
   * contenido se muestra sin ceros de más, con coma — mismo formato que
   * `cantidadConUnidad`.
   */
  function etiquetaPresentacion(p: { nombre: string, contenido: string, unidadCodigo: string }): string {
    const contenido = formatStockCantidad(p.contenido, true)
    return p.unidadCodigo === 'unidad'
      ? `${p.nombre} (${contenido})`
      : `${p.nombre} (${contenido} ${p.unidadCodigo})`
  }

  /**
   * La unidad de una línea, para mostrar: la etiqueta de su presentación si
   * tiene una, si no su `unidadCodigo`, y vacío si no tiene ninguna (un
   * borrador cuya presentación fue retirada — pieza 2 § 4.4).
   */
  function unidadDeLinea(l: {
    unidadCodigo: string | null
    presentacion: { nombre: string, contenido: string, unidadCodigo: string } | null
  }): string {
    if (l.presentacion) return etiquetaPresentacion(l.presentacion)
    return l.unidadCodigo ?? ''
  }

  /**
   * La cuenta a la vista bajo una línea en presentación (pieza 2 § 6): cuánto
   * entra en la unidad base y cuánto cuesta cada una. ⚠️ NO es el costo — lo
   * calcula el servidor al confirmar, con la conversión de unidad y el
   * descuento repartido —, así que esto no cuantiza a la escala de la moneda:
   * es un costo por unidad (una tasa de solo lectura), y sus decimales son el
   * piso, no el techo (`formatCostoDisplay`, mismo criterio que el costo por
   * unidad elegida del ajuste de stock). `monedaOficial` viaja como
   * parámetro —la config, no el store— para que este composable siga sin
   * depender de Pinia: sin ella (todavía no cargó) se omite el costo, igual
   * que sin precio. Null si la cantidad no es un número.
   */
  function cuentaPresentacion(
    cantidad: string,
    contenido: string,
    unidad: string,
    precio: string | null,
    monedaOficial: MonedaDisplayConfig | null,
  ): string | null {
    const c = comoDecimal(cantidad)
    const cont = comoDecimal(contenido)
    if (!c || !cont) return null
    const totalBase = c.times(cont)
    let texto = `= ${cantidadConUnidad(totalBase.toString(), unidad)}`
    const p = comoDecimal(precio)
    if (p && monedaOficial) {
      const costoUnidad = p.div(cont)
      texto += ` · ${formatCostoDisplay(costoUnidad, monedaOficial)} c/u`
    }
    return texto
  }

  /**
   * La cantidad de una línea confirmada, para leer (pieza 2 § 6): "10 Caja
   * (12) · 120 unidad" si va en presentación (lo congelado ya está en la
   * unidad base, así que solo hace falta multiplicar), o "20,35 kg" si va en
   * una unidad simple.
   */
  function cantidadLineaConfirmada(l: {
    cantidad: string
    unidadCodigo: string | null
    presentacion: { nombre: string, contenido: string, unidadCodigo: string } | null
    unidadMedidaBase: string | null
  }): string {
    const base = cantidadConUnidad(l.cantidad, unidadDeLinea(l))
    if (!l.presentacion || !l.unidadMedidaBase) return base
    const c = comoDecimal(l.cantidad)
    const cont = comoDecimal(l.presentacion.contenido)
    if (!c || !cont) return base
    return `${base} · ${cantidadConUnidad(c.times(cont).toString(), l.unidadMedidaBase)}`
  }

  /** "Precio", "Cantidad" o "Descuento al total", para el historial. */
  function etiquetaCambio(campo: string): string {
    return ETIQUETA_CAMBIO[campo] ?? campo
  }

  /** El 0 es un precio (el regalo); el vacío no. */
  function faltaAlgunPrecio(lineas: { precioUnitario: string | null }[]): boolean {
    return lineas.some(l => comoDecimal(l.precioUnitario) == null)
  }

  function insigniaEstado(c: { estado: EstadoCompra, faltaCosto: boolean }) {
    const insignias: { label: string, color: ColorInsignia }[] = [
      { label: ETIQUETA[c.estado] ?? c.estado, color: COLOR[c.estado] ?? 'neutral' },
    ]
    if (c.faltaCosto) insignias.push({ label: 'Falta costo', color: 'warning' })
    return insignias
  }

  /**
   * La insignia de pago (spec § 4.1 y § 10): "Vencida" pisa a las demás —
   * queda deuda (o el total ni se sabe) y ya pasó el vencimiento, así que es
   * lo más urgente. Solo tiene sentido con `Compras:Pagar` (decisión 12):
   * quien no lo tiene ni recibe `estadoPago` en la respuesta.
   */
  function insigniaPago(
    c: { estadoPago: EstadoPagoCompra, deuda: string | null, vencida: boolean },
    formatMonto: (v: string) => string,
  ): { label: string, color: ColorInsignia } {
    if (c.vencida) return { label: 'Vencida', color: 'error' }
    switch (c.estadoPago) {
      case 'pagada':
        return { label: 'Pagada', color: 'success' }
      case 'parcial':
        return { label: `Te faltan ${formatMonto(c.deuda ?? '0')}`, color: 'warning' }
      case 'falta_total':
        return { label: 'Falta el total', color: 'neutral' }
      case 'falta_precio':
        return { label: 'Falta el precio', color: 'neutral' }
      default:
        return { label: 'Pendiente de pago', color: 'warning' }
    }
  }

  const estadoOptions = (Object.keys(ETIQUETA) as EstadoCompra[]).map(value => ({
    label: ETIQUETA[value],
    value,
  }))

  return {
    totalLinea,
    subtotal,
    totalConDescuento,
    faltaAlgunPrecio,
    insigniaEstado,
    insigniaPago,
    estadoOptions,
    diferenciaCantidad,
    cuerpoCorreccion,
    cuerpoDescuento,
    cuerpoDocumento,
    cuerpoActualizarDocumento,
    fechaVencimientoSugerida,
    cantidadConUnidad,
    cantidadParaEditar,
    etiquetaCambio,
    etiquetaPresentacion,
    unidadDeLinea,
    cuentaPresentacion,
    cantidadLineaConfirmada,
  }
}
