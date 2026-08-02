import Decimal from 'decimal.js'
import { formatStock, formatStockCantidad } from './stock-format'

export type UnidadCat = { codigo: string, magnitud: string, factorBase: string }

function buscar(catalogo: UnidadCat[], codigo: string): UnidadCat | undefined {
  return catalogo.find(u => u.codigo === codigo)
}

export function esConteo(unidadCodigo: string, catalogo: UnidadCat[]): boolean {
  const u = buscar(catalogo, unidadCodigo)
  return u?.magnitud === 'conteo'
}

export function opcionesMismaMagnitud(
  unidadBase: string,
  catalogo: UnidadCat[],
): UnidadCat[] {
  const base = buscar(catalogo, unidadBase)
  if (!base) return catalogo.filter(u => u.codigo === unidadBase)
  return catalogo.filter(u => u.magnitud === base.magnitud)
}

export function convertirPresentacion(
  cantidad: string,
  desde: string,
  hacia: string,
  catalogo: UnidadCat[],
): string {
  if (desde === hacia) return cantidad
  const uDesde = buscar(catalogo, desde)
  const uHacia = buscar(catalogo, hacia)
  if (!uDesde || !uHacia || uDesde.magnitud !== uHacia.magnitud) {
    throw new Error(`No se puede convertir de ${desde} a ${hacia}`)
  }
  return new Decimal(cantidad)
    .mul(uDesde.factorBase)
    .div(uHacia.factorBase)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toString()
}

export function aCantidadCanonica(
  presentacion: string,
  unidadPres: string,
  unidadBase: string,
  catalogo: UnidadCat[],
): string {
  return convertirPresentacion(presentacion, unidadPres, unidadBase, catalogo)
}

export function desdeCantidadCanonica(
  canonica: string,
  unidadBase: string,
  unidadPres: string,
  catalogo: UnidadCat[],
): string {
  return convertirPresentacion(canonica, unidadBase, unidadPres, catalogo)
}

export function puedeDecrementar(
  presentacion: string,
  unidadPres: string,
  catalogo: UnidadCat[],
): boolean {
  let val: Decimal
  try {
    val = new Decimal(presentacion)
  } catch {
    return false
  }
  if (esConteo(unidadPres, catalogo)) {
    return val.greaterThan(1)
  }
  return val.greaterThan(1)
}

/**
 * Formatea la cantidad para tickets (comanda/precuenta/boleta) según su magnitud —
 * delega en `formatStock` (mismo formateador que usa el resto de la UI para stock)
 * para no duplicar el recorte de decimales ni el separador decimal es-CL (coma).
 * `esFraccionaria` la calcula el caller (ej.
 * `unidadesMedidaStore.esFraccionaria(unidadCodigo)`), para mantener este util
 * libre de dependencias de Pinia/Nuxt.
 */
export function formatCantidadTicket(
  cantidad: string,
  unidadCodigo: string | null | undefined,
  esFraccionaria: boolean,
): string {
  // Sin unidad NO se devuelve el string crudo: `1.0000` no es una cantidad
  // legible. Se recorta igual, solo que sin sufijo. `true` porque sin unidad no
  // se puede saber si la magnitud es de conteo, y recortar ceros nunca inventa
  // precisión —para un entero da lo mismo que redondear—.
  if (!unidadCodigo) return formatStockCantidad(cantidad, true)
  return formatStock(cantidad, unidadCodigo, esFraccionaria)
}

/**
 * La cantidad de una línea de venta, se haya vendido por presentación o no.
 *
 * Existe porque los tres lugares que muestran líneas —el detalle de venta, el
 * ticket del POS y el de salones— repetían el mismo ternario y los tres caían
 * al string crudo en el caso sin presentación, que es el más común: se veía
 * `1.0000`.
 *
 * Se muestra la **presentación** si la línea se vendió así ("2 cajas"), porque
 * es como la pidió el cliente; si no, la cantidad canónica con su unidad base.
 * Las dos unidades vienen **congeladas en la venta**: leerlas del catálogo vivo
 * mostraría la unidad de hoy sobre una venta vieja.
 *
 * `esFraccionaria` la resuelve el caller contra el store, para la unidad que
 * vaya a mostrarse — quien llama sabe cuál de las dos es.
 */
export function formatCantidadLinea(
  cantidad: string,
  cantidadPresentacion: string | null | undefined,
  unidadCodigoPresentacion: string | null | undefined,
  esFraccionaria: boolean,
  unidadCodigoBase?: string | null,
): string {
  if (cantidadPresentacion && unidadCodigoPresentacion) {
    return formatCantidadTicket(
      cantidadPresentacion,
      unidadCodigoPresentacion,
      esFraccionaria,
    )
  }
  return formatCantidadTicket(cantidad, unidadCodigoBase ?? null, esFraccionaria)
}

export function unidadBaseItem(item: { tipo: string, unidadMedida?: string | null }): string {
  return item.tipo === 'receta' ? 'unidad' : (item.unidadMedida ?? 'unidad')
}
