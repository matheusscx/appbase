import Decimal from 'decimal.js'
import type { PersonalizacionDetalleLinea } from '~/utils/ticket-builder'

export interface RecetaIngredientePersonalizacion {
  ingredienteItemId: string
  ingredienteNombre: string
  cantidad: string
  unidadCodigo: string
  bloqueante: boolean
  stock: string
}

export interface RecetaExtraPersonalizacion {
  ingredienteItemId: string
  ingredienteNombre: string
  cantidad: string
  unidadCodigo: string
  precioExtra: string
  stock: string
}

export interface RecetaDetallePersonalizacion {
  id: string
  nombre: string
  precioBase: string
  monedaId: string
  ingredientes: RecetaIngredientePersonalizacion[]
  extrasPermitidos: RecetaExtraPersonalizacion[]
}

export interface PersonalizacionExtraPayload {
  ingredienteItemId: string
  /** Número de veces que se agrega el extra (≥ 1). */
  unidades: number
}

export interface PersonalizacionPayload {
  omitidos: string[]
  extras: PersonalizacionExtraPayload[]
  comentario?: string
}

export function sinStock(stock: string): boolean {
  try {
    return new Decimal(stock || '0').lte(0)
  }
  catch {
    return true
  }
}

export function precioConExtras(
  precioBase: string,
  extrasSeleccionados: { precioExtra: string, unidades: number }[],
): string {
  return extrasSeleccionados
    .reduce(
      (acc, extra) =>
        acc.plus(new Decimal(extra.precioExtra || '0').mul(extra.unidades || 0)),
      new Decimal(precioBase || '0'),
    )
    .toString()
}

export function buildPersonalizacionPayload(
  omitidos: string[],
  extras: PersonalizacionExtraPayload[],
  comentario: string,
): PersonalizacionPayload {
  const payload: PersonalizacionPayload = {
    omitidos,
    extras: extras.map((e) => ({
      ingredienteItemId: e.ingredienteItemId,
      unidades: e.unidades,
    })),
  }
  const trimmed = comentario.trim()
  if (trimmed) payload.comentario = trimmed.slice(0, 200)
  return payload
}

export function resumenPersonalizacion(
  nombresOmitidos: string[],
  extras: { nombre: string, unidades: number }[],
  comentario?: string,
): string {
  const partes: string[] = []
  for (const nombre of nombresOmitidos) {
    partes.push(`Sin ${nombre}`)
  }
  for (const extra of extras) {
    partes.push(extra.unidades > 1 ? `Extra ${extra.nombre} x${extra.unidades}` : `Extra ${extra.nombre}`)
  }
  const trimmed = comentario?.trim()
  if (trimmed) partes.push(trimmed)
  return partes.join(' · ')
}

/**
 * Detalle priceado (preview del drawer, antes de confirmar) para boleta/precuenta:
 * omitidos primero en $0 (nunca tienen costo), extras después con precioExtra × unidades.
 */
export function detallePersonalizacionPreview(
  nombresOmitidos: string[],
  extras: { nombre: string, unidades: number, precioExtra: string }[],
): PersonalizacionDetalleLinea[] {
  const omitidos: PersonalizacionDetalleLinea[] = nombresOmitidos.map(nombre => ({
    nombre,
    tipo: 'omitido',
    monto: '0',
  }))
  const extrasDetalle: PersonalizacionDetalleLinea[] = extras.map(e => ({
    nombre: e.nombre,
    tipo: 'extra',
    unidades: e.unidades,
    monto: new Decimal(e.precioExtra || '0').times(e.unidades || 0).toString(),
  }))
  return [...omitidos, ...extrasDetalle]
}
