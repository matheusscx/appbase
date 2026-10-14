import { DteError } from './dte.types';

/** ISO-8859-1: U+0000–U+00FF. Los de control salvo tab y saltos no entran en un XML. */
const FUERA_DE_LATIN1 = /[^\t\n\r\u0020-\u007E\u00A0-\u00FF]/u;

/**
 * Devuelve el valor si cabe en el campo del SII. No corrige ni corta (spec § 5):
 * lo emitido tiene que ser igual a lo congelado. La garantía de origen la da la
 * captura (el catálogo, el perfil fiscal).
 */
export function validarTexto(
  campo: string,
  valor: string,
  max: number,
): string {
  if (FUERA_DE_LATIN1.test(valor)) {
    throw new DteError(
      'TEXTO_NO_ISO_8859_1',
      `${campo} tiene un carácter que la boleta no admite: "${valor}"`,
    );
  }
  if (valor.length > max) {
    throw new DteError(
      'TEXTO_DEMASIADO_LARGO',
      `${campo} admite ${max} caracteres y trae ${valor.length}`,
    );
  }
  return valor;
}

export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Los bytes que viajan al SII: el XML declara ISO-8859-1. */
export function aLatin1(xml: string): Buffer {
  return Buffer.from(xml, 'latin1');
}
