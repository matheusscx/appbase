/**
 * Gemelo de `TEXTO_SII` (`backend/src/modules/dte/texto.ts`): lo que cabe en un campo de la
 * boleta del SII, ISO-8859-1 imprimible (U+0020 a U+007E y U+00A0 a U+00FF). Si una de las dos
 * clases cambia, la otra también: el backend rechaza con 400, esto avisa antes de enviar.
 */
const TEXTO_SII = /^[\u0020-\u007E\u00A0-\u00FF]*$/u

/**
 * El aviso para el campo si `valor` no cabe en la boleta, o `null` si cabe. `max` son los
 * caracteres que admite el campo (80 para el nombre de un ítem).
 */
export function textoSiiInvalido(valor: string, max: number): string | null {
  if (valor.length > max) return `No puede pasar de ${max} caracteres (lo exige el SII en la boleta)`
  if (!TEXTO_SII.test(valor)) return 'Lleva un símbolo que la boleta no admite (solo el alfabeto latino, sin emojis ni tabuladores)'
  return null
}
