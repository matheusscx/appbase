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

/**
 * El `nombreSugerido` que viaja en el 400 de colisión al restaurar de la
 * papelera, o `null` si el error es cualquier otra cosa.
 *
 * Es lo que separa "no se pudo, avisale al usuario" de "no se pudo TODAVÍA,
 * ofrecele un nombre libre": sin este dato la pantalla solo puede tirar un
 * toast rojo, y el usuario queda sin salida más que renombrar a mano la fila
 * viva que le está ocupando el nombre.
 *
 * Vive acá y no en `usePapelera` porque es un lector del cuerpo de error de la
 * API, igual que `apiErrorMsg`. Devuelve `null` —y no el string vacío— para
 * que el `if` de la pantalla distinga el caso "vino sugerencia" del caso
 * "vino, pero vacía", que sería un bug del backend y no una salida usable.
 */
export function nombreSugeridoDe(e: unknown): string | null {
  const sugerido = (e as { data?: { nombreSugerido?: unknown } })
    ?.data?.nombreSugerido
  return typeof sugerido === 'string' && sugerido.length > 0 ? sugerido : null
}
