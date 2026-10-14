import { createSign } from 'crypto';
import { normalizarRut, rutValido } from '../../common/utils/rut.util';
import { type CafLeido, validarFolio } from './caf';
import { type DatosBoleta, DteError } from './dte.types';
import { aDecimal } from './montos';
import {
  aLatin1,
  escaparXml,
  validarFecha,
  validarFechaHora,
  validarTexto,
} from './texto';

/** RUT genérico del receptor cuando la boleta no lo identifica (Formato Boletas v4.2, campo 18). */
const RUT_GENERICO = '66666666-6';

/** IT1 es la primera línea: sin líneas no hay boleta que timbrar. */
const sinLineas = () =>
  new DteError('SIN_LINEAS', 'La boleta no tiene líneas de detalle');

/** `RSR` e `IT1` del timbre son un extracto: el XSD fija 40 caracteres. */
const LARGO_EXTRACTO = 40;

const el = (tag: string, valor: string) => `<${tag}>${valor}</${tag}>`;

/**
 * Extracto del timbre: valida el texto de origen completo, lo corta a 40 caracteres y
 * recién después lo escapa (cortar lo ya escapado podría partir un `&amp;`). Es la
 * única truncación del motor.
 */
function extracto(campo: string, valor: string, maxOrigen: number): string {
  return escaparXml(
    validarTexto(campo, valor, maxOrigen).slice(0, LARGO_EXTRACTO),
  );
}

function rutReceptor(valor: string): string {
  if (!rutValido(valor))
    throw new DteError('RUT_INVALIDO', `RR no es un RUT válido: "${valor}"`);
  return normalizarRut(valor);
}

/**
 * Arma y firma el `<TED>` (timbre electrónico). El `FRMT` es RSA-SHA1 con la llave del CAF
 * sobre el `<DD>` aplanado (sin los blancos entre tags) y en bytes ISO-8859-1: la regla que
 * el spike midió contra el ejemplo del SII. `tsted` lo pone quien llama (AAAA-MM-DDTHH:MM:SS).
 */
export function armarTed(
  datos: DatosBoleta,
  caf: CafLeido,
  tsted: string,
): string {
  // Antes que el folio: un RUT malformado no es un CAF de otro RUT.
  if (!rutValido(datos.emisor.rut)) {
    throw new DteError(
      'RUT_INVALIDO',
      `RE no es un RUT válido: "${datos.emisor.rut}"`,
    );
  }
  validarFolio(caf, datos.emisor.rut, datos.tipo, datos.folio);
  if (datos.lineas.length === 0) throw sinLineas();

  const r = datos.receptor;
  // Sin nombre, RSR queda vacío (el XSD solo fija maxLength 40; el formato v4.2 no dice más).
  // Va como el par <RSR></RSR>, la forma C14N de un elemento vacío, nunca <RSR/>.
  const rsr = r?.nombre ? extracto('RznSocRecep', r.nombre, 100) : '';
  const it1 = extracto('NmbItem', datos.lineas[0].nombre, 80);

  const dd =
    '<DD>' +
    el('RE', normalizarRut(datos.emisor.rut)) +
    el('TD', datos.tipo.toString()) +
    el('F', datos.folio.toString()) +
    el('FE', validarFecha('FE', datos.fechaEmision)) +
    el('RR', r ? rutReceptor(r.rut) : RUT_GENERICO) +
    `<RSR>${rsr}</RSR>` +
    el('MNT', aDecimal('MntTotal', datos.montos.total).toFixed()) +
    el('IT1', it1) +
    caf.xmlCaf +
    el('TSTED', validarFechaHora('TSTED', tsted)) +
    '</DD>';

  const aplanado = dd.replace(/>\s+</g, '><');
  const frmt = createSign('RSA-SHA1')
    .update(aLatin1(aplanado))
    .sign(caf.llavePrivada, 'base64');

  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${frmt}</FRMT></TED>`;
}
