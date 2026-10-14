import { generateKeyPairSync } from 'crypto';
import forge from 'node-forge';

interface OpcionesCaf {
  rut: string;
  tipo: number;
  desde: number;
  hasta: number;
}

/** CAF con la forma del SII: llave RSA de 512 bits y `FRMA` falsa (no se verifica, spec § 6). */
export function cafDePrueba({ rut, tipo, desde, hasta }: OpcionesCaf): string {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 512,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  // M y E van en base64 estándar; el JWK las da en base64url.
  const b64 = (s: string) => Buffer.from(s, 'base64url').toString('base64');
  // La cabecera PEM sale del export, nunca de un literal en el archivo (el repo es público).
  const rsask = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const rsapubk = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return [
    '<AUTORIZACION>',
    '<CAF version="1.0">',
    '<DA>',
    `<RE>${rut}</RE><RS>EMPRESA DE PRUEBA LTDA</RS><TD>${tipo}</TD>`,
    `<RNG><D>${desde}</D><H>${hasta}</H></RNG><FA>2026-10-01</FA>`,
    `<RSAPK><M>${b64(jwk.n!)}</M><E>${b64(jwk.e!)}</E></RSAPK><IDK>100</IDK>`,
    '</DA>',
    '<FRMA algoritmo="SHA1withRSA">RlJNQSBkZSBwcnVlYmE=</FRMA>',
    '</CAF>',
    `<RSASK>${rsask}</RSASK>`,
    `<RSAPUBK>${rsapubk}</RSAPUBK>`,
    '</AUTORIZACION>',
  ].join('\n');
}

const RUT_CERTIFICADO = '11111111-1';
const CLAVE_CERTIFICADO = 'clave-de-prueba';

/**
 * X.509 autofirmado RSA 2048 dentro de un .pfx. El RUT va en el `serialNumber` del sujeto
 * (el SII lo pone ahí o en un subjectAltName; este es el más simple de leer de vuelta).
 */
export function certificadoDePrueba(): {
  pfx: Buffer;
  clave: string;
  rut: string;
} {
  // La llave se genera con Node: la de forge tarda segundos en RSA 2048.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const llavePrivada = forge.pki.privateKeyFromPem(
    privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  );
  const llavePublica = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  );
  const cert = forge.pki.createCertificate();
  cert.publicKey = llavePublica;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2036-01-01T00:00:00Z');
  const sujeto = [
    { name: 'commonName', value: 'Firmante de Prueba' },
    { name: 'serialNumber', value: RUT_CERTIFICADO },
  ];
  cert.setSubject(sujeto);
  cert.setIssuer(sujeto);
  cert.sign(llavePrivada, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(
    llavePrivada,
    [cert],
    CLAVE_CERTIFICADO,
    { algorithm: '3des' },
  );
  return {
    pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'),
    clave: CLAVE_CERTIFICADO,
    rut: RUT_CERTIFICADO,
  };
}
