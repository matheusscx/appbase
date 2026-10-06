/**
 * Presentación del reembolso por pasarela que no sale dos veces
 * (`docs/adr/029-reembolso-con-efecto-externo.md`).
 */

/** El ámbito de `useIntentoCobro` de un reembolso: uno por orden y por pestaña. */
export function ambitoReembolso(ordenId: string): string {
  return `reembolso:${ordenId}`
}

/**
 * Un REFUND en `iniciada` o `error` quedó **sin confirmar**: Transbank pudo
 * haber devuelto la plata sin que el sistema se enterara. No es un rechazo.
 */
export function esSinConfirmar(estado: string): boolean {
  return estado === 'iniciada' || estado === 'error'
}

const ETIQUETAS: Record<string, string> = {
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
}

/** Cómo se lee el estado de una transacción de pasarela en el historial. */
export function etiquetaEstadoTransaccion(estado: string): string {
  return esSinConfirmar(estado) ? 'Sin confirmar' : (ETIQUETAS[estado] ?? estado)
}

export function colorEstadoTransaccion(estado: string): 'success' | 'error' | 'warning' | 'neutral' {
  if (esSinConfirmar(estado)) return 'warning'
  if (estado === 'aprobada') return 'success'
  if (estado === 'rechazada') return 'error'
  return 'neutral'
}

/** El reintento llegó igual y el backend reprodujo el que ya había salido (decisión 1 del owner). */
export function avisoReembolsoRepetido(montoFormateado: string): string {
  return `Este reembolso ya se había hecho: al cliente le vuelven ${montoFormateado} una sola vez.`
}

/**
 * La orden del 422 de "este reembolso ya se hizo con otros datos", o `null`
 * si el error es otro.
 */
export function ordenDeOtrosDatos(error: unknown): string | null {
  const e = error as { status?: number, data?: { ordenId?: unknown } }
  const id = e?.data?.ordenId
  return e?.status === 422 && typeof id === 'string' && id ? id : null
}

/** El ámbito de `useIntentoCobro` de "Generar nota": uno por REFUND y por pestaña. */
export function ambitoGenerarNota(transaccionId: string): string {
  return `gn:${transaccionId}`
}

/**
 * Un REFUND aprobado de una orden con venta que quedó sin corrección: la plata
 * ya volvió y la boleta no se corrigió. Es el que se marca y lleva "Generar
 * nota". Uno sin confirmar no: se aclara en su tarjeta y deja su nota ahí.
 */
export function esRefundSinNota(
  t: { tipo: string, estado: string, correccionVentaId: string | null },
  ventaId: string | null,
): boolean {
  return !!ventaId && t.tipo === 'REFUND' && t.estado === 'aprobada' && !t.correccionVentaId
}

/** El reintento llegó igual y el backend reprodujo la nota que ya había entrado. */
export const AVISO_NOTA_REPETIDA = 'Esta nota ya se había generado: no se emitió dos veces.'

/**
 * La nota del 409 "este reembolso ya tiene su nota de crédito" (otra pestaña u
 * otro admin la generó), o `null` si el error es otro.
 */
export function notaYaLigada(error: unknown): string | null {
  const e = error as { status?: number, data?: { notaCreditoId?: unknown } }
  const id = e?.data?.notaCreditoId
  return e?.status === 409 && typeof id === 'string' && id ? id : null
}
