import { DteError } from './dte.types';
import {
  aLatin1,
  escaparXml,
  validarFecha,
  validarFechaHora,
  validarTexto,
} from './texto';

describe('validarTexto', () => {
  it('acepta tildes y eñes, que están en ISO-8859-1', () => {
    expect(validarTexto('RznSocEmisor', 'Panadería Ñuñoa', 100)).toBe(
      'Panadería Ñuñoa',
    );
  });

  it.each(['Pizza 🍕', 'Café – especial', 'Té “verde”'])(
    'rechaza %s: tiene un carácter fuera de ISO-8859-1',
    (valor) => {
      expect(() => validarTexto('NmbItem', valor, 80)).toThrow(
        expect.objectContaining({ codigo: 'TEXTO_NO_ISO_8859_1' }),
      );
    },
  );

  it('acepta exactamente el máximo y rechaza uno más, sin cortar', () => {
    expect(validarTexto('NmbItem', 'a'.repeat(80), 80)).toHaveLength(80);
    expect(() => validarTexto('NmbItem', 'a'.repeat(81), 80)).toThrow(
      expect.objectContaining({ codigo: 'TEXTO_DEMASIADO_LARGO' }),
    );
  });

  it('el mensaje nombra el campo', () => {
    expect(() => validarTexto('GiroEmisor', 'x'.repeat(81), 80)).toThrow(
      /GiroEmisor/,
    );
  });

  it('es DteError', () => {
    expect(() => validarTexto('NmbItem', '🍕', 80)).toThrow(DteError);
  });
});

describe('escaparXml', () => {
  it('escapa solo & < >, y deja las comillas y el apóstrofo crudos', () => {
    expect(escaparXml(`A&B <C> "D" 'E'`)).toBe(`A&amp;B &lt;C&gt; "D" 'E'`);
  });

  it('escapa el & primero: no vuelve a escapar lo que acaba de escapar', () => {
    expect(escaparXml('&lt;')).toBe('&amp;lt;');
  });
});

const fechaMala = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { codigo?: string }).codigo;
  }
  return 'NO_LANZO';
};

describe('validarFecha', () => {
  it.each(['2026-10-14', '2028-02-29', '2026-12-31', '2026-01-01'])(
    'acepta %s',
    (f) => {
      expect(validarFecha('FchEmis', f)).toBe(f);
    },
  );

  it.each([
    '14-10-2026',
    '2026-10-14T12:00:00',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-04-31',
    '2026-1-4',
    '',
    ' 2026-10-14',
  ])('rechaza %j con FECHA_INVALIDA', (f) => {
    expect(fechaMala(() => validarFecha('FchEmis', f))).toBe('FECHA_INVALIDA');
  });

  it('el mensaje nombra el campo', () => {
    expect(() => validarFecha('FchResol', '14-10-2026')).toThrow(/FchResol/);
  });
});

describe('validarFechaHora', () => {
  it.each([
    '2026-10-14T12:00:00',
    '2026-10-14T00:00:00',
    '2026-10-14T23:59:59',
  ])('acepta %s', (f) => {
    expect(validarFechaHora('TSTED', f)).toBe(f);
  });

  it.each([
    '2026-10-14 12:00:00',
    new Date('2026-10-14T12:00:00Z').toISOString(),
    '2026-10-14',
    '2026-02-30T10:00:00',
    '2026-10-14T24:00:00',
    '2026-10-14T12:60:00',
    '2026-10-14T12:00:60',
    '2026-10-14T1:00:00',
  ])('rechaza %j con FECHA_INVALIDA', (f) => {
    expect(fechaMala(() => validarFechaHora('TSTED', f))).toBe(
      'FECHA_INVALIDA',
    );
  });
});

describe('aLatin1', () => {
  it('codifica la ñ como un byte (0xF1), no como dos de UTF-8', () => {
    expect([...aLatin1('ñ')]).toEqual([0xf1]);
  });
});
