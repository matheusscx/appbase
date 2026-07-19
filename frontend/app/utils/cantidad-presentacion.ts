import Decimal from 'decimal.js'
import { formatStock } from './stock-format'

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
  if (!unidadCodigo) return cantidad
  return formatStock(cantidad, unidadCodigo, esFraccionaria)
}

export function unidadBaseItem(item: { tipo: string, unidadMedida?: string | null }): string {
  return item.tipo === 'receta' ? 'unidad' : (item.unidadMedida ?? 'unidad')
}
