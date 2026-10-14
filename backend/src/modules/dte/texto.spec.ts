import { DteError } from './dte.types';
import { aLatin1, escaparXml, validarTexto } from './texto';

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

describe('aLatin1', () => {
  it('codifica la ñ como un byte (0xF1), no como dos de UTF-8', () => {
    expect([...aLatin1('ñ')]).toEqual([0xf1]);
  });
});
