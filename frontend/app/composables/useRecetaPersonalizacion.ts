import Decimal from 'decimal.js'

export interface RecetaIngredientePersonalizacion {
  ingredienteItemId: string
  ingredienteNombre: string
  cantidad: string
  unidadCodigo: string
  bloqueante: boolean
  stock: string
  /** Ver `stock` vs `stockDisponible` en `sinStock`. */
  stockDisponible?: string | null
}

export interface RecetaExtraPersonalizacion {
  ingredienteItemId: string
  ingredienteNombre: string
  cantidad: string
  unidadCodigo: string
  precioExtra: string
  stock: string
  /** Ver `stock` vs `stockDisponible` en `sinStock`. */
  stockDisponible?: string | null
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
  /** Ver `stock` vs `stockDisponible` en `sinStock`. */
  stockDisponible?: string | null
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

/**
 * Lo que de una fila del drawer **todavía se puede pedir**: `stockDisponible`
 * si el servidor lo mandó, y el `stock` físico si no.
 *
 * Gemela de `stockPedible` (useVenta.ts), que hace lo mismo para la grilla del
 * catálogo. Duplicada a propósito y no importada: `useVenta.ts` importa
 * `personalizacionVacia` de este archivo, así que traerla para acá cerraría un
 * ciclo de imports en runtime. Si aparece un tercer lector, ahí sí se extrae.
 */
function pedible(fila: { stock: string | null, stockDisponible?: string | null }): string | null {
  return fila.stockDisponible ?? fila.stock
}

/**
 * Decide si una fila con stock propio ya no se puede incluir.
 *
 * Lee lo **pedible**, no el `stock` físico: pedir en una mesa aparta el
 * ingrediente aunque el kardex todavía no se haya movido —la venta descuenta al
 * cerrar la cuenta—, así que mirar `stock` ofrecía lo que otra mesa ya se había
 * llevado y lo rechazaba recién al confirmar.
 */
export function sinStock(fila: { stock: string, stockDisponible?: string | null }): boolean {
  try {
    return new Decimal(pedible(fila) || '0').lte(0)
  }
  catch {
    return true
  }
}

/** Como `sinStock`, pero para opciones de grupo: `stock === null` = no rastreado, nunca bloquea. */
export function opcionSinStock(o: { stock: string | null, stockDisponible?: string | null }): boolean {
  const p = pedible(o)
  if (p === null) return false
  return sinStock({ stock: p })
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
 * ⚠️ No es la pregunta de si la línea cambia de precio. Esa vivía al lado, en
 * `personalizacionAfectaPrecio` ("sacar no cobra, agregar sí"), y se borró el
 * 2026-08-30 junto con el override de `precioUnitario`: **el precio lo calcula
 * el servidor**, cuyo resolver ya devuelve `precioExtraTotal` 0 cuando lo único
 * que se hizo fue omitir. Aplanar las dos preguntas fue un bug una vez; tener el
 * criterio de precio duplicado en el cliente fue otro.
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
