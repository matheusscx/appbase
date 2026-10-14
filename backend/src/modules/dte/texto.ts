import { DteError } from './dte.types';

/**
 * Lo que cabe en un campo del motor: ISO-8859-1 imprimible (U+0020 a U+007E y U+00A0 a
 * U+00FF). Quedan fuera los de control, también tab y saltos: todos los campos son de una línea.
 */
const FUERA_DE_LATIN1 = /[^\u0020-\u007E\u00A0-\u00FF]/u;

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
      `${campo} tiene un carácter que la boleta no admite (fuera de ISO-8859-1, tab o salto de línea): ${JSON.stringify(valor)}`,
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

/**
 * Escapa solo `&`, `<` y `>`: lo que la forma C14N del texto de un elemento escapa. Así los
 * bytes emitidos son los mismos que los canonicalizados y el `FRMT` verifica tanto si el
 * verificador del SII lee el DD crudo como si lo canonicaliza. Solo para texto de elemento:
 * ningún atributo del motor lleva texto libre.
 */
export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const FECHA_HORA = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

const bisiesto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/** Un día que existe en el calendario. */
function esFecha(valor: string): boolean {
  const m = FECHA.exec(valor);
  if (!m) return false;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const diasDelMes = [
    31,
    bisiesto(anio) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasDelMes[mes - 1];
}

const fechaInvalida = (campo: string, valor: string, formato: string) =>
  new DteError(
    'FECHA_INVALIDA',
    `${campo} tiene que ir como ${formato} y ser una fecha real: "${valor}"`,
  );

/** `AAAA-MM-DD`. Sin zona horaria: la hora de Chile la decide quien llama. */
export function validarFecha(campo: string, valor: string): string {
  if (!esFecha(valor)) throw fechaInvalida(campo, valor, 'AAAA-MM-DD');
  return valor;
}

/** `AAAA-MM-DDTHH:MM:SS`: ni un `toISOString()` (con Z y milisegundos) ni un espacio en vez de la T. */
export function validarFechaHora(campo: string, valor: string): string {
  const m = FECHA_HORA.exec(valor);
  if (
    !m ||
    !esFecha(m[1]) ||
    Number(m[2]) > 23 ||
    Number(m[3]) > 59 ||
    Number(m[4]) > 59
  ) {
    throw fechaInvalida(campo, valor, 'AAAA-MM-DDTHH:MM:SS');
  }
  return valor;
}

/** Los bytes que viajan al SII: el XML declara ISO-8859-1. */
export function aLatin1(xml: string): Buffer {
  return Buffer.from(xml, 'latin1');
}
