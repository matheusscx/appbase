/**
 * `detalleLocal: false` para pantallas SIN sesión (login, registro). El `message`
 * de un `Error` de red de ofetch trae el método y la URL completa del backend
 * (`[POST] "http://host:3000/api/auth/login": <no response> fetch failed`), y esa
 * topología no puede llegarle a un visitante anónimo. El mensaje HTTP que sí manda
 * el backend —incluido el array del `ValidationPipe`— se conserva igual.
 */
export function apiErrorMsg(
  e: unknown,
  fallback = 'Error inesperado',
  opts: { detalleLocal?: boolean } = {},
): string {
  const raw = (e as { data?: { message?: string | string[] } })?.data?.message
  if (raw) return Array.isArray(raw) ? raw.join(', ') : raw
  // Errores locales (timeout QZ, etc.): conservar el mensaje sin perder el fallback
  // de contexto ("Venta registrada, pero…").
  if (opts.detalleLocal !== false && e instanceof Error && e.message) {
    return fallback === 'Error inesperado' ? e.message : `${fallback}: ${e.message}`
  }
  return fallback
}
