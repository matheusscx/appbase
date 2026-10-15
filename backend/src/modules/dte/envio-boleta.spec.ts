import { DOMParser } from '@xmldom/xmldom';
import { createVerify } from 'crypto';
import { SignedXml } from 'xml-crypto';
import {
  cafDePrueba,
  certificadoDePrueba,
} from './__fixtures__/credenciales-prueba';
import { validarContraXsd } from './__fixtures__/xsd';
import { armarDocumento } from './boleta-documento';
import { type CafLeido, leerCaf } from './caf';
import { DteError } from './dte.types';
import type { DatosBoleta, LineaBoleta } from './dte.types';
import {
  armarEnvioBoleta,
  type BoletaEmitida,
  emitirBoleta,
} from './envio-boleta';
import { firmarNodo, leerCertificado } from './firma';
import { armarTed } from './ted';
import { aLatin1 } from './texto';

const AHORA = '2026-10-14T12:00:00';
const SII = 'http://www.sii.cl/SiiDte';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const XSD = 'EnvioBOLETA_v11_formato42.xsd';

const linea = (over: Partial<LineaBoleta> = {}): LineaBoleta => ({
  nombre: 'Café',
  cantidad: '3',
  precioUnitario: '1490',
  monto: '4470',
  exenta: false,
  ...over,
});

const boleta = (over: Partial<DatosBoleta> = {}): DatosBoleta => ({
  tipo: 39,
  folio: 101,
  fechaEmision: '2026-10-14',
  emisor: {
    rut: '76543210-3',
    razonSocial: 'Panadería Ñuñoa SpA',
    giro: 'Panadería',
    direccion: 'Irarrázaval 2401',
    comuna: 'Peñalolén',
  },
  proveedorSoftware: { rut: '77777777-7', razonSocial: 'Venka SpA' },
  superaUmbralIdentificacion: false,
  lineas: [linea()],
  ajustesGlobales: [],
  montos: {
    neto: '3756',
    exento: '0',
    iva: '714',
    total: '4470',
    adicionales: '0',
  },
  ...over,
});

const exenta = (folio = 7): DatosBoleta =>
  boleta({
    tipo: 41,
    folio,
    lineas: [
      linea({
        nombre: 'Pan',
        cantidad: '2',
        precioUnitario: '500',
        monto: '1000',
        exenta: true,
      }),
      linea({
        nombre: 'Leche',
        cantidad: '1',
        precioUnitario: '1200',
        monto: '1200',
        exenta: true,
      }),
    ],
    montos: {
      neto: '0',
      exento: '2200',
      iva: '0',
      total: '2200',
      adicionales: '0',
    },
  });

const mixta = (): DatosBoleta =>
  boleta({
    folio: 102,
    receptor: { rut: '12.345.678-5', nombre: 'Juana Pérez' },
    lineas: [
      linea({
        nombre: 'Torta',
        cantidad: '1',
        precioUnitario: '1190',
        monto: '1190',
      }),
      linea({
        nombre: 'Pan',
        cantidad: '1',
        precioUnitario: '500',
        monto: '500',
        exenta: true,
      }),
    ],
    ajustesGlobales: [
      { tipo: 'D', glosa: 'Promo del día', monto: '190', exento: false },
    ],
    montos: {
      neto: '840',
      exento: '500',
      iva: '160',
      total: '1500',
      adicionales: '0',
    },
  });

/** Res. Ex. SII 60/2023: un descuento que deja la venta en $0 no la saca del SII; sale por $0. */
const cero = {
  neto: '0',
  exento: '0',
  iva: '0',
  total: '0',
  adicionales: '0',
};
const ceroPorDescuentoDeLinea = (): DatosBoleta =>
  boleta({
    folio: 104,
    lineas: [
      linea({
        cantidad: '1',
        precioUnitario: '12000',
        descuentoMonto: '12000',
        monto: '0',
      }),
    ],
    montos: cero,
  });
const ceroPorDescuentoGlobal = (): DatosBoleta =>
  boleta({
    folio: 105,
    lineas: [linea({ cantidad: '1', precioUnitario: '12000', monto: '12000' })],
    ajustesGlobales: [
      { tipo: 'D', glosa: 'Promo del día', monto: '12000', exento: false },
    ],
    montos: cero,
  });

const gondola = (): DatosBoleta =>
  boleta({
    folio: 103,
    lineas: [linea({ cantidad: '1', precioUnitario: '993', monto: '993' })],
    montos: {
      neto: '834',
      exento: '0',
      iva: '159',
      total: '993',
      adicionales: '0',
    },
  });

const caf39 = leerCaf(
  cafDePrueba({
    rut: '76543210-3',
    tipo: 39,
    desde: 1,
    hasta: 600,
    razonSocial: 'Panadería Ñuñoa SpA',
  }),
);
const caf41 = leerCaf(
  cafDePrueba({ rut: '76543210-3', tipo: 41, desde: 1, hasta: 50 }),
);
const { pfx, clave } = certificadoDePrueba();
const certificado = leerCertificado(pfx, clave);
const cafDe = (d: DatosBoleta): CafLeido => (d.tipo === 39 ? caf39 : caf41);
const emitir = (d: DatosBoleta) =>
  emitirBoleta(d, { caf: cafDe(d), certificado }, AHORA);

const caratula = {
  rutEmisor: '76543210-3',
  rutReceptor: '60803000-K' as const,
  fchResol: '2026-01-15',
  nroResol: 0,
};
const envio = (boletas: BoletaEmitida[]) =>
  armarEnvioBoleta(boletas, caratula, certificado, AHORA);

const certPem = (b64: string) =>
  `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;

/** Verifica la firma número `n` de `xml` con la llave de NUESTRO certificado, no con la del KeyInfo. */
const verificar = (xml: string, n: number) => {
  const sig = new SignedXml({
    publicCert: certPem(certificado.certificadoB64),
    getCertFromKeyInfo: () => null,
  });
  const firmas = new DOMParser()
    .parseFromString(xml, 'text/xml')
    .getElementsByTagNameNS(DSIG, 'Signature');
  sig.loadSignature(firmas[n]);
  return sig.checkSignature(xml);
};

/** El FRMT del TED con la llave pública del CAF, sobre el DD aplanado en latin1. */
const frmtVerifica = (xml: string, caf: CafLeido) => {
  const dd = xml.slice(xml.indexOf('<DD>'), xml.indexOf('</DD>') + 5);
  const firma = /<FRMT algoritmo="SHA1withRSA">([^<]*)<\/FRMT>/.exec(xml)![1];
  return createVerify('RSA-SHA1')
    .update(Buffer.from(dd.replace(/>\s+</g, '><'), 'latin1'))
    .verify(caf.llavePublica, firma, 'base64');
};

const valida = (xml: string) =>
  validarContraXsd(xml, XSD, ['xmldsignature_v10.xsd']);

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { codigo?: string }).codigo;
  }
  return 'NO_LANZO';
};

describe('emitirBoleta + armarEnvioBoleta, de punta a punta', () => {
  it.each([
    ['afecta', boleta()],
    ['exenta (41)', exenta()],
    ['mixta con descuento global y receptor', mixta()],
    ['de $0 por un descuento de línea', ceroPorDescuentoDeLinea()],
    ['de $0 por un descuento global', ceroPorDescuentoGlobal()],
  ])(
    'boleta %s: XSD, firmas del Documento (suelto y en el sobre) y del SetDTE, y FRMT',
    async (_nombre, datos) => {
      const b = emitir(datos);
      expect(b.folio).toBe(datos.folio);
      expect(b.tipo).toBe(datos.tipo);
      expect(
        b.xml.startsWith(
          `<DTE xmlns="${SII}" xmlns:xsi="${XSI}" version="1.0">`,
        ),
      ).toBe(true);
      expect(b.xml.endsWith('</Signature></DTE>')).toBe(true);

      // La firma del Documento, con el <DTE> suelto.
      expect(verificar(b.xml, 0)).toBe(true);

      const sobre = envio([b]);
      expect(await valida(sobre)).toEqual({ valido: true, errores: [] });
      expect(verificar(sobre, 0)).toBe(true); // el Documento, ya dentro del sobre
      expect(verificar(sobre, 1)).toBe(true); // el SetDTE
      expect(frmtVerifica(sobre, cafDe(datos))).toBe(true);

      // Lo que viaja son bytes ISO-8859-1; releídos como latin1 todo sigue igual.
      expect(aLatin1(sobre).toString('latin1')).toBe(sobre);
      const releido = aLatin1(sobre).toString('latin1');
      expect(releido).toContain('Panadería Ñuñoa SpA');
      expect(releido).toContain('Peñalolén');
      expect(await valida(releido)).toEqual({ valido: true, errores: [] });
      expect(verificar(releido, 0)).toBe(true);
      expect(verificar(releido, 1)).toBe(true);
      expect(frmtVerifica(releido, cafDe(datos))).toBe(true);
    },
  );

  it('la boleta de $0 por descuento informa MntTotal 0 y la línea a precio de lista con su DescuentoMonto', () => {
    const xml = emitir(ceroPorDescuentoDeLinea()).xml;
    expect(xml).toContain('<MntTotal>0</MntTotal>');
    expect(xml).toContain('<PrcItem>12000</PrcItem>');
    expect(xml).toContain('<DescuentoMonto>12000</DescuentoMonto>');
    expect(xml).toContain('<MontoItem>0</MontoItem>');
  });

  it('sin el xmlns:xsi en el <DTE>, la firma del Documento verifica suelta pero cae dentro del sobre', () => {
    const datos = boleta();
    const ted = armarTed(datos, caf39, AHORA);
    const { xml, id } = armarDocumento(datos, ted, AHORA);
    const sinXsi = firmarNodo(
      `<DTE xmlns="${SII}" version="1.0">${xml}</DTE>`,
      id,
      certificado,
    );
    expect(verificar(sinXsi, 0)).toBe(true);

    const sobre = `<EnvioBOLETA xmlns="${SII}" xmlns:xsi="${XSI}" version="1.0"><SetDTE ID="SetDoc">${sinXsi}</SetDTE></EnvioBOLETA>`;
    expect(verificar(sobre, 0)).toBe(false);
  });

  it('la góndola de $993 sale con diferenciaIvaRedondeo = 1', () => {
    expect(emitir(gondola()).diferenciaIvaRedondeo).toBe('1');
    expect(emitir(boleta()).diferenciaIvaRedondeo).toBe('0');
  });

  describe('los errores salen sin envolver', () => {
    it('de los montos: TOTALES_NO_CIERRAN', () => {
      const malos = boleta({
        montos: { ...boleta().montos, total: '4471' },
      });
      expect(codigo(() => emitir(malos))).toBe('TOTALES_NO_CIERRAN');
    });

    it('del TED y el folio: FOLIO_FUERA_DE_RANGO y CAF_OTRO_TIPO', () => {
      expect(codigo(() => emitir(boleta({ folio: 601 })))).toBe(
        'FOLIO_FUERA_DE_RANGO',
      );
      expect(
        codigo(() =>
          emitirBoleta(boleta(), { caf: caf41, certificado }, AHORA),
        ),
      ).toBe('CAF_OTRO_TIPO');
    });

    it('del texto: TEXTO_NO_ISO_8859_1', () => {
      const d = boleta();
      d.emisor.razonSocial = 'Łódź SpA';
      expect(codigo(() => emitir(d))).toBe('TEXTO_NO_ISO_8859_1');
    });

    it('sin líneas: SIN_LINEAS', () => {
      expect(codigo(() => emitir(boleta({ lineas: [] })))).toBe('SIN_LINEAS');
    });

    it('un error que no es DteError tampoco se envuelve: una llave ilegible llega tal cual', () => {
      let error: unknown;
      try {
        emitirBoleta(
          boleta(),
          { caf: caf39, certificado: { ...certificado, llavePrivadaPem: 'x' } },
          AHORA,
        );
      } catch (e) {
        error = e;
      }
      // El Error de crypto viene de otro realm de Node: no es `instanceof Error` en jest.
      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(DteError);
      expect((error as { codigo?: string }).codigo).toBeUndefined();
    });
  });
});

describe('armarEnvioBoleta', () => {
  it('la Carátula lleva el RUT del certificado, el SII de receptor y la hora que pasó quien llama', () => {
    const sobre = envio([emitir(boleta())]);
    expect(
      sobre.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>'),
    ).toBe(true);
    expect(sobre).toContain(
      `<EnvioBOLETA xmlns="${SII}" xmlns:xsi="${XSI}" xsi:schemaLocation="${SII} EnvioBOLETA_v11.xsd" version="1.0"><SetDTE ID="SetDoc">`,
    );
    expect(sobre).toContain(
      '<Caratula version="1.0"><RutEmisor>76543210-3</RutEmisor>' +
        `<RutEnvia>${certificado.rut}</RutEnvia><RutReceptor>60803000-K</RutReceptor>` +
        '<FchResol>2026-01-15</FchResol><NroResol>0</NroResol>' +
        '<TmstFirmaEnv>2026-10-14T12:00:00</TmstFirmaEnv>' +
        '<SubTotDTE><TpoDTE>39</TpoDTE><NroDTE>1</NroDTE></SubTotDTE></Caratula>',
    );
    expect(sobre).toMatch(
      /<\/SetDTE><Signature [^>]*>.*<\/Signature><\/EnvioBOLETA>$/s,
    );
  });

  it('tres boletas (39, 39, 41): SubTotDTE da 2 de tipo 39 y 1 de tipo 41, y todo verifica', async () => {
    const sobre = envio([
      emitir(boleta({ folio: 1 })),
      emitir(boleta({ folio: 2 })),
      emitir(exenta(1)),
    ]);
    expect(sobre).toContain(
      '<SubTotDTE><TpoDTE>39</TpoDTE><NroDTE>2</NroDTE></SubTotDTE>' +
        '<SubTotDTE><TpoDTE>41</TpoDTE><NroDTE>1</NroDTE></SubTotDTE></Caratula>',
    );
    expect(await valida(sobre)).toEqual({ valido: true, errores: [] });
    for (const n of [0, 1, 2, 3]) expect(verificar(sobre, n)).toBe(true);
  });

  it('la firma del SetDTE cubre los <DTE>: alterar uno dentro del sobre la rompe', () => {
    const sobre = envio([emitir(boleta()), emitir(boleta({ folio: 2 }))]);
    expect(verificar(sobre, 2)).toBe(true);
    const alterado = sobre.replace('<Folio>2</Folio>', '<Folio>3</Folio>');
    expect(alterado).not.toBe(sobre);
    expect(verificar(alterado, 2)).toBe(false);
  });

  it('500 boletas con un mismo CAF de 1 a 600: el sobre sale firmado y verifica', async () => {
    const boletas = Array.from({ length: 500 }, (_, i) =>
      emitir(boleta({ folio: i + 1 })),
    );
    const sobre = envio(boletas);
    expect(sobre.match(/<DTE /g)).toHaveLength(500);
    expect(sobre).toContain('<NroDTE>500</NroDTE>');
    expect(verificar(sobre, 500)).toBe(true); // la 501 es la del SetDTE
    expect(await valida(sobre)).toEqual({ valido: true, errores: [] });
  }, 120_000);

  it('un envío vacío da ENVIO_VACIO y uno de 501 boletas, ENVIO_DEMASIADAS_BOLETAS', () => {
    expect(codigo(() => envio([]))).toBe('ENVIO_VACIO');
    const b = emitir(boleta());
    expect(codigo(() => envio(Array<BoletaEmitida>(501).fill(b)))).toBe(
      'ENVIO_DEMASIADAS_BOLETAS',
    );
  });

  it('un RutEmisor inválido da RUT_INVALIDO', () => {
    expect(
      codigo(() =>
        armarEnvioBoleta(
          [emitir(boleta())],
          { ...caratula, rutEmisor: '76543210-4' },
          certificado,
          AHORA,
        ),
      ),
    ).toBe('RUT_INVALIDO');
  });

  it('BoletaEmitida lleva el RUT del emisor normalizado', () => {
    const d = boleta();
    d.emisor.rut = '76.543.210-3';
    expect(emitir(d).rutEmisor).toBe('76543210-3');
  });

  it('una boleta de otro emisor da ENVIO_OTRO_EMISOR', () => {
    const ajena: BoletaEmitida = {
      ...emitir(boleta()),
      rutEmisor: '77777777-7',
    };
    expect(codigo(() => envio([emitir(boleta({ folio: 2 })), ajena]))).toBe(
      'ENVIO_OTRO_EMISOR',
    );
  });

  it('el emisor de la boleta se compara con la Carátula normalizada', () => {
    expect(
      codigo(() =>
        armarEnvioBoleta(
          [emitir(boleta())],
          { ...caratula, rutEmisor: '76.543.210-3' },
          certificado,
          AHORA,
        ),
      ),
    ).toBe('NO_LANZO');
  });

  it('un mismo (tipo, folio) dos veces da ENVIO_FOLIO_REPETIDO; el mismo folio en otro tipo no', () => {
    const b = emitir(boleta({ folio: 5 }));
    expect(codigo(() => envio([b, emitir(boleta({ folio: 6 })), b]))).toBe(
      'ENVIO_FOLIO_REPETIDO',
    );
    expect(codigo(() => envio([b, emitir(exenta(5))]))).toBe('NO_LANZO');
  });

  it.each([-1, 1.5, Number.NaN, 1_000_000])(
    'NroResol %s da NRO_RESOL_INVALIDO',
    (nroResol) => {
      expect(
        codigo(() =>
          armarEnvioBoleta(
            [emitir(boleta())],
            { ...caratula, nroResol },
            certificado,
            AHORA,
          ),
        ),
      ).toBe('NRO_RESOL_INVALIDO');
    },
  );

  it.each([0, 999_999])('NroResol %s vale', (nroResol) => {
    expect(
      codigo(() =>
        armarEnvioBoleta(
          [emitir(boleta())],
          { ...caratula, nroResol },
          certificado,
          AHORA,
        ),
      ),
    ).toBe('NO_LANZO');
  });

  it.each(['15-01-2026', '2026-02-30', new Date().toISOString()])(
    'FchResol %s da FECHA_INVALIDA',
    (fchResol) => {
      expect(
        codigo(() =>
          armarEnvioBoleta(
            [emitir(boleta())],
            { ...caratula, fchResol },
            certificado,
            AHORA,
          ),
        ),
      ).toBe('FECHA_INVALIDA');
    },
  );

  it.each(['2026-10-14 12:00:00', '2026-10-14', new Date().toISOString()])(
    'TmstFirmaEnv %s da FECHA_INVALIDA',
    (ahora) => {
      expect(
        codigo(() =>
          armarEnvioBoleta([emitir(boleta())], caratula, certificado, ahora),
        ),
      ).toBe('FECHA_INVALIDA');
    },
  );

  it('el último cinturón: un sobre con un carácter fuera de ISO-8859-1 da TEXTO_NO_ISO_8859_1', () => {
    const euro = String.fromCharCode(0x20ac);
    const intruso: BoletaEmitida = {
      ...emitir(boleta()),
      xml: `<DTE version="1.0"><Documento ID="X">${euro}</Documento></DTE>`,
    };
    expect(codigo(() => envio([intruso]))).toBe('TEXTO_NO_ISO_8859_1');
  });

  it('un error de firma que no es DteError llega tal cual (un ID repetido es un bug de programación)', () => {
    const intruso: BoletaEmitida = {
      ...emitir(boleta()),
      xml: '<DTE version="1.0"><Documento ID="SetDoc"/></DTE>',
    };
    let error: unknown;
    try {
      envio([intruso]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DteError);
    expect((error as Error).message).toContain('SetDoc');
  });
});
