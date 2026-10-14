import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  type KeyObject,
} from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import { normalizarRut, rutValido } from '../../common/utils/rut.util';
import { DteError, type TipoBoleta } from './dte.types';
import { aLatin1 } from './texto';

export interface CafLeido {
  rutEmisor: string; // normalizado
  tipo: number; // TD
  desde: number; // RNG/D
  hasta: number; // RNG/H
  /** El nodo <CAF> tal cual, para copiarlo adentro del TED sin reserializar. */
  xmlCaf: string;
  llavePrivada: KeyObject; // RSASK
  llavePublica: KeyObject; // RSAPK (M, E)
}

const invalido = (motivo: string) =>
  new DteError('CAF_INVALIDO', `El CAF no es válido: ${motivo}`);

/** Parsea `<AUTORIZACION>` del SII. No verifica la `FRMA` (spec § 6) ni cuenta folios usados. */
export function leerCaf(xmlAutorizacion: string): CafLeido {
  // El TED se firma en latin1: un carácter fuera de ISO-8859-1 (el U+FFFD de un UTF-8 mal
  // leído, por ejemplo) se firmaría con otros bytes que los del SII.
  if (aLatin1(xmlAutorizacion).toString('latin1') !== xmlAutorizacion) {
    throw invalido(
      'trae caracteres fuera de ISO-8859-1; ¿se leyó el archivo como UTF-8? Léelo como latin1',
    );
  }
  const doc = new DOMParser({
    errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
  }).parseFromString(xmlAutorizacion, 'text/xml');

  const texto = (padre: Element | undefined, tag: string): string => {
    const valor = padre?.getElementsByTagName(tag)[0]?.textContent?.trim();
    if (!valor) throw invalido(`falta ${tag}`);
    return valor;
  };
  const entero = (padre: Element | undefined, tag: string): number => {
    const valor = texto(padre, tag);
    if (!/^\d+$/.test(valor)) throw invalido(`${tag} no es un entero`);
    return Number(valor);
  };

  // xmldom devuelve undefined con un texto vacío.
  const raiz = (doc as Document | undefined)?.documentElement;
  if (!raiz || raiz.tagName !== 'AUTORIZACION') {
    throw invalido('no es una AUTORIZACION');
  }
  const da = raiz.getElementsByTagName('DA')[0];
  const rut = texto(da, 'RE');
  if (!rutValido(rut)) throw invalido(`el RUT ${rut} no es válido`);
  const tipo = entero(da, 'TD');
  const rng = da.getElementsByTagName('RNG')[0];
  const desde = entero(rng, 'D');
  const hasta = entero(rng, 'H');
  if (desde > hasta) throw invalido('el rango está al revés');

  const rsapk = da.getElementsByTagName('RSAPK')[0];
  const b64aUrl = (s: string) =>
    Buffer.from(s.replace(/\s/g, ''), 'base64').toString('base64url');

  let llavePublica: KeyObject;
  let llavePrivada: KeyObject;
  try {
    llavePublica = createPublicKey({
      key: {
        kty: 'RSA',
        n: b64aUrl(texto(rsapk, 'M')),
        e: b64aUrl(texto(rsapk, 'E')),
      },
      format: 'jwk',
    });
    const pem = texto(raiz, 'RSASK')
      .split('\n')
      .map((linea) => linea.trim())
      .join('\n');
    llavePrivada = createPrivateKey(pem);
    // La privada tiene que ser la par de la pública: firmar y verificar un texto fijo.
    // Una llave que no es RSA (Ed25519…) hace fallar el firmar: también es inválida.
    const firma = createSign('RSA-SHA1').update('caf').sign(llavePrivada);
    if (!createVerify('RSA-SHA1').update('caf').verify(llavePublica, firma)) {
      throw invalido('RSASK no corresponde a RSAPK');
    }
  } catch (e) {
    if (e instanceof DteError) throw e;
    throw invalido('las llaves no se pueden leer o no son un par RSA');
  }

  const xmlCaf = /<CAF[\s>][\s\S]*<\/CAF>/.exec(xmlAutorizacion)?.[0];
  if (!xmlCaf) throw invalido('falta el nodo CAF');

  return {
    rutEmisor: normalizarRut(rut),
    tipo,
    desde,
    hasta,
    xmlCaf,
    llavePrivada,
    llavePublica,
  };
}

/** El CAF es de este emisor y de este tipo, y el folio cae en su rango (inclusive). */
export function validarFolio(
  caf: CafLeido,
  rutEmisor: string,
  tipo: TipoBoleta,
  folio: number,
): void {
  if (caf.rutEmisor !== normalizarRut(rutEmisor)) {
    throw new DteError(
      'CAF_OTRO_RUT',
      `El CAF es del RUT ${caf.rutEmisor}, no de ${normalizarRut(rutEmisor)}`,
    );
  }
  if (caf.tipo !== tipo) {
    throw new DteError(
      'CAF_OTRO_TIPO',
      `El CAF es del tipo ${caf.tipo}, no del ${tipo}`,
    );
  }
  if (folio < caf.desde || folio > caf.hasta) {
    throw new DteError(
      'FOLIO_FUERA_DE_RANGO',
      `El folio ${folio} está fuera del rango ${caf.desde}-${caf.hasta} del CAF`,
    );
  }
}
