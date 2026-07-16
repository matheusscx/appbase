import {
  hashPersonalizacion,
  textoComandaPersonalizacion,
} from './personalizacion-receta.util';

describe('personalizacion-receta.util', () => {
  it('hash estable sin importar orden de omitidos', () => {
    const a = hashPersonalizacion({
      omitidos: ['b', 'a'],
      extras: [],
    });
    const b = hashPersonalizacion({
      omitidos: ['a', 'b'],
      extras: [],
    });
    expect(a).toBe(b);
  });

  it('hash distinto si cambia comentario', () => {
    expect(
      hashPersonalizacion({ omitidos: [], extras: [], comentario: 'medio' }),
    ).not.toBe(
      hashPersonalizacion({ omitidos: [], extras: [], comentario: 'jugoso' }),
    );
  });

  it('textoComanda arma Sin / Extra / comentario', () => {
    const nombres = new Map([
      ['i1', 'Cebolla'],
      ['i2', 'Queso'],
    ]);
    expect(
      textoComandaPersonalizacion(
        {
          omitidos: ['i1'],
          extras: [
            {
              ingredienteItemId: 'i2',
              cantidad: '1',
              unidadCodigo: 'unidad',
              precioExtra: '800',
            },
          ],
          comentario: 'término medio',
        },
        nombres,
      ),
    ).toBe('Sin Cebolla · Extra Queso · término medio');
  });
});
