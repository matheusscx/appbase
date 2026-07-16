import { BadRequestException } from '@nestjs/common';
import {
  assertPresentacionPareada,
  resolverCantidadDesdePresentacion,
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
});
