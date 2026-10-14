import { createSign, createVerify, generateKeyPairSync } from 'crypto';
import forge from 'node-forge';
import { leerCaf, validarFolio } from './caf';
import { DteError } from './dte.types';
import {
  cafDePrueba,
  certificadoDePrueba,
} from './__fixtures__/credenciales-prueba';

const RUT = '76543210-3';
const caf = (over: Partial<Parameters<typeof cafDePrueba>[0]> = {}) =>
  cafDePrueba({ rut: RUT, tipo: 39, desde: 101, hasta: 150, ...over });

const codigoDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DteError) return e.codigo;
    throw e;
  }
  return null;
};

describe('leerCaf', () => {
  it('lee RUT, tipo y rango, y deja el <CAF> como subcadena literal del original', () => {
    const xml = caf();
    const leido = leerCaf(xml);
    expect(leido.rutEmisor).toBe('76543210-3');
    expect(leido.tipo).toBe(39);
    expect(leido.desde).toBe(101);
    expect(leido.hasta).toBe(150);
    expect(leido.xmlCaf).toBe(
      xml.slice(xml.indexOf('<CAF'), xml.indexOf('</CAF>') + '</CAF>'.length),
    );
    expect(leido.xmlCaf.startsWith('<CAF version="1.0">')).toBe(true);
    expect(leido.xmlCaf.endsWith('</CAF>')).toBe(true);
  });

  it('la llave privada firma lo que la pública verifica', () => {
    const { llavePrivada, llavePublica } = leerCaf(caf());
    const firma = createSign('RSA-SHA1').update('dd').sign(llavePrivada);
    expect(
      createVerify('RSA-SHA1').update('dd').verify(llavePublica, firma),
    ).toBe(true);
  });

  it('un CAF sin RSASK es inválido', () => {
    const sinLlave = caf().replace(/<RSASK>[\s\S]*<\/RSASK>/, '');
    expect(codigoDe(() => leerCaf(sinLlave))).toBe('CAF_INVALIDO');
  });

  it('un RSASK de otra llave es inválido', () => {
    const otra = generateKeyPairSync('rsa', { modulusLength: 512 })
      .privateKey.export({ type: 'pkcs1', format: 'pem' })
      .toString();
    const cruzado = caf().replace(
      /<RSASK>[\s\S]*<\/RSASK>/,
      () => `<RSASK>${otra}</RSASK>`,
    );
    expect(codigoDe(() => leerCaf(cruzado))).toBe('CAF_INVALIDO');
  });

  it.each([
    ['RE', /<RE>[\s\S]*?<\/RE>/],
    ['TD', /<TD>[\s\S]*?<\/TD>/],
    ['RNG', /<RNG>[\s\S]*?<\/RNG>/],
    ['RSAPK', /<RSAPK>[\s\S]*?<\/RSAPK>/],
  ])('un CAF sin %s es inválido', (_nombre, patron) => {
    expect(codigoDe(() => leerCaf(caf().replace(patron, '')))).toBe(
      'CAF_INVALIDO',
    );
  });

  it('un RSASK que no es una llave RSA (Ed25519) es inválido', () => {
    const ed = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const conEd = caf().replace(
      /<RSASK>[\s\S]*<\/RSASK>/,
      () => `<RSASK>${ed}</RSASK>`,
    );
    expect(codigoDe(() => leerCaf(conEd))).toBe('CAF_INVALIDO');
  });

  it('un CAF cuyo RE tiene el dígito verificador malo es inválido', () => {
    expect(codigoDe(() => leerCaf(caf({ rut: '76543210-4' })))).toBe(
      'CAF_INVALIDO',
    );
  });

  it('un texto vacío es inválido', () => {
    expect(codigoDe(() => leerCaf(''))).toBe('CAF_INVALIDO');
  });

  it('un texto que no es XML de CAF es inválido', () => {
    expect(codigoDe(() => leerCaf('no es xml'))).toBe('CAF_INVALIDO');
    expect(codigoDe(() => leerCaf('<otra/>'))).toBe('CAF_INVALIDO');
  });
});

describe('validarFolio', () => {
  const leido = leerCaf(caf());

  it('acepta los dos bordes del rango, inclusive', () => {
    expect(codigoDe(() => validarFolio(leido, RUT, 39, 101))).toBeNull();
    expect(codigoDe(() => validarFolio(leido, RUT, 39, 150))).toBeNull();
  });

  it('rechaza el folio justo fuera del rango', () => {
    expect(codigoDe(() => validarFolio(leido, RUT, 39, 100))).toBe(
      'FOLIO_FUERA_DE_RANGO',
    );
    expect(codigoDe(() => validarFolio(leido, RUT, 39, 151))).toBe(
      'FOLIO_FUERA_DE_RANGO',
    );
  });

  it('un CAF de factura de otro tipo no sirve para una boleta 39', () => {
    const caf41 = leerCaf(caf({ tipo: 41 }));
    expect(codigoDe(() => validarFolio(caf41, RUT, 39, 120))).toBe(
      'CAF_OTRO_TIPO',
    );
  });

  it('un CAF de otro RUT no sirve para este emisor', () => {
    expect(codigoDe(() => validarFolio(leido, '11111111-1', 39, 120))).toBe(
      'CAF_OTRO_RUT',
    );
  });

  it('compara el RUT normalizado de los dos lados', () => {
    expect(
      codigoDe(() => validarFolio(leido, '76.543.210-3', 39, 120)),
    ).toBeNull();
  });
});

describe('credenciales de prueba', () => {
  it('el certificado abre con su clave y lleva el RUT en el serialNumber del sujeto', () => {
    const { pfx, clave, rut } = certificadoDePrueba();
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(pfx.toString('binary')),
      clave,
    );
    const bag = p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ];
    const cert = bag![0].cert!;
    expect(cert.subject.getField({ name: 'serialNumber' }).value).toBe(rut);
  });
});
