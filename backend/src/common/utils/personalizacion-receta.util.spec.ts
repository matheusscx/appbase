import {
  detallePersonalizacion,
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

  it('hash estable sin importar orden de extras', () => {
    const extraA = {
      ingredienteItemId: 'i1',
      cantidad: '1',
      unidadCodigo: 'unidad',
      precioExtra: '500',
    };
    const extraB = {
      ingredienteItemId: 'i2',
      cantidad: '2',
      unidadCodigo: 'unidad',
      precioExtra: '800',
    };
    const a = hashPersonalizacion({
      omitidos: [],
      extras: [extraB, extraA],
    });
    const b = hashPersonalizacion({
      omitidos: [],
      extras: [extraA, extraB],
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

  it('hash distinto si cambian las unidades de un extra', () => {
    const base = {
      ingredienteItemId: 'i1',
      cantidad: '1',
      unidadCodigo: 'unidad',
      precioExtra: '500',
    };
    expect(
      hashPersonalizacion({ omitidos: [], extras: [{ ...base, unidades: '1' }] }),
    ).not.toBe(
      hashPersonalizacion({ omitidos: [], extras: [{ ...base, unidades: '2' }] }),
    );
  });

  it('hash distinto si cambia la opción elegida en un grupo (combos)', () => {
    const base = { omitidos: [], extras: [] };
    const a = hashPersonalizacion({
      ...base,
      grupos: [
        {
          grupoId: 'g1',
          grupoNombre: 'Bebida',
          opciones: [
            { itemId: 'coca', nombre: 'Coca-Cola', cantidad: '1', precioExtra: '0', unidades: '1' },
          ],
        },
      ],
    });
    const b = hashPersonalizacion({
      ...base,
      grupos: [
        {
          grupoId: 'g1',
          grupoNombre: 'Bebida',
          opciones: [
            { itemId: 'sprite', nombre: 'Sprite', cantidad: '1', precioExtra: '0', unidades: '1' },
          ],
        },
      ],
    });
    expect(a).not.toBe(b);
  });

  it('hash distinto si la misma opción de grupo cambia de precioExtra', () => {
    const base = { omitidos: [], extras: [] };
    const conGrupo = (precioExtra: string) =>
      hashPersonalizacion({
        ...base,
        grupos: [
          {
            grupoId: 'g1',
            grupoNombre: 'Bebida',
            opciones: [
              { itemId: 'coca', nombre: 'Coca-Cola', cantidad: '1', precioExtra, unidades: '1' },
            ],
          },
        ],
      });
    expect(conGrupo('0')).not.toBe(conGrupo('1500'));
  });

  it('hash de grupos estable sin importar el orden de grupos/opciones', () => {
    const grupoA = {
      grupoId: 'g1',
      grupoNombre: 'Bebida',
      opciones: [
        { itemId: 'coca', nombre: 'Coca-Cola', cantidad: '1', precioExtra: '0', unidades: '1' },
        { itemId: 'sprite', nombre: 'Sprite', cantidad: '1', precioExtra: '0', unidades: '1' },
      ],
    };
    const grupoB = {
      grupoId: 'g2',
      grupoNombre: 'Extra',
      opciones: [
        { itemId: 'papas', nombre: 'Papas', cantidad: '1', precioExtra: '500', unidades: '1' },
      ],
    };
    const a = hashPersonalizacion({
      omitidos: [],
      extras: [],
      grupos: [grupoA, grupoB],
    });
    const b = hashPersonalizacion({
      omitidos: [],
      extras: [],
      grupos: [
        { ...grupoB },
        { ...grupoA, opciones: [...grupoA.opciones].reverse() },
      ],
    });
    expect(a).toBe(b);
  });

  it('hash sin grupos coincide con snapshot que trae grupos: [] explícito', () => {
    const a = hashPersonalizacion({ omitidos: [], extras: [] });
    const b = hashPersonalizacion({ omitidos: [], extras: [], grupos: [] });
    expect(a).toBe(b);
  });

  it('hash trata unidades ausente como 1 (compat snapshots antiguos)', () => {
    const base = {
      ingredienteItemId: 'i1',
      cantidad: '1',
      unidadCodigo: 'unidad',
      precioExtra: '500',
    };
    expect(hashPersonalizacion({ omitidos: [], extras: [{ ...base }] })).toBe(
      hashPersonalizacion({ omitidos: [], extras: [{ ...base, unidades: '1' }] }),
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

  it('textoComanda muestra xN cuando unidades > 1', () => {
    const nombres = new Map([['i2', 'Queso']]);
    expect(
      textoComandaPersonalizacion(
        {
          omitidos: [],
          extras: [
            {
              ingredienteItemId: 'i2',
              cantidad: '1',
              unidadCodigo: 'unidad',
              precioExtra: '800',
              unidades: '3',
            },
          ],
        },
        nombres,
      ),
    ).toBe('Extra Queso x3');
  });

  it('detallePersonalizacion devuelve [] si no hay personalización', () => {
    expect(detallePersonalizacion(null, new Map())).toEqual([]);
    expect(detallePersonalizacion(undefined, new Map())).toEqual([]);
  });

  it('detallePersonalizacion arma omitidos primero en $0 y extras con su monto (precioExtra x unidades)', () => {
    const nombres = new Map([
      ['i1', 'Cebolla'],
      ['i2', 'Queso Cheddar'],
      ['i3', 'Tocino'],
    ]);
    expect(
      detallePersonalizacion(
        {
          omitidos: ['i1'],
          extras: [
            { ingredienteItemId: 'i2', cantidad: '1', unidadCodigo: 'unidad', precioExtra: '1000' },
            { ingredienteItemId: 'i3', cantidad: '1', unidadCodigo: 'unidad', precioExtra: '750', unidades: '2' },
          ],
        },
        nombres,
      ),
    ).toEqual([
      { nombre: 'Cebolla', tipo: 'omitido', monto: '0' },
      { nombre: 'Queso Cheddar', tipo: 'extra', unidades: 1, monto: '1000' },
      { nombre: 'Tocino', tipo: 'extra', unidades: 2, monto: '1500' },
    ]);
  });

  it('detallePersonalizacion usa el id como fallback si el nombre no está en el mapa', () => {
    expect(
      detallePersonalizacion({ omitidos: ['id-desconocido'], extras: [] }, new Map()),
    ).toEqual([{ nombre: 'id-desconocido', tipo: 'omitido', monto: '0' }]);
  });
});
