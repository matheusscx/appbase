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

/**
 * ¿Hay algo que **registrar**? Un "sin cebolla" o un comentario cuentan: tienen
 * que viajar a la comanda de cocina aunque no muevan el precio.
 *
 * No confundir con [`personalizacionAfectaPrecio`]: son dos preguntas distintas
 * y aplanarlas fue justo el bug — ver el docblock de esa función.
 */
export function personalizacionVacia(p?: PersonalizacionPayload): boolean {
  if (!p) return true
  return (
    p.omitidos.length === 0
    && p.extras.length === 0
    && !p.comentario?.trim()
    && !(p.grupos && p.grupos.length > 0)
    && !(p.componentes && p.componentes.length > 0)
  )
}

/**
 * ¿Esta personalización cambia el **precio** de la línea?
 *
 * **Criterio único del proyecto: sacar no cobra, agregar sí.** Quitar un
 * ingrediente nunca genera recargo ni marca la línea como personalizada a
 * efectos de precio; agregar extras, elegir opciones de grupo o sumar
 * componentes sí.
 *
 * Antes había dos criterios distintos para lo mismo, alimentando el mismo campo
 * del mismo endpoint: `personalizacionVacia` (para la que un "sin cebolla" ya
 * contaba) en el POS, y `tienePersonalizacionConRecargo` en salones (que lo
 * ignoraba). Ganó el segundo, y este es el único lugar donde vive.
 *
 * ⚠️ **"No afecta el precio" NO es "no se registra".** El *sin cebolla* sigue
 * viajando a la comanda — eso lo decide `personalizacionVacia`. Lo que se
 * unificó acá es el criterio de recargo, no el de trazabilidad.
 */
export function personalizacionAfectaPrecio(
  // Estructural y no `PersonalizacionPayload`: los dos llamadores traen la
  // personalización con tipos distintos (el payload del drawer y la línea de
  // una cuenta de salón). Pedir el tipo nominal obligaría a castear en uno de
  // los dos, que es como se llega a tener dos criterios de nuevo.
  p?: {
    extras?: { length: number }
    grupos?: { length: number }
    componentes?: { length: number }
  } | null,
): boolean {
  if (!p) return false
  return Boolean(p.extras?.length || p.grupos?.length || p.componentes?.length)
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
