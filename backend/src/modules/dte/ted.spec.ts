import { DOMParser } from '@xmldom/xmldom';
import { createVerify } from 'crypto';
import { C14nCanonicalization } from 'xml-crypto';
import { cafDePrueba } from './__fixtures__/credenciales-prueba';
import { envolverParaXsd } from './__fixtures__/envio-boleta';
import { validarContraXsd } from './__fixtures__/xsd';
import { armarDocumento } from './boleta-documento';
import { type CafLeido, leerCaf } from './caf';
import type { DatosBoleta, LineaBoleta } from './dte.types';
import { armarTed } from './ted';
import { aLatin1 } from './texto';

const TSTED = '2026-10-14T12:00:00';

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
    comuna: 'Ñuñoa',
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

const conReceptor = (nombre?: string, rut = '12.345.678-5') =>
  boleta({ receptor: { rut, nombre } });

const cafXml = (razonSocial?: string) =>
  cafDePrueba({
    rut: '76543210-3',
    tipo: 39,
    desde: 101,
    hasta: 150,
    razonSocial,
  });

const dd = (ted: string) =>
  ted.slice(ted.indexOf('<DD>'), ted.indexOf('</DD>') + '</DD>'.length);

/** La regla del SII (medida en la Task 1): sin los blancos entre tags, en latin1. */
const aplanado = (ted: string) => dd(ted).replace(/>\s+</g, '><');

const frmt = (ted: string) =>
  /<FRMT algoritmo="SHA1withRSA">([^<]*)<\/FRMT>/.exec(ted)![1];

const verifica = (caf: CafLeido, ddAplanado: string, firma: string) =>
  createVerify('RSA-SHA1')
    .update(Buffer.from(ddAplanado, 'latin1'))
    .verify(caf.llavePublica, firma, 'base64');

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { codigo?: string }).codigo;
  }
  return 'NO_LANZO';
};

describe('armarTed', () => {
  const xml = cafXml();
  const caf = leerCaf(xml);

  it('arma <TED version="1.0"> con el DD en el orden del XSD y el FRMT al final', () => {
    const ted = armarTed(conReceptor('Juana Pérez'), caf, TSTED);
    expect(ted.startsWith('<TED version="1.0"><DD>')).toBe(true);
    expect(ted.endsWith('</FRMT></TED>')).toBe(true);
    const sinCaf = dd(ted).replace(caf.xmlCaf, '<CAF/>');
    expect(sinCaf).toBe(
      '<DD><RE>76543210-3</RE><TD>39</TD><F>101</F><FE>2026-10-14</FE>' +
        '<RR>12345678-5</RR><RSR>Juana Pérez</RSR><MNT>4470</MNT>' +
        '<IT1>Café</IT1><CAF/><TSTED>2026-10-14T12:00:00</TSTED></DD>',
    );
  });

  it('el FRMT verifica con la llave pública del CAF sobre el DD aplanado en latin1', () => {
    const ted = armarTed(conReceptor('Juana Pérez'), caf, TSTED);
    expect(verifica(caf, aplanado(ted), frmt(ted))).toBe(true);
  });

  it('el <CAF> del TED es byte a byte el del archivo', () => {
    const ted = armarTed(boleta(), caf, TSTED);
    expect(xml.includes(caf.xmlCaf)).toBe(true);
    expect(ted.includes(caf.xmlCaf)).toBe(true);
    expect(caf.xmlCaf).toContain('\n'); // el aplanado no toca lo que se copia
  });

  it('cambiar un dígito de MNT después de firmar hace fallar la verificación', () => {
    const ted = armarTed(boleta(), caf, TSTED);
    const alterado = aplanado(ted).replace(
      '<MNT>4470</MNT>',
      '<MNT>4471</MNT>',
    );
    expect(alterado).not.toBe(aplanado(ted));
    expect(verifica(caf, alterado, frmt(ted))).toBe(false);
  });

  it('con tildes y Ñ en el receptor y en el RS del CAF, tras aLatin1 el CAF sigue idéntico y el FRMT verifica', () => {
    const cafTildes = cafXml('Panadería Ñuñoa SpA');
    const leido = leerCaf(cafTildes);
    const ted = armarTed(conReceptor('José Muñoz Peña'), leido, TSTED);
    const releido = aLatin1(ted).toString('latin1');
    expect(releido).toBe(ted);
    expect(
      releido.includes(
        cafTildes.slice(
          cafTildes.indexOf('<CAF'),
          cafTildes.indexOf('</CAF>') + 6,
        ),
      ),
    ).toBe(true);
    expect(releido).toContain('<RS>Panadería Ñuñoa SpA</RS>');
    expect(verifica(leido, aplanado(releido), frmt(releido))).toBe(true);
  });

  it('con \', " y & en RSR e IT1 el FRMT verifica sobre el DD crudo y sobre el DD canonicalizado', () => {
    const ted = armarTed(
      {
        ...conReceptor(`Café d'Or "Ltda" & Cía`),
        lineas: [linea({ nombre: `Pan d'or "x" & Co` })],
      },
      caf,
      TSTED,
    );
    // Las comillas y el apóstrofo van crudos; solo & < > se escapan.
    expect(ted).toContain(`<RSR>Café d'Or "Ltda" &amp; Cía</RSR>`);
    expect(ted).toContain(`<IT1>Pan d'or "x" &amp; Co</IT1>`);
    expect(ted).not.toContain('&quot;');
    expect(ted).not.toContain('&apos;');

    // Lectura 1: el verificador firma/verifica el DD crudo que viaja.
    expect(verifica(caf, aplanado(ted), frmt(ted))).toBe(true);

    // Lectura 2: el verificador parsea el <DD> y lo canonicaliza (C14N inclusivo).
    const nodo = new DOMParser().parseFromString(dd(ted), 'text/xml')
      .documentElement as unknown as Node;
    const canonico = new C14nCanonicalization()
      .process(nodo, {})
      .replace(/>\s+</g, '><');
    expect(verifica(caf, canonico, frmt(ted))).toBe(true);
  });

  it('RSR e IT1 salen a 40 caracteres cuando el origen es más largo', () => {
    const nombre = 'ABCDEFGHIJ'.repeat(6); // 60
    const ted = armarTed(
      { ...conReceptor(nombre), lineas: [linea({ nombre: 'Z'.repeat(70) })] },
      caf,
      TSTED,
    );
    expect(ted).toContain(`<RSR>${nombre.slice(0, 40)}</RSR>`);
    expect(ted).toContain(`<IT1>${'Z'.repeat(40)}</IT1>`);
    expect(verifica(caf, aplanado(ted), frmt(ted))).toBe(true);
  });

  it('corta antes de escapar: un & en la posición 40 sale entero como &amp;', () => {
    const nombre = `${'A'.repeat(39)}&BBB`;
    const ted = armarTed(conReceptor(nombre), caf, TSTED);
    expect(ted).toContain(`<RSR>${'A'.repeat(39)}&amp;</RSR>`);
    const it = armarTed(
      boleta({ lineas: [linea({ nombre: `${'A'.repeat(39)}<BBB` })] }),
      caf,
      TSTED,
    );
    expect(it).toContain(`<IT1>${'A'.repeat(39)}&lt;</IT1>`);
  });

  it('el texto de origen se valida completo, aunque lo que sale quepa en 40', () => {
    expect(
      codigo(() => armarTed(conReceptor('N'.repeat(101)), caf, TSTED)),
    ).toBe('TEXTO_DEMASIADO_LARGO');
    expect(
      codigo(() =>
        armarTed(
          boleta({ lineas: [linea({ nombre: 'N'.repeat(81) })] }),
          caf,
          TSTED,
        ),
      ),
    ).toBe('TEXTO_DEMASIADO_LARGO');
    expect(codigo(() => armarTed(conReceptor('Juana €'), caf, TSTED))).toBe(
      'TEXTO_NO_ISO_8859_1',
    );
  });

  it('sin receptor: RR genérico y RSR vacío como el par <RSR></RSR>', () => {
    const ted = armarTed(boleta(), caf, TSTED);
    expect(ted).toContain('<RR>66666666-6</RR><RSR></RSR><MNT>');
    expect(ted).not.toContain('<RSR/>');
    expect(verifica(caf, aplanado(ted), frmt(ted))).toBe(true);
  });

  it('receptor con RUT pero sin nombre: RR del receptor y RSR vacío', () => {
    const ted = armarTed(conReceptor(undefined), caf, TSTED);
    expect(ted).toContain('<RR>12345678-5</RR><RSR></RSR>');
  });

  it('una boleta sin líneas da SIN_LINEAS, sin TED', () => {
    expect(codigo(() => armarTed(boleta({ lineas: [] }), caf, TSTED))).toBe(
      'SIN_LINEAS',
    );
  });

  it('un RUT de receptor inválido da RUT_INVALIDO', () => {
    expect(
      codigo(() => armarTed(conReceptor('Juana', '12.345.678-9'), caf, TSTED)),
    ).toBe('RUT_INVALIDO');
  });

  it('un folio fuera del rango del CAF da FOLIO_FUERA_DE_RANGO, sin TED', () => {
    expect(codigo(() => armarTed(boleta({ folio: 151 }), caf, TSTED))).toBe(
      'FOLIO_FUERA_DE_RANGO',
    );
    expect(codigo(() => armarTed(boleta({ folio: 100 }), caf, TSTED))).toBe(
      'FOLIO_FUERA_DE_RANGO',
    );
  });

  it('un CAF de otro RUT o de otro tipo no timbra', () => {
    const ajeno = leerCaf(
      cafDePrueba({ rut: '77777777-7', tipo: 39, desde: 101, hasta: 150 }),
    );
    expect(codigo(() => armarTed(boleta(), ajeno, TSTED))).toBe('CAF_OTRO_RUT');
    expect(codigo(() => armarTed(boleta({ tipo: 41 }), caf, TSTED))).toBe(
      'CAF_OTRO_TIPO',
    );
  });

  it('el Documento con el TED real es válido contra el XSD', async () => {
    const datos = conReceptor('Juana Pérez & Hijos');
    const ted = armarTed(datos, caf, TSTED);
    const { xml: documento } = armarDocumento(datos, ted, TSTED);
    const r = await validarContraXsd(
      envolverParaXsd(documento, 39),
      'EnvioBOLETA_v11_formato42.xsd',
      ['xmldsignature_v10.xsd'],
    );
    expect(r.errores).toEqual([]);
    expect(r.valido).toBe(true);
  });

  it('también es válido sin receptor (RSR vacío) contra el XSD', async () => {
    const datos = boleta();
    const ted = armarTed(datos, caf, TSTED);
    const { xml: documento } = armarDocumento(datos, ted, TSTED);
    const r = await validarContraXsd(
      envolverParaXsd(documento, 39),
      'EnvioBOLETA_v11_formato42.xsd',
      ['xmldsignature_v10.xsd'],
    );
    expect(r.errores).toEqual([]);
  });
});
