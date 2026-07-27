import Decimal from 'decimal.js'

/** Estados del ciclo de vida de una sesión de recuento (`recuento_inventario.estado`). */
export type EstadoRecuento = 'borrador' | 'aplicado' | 'cancelado'

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  aplicado: 'Aplicado',
  cancelado: 'Cancelado',
}

const ESTADO_COLORS: Record<string, 'neutral' | 'success' | 'error'> = {
  borrador: 'neutral',
  aplicado: 'success',
  cancelado: 'error',
}

/** Etiqueta legible del estado de una sesión — listado y detalle. */
export function estadoRecuentoLabel(estado: string): string {
  return ESTADO_LABELS[estado] ?? estado
}

/** Color semántico del badge de estado — listado y detalle. */
export function estadoRecuentoColor(estado: string): 'neutral' | 'success' | 'error' {
  return ESTADO_COLORS[estado] ?? 'neutral'
}

/**
 * Delta = contado − sistema, igual que el backend (§4 del diseño). `null`
 * mientras la línea no tiene conteo cargado. Usado tanto para el cálculo en
 * vivo mientras se escribe como para el valor persistido que llega del API.
 */
export function calcularDiferenciaRecuento(
  cantidadContada: string | null | undefined,
  stockSistema: string,
): string | null {
  if (cantidadContada === null || cantidadContada === undefined || cantidadContada.trim() === '') {
    return null
  }
  try {
    return new Decimal(cantidadContada).minus(stockSistema).toFixed(4)
  }
  catch {
    return null
  }
}

/** Clase de color semántico de la diferencia: faltante, sobrante o neutro. */
export function claseDiferenciaRecuento(diferencia: string | null | undefined): string {
  if (diferencia === null || diferencia === undefined) return 'text-muted'
  const d = new Decimal(diferencia)
  if (d.isZero()) return 'text-muted'
  return d.isNegative() ? 'text-error' : 'text-success'
}

interface LineaConDiferencia {
  cantidadContada: string | null
  diferencia: string | null
}

/**
 * Cuántas líneas realmente mueven stock al aplicar: contadas y con delta
 * distinto de cero. Las sin contar se ignoran (§7 del diseño) y un delta
 * cero no genera movimiento.
 */
export function contarLineasAMover(lineas: LineaConDiferencia[]): number {
  return lineas.filter((l) => {
    if (l.cantidadContada === null || l.diferencia === null) return false
    return !new Decimal(l.diferencia).isZero()
  }).length
}

interface LineaConCausa extends LineaConDiferencia {
  motivoDiferenciaId: string | null
}

/**
 * Líneas con diferencia distinta de cero que se quedarían sin causa al
 * aplicar (ni override de línea ni default de la sesión). Aviso previo en
 * cliente; el backend igual lo rechaza si se intenta aplicar así.
 */
export function contarLineasSinCausa(
  lineas: LineaConCausa[],
  motivoDefaultId: string | null,
): number {
  return lineas.filter((l) => {
    if (l.cantidadContada === null || l.diferencia === null) return false
    if (new Decimal(l.diferencia).isZero()) return false
    return !l.motivoDiferenciaId && !motivoDefaultId
  }).length
}
