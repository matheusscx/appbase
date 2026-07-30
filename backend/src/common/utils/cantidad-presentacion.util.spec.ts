import { BadRequestException } from '@nestjs/common';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
  resolverUnidadBaseDeItem,
} from './cantidad-presentacion.util';

const CAT = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
  { codigo: 'ml', magnitud: 'volumen', factorBase: '1' },
  { codigo: 'l', magnitud: 'volumen', factorBase: '1000' },
];

describe('cantidad-presentacion.util', () => {
  it('500 g → 0.5 kg', () => {
    const r = resolverCantidadDesdePresentacion({
      cantidadPresentacion: '500',
      unidadCodigoPresentacion: 'g',
      unidadBaseCodigo: 'kg',
      catalogo: CAT,
    });
    expect(r.cantidadCanonica).toBe('0.5');
  });

  it('rechaza cross-magnitud', () => {
    expect(() =>
      resolverCantidadDesdePresentacion({
        cantidadPresentacion: '1',
        unidadCodigoPresentacion: 'l',
        unidadBaseCodigo: 'kg',
        catalogo: CAT,
      }),
    ).toThrow(BadRequestException);
  });

  it('conteo rechaza decimal', () => {
    expect(() =>
      resolverCantidadDesdePresentacion({
        cantidadPresentacion: '0.5',
        unidadCodigoPresentacion: 'unidad',
        unidadBaseCodigo: 'unidad',
        catalogo: CAT,
        forzarConteo: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('assertPresentacionPareada exige ambos o ninguno', () => {
    expect(() => assertPresentacionPareada('1', undefined)).toThrow(
      BadRequestException,
    );
    expect(() => assertPresentacionPareada(undefined, 'g')).toThrow(
      BadRequestException,
    );
    expect(() => assertPresentacionPareada(undefined, undefined)).not.toThrow();
  });

  describe('resolverUnidadBaseDeItem', () => {
    // La razón de existir de esta función: los tres carritos derivaban esto por
    // su cuenta y el `combo` había quedado distinto entre venta y checkout.
    it('receta y combo se venden de a uno, en unidades enteras', () => {
      for (const tipo of ['receta', 'combo']) {
        expect(resolverUnidadBaseDeItem({ tipo })).toEqual({
          unidadBaseCodigo: 'unidad',
          forzarConteo: true,
        });
      }
    });

    it('receta y combo ignoran cualquier unidadMedida que traiga la fila', () => {
      // Hoy siempre viene `null` (no tienen fila en `item_producto`), y es
      // justamente eso lo que tapaba la divergencia entre los tres call sites:
      // el `?? 'unidad'` del camino equivocado daba el mismo resultado. Fijar
      // el caso no-null deja la unificación probada por sí misma, sin depender
      // de un invariante de otro archivo.
      expect(
        resolverUnidadBaseDeItem({ tipo: 'combo', unidadMedida: 'kg' }),
      ).toEqual({ unidadBaseCodigo: 'unidad', forzarConteo: true });
    });

    it('un producto usa su unidad de medida y no fuerza entero', () => {
      expect(
        resolverUnidadBaseDeItem({ tipo: 'producto', unidadMedida: 'kg' }),
      ).toEqual({ unidadBaseCodigo: 'kg', forzarConteo: false });
    });

    it('un producto sin unidad cae en unidad', () => {
      expect(
        resolverUnidadBaseDeItem({ tipo: 'producto', unidadMedida: null }),
      ).toEqual({ unidadBaseCodigo: 'unidad', forzarConteo: false });
    });
  });
});
