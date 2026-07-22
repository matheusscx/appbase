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

/** Opción elegible dentro de un grupo de modificadores (receta o combo). */
export interface GrupoOpcionPersonalizacion {
  grupoOpcionId: string
  itemId: string
  itemNombre: string
  tipo: string
  cantidad: string
  unidadCodigo: string | null
  precioExtra: string
  orden: number
  /** null = ítem no rastrea stock (no bloquea la opción). */
  stock: string | null
  /** true = sin cantidad default ni override: no vendible en este item (nunca seleccionable). */
  esPendiente?: boolean
}

/** Grupo de modificadores asociado a un item (receta o combo) — `GET /items/:id`. */
export interface GrupoPersonalizacion {
  grupoModificadorId: string
  nombre: string
  min: number
  max: number
  orden: number
  opciones: GrupoOpcionPersonalizacion[]
}

/** Componente receta de un combo, con sus grupos — `GET /items/:id`. */
export interface ComponentePersonalizacion {
  componenteItemId: string
  componenteNombre: string
  tipo: string
  cantidad: string
  grupos: GrupoPersonalizacion[]
}

export interface RecetaDetallePersonalizacion {
  id: string
  nombre: string
  precioBase: string
  monedaId: string
  ingredientes: RecetaIngredientePersonalizacion[]
  extrasPermitidos: RecetaExtraPersonalizacion[]
  /** Combos: siempre []. Recetas/combos con grupos configurados: uno por grupo asociado. */
  grupos: GrupoPersonalizacion[]
  /** Combos: componentes con sus grupos (para la elección por unidad). */
  componentes?: ComponentePersonalizacion[]
}

export interface PersonalizacionExtraPayload {
  ingredienteItemId: string
  /** Número de veces que se agrega el extra (≥ 1). */
  unidades: number
}

export interface PersonalizacionGrupoOpcionPayload {
  itemId: string
  unidades: number
}

export interface PersonalizacionGrupoPayload {
  grupoId: string
  opciones: PersonalizacionGrupoOpcionPayload[]
}

export interface PersonalizacionComponentePayload {
  componenteItemId: string
  /** 1..cantidad del componente. */
  unidad: number
  grupos: PersonalizacionGrupoPayload[]
}

export interface PersonalizacionPayload {
  omitidos: string[]
  extras: PersonalizacionExtraPayload[]
  comentario?: string
  grupos?: PersonalizacionGrupoPayload[]
  componentes?: PersonalizacionComponentePayload[]
}

export function sinStock(stock: string): boolean {
  try {
    return new Decimal(stock || '0').lte(0)
  }
  catch {
    return true
  }
}

/** Como `sinStock`, pero para opciones de grupo: `stock === null` = no rastreado, nunca bloquea. */
export function opcionSinStock(stock: string | null): boolean {
  if (stock === null) return false
  return sinStock(stock)
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
  grupos: PersonalizacionGrupoPayload[] = [],
  componentes: PersonalizacionComponentePayload[] = [],
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
  const gruposConSeleccion = grupos.filter((g) => g.opciones.length > 0)
  if (gruposConSeleccion.length) payload.grupos = gruposConSeleccion
  const compConSeleccion = componentes
    .map((c) => ({ ...c, grupos: c.grupos.filter((g) => g.opciones.length > 0) }))
    .filter((c) => c.grupos.length > 0)
  if (compConSeleccion.length) payload.componentes = compConSeleccion
  return payload
}

export function resumenPersonalizacion(
  nombresOmitidos: string[],
  extras: { nombre: string, unidades: number }[],
  comentario?: string,
  grupos: { grupoNombre: string, opcionNombre: string, unidades: number }[] = [],
): string {
  const partes: string[] = []
  for (const nombre of nombresOmitidos) {
    partes.push(`Sin ${nombre}`)
  }
  for (const extra of extras) {
    partes.push(extra.unidades > 1 ? `Extra ${extra.nombre} x${extra.unidades}` : `Extra ${extra.nombre}`)
  }
  for (const g of grupos) {
    partes.push(
      g.unidades > 1
        ? `${g.grupoNombre}: ${g.opcionNombre} x${g.unidades}`
        : `${g.grupoNombre}: ${g.opcionNombre}`,
    )
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
