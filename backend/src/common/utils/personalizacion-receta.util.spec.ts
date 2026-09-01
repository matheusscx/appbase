import {
  detallePersonalizacion,
  hashPersonalizacion,
  hashReglasCongeladas,
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
      hashPersonalizacion({
        omitidos: [],
        extras: [{ ...base, unidades: '1' }],
      }),
    ).not.toBe(
      hashPersonalizacion({
        omitidos: [],
        extras: [{ ...base, unidades: '2' }],
      }),
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
            {
              itemId: 'coca',
              nombre: 'Coca-Cola',
              cantidad: '1',
              precioExtra: '0',
              unidades: '1',
            },
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
            {
              itemId: 'sprite',
              nombre: 'Sprite',
              cantidad: '1',
              precioExtra: '0',
              unidades: '1',
            },
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
              {
                itemId: 'coca',
                nombre: 'Coca-Cola',
                cantidad: '1',
                precioExtra,
                unidades: '1',
              },
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
        {
          itemId: 'coca',
          nombre: 'Coca-Cola',
          cantidad: '1',
          precioExtra: '0',
          unidades: '1',
        },
        {
          itemId: 'sprite',
          nombre: 'Sprite',
          cantidad: '1',
          precioExtra: '0',
          unidades: '1',
        },
      ],
    };
    const grupoB = {
      grupoId: 'g2',
      grupoNombre: 'Extra',
      opciones: [
        {
          itemId: 'papas',
          nombre: 'Papas',
          cantidad: '1',
          precioExtra: '500',
          unidades: '1',
        },
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
      hashPersonalizacion({
        omitidos: [],
        extras: [{ ...base, unidades: '1' }],
      }),
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
            {
              ingredienteItemId: 'i2',
              cantidad: '1',
              unidadCodigo: 'unidad',
              precioExtra: '1000',
            },
            {
              ingredienteItemId: 'i3',
              cantidad: '1',
              unidadCodigo: 'unidad',
              precioExtra: '750',
              unidades: '2',
            },
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
      detallePersonalizacion(
        { omitidos: ['id-desconocido'], extras: [] },
        new Map(),
      ),
    ).toEqual([{ nombre: 'id-desconocido', tipo: 'omitido', monto: '0' }]);
  });

  describe('hashReglasCongeladas', () => {
    const regla = (over = {}) => ({
      id: 'descuento-1',
      nombre: 'Promo',
      codigo: 'directo',
      modo: 'porcentaje',
      valorMonto: null,
      valorPorcentaje: '0.20',
      activo: true,
      vigente: true,
      tramos: [],
      metodoPagoIds: [],
      nivel: 'linea',
      ...over,
    });

    it('sin reglas y null dan la misma huella', () => {
      expect(hashReglasCongeladas(null)).toBe(
        hashReglasCongeladas({ descuentos: [], recargos: [] }),
      );
    });

    it('cambiar el VALOR cambia la huella aunque la regla sea la misma', () => {
      // Es la mitad que la decisión del owner protege: un 20% que pasa a 30% no
      // puede alcanzar a la mesa que ya pidió. Congelar solo el id la dejaría
      // pasar, porque el id no cambió.
      const veinte = { descuentos: [regla()], recargos: [] };
      const treinta = {
        descuentos: [regla({ valorPorcentaje: '0.30' })],
        recargos: [],
      };
      expect(hashReglasCongeladas(veinte)).not.toBe(
        hashReglasCongeladas(treinta),
      );
    });

    it('cambiar el CÓDIGO cambia la huella aunque el valor no se mueva', () => {
      // El caso que la primera versión de esta huella dejaba pasar, y no era
      // teórico: `codigo` es la estrategia de evaluación del motor —un
      // `pronto_pago` no aporta valor, un código de método de pago vuelve la
      // regla condicional—. Cambiarle el tipo a un descuento deja todos los
      // demás campos idénticos, así que con una lista blanca de campos la huella
      // no se movía y dos líneas que valen distinto se fusionaban (medido por
      // API: la segunda se quedaba con un 20% que ya no le tocaba).
      expect(
        hashReglasCongeladas({ descuentos: [regla()], recargos: [] }),
      ).not.toBe(
        hashReglasCongeladas({
          descuentos: [regla({ codigo: 'pronto_pago' })],
          recargos: [],
        }),
      );
    });

    it('un campo NUEVO del motor entra en la huella sin tocar este archivo', () => {
      // La propiedad que hace que el bug de `codigo` no se repita: no hay lista
      // blanca. Cualquier campo que el motor agregue viaja en el `rest`.
      expect(
        hashReglasCongeladas({ descuentos: [regla()], recargos: [] }),
      ).not.toBe(
        hashReglasCongeladas({
          descuentos: [regla({ campoQueElMotorAgregoMañana: 'x' })],
          recargos: [],
        }),
      );
    });

    it('renombrar la regla NO cambia la huella', () => {
      // La única exclusión, y por el lado seguro: un rename no mueve un peso, y
      // si contara partiría en dos una línea que el garzón espera ver junta.
      expect(
        hashReglasCongeladas({ descuentos: [regla()], recargos: [] }),
      ).toBe(
        hashReglasCongeladas({
          descuentos: [regla({ nombre: 'Promo renombrada' })],
          recargos: [],
        }),
      );
    });

    it('el ORDEN de un array no cambia la huella', () => {
      // Medido antes del arreglo: `metodoPagoIds` sale de un `find` sin
      // `ORDER BY`, así que un `UPDATE` sobre su fila puente —el soft delete
      // escribe ahí— devolvía el array al revés y partía en dos una línea que
      // debía ir junta. La misma regla, los mismos métodos, la misma plata.
      expect(
        hashReglasCongeladas({
          descuentos: [regla({ metodoPagoIds: ['efectivo', 'debito'] })],
          recargos: [],
        }),
      ).toBe(
        hashReglasCongeladas({
          descuentos: [regla({ metodoPagoIds: ['debito', 'efectivo'] })],
          recargos: [],
        }),
      );
    });

    it('el orden de los TRAMOS tampoco', () => {
      // Los tramos se evalúan por umbral, no por posición: dos listas con los
      // mismos tramos en otro orden son la misma regla.
      const tramo = (minimoCantidad: string, valorPorcentaje: string) => ({
        minimoCantidad,
        minimoMonto: null,
        valorMonto: null,
        valorPorcentaje,
      });
      expect(
        hashReglasCongeladas({
          descuentos: [
            regla({ tramos: [tramo('3', '0.10'), tramo('6', '0.20')] }),
          ],
          recargos: [],
        }),
      ).toBe(
        hashReglasCongeladas({
          descuentos: [
            regla({ tramos: [tramo('6', '0.20'), tramo('3', '0.10')] }),
          ],
          recargos: [],
        }),
      );
    });

    it('una clave con `undefined` hashea igual que la clave ausente', () => {
      // El round-trip por `jsonb` borra las claves `undefined`. Si la huella las
      // emitiera, la de lo que está por guardarse y la de lo que vuelve de la
      // base no coincidirían nunca y nada volvería a fusionarse.
      expect(
        hashReglasCongeladas({
          descuentos: [{ id: 'd', valorMonto: undefined }],
          recargos: [],
        }),
      ).toBe(hashReglasCongeladas({ descuentos: [{ id: 'd' }], recargos: [] }));
    });

    it('el ORDEN de las propiedades no cambia la huella', () => {
      const derecho = { id: 'd', modo: 'porcentaje', valorPorcentaje: '0.20' };
      const alReves = { valorPorcentaje: '0.20', modo: 'porcentaje', id: 'd' };
      expect(
        hashReglasCongeladas({ descuentos: [derecho], recargos: [] }),
      ).toBe(hashReglasCongeladas({ descuentos: [alReves], recargos: [] }));
    });

    it('pausar la regla, vencerla o cambiarle un tramo también cambian la huella', () => {
      const base = { descuentos: [regla()], recargos: [] };
      for (const distinta of [
        { descuentos: [regla({ activo: false })], recargos: [] },
        { descuentos: [regla({ vigente: false })], recargos: [] },
        {
          descuentos: [
            regla({
              tramos: [
                {
                  minimoCantidad: '3',
                  minimoMonto: null,
                  valorMonto: null,
                  valorPorcentaje: '0.30',
                },
              ],
            }),
          ],
          recargos: [],
        },
        { descuentos: [regla({ metodoPagoIds: ['efectivo'] })], recargos: [] },
      ]) {
        expect(hashReglasCongeladas(base)).not.toBe(
          hashReglasCongeladas(distinta),
        );
      }
    });

    it('el ORDEN de las reglas no cambia la huella', () => {
      // Si lo cambiara, dos líneas idénticas dejarían de fusionarse por un
      // `ORDER BY` distinto en la consulta que las trajo.
      const a = regla();
      const b = regla({ id: 'descuento-2', valorPorcentaje: '0.10' });
      expect(hashReglasCongeladas({ descuentos: [a, b], recargos: [] })).toBe(
        hashReglasCongeladas({ descuentos: [b, a], recargos: [] }),
      );
    });

    it('un descuento y un recargo con los mismos valores NO son la misma huella', () => {
      const r = regla();
      expect(hashReglasCongeladas({ descuentos: [r], recargos: [] })).not.toBe(
        hashReglasCongeladas({ descuentos: [], recargos: [r] }),
      );
    });
  });
});
