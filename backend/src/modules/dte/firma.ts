import { createPrivateKey, X509Certificate } from 'crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { normalizarRut, rutValido } from '../../common/utils/rut.util';
import { DteError } from './dte.types';

export interface CertificadoLeido {
  /** PKCS#1, generado al leer el pfx; nunca se escribe en disco. */
  llavePrivadaPem: string;
  /** El certificado X.509 en DER, base64 sin saltos. */
  certificadoB64: string;
  /** Normalizado. Va como `RutEnvia` de la Carátula. */
  rut: string;
}

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

const invalido = (motivo: string) =>
  new DteError(
    'CERTIFICADO_INVALIDO',
    `El certificado no es válido: ${motivo}`,
  );

/** Lee el .pfx del firmante. Una clave mala, un pfx sin certificado o sin llave dan `CERTIFICADO_INVALIDO`. */
export function leerCertificado(pfx: Buffer, clave: string): CertificadoLeido {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))),
      clave,
    );
  } catch {
    throw invalido('no se pudo abrir el .pfx; ¿la clave es la correcta?');
  }

  const bags = (tipo: string) => p12.getBags({ bagType: tipo })[tipo] ?? [];
  const llave = [
    ...bags(forge.pki.oids.pkcs8ShroudedKeyBag),
    ...bags(forge.pki.oids.keyBag),
  ].find((b) => b.key)?.key;
  if (!llave) throw invalido('el .pfx no trae llave privada');

  // El pfx puede traer la cadena entera: el que firma es el certificado de la llave.
  const cert = bags(forge.pki.oids.certBag)
    .map((b) => b.cert)
    .find(
      (c) =>
        c &&
        (c.publicKey as forge.pki.rsa.PublicKey).n.compareTo(llave.n) === 0,
    );
  if (!cert) {
    throw invalido('el .pfx no trae el certificado que corresponde a la llave');
  }

  // Solo el serialNumber del sujeto. Un certificado del SII que lleve el RUT en un
  // subjectAltName (otherName) hoy no se lee.
  const campo = cert.subject.getField({ name: 'serialNumber' }) as {
    value: string;
  } | null;
  if (!campo?.value) {
    throw invalido(
      'no trae el RUT: se buscó en el serialNumber del sujeto del certificado',
    );
  }
  const rut = normalizarRut(campo.value);
  if (!rutValido(rut)) {
    throw invalido(
      `el serialNumber del sujeto no es un RUT válido: "${campo.value}"`,
    );
  }

  return {
    llavePrivadaPem: forge.pki.privateKeyToPem(llave),
    certificadoB64: forge.util.encode64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    ),
    rut,
  };
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Posición justo después del cierre del elemento cuyo atributo `ID` es `id`.
 * Cuenta el anidamiento de los elementos del mismo nombre; no mira comentarios ni CDATA,
 * donde una etiqueta escrita como texto lo descuadraría.
 */
function finDelNodo(xml: string, id: string): number {
  if (!/^[\w.-]+$/.test(id)) throw new Error(`ID no admitido: "${id}"`);
  const apertura = new RegExp(
    `<([A-Za-z_][\\w.:-]*)(?=[\\s/>])[^>]*?\\sID\\s*=\\s*(["'])${escaparRegex(id)}\\2[^>]*>`,
    'g',
  );
  const encontradas = [...xml.matchAll(apertura)];
  if (encontradas.length !== 1) {
    throw new Error(
      `Se esperaba un solo elemento con ID="${id}" y hay ${encontradas.length.toString()}`,
    );
  }
  const [abre, nombre] = encontradas[0];
  const desde = encontradas[0].index + abre.length;
  if (abre.endsWith('/>')) return desde;

  const etiquetas = new RegExp(
    `<(/?)${escaparRegex(nombre)}(?=[\\s/>])[^>]*?(/?)>`,
    'g',
  );
  etiquetas.lastIndex = desde;
  let profundidad = 1;
  for (let m = etiquetas.exec(xml); m; m = etiquetas.exec(xml)) {
    if (m[1]) profundidad--;
    else if (!m[2]) profundidad++;
    if (profundidad === 0) return m.index + m[0].length;
  }
  throw new Error(`El elemento con ID="${id}" no se cierra`);
}

/**
 * Firma (XMLDSig, RSA-SHA1, C14N inclusivo) el nodo con `ID="id"` y pone la `<Signature>`
 * como su hermana siguiente, como en el ejemplo del SII.
 *
 * No reserializa: la firma se calcula sobre el documento parseado, pero se inserta como texto
 * en el XML original. El `<DD>` del TED está firmado sobre los bytes que el motor emitió
 * (`<RSR></RSR>` vacío) y el `<CAF>` tiene que salir tal cual lo dio el SII; `getSignedXml()`
 * reserializa con xmldom y rompe las dos cosas.
 */
export function firmarNodo(
  xml: string,
  id: string,
  cert: CertificadoLeido,
): string {
  const fin = finDelNodo(xml, id);

  const jwk = new X509Certificate(
    Buffer.from(cert.certificadoB64, 'base64'),
  ).publicKey.export({ format: 'jwk' });
  const b64 = (s: string) => Buffer.from(s, 'base64url').toString('base64');

  const sig = new SignedXml({
    privateKey: createPrivateKey(cert.llavePrivadaPem),
    canonicalizationAlgorithm: C14N,
    signatureAlgorithm: RSA_SHA1,
    // El RSAKeyValue y el certificado salen de la misma llave (el ejemplo del SII las trae cruzadas).
    getKeyInfoContent: () =>
      `<KeyValue><RSAKeyValue><Modulus>${b64(jwk.n!)}</Modulus><Exponent>${b64(jwk.e!)}</Exponent></RSAKeyValue></KeyValue>` +
      `<X509Data><X509Certificate>${cert.certificadoB64}</X509Certificate></X509Data>`,
  });
  // `idAttribute` se queda en el default (ya busca ID): pasarlo duplica el atributo y xml-crypto rechaza.
  sig.addReference({
    xpath: `//*[@ID='${id}']`,
    transforms: [C14N],
    digestAlgorithm: SHA1,
  });
  sig.computeSignature(xml);

  return xml.slice(0, fin) + sig.getSignatureXml() + xml.slice(fin);
}
