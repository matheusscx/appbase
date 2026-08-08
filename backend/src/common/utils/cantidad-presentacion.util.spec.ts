import { BadRequestException } from '@nestjs/common';
import {
  assertPresentacionPareada,
  presentacionDesdeCanonica,
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

  // El camino inverso, que existe para el merge de líneas: la canónica ya
  // sumada se reescribe en la unidad que la línea venía mostrando.
  describe('presentacionDesdeCanonica', () => {
    it('1500 g canónicos en una línea que muestra g → 1500', () => {
      expect(
        presentacionDesdeCanonica({
          cantidadCanonica: '1500',
          unidadCodigoPresentacion: 'g',
          unidadBaseCodigo: 'g',
          catalogo: CAT,
        }),
      ).toBe('1500');
    });

    it('1500 g canónicos en una línea que muestra kg → 1.5', () => {
      expect(
        presentacionDesdeCanonica({
          cantidadCanonica: '1500',
          unidadCodigoPresentacion: 'kg',
          unidadBaseCodigo: 'g',
          catalogo: CAT,
        }),
      ).toBe('1.5');
    });

    // Ida y vuelta: lo que entra por `resolverCantidadDesdePresentacion` tiene
    // que volver igual. Si las dos funciones no son inversas, el merge escribe
    // un número que nadie pidió.
    it('es inversa de resolverCantidadDesdePresentacion', () => {
      const ida = resolverCantidadDesdePresentacion({
        cantidadPresentacion: '0.3',
        unidadCodigoPresentacion: 'kg',
        unidadBaseCodigo: 'g',
        catalogo: CAT,
      });
      expect(ida.cantidadCanonica).toBe('300');
      expect(
        presentacionDesdeCanonica({
          cantidadCanonica: ida.cantidadCanonica,
          unidadCodigoPresentacion: 'kg',
          unidadBaseCodigo: 'g',
          catalogo: CAT,
        }),
      ).toBe('0.3');
    });

    it('devuelve null si las magnitudes no se pueden convertir', () => {
      expect(
        presentacionDesdeCanonica({
          cantidadCanonica: '100',
          unidadCodigoPresentacion: 'l',
          unidadBaseCodigo: 'g',
          catalogo: CAT,
        }),
      ).toBeNull();
    });

    it('devuelve null si la unidad no está en el catálogo', () => {
      expect(
        presentacionDesdeCanonica({
          cantidadCanonica: '100',
          unidadCodigoPresentacion: 'onza',
          unidadBaseCodigo: 'g',
          catalogo: CAT,
        }),
      ).toBeNull();
    });

    // El llamador usa este `null` para NO escribir: un 0 mentiría sobre que
    // haya algo, y esto corre después de que la canónica ya se sumó.
    it('devuelve null si la conversión cae bajo los 4 decimales', () => {
      expect(
        presentacionDesdeCanonica({
          cantidadCanonica: '0.0001',
          unidadCodigoPresentacion: 'kg',
          unidadBaseCodigo: 'g',
          catalogo: CAT,
        }),
      ).toBeNull();
    });

    it('no lanza con una cantidad que no es número: devuelve null', () => {
      expect(
        presentacionDesdeCanonica({
          cantidadCanonica: 'no-es-un-numero',
          unidadCodigoPresentacion: 'kg',
          unidadBaseCodigo: 'g',
          catalogo: CAT,
        }),
      ).toBeNull();
    });
  });
});
