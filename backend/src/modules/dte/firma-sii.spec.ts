import {
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  X509Certificate,
} from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { validarContraXsd } from './__fixtures__/xsd';

const EJEMPLO = readFileSync(
  join(__dirname, '__fixtures__', 'sii', 'F60T33-ejemplo.xml'),
  'latin1',
);
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const SII = 'http://www.sii.cl/SiiDte';

const b64aUrl = (s: string) =>
  Buffer.from(s.replace(/\s/g, ''), 'base64').toString('base64url');

const certPem = (b64: string) =>
  `-----BEGIN CERTIFICATE-----\n${b64
    .replace(/\s/g, '')
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END CERTIFICATE-----\n`;

const texto = (el: Element, tag: string) =>
  el.getElementsByTagNameNS(DSIG, tag)[0].textContent ?? '';

/** Llave pública del `RSAKeyValue` de una firma (JWK). */
const llaveRsaKeyValue = (firma: Element) =>
  createPublicKey({
    key: {
      kty: 'RSA',
      n: b64aUrl(texto(firma, 'Modulus')),
      e: b64aUrl(texto(firma, 'Exponent')),
    },
    format: 'jwk',
  });

describe('firma del SII (ejemplo oficial de 2003)', () => {
  const doc = new DOMParser().parseFromString(EJEMPLO, 'text/xml');
  const firmas = Array.from(doc.getElementsByTagNameNS(DSIG, 'Signature'));

  /** Verifica `firma` (de `xml`) con la llave de su `RSAKeyValue`. */
  const verificar = (xml: string, firma: Element) => {
    const sig = new SignedXml({
      publicCert: llaveRsaKeyValue(firma).export({
        type: 'spki',
        format: 'pem',
      }),
      getCertFromKeyInfo: () => null,
    });
    sig.loadSignature(firma);
    return sig.checkSignature(xml);
  };

  it('el ejemplo del SII valida contra EnvioDTE_v10.xsd', async () => {
    const r = await validarContraXsd(EJEMPLO, 'EnvioDTE_v10.xsd', [
      'DTE_v10.xsd',
      'SiiTypes_v10.xsd',
      'xmldsignature_v10.xsd',
    ]);
    expect(r.errores).toEqual([]);
  });

  it('el ejemplo trae en cada firma un X509Certificate con otra llave que su RSAKeyValue: el spike verifica con el RSAKeyValue', () => {
    for (const firma of firmas) {
      const delCertificado = new X509Certificate(
        certPem(texto(firma, 'X509Certificate')),
      ).publicKey.export({
        format: 'jwk',
      });
      expect(delCertificado.n).not.toBe(b64aUrl(texto(firma, 'Modulus')));
    }
  });

  it('xml-crypto verifica la firma del Documento sobre el <DTE> aislado', () => {
    // El ejemplo de 2003 firmó el Documento antes de meterlo al sobre: dentro hereda xmlns y deja de verificar.
    const dte = EJEMPLO.slice(
      EJEMPLO.indexOf('<DTE '),
      EJEMPLO.indexOf('</DTE>') + '</DTE>'.length,
    );
    const aislado = new DOMParser().parseFromString(dte, 'text/xml');
    const firma = aislado.getElementsByTagNameNS(DSIG, 'Signature')[0];
    expect(verificar(dte, firma)).toBe(true);
  });

  it('xml-crypto verifica la firma del SetDTE sobre el sobre completo', () => {
    expect(verificar(EJEMPLO, firmas[1])).toBe(true);
  });

  it('el FRMT del TED verifica con la RSAPK del CAF (regla: DD aplanado en latin1)', () => {
    const ted = doc.getElementsByTagNameNS(SII, 'TED')[0];
    const ddInicio = EJEMPLO.indexOf('<DD>');
    const ddFin = EJEMPLO.indexOf('</DD>') + '</DD>'.length;
    const aplanado = EJEMPLO.slice(ddInicio, ddFin).replace(/>\s+</g, '><');
    const m = ted.getElementsByTagNameNS(SII, 'M')[0].textContent ?? '';
    const e = ted.getElementsByTagNameNS(SII, 'E')[0].textContent ?? '';
    const pub = createPublicKey({
      key: { kty: 'RSA', n: b64aUrl(m), e: b64aUrl(e) },
      format: 'jwk',
    });
    const frmt = ted.getElementsByTagNameNS(SII, 'FRMT')[0].textContent ?? '';
    const ok = createVerify('RSA-SHA1')
      .update(Buffer.from(aplanado, 'latin1'))
      .verify(pub, frmt.replace(/\s/g, ''), 'base64');
    expect(ok).toBe(true);
  });

  it('Node 22 firma y verifica SHA1 con una llave RSA de 512 bits (tamaño de la llave del CAF)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 512,
    });
    const firma = createSign('RSA-SHA1').update('dd').sign(privateKey);
    expect(createVerify('RSA-SHA1').update('dd').verify(publicKey, firma)).toBe(
      true,
    );
  });
});
