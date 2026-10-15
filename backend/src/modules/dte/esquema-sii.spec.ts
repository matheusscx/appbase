import {
  cafDePrueba,
  certificadoDePrueba,
} from './__fixtures__/credenciales-prueba';
import { type CafLeido, leerCaf } from './caf';
import type { DatosBoleta } from './dte.types';
import { armarEnvioBoleta, emitirBoleta } from './envio-boleta';
import { revisarSobreBoleta, validarContraXsd } from './esquema-sii';
import { leerCertificado } from './firma';

const AHORA = '2026-10-14T12:00:00';

const boleta = (folio: number): DatosBoleta => ({
  tipo: 39,
  folio,
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
  lineas: [
    {
      nombre: 'Café',
      cantidad: '3',
      precioUnitario: '1490',
      monto: '4470',
      exenta: false,
    },
  ],
  ajustesGlobales: [],
  montos: {
    neto: '3756',
    exento: '0',
    iva: '714',
    total: '4470',
    adicionales: '0',
  },
});

const caf: CafLeido = leerCaf(
  cafDePrueba({
    rut: '76543210-3',
    tipo: 39,
    desde: 1,
    hasta: 600,
    razonSocial: 'Panadería Ñuñoa SpA',
  }),
);
const { pfx, clave } = certificadoDePrueba();
const certificado = leerCertificado(pfx, clave);

describe('revisarSobreBoleta', () => {
  const sobre = armarEnvioBoleta(
    [101, 102].map((folio) =>
      emitirBoleta(boleta(folio), { caf, certificado }, AHORA),
    ),
    {
      rutEmisor: '76543210-3',
      rutReceptor: '60803000-K',
      fchResol: '2026-01-15',
      nroResol: 0,
    },
    certificado,
    AHORA,
  );

  it('un sobre que cumple el esquema pasa sin mirar cada boleta', async () => {
    expect(await revisarSobreBoleta(sobre)).toEqual({ valido: true });
  });

  it('una boleta con un elemento que el esquema no conoce: falla el sobre y se aísla esa sola', async () => {
    const roto = sobre.replace(
      '<Folio>102</Folio>',
      '<Folio>102</Folio><Basura>1</Basura>',
    );
    expect(roto).not.toBe(sobre);
    const r = await revisarSobreBoleta(roto);
    expect(r.valido).toBe(false);
    if (r.valido) return;
    expect(r.invalidos.map((d) => [d.tipo, d.folio])).toEqual([[39, 102]]);
    expect(r.invalidos[0].errores.join(' ')).toContain('Basura');
  });

  it('un error en la carátula: falla el sobre y ninguna boleta falla sola', async () => {
    const roto = sobre.replace('<RutEnvia>', '<Basura>1</Basura><RutEnvia>');
    expect(roto).not.toBe(sobre);
    const r = await revisarSobreBoleta(roto);
    expect(r).toMatchObject({ valido: false, invalidos: [] });
    if (!r.valido) expect(r.errores.length).toBeGreaterThan(0);
  });

  it('recorta los errores: a lo más 5 por boleta, de a lo más 300 caracteres', async () => {
    // Seis valores inválidos en la misma boleta, uno de ellos larguísimo: libxml da un error por
    // campo y repite el valor en el mensaje. Un solo elemento ajeno da un error corto (medido: 1).
    const roto = sobre
      .replace(
        /(<Folio>102<\/Folio>[\s\S]*?)<FchEmis>[^<]+<\/FchEmis>/,
        `$1<FchEmis>${'z'.repeat(400)}</FchEmis>`,
      )
      .replace(
        /(<Folio>102<\/Folio>[\s\S]*?)<MntNeto>\d+<\/MntNeto>/,
        '$1<MntNeto>x</MntNeto>',
      )
      .replace(/(<Folio>102<\/Folio>[\s\S]*?)<IVA>\d+<\/IVA>/, '$1<IVA>x</IVA>')
      .replace(
        /(<Folio>102<\/Folio>[\s\S]*?)<MntTotal>\d+<\/MntTotal>/,
        '$1<MntTotal>x</MntTotal>',
      )
      .replace(
        /(<Folio>102<\/Folio>[\s\S]*?)<PrcItem>[^<]+<\/PrcItem>/,
        '$1<PrcItem>x</PrcItem>',
      )
      .replace(
        /(<Folio>102<\/Folio>[\s\S]*?)<QtyItem>[^<]+<\/QtyItem>/,
        '$1<QtyItem>x</QtyItem>',
      );
    const sinRecortar = await validarContraXsd(
      roto,
      'EnvioBOLETA_v11_formato42.xsd',
      ['xmldsignature_v10.xsd'],
    );
    expect(sinRecortar.errores.length).toBeGreaterThan(5);
    expect(sinRecortar.errores.some((e) => e.length > 300)).toBe(true);

    const r = await revisarSobreBoleta(roto);
    if (r.valido) throw new Error('debía fallar');
    expect(r.invalidos.map((d) => d.folio)).toEqual([102]);
    expect(r.invalidos[0].errores).toHaveLength(5);
    expect(r.invalidos[0].errores.every((e) => e.length <= 300)).toBe(true);
    expect(r.errores).toHaveLength(5);
    expect(r.errores.every((e) => e.length <= 300)).toBe(true);
  });
});
