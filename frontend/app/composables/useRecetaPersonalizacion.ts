import Decimal from 'decimal.js'

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

export interface PersonalizacionPayload {
  omitidos: string[]
  extras: { ingredienteItemId: string }[]
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
  extrasSeleccionados: { precioExtra: string }[],
): string {
  return extrasSeleccionados
    .reduce(
      (acc, extra) => acc.plus(new Decimal(extra.precioExtra || '0')),
      new Decimal(precioBase || '0'),
    )
    .toString()
}

export function buildPersonalizacionPayload(
  omitidos: string[],
  extrasIds: string[],
  comentario: string,
): PersonalizacionPayload {
  const payload: PersonalizacionPayload = {
    omitidos,
    extras: extrasIds.map((id) => ({ ingredienteItemId: id })),
  }
  const trimmed = comentario.trim()
  if (trimmed) payload.comentario = trimmed.slice(0, 200)
  return payload
}

export function resumenPersonalizacion(
  nombresOmitidos: string[],
  nombresExtras: string[],
  comentario?: string,
): string {
  const partes: string[] = []
  for (const nombre of nombresOmitidos) {
    partes.push(`Sin ${nombre}`)
  }
  for (const nombre of nombresExtras) {
    partes.push(`Extra ${nombre}`)
  }
  const trimmed = comentario?.trim()
  if (trimmed) partes.push(trimmed)
  return partes.join(' · ')
}
