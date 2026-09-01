import Decimal from 'decimal.js'
import type { MonedaDisplayConfig } from '~/types/moneda'

const NON_ISO_CURRENCIES = new Set(['UF'])

export function isIso4217Currency(codigoIso: string): boolean {
  const code = codigoIso.trim().toUpperCase()
  if (NON_ISO_CURRENCIES.has(code)) return false
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(0)
    return true
  }
  catch {
    return false
  }
}

/** Símbolo pegado al monto (sin espacio intermedio). */
function symbolPrefix(cfg: MonedaDisplayConfig): string {
  return cfg.prefix.trim()
}

export function formatMontoManual(d: Decimal, cfg: MonedaDisplayConfig): string {
  const negative = d.isNegative()
  const abs = d.abs()
  const fixed = abs.toFixed(cfg.decimals)
  const [entero, frac] = fixed.split('.')
  const milesRegex = /\B(?=(\d{3})+(?!\d))/g
  const enteroFmt = entero!.replace(milesRegex, cfg.thousands)
  const numero = cfg.decimals > 0 && frac !== undefined
    ? `${enteroFmt}${cfg.decimal}${frac}`
    : enteroFmt
  const formatted = `${symbolPrefix(cfg)}${numero}`
  return negative ? `-${formatted}` : formatted
}

export function formatMontoDisplay(
  value: string | Decimal | null | undefined,
  cfg: MonedaDisplayConfig,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)
  return formatMontoManual(d, cfg)
}

export function parseMontoInput(raw: string, cfg: MonedaDisplayConfig): Decimal {
  const prefix = cfg.prefix.trim()
  let clean = raw
  if (prefix) clean = clean.replace(prefix, '')
  clean = clean.replaceAll(cfg.thousands, '').replace(cfg.decimal, '.').trim()
  if (!clean || clean === '-') return new Decimal(0)
  try {
    return new Decimal(clean)
  }
  catch {
    return new Decimal(0)
  }
}

/**
 * Veredicto sobre un monto **pegado** en un input de plata.
 *
 * - `sin-cambios`: lo pegado no es ambiguo, que siga el camino normal.
 * - `corregido`: el separador que trae era un decimal disfrazado de agrupador;
 *   `texto` es lo mismo escrito con el separador decimal de la moneda.
 * - `rechazado`: era un decimal y la moneda **no lo puede representar**. No se
 *   redondea ni se recorta: cualquiera de las dos guarda un número que la
 *   persona no escribió.
 */
export type MontoPegado =
  | { tipo: 'sin-cambios' }
  | { tipo: 'corregido', texto: string }
  | { tipo: 'rechazado' }

const SIN_CAMBIOS: MontoPegado = { tipo: 'sin-cambios' }

/**
 * Decide qué quiso decir un monto **pegado**, que es el único camino donde se
 * puede saber.
 *
 * Tecleando no se puede y por eso este parche no vive en la máscara: en es-CL,
 * `1`,`.`,`5`,`0`,`0` (mil quinientos, el hábito chileno) y `1`,`0`,`0`,`.`,`5`
 * (ochocientos y medio) son el **mismo gesto**. Lo único que los distingue son
 * los dígitos que vienen DESPUÉS del punto, y para cuando se teclean maska ya
 * colapsó el texto — un intento de reconstruirlo con memoria de la última tecla
 * rompió `1.500` → `1` y se revirtió (ver el docblock de `maskaOptions` en
 * `MoneyInput.vue`).
 *
 * Pegando, en cambio, la cadena llega entera y la agrupación se puede juzgar:
 * `1.500` agrupa de a 3 y es mil quinientos; `1000.5` no agrupa nada, así que
 * ese punto era el decimal.
 *
 * ⚠️ Eso no es "no adivinar": es **adivinar siempre igual**. `12.345` en un campo
 * de 4 decimales es `12345` en es-CL y `12,345` en en-US, y acá gana la lectura
 * de la moneda del campo. Y solo se opina sobre cadenas de dígitos y los dos
 * separadores de la moneda: cualquier otra cosa —un paréntesis contable, dos
 * celdas de una planilla— sigue de largo hasta la máscara, como antes.
 *
 * Vale para los dos separadores, porque cuál agrupa y cuál decimaliza lo dice la
 * moneda: en USD la coma es la que agrupa, y `1000,5` es el caso espejo.
 */
export function parseMontoPegado(
  raw: string,
  cfg: MonedaDisplayConfig,
): MontoPegado {
  const prefix = symbolPrefix(cfg)
  let texto = raw.trim()
  if (prefix) texto = texto.replaceAll(prefix, '')
  // El espacio se saca SOLO cuando está agrupando —entre dígitos y seguido de un
  // grupo de 3—, que es como lo escriben varios locales y como llega de una
  // página web (con el duro `\u00A0`). Sin esto, `1 000,5` no pasaba por monto y
  // seguía de largo hasta el ×10.
  //
  // ⚠️ Colapsar TODO espacio estaba mal: `1.500\t2.000` —dos celdas copiadas de
  // una planilla— se volvía un solo monto y esta función firmaba un `15002` que
  // parece plausible. Sin colapsarlo no pasa por monto y decide la máscara, como
  // antes. El signo sí se descarta entero: la máscara es `unsigned` y lo iba a
  // tirar igual, con o sin esta función.
  const crudo = texto
  texto = texto
    // Grupo de captura y no lookbehind: sería el primero del frontend, y en
    // Safari/iOS < 16.4 tira `SyntaxError` **al pegar** —el handler muere, nunca
    // frena el evento y el pegado degrada al ×10 viejo—. Un POS puede correr en
    // un iPad viejo y esto hace exactamente lo mismo.
    .replace(/(\d)[\s\u00A0\u202F](?=\d{3}(?!\d))/g, '$1')
    .replace(/^-/, '')
  // Si hubo que normalizar para poder juzgar, el veredicto no puede ser "que siga
  // como está": la máscara vería el texto original, con los espacios y el signo
  // que esta función acaba de sacar. Todo lo que abajo saldría `sin-cambios` sale
  // `corregido` con el texto ya limpio.
  const normalizado = texto !== crudo
  const sinCambios = (): MontoPegado =>
    normalizado ? { tipo: 'corregido', texto } : SIN_CAMBIOS

  // Solo se opina sobre lo que ya es un monto. Cualquier otra cosa —una etiqueta
  // pegada de una planilla, un texto— la descarta la máscara como siempre.
  const esMonto = texto.length > 0
    && /\d/.test(texto)
    && [...texto].every(c => /\d/.test(c) || c === cfg.thousands || c === cfg.decimal)
  if (!esMonto) return SIN_CAMBIOS

  let entero: string
  let cola: string
  let reinterpretado = false

  const iDecimal = texto.lastIndexOf(cfg.decimal)
  if (iDecimal >= 0) {
    // Trae el decimal de la moneda: no hay nada que interpretar.
    entero = texto.slice(0, iDecimal)
    cola = texto.slice(iDecimal + 1)
    // Mismo criterio que en la rama de abajo, y por eso está en las dos: un
    // separador al final es un monto a medio escribir, no un decimal. Sin este
    // guard, `1000,` se rechazaba y `1000.` no, para la misma cadena.
    if (!cola) return sinCambios()
  }
  else {
    const grupos = texto.split(cfg.thousands)
    if (grupos.length === 1) return sinCambios()
    // Una agrupación de verdad: el primer grupo de 1 a 3 dígitos y los demás de 3.
    const agrupaBien = grupos[0]!.length >= 1 && grupos[0]!.length <= 3
      && grupos.slice(1).every(g => g.length === 3)
    if (agrupaBien) return sinCambios()

    const i = texto.lastIndexOf(cfg.thousands)
    entero = texto.slice(0, i)
    cola = texto.slice(i + 1)
    // Un separador al final es un monto a medio escribir, no un decimal.
    if (!cola) return sinCambios()
    reinterpretado = true
  }

  // La cola con un separador adentro es una cadena de otro locale (`1,234.56`
  // pegado en un campo chileno): tiene DOS lecturas y ninguna es más válida que
  // la otra. Rechazar es lo único que no adivina.
  if (!/^\d+$/.test(cola)) return { tipo: 'rechazado' }

  const enteroLimpio = entero.replaceAll(cfg.thousands, '')
  if (enteroLimpio && !/^\d+$/.test(enteroLimpio)) return { tipo: 'rechazado' }

  let valor: Decimal
  try {
    valor = new Decimal(`${enteroLimpio || '0'}.${cola}`)
  }
  catch {
    return { tipo: 'rechazado' }
  }

  // ⚠️ Lo que decide es el VALOR, no cuántos caracteres trae la cola. `1.500,00`
  // en pesos son mil quinientos y **caben**: rechazarlo por "dos decimales"
  // descartaba un monto perfectamente representable, que es la forma en que
  // cualquier planilla escribe un entero.
  if (valor.decimalPlaces() > cfg.decimals) return { tipo: 'rechazado' }

  // Cabe. Solo hace falta reescribirlo si el texto, tal cual, la máscara lo iba a
  // leer mal: porque el separador era un decimal disfrazado de agrupador, o
  // porque trae más decimales de los que la máscara admite aunque sean ceros
  // (`1.500,00` con `fraction: 0` sale `150000`).
  if (!reinterpretado && cola.length <= cfg.decimals) return sinCambios()
  return { tipo: 'corregido', texto: valor.toFixed().replace('.', cfg.decimal) }
}

/**
 * Escala de un costo en el backend (`ESCALA_COSTO`, `common/decorators/es-costo`).
 * Duplicada acá a propósito: no hay workspace compartido entre backend y
 * frontend todavía. Si cambia allá, cambia acá.
 */
const ESCALA_COSTO = 4

/**
 * Un costo es una **tasa**, no un monto cobrado, así que los decimales de la
 * moneda son su **piso, no su techo**: convertir un costo a otra unidad puede
 * dar una fracción que la moneda no representa —$1.500 por kilo son $1,5 por
 * gramo— y formatearla con `formatMontoDisplay` la redondearía a `$2`, un
 * número que no es el costo. Acá se agregan los decimales que el valor traiga,
 * hasta la escala con que el backend lo guarda.
 *
 * Solo para **lectura**. Un campo editable no puede usar esto: ahí la escala la
 * manda la moneda, porque lo que se teclea se cobra
 * (`docs/patterns/frontend.md` §8).
 */
export function formatCostoDisplay(
  value: string | Decimal | null | undefined,
  cfg: MonedaDisplayConfig,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const d = value instanceof Decimal ? value : new Decimal(value)
  const decimals = Math.max(cfg.decimals, Math.min(d.decimalPlaces(), ESCALA_COSTO))
  return formatMontoManual(d, { ...cfg, decimals })
}
