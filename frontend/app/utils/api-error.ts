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
  const data = (e as { data?: { message?: string | string[], statusCode?: number } })?.data
  const raw = data?.message
  if (raw) {
    // Un 5xx trae el texto genérico de Nest en inglés: no le sirve a nadie.
    if (!Array.isArray(raw) && (data?.statusCode ?? 0) >= 500 && /^internal server error$/i.test(raw)) {
      return fallback
    }
    const lista = Array.isArray(raw) ? raw : [raw]
    const traducidos = lista.map(m => traducirMensaje(m).texto)
    // El detalle crudo queda para quien depura, no para quien está en el local.
    if (traducidos.some((t, i) => t !== lista[i])) console.warn('[api] validación rechazada:', lista)
    return [...new Set(traducidos)].join(', ')
  }
  // Errores locales (timeout QZ, etc.): conservar el mensaje sin perder el fallback
  // de contexto ("Venta registrada, pero…").
  if (opts.detalleLocal !== false && e instanceof Error && e.message) {
    return fallback === 'Error inesperado' ? e.message : `${fallback}: ${e.message}`
  }
  return fallback
}

/**
 * Los rechazos de validación del servidor, por campo y en español corto
 * ("Es obligatorio"), para marcar el campo con `useErroresCampo().marcar`. Solo entran los
 * mensajes que nombran un campo; una frase del negocio ("Stock insuficiente…")
 * no tiene dónde marcarse y sigue yendo al toast.
 */
export function apiFieldErrors(e: unknown): Record<string, string> {
  const raw = (e as { data?: { message?: string | string[] } })?.data?.message
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const m of Array.isArray(raw) ? raw : [raw]) {
    const t = traducirMensaje(m)
    if (t.campo && !(t.campo in out)) out[t.campo] = t.corto
  }
  return out
}

// Etiquetas de los campos que el ValidationPipe nombra tal cual vienen del DTO.
const ETIQUETAS: Record<string, string> = {
  nombre: 'nombre',
  correo: 'correo',
  contrasena: 'contraseña',
  contrasenaActual: 'contraseña actual',
  contrasenaNueva: 'contraseña nueva',
  host: 'host',
  puerto: 'puerto',
  minimo: 'mínimo',
  cantidad: 'cantidad',
  precioBase: 'precio base',
  tipoReglaId: 'tipo de regla',
  emisorRut: 'RUT del emisor',
  rut: 'RUT',
  lineas: 'línea',
  codigo: 'código',
  descripcion: 'descripción',
  telefono: 'teléfono',
  direccion: 'dirección',
}

const SEGMENTO_CAMEL = /^[a-z][a-z0-9]*[A-Z_]|^[a-z][a-z0-9]*\.\d/
const CAMPO = /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/

function humanizar(seg: string): string {
  if (ETIQUETAS[seg]) return ETIQUETAS[seg]
  const sinId = seg.endsWith('Id') && seg.length > 2 ? seg.slice(0, -2) : seg
  return sinId.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase().trim()
}

function etiquetaDe(campo: string): string {
  const partes = campo.split('.')
  const nombres: string[] = []
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]!
    if (/^\d+$/.test(p)) {
      nombres[nombres.length - 1] = `${nombres[nombres.length - 1]} ${Number(p) + 1}`
    } else nombres.push(humanizar(p))
  }
  return nombres.join(', ')
}

const mayus = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** Reglas por defecto de class-validator (inglés) → texto y versión corta junto al campo. */
const REGLAS_INGLES: Array<[RegExp, (m: RegExpMatchArray, l: string) => [string, string]]> = [
  [/^should not be empty$/, (_m, l) => [`${mayus(l)}: es obligatorio`, 'Es obligatorio']],
  [/^must be a UUID/, (_m, l) => [`Elige ${l}`, 'Elige una opción']],
  [/^must be an email/, (_m, l) => [`${mayus(l)}: escribe un correo válido`, 'Escribe un correo válido']],
  [/^must be longer than or equal to 1 characters/, (_m, l) => [`${mayus(l)}: es obligatorio`, 'Es obligatorio']],
  [/^must be longer than or equal to (\d+) characters/, (m, l) => [`${mayus(l)}: mínimo ${m[1]} caracteres`, `Mínimo ${m[1]} caracteres`]],
  [/^must be shorter than or equal to (\d+) characters/, (m, l) => [`${mayus(l)}: máximo ${m[1]} caracteres`, `Máximo ${m[1]} caracteres`]],
  [/^must be a number|^must be an integer|^must be a positive number/, (_m, l) => [`${mayus(l)}: escribe un número`, 'Escribe un número']],
  [/^must match .* regular expression/, (_m, l) => [`${mayus(l)}: el formato no es válido`, 'El formato no es válido']],
]

function traducirMensaje(m: string): { texto: string, corto: string, campo: string | null } {
  const sinTraducir = { texto: m, corto: m, campo: null }
  const sp = m.indexOf(' ')
  if (sp < 1) return sinTraducir
  const campo = m.slice(0, sp)
  const resto = m.slice(sp + 1)
  if (!CAMPO.test(campo)) return sinTraducir
  const etiqueta = etiquetaDe(campo)
  for (const [re, fn] of REGLAS_INGLES) {
    const mm = resto.match(re)
    if (mm) {
      const [texto, corto] = fn(mm, etiqueta)
      return { texto, corto, campo }
    }
  }
  // Inglés que ninguna regla conoce: igual no se muestra crudo.
  if (/\b(must|should)\b/.test(resto)) {
    return { texto: `${mayus(etiqueta)}: el valor no es válido`, corto: 'El valor no es válido', campo }
  }
  // Español del backend con el nombre interno por delante: se cambia por la etiqueta.
  if (SEGMENTO_CAMEL.test(campo) || ETIQUETAS[campo]) {
    return { texto: `${mayus(etiqueta)} ${resto}`, corto: mayus(resto), campo }
  }
  return sinTraducir
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

/**
 * `true` si el servidor contestó 403: la persona no tiene el permiso de esa lectura.
 *
 * Separa "no puedes verlo" de "se cayó" y de "no hay": las tres se veían como una lista vacía
 * con un toast que se iba (auditoría UX 2026-10-16, lote 7). El candado sigue siendo el guard
 * del backend (invariante 6); esto solo decide qué se le dice a la persona.
 */
export function esSinPermiso(e: unknown): boolean {
  const err = e as { status?: number, response?: { status?: number } } | null | undefined
  return (err?.status ?? err?.response?.status) === 403
}
