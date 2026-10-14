import { X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DOMParser } from '@xmldom/xmldom';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { certificadoDePrueba } from './__fixtures__/credenciales-prueba';
import { DteError } from './dte.types';
import { firmarNodo, leerCertificado } from './firma';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const SII = 'http://www.sii.cl/SiiDte';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

const EJEMPLO = readFileSync(
  join(__dirname, '__fixtures__', 'sii', 'F60T33-ejemplo.xml'),
  'latin1',
);

const certPem = (b64: string) =>
  `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;

const firmas = (xml: string) =>
  Array.from(
    new DOMParser()
      .parseFromString(xml, 'text/xml')
      .getElementsByTagNameNS(DSIG, 'Signature'),
  );

/** Verifica la primera firma de `xml` con la llave de NUESTRO certificado, no con la del KeyInfo. */
const verificar = (xml: string, certificadoB64: string) => {
  const sig = new SignedXml({
    publicCert: certPem(certificadoB64),
    getCertFromKeyInfo: () => null,
  });
  sig.loadSignature(firmas(xml)[0]);
  return sig.checkSignature(xml);
};

/** Forma de un árbol: nombres y orden de los elementos y sus Algorithm; sin textos ni URIs. */
const forma = (el: Element, profundidad = 0): string[] => {
  const attrs = Array.from(el.attributes)
    .map((a) => (a.name === 'URI' ? 'URI' : `${a.name}=${a.value}`))
    .join(' ');
  const propio =
    `${'  '.repeat(profundidad)}${el.localName} ${attrs}`.trimEnd();
  return [
    propio,
    ...Array.from(el.childNodes)
      .filter((n): n is Element => n.nodeType === 1)
      .flatMap((h) => forma(h, profundidad + 1)),
  ];
};

const dteConDocumento = (cuerpo = '<Folio>101</Folio>') =>
  `<DTE xmlns="${SII}" xmlns:xsi="${XSI}" version="1.0"><Documento ID="B39F1">${cuerpo}</Documento></DTE>`;

describe('leerCertificado', () => {
  const { pfx, clave, rut } = certificadoDePrueba();

  it('entrega la llave privada, el certificado en base64 DER y el RUT normalizado', () => {
    const c = leerCertificado(pfx, clave);
    expect(c.rut).toBe(rut);
    expect(c.llavePrivadaPem).toContain('PRIVATE KEY');
    const der = Buffer.from(c.certificadoB64, 'base64');
    expect(
      new X509Certificate(der).subject.includes(`serialNumber=${rut}`),
    ).toBe(true);
  });

  const falla = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(DteError);
      expect((e as DteError).codigo).toBe('CERTIFICADO_INVALIDO');
      return;
    }
    throw new Error('no lanzó');
  };

  it('una clave equivocada da CERTIFICADO_INVALIDO', () => {
    falla(() => leerCertificado(pfx, 'otra-clave'));
  });

  it('bytes que no son un pfx dan CERTIFICADO_INVALIDO', () => {
    falla(() => leerCertificado(Buffer.from('esto no es un pfx'), clave));
  });

  /** Lee la llave y el certificado de un pfx de prueba. */
  const partes = (origen: Buffer) => {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(origen.toString('binary'))),
      clave,
    );
    const llave = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ]![0].key!;
    const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ]![0].cert!;
    return { llave, cert };
  };

  const empacar = (
    llave: forge.pki.rsa.PrivateKey | null,
    certs: forge.pki.Certificate[],
  ) =>
    Buffer.from(
      forge.asn1
        .toDer(
          forge.pkcs12.toPkcs12Asn1(llave, certs, clave, { algorithm: '3des' }),
        )
        .getBytes(),
      'binary',
    );

  it('un pfx cuyo certificado no es el de la llave da CERTIFICADO_INVALIDO', () => {
    const otro = certificadoDePrueba();
    falla(() =>
      leerCertificado(
        empacar(partes(pfx).llave, [partes(otro.pfx).cert]),
        clave,
      ),
    );
  });

  it('un pfx sin llave privada da CERTIFICADO_INVALIDO', () => {
    falla(() => leerCertificado(empacar(null, [partes(pfx).cert]), clave));
  });

  it('un certificado sin RUT en el serialNumber del sujeto da CERTIFICADO_INVALIDO y dice dónde se buscó', () => {
    const sinRut = certificadoDePrueba({ rut: null });
    try {
      leerCertificado(sinRut.pfx, sinRut.clave);
      throw new Error('no lanzó');
    } catch (e) {
      expect((e as DteError).codigo).toBe('CERTIFICADO_INVALIDO');
      expect((e as DteError).message).toContain('serialNumber');
    }
  });

  it('un RUT con dígito verificador malo en el certificado da CERTIFICADO_INVALIDO', () => {
    const malo = certificadoDePrueba({ rut: '11111111-2' });
    falla(() => leerCertificado(malo.pfx, malo.clave));
  });

  it('normaliza el RUT del certificado (puntos y minúscula)', () => {
    const conPuntos = certificadoDePrueba({ rut: '76.543.210-3' });
    expect(leerCertificado(conPuntos.pfx, conPuntos.clave).rut).toBe(
      '76543210-3',
    );
  });

  it('devuelve el nombre del firmante y el vencimiento', () => {
    const venceEl = new Date('2027-03-15T12:00:00Z');
    const { pfx, clave } = certificadoDePrueba({
      venceEl,
      nombre: 'Ana Pérez',
    });
    const cert = leerCertificado(pfx, clave);
    expect(cert.nombre).toBe('Ana Pérez');
    expect(cert.venceEl.toISOString()).toBe(venceEl.toISOString());
  });

  it('por defecto el firmante es el de prueba y vence en 2036', () => {
    const { pfx, clave } = certificadoDePrueba();
    const cert = leerCertificado(pfx, clave);
    expect(cert.nombre).toBe('Firmante de Prueba');
    expect(cert.venceEl.toISOString()).toBe('2036-01-01T00:00:00.000Z');
  });
});

describe('firmarNodo', () => {
  const { pfx, clave } = certificadoDePrueba();
  const cert = leerCertificado(pfx, clave);

  it('el Documento firmado verifica suelto en su <DTE> y dentro de un sobre con los mismos namespaces', () => {
    const firmado = firmarNodo(dteConDocumento(), 'B39F1', cert);
    expect(verificar(firmado, cert.certificadoB64)).toBe(true);

    const sobre = `<EnvioBOLETA xmlns="${SII}" xmlns:xsi="${XSI}" version="1.0"><SetDTE ID="SetDoc">${firmado}</SetDTE></EnvioBOLETA>`;
    expect(verificar(sobre, cert.certificadoB64)).toBe(true);
  });

  it('pone la Signature como hermana siguiente del nodo firmado', () => {
    const firmado = firmarNodo(dteConDocumento(), 'B39F1', cert);
    expect(firmado).toMatch(
      /^<DTE [^>]*><Documento ID="B39F1"><Folio>101<\/Folio><\/Documento><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">.*<\/Signature><\/DTE>$/s,
    );
  });

  it('el KeyInfo trae RSAKeyValue y X509Certificate, en ese orden, de la misma llave', () => {
    const firma = firmas(firmarNodo(dteConDocumento(), 'B39F1', cert))[0];
    const keyInfo = firma.getElementsByTagNameNS(DSIG, 'KeyInfo')[0];
    const hijos = Array.from(keyInfo.getElementsByTagNameNS(DSIG, '*')).map(
      (e) => e.localName,
    );
    expect(hijos).toEqual([
      'KeyValue',
      'RSAKeyValue',
      'Modulus',
      'Exponent',
      'X509Data',
      'X509Certificate',
    ]);
    const modulo =
      keyInfo.getElementsByTagNameNS(DSIG, 'Modulus')[0].textContent ?? '';
    const delCert = new X509Certificate(
      Buffer.from(
        keyInfo.getElementsByTagNameNS(DSIG, 'X509Certificate')[0]
          .textContent ?? '',
        'base64',
      ),
    ).publicKey.export({ format: 'jwk' });
    expect(Buffer.from(modulo, 'base64').toString('base64url')).toBe(delCert.n);
  });

  it('alterar un carácter del nodo firmado hace fallar la verificación', () => {
    const firmado = firmarNodo(dteConDocumento(), 'B39F1', cert);
    expect(
      verificar(
        firmado.replace('<Folio>101</Folio>', '<Folio>102</Folio>'),
        cert.certificadoB64,
      ),
    ).toBe(false);
  });

  it('verificar con otra llave falla', () => {
    const otro = certificadoDePrueba();
    const otroCert = leerCertificado(otro.pfx, otro.clave);
    const firmado = firmarNodo(dteConDocumento(), 'B39F1', cert);
    // Con otra llave xml-crypto no devuelve false: lanza "invalid signature".
    expect(() => verificar(firmado, otroCert.certificadoB64)).toThrow(
      /invalid signature/,
    );
  });

  it('la forma de la Signature (elementos, orden, Algorithm) es la de la firma 0 del ejemplo del SII', () => {
    const generada = firmas(firmarNodo(dteConDocumento(), 'B39F1', cert))[0];
    const delSii = firmas(EJEMPLO)[0];
    expect(forma(generada)).toEqual(forma(delSii));
  });

  describe('no reserializa el documento', () => {
    const cafConBlancos = [
      '<CAF version="1.0">',
      '<DA>',
      '  <RE>76543210-3</RE>',
      '  <RS>Panadería Ñuñoa SpA</RS>',
      '</DA>',
      '</CAF>',
    ].join('\n');
    const cuerpo =
      `<Encabezado><RznSocRecep>Ñuñoa</RznSocRecep><RSR></RSR>` +
      `<TED version="1.0"><DD>${cafConBlancos}\n  <TSTED>2026-10-14T12:00:00</TSTED></DD></TED></Encabezado>`;

    it('quitando la Signature insertada, el resultado es idéntico a la entrada (RSR vacío, CAF con blancos, Ñ)', () => {
      const entrada = dteConDocumento(cuerpo);
      const firmado = firmarNodo(entrada, 'B39F1', cert);
      const sinFirma = firmado.replace(/<Signature[\s\S]*<\/Signature>/, '');
      expect(sinFirma).toBe(entrada);
      expect(firmado).toContain('<RSR></RSR>');
      expect(verificar(firmado, cert.certificadoB64)).toBe(true);
    });
  });

  describe('dónde cierra el nodo firmado', () => {
    it('con un elemento del mismo nombre anidado, inserta tras el cierre del externo', () => {
      const xml = `<Raiz><Caja ID="a"><Caja>interna</Caja>x</Caja><Otra/></Raiz>`;
      const firmado = firmarNodo(xml, 'a', cert);
      expect(firmado).toMatch(
        /^<Raiz><Caja ID="a"><Caja>interna<\/Caja>x<\/Caja><Signature [^>]*>.*<\/Signature><Otra\/><\/Raiz>$/s,
      );
      expect(firmado.replace(/<Signature[\s\S]*<\/Signature>/, '')).toBe(xml);
      expect(verificar(firmado, cert.certificadoB64)).toBe(true);
    });

    it('firma el SetDTE aunque tenga varios <DTE> hermanos adentro', () => {
      const xml = `<EnvioBOLETA xmlns="${SII}"><SetDTE ID="SetDoc"><DTE><Documento ID="D1"/></DTE><DTE><Documento ID="D2"/></DTE></SetDTE></EnvioBOLETA>`;
      const firmado = firmarNodo(xml, 'SetDoc', cert);
      expect(firmado).toMatch(
        /<\/SetDTE><Signature [^>]*>.*<\/Signature><\/EnvioBOLETA>$/s,
      );
      expect(verificar(firmado, cert.certificadoB64)).toBe(true);
    });

    it('un elemento vacío auto-cerrado también recibe la Signature a continuación', () => {
      const xml = `<Raiz xmlns="${SII}"><Hoja ID="h"/><Otra/></Raiz>`;
      const firmado = firmarNodo(xml, 'h', cert);
      expect(firmado).toMatch(/^<Raiz [^>]*><Hoja ID="h"\/><Signature /);
      expect(firmado.replace(/<Signature[\s\S]*<\/Signature>/, '')).toBe(xml);
    });

    it('un ID que no existe en el documento falla en vez de devolver el XML sin firmar', () => {
      expect(() => firmarNodo(dteConDocumento(), 'NoExiste', cert)).toThrow();
    });
  });
});
