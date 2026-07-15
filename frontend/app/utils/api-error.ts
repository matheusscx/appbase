export function apiErrorMsg(e: unknown, fallback = 'Error inesperado'): string {
  const raw = (e as { data?: { message?: string | string[] } })?.data?.message
  if (raw) return Array.isArray(raw) ? raw.join(', ') : raw
  // Errores locales (timeout QZ, etc.): conservar el mensaje sin perder el fallback
  // de contexto ("Venta registrada, pero…").
  if (e instanceof Error && e.message) {
    return fallback === 'Error inesperado' ? e.message : `${fallback}: ${e.message}`
  }
  return fallback
}
