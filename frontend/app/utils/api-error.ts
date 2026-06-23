export function apiErrorMsg(e: unknown, fallback = 'Error inesperado'): string {
  const raw = (e as { data?: { message?: string | string[] } })?.data?.message
  if (!raw) return fallback
  return Array.isArray(raw) ? raw.join(', ') : raw
}
