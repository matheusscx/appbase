import { BadRequestException } from '@nestjs/common';
import { validarMontosDeRegla } from './monto-regla.util';

describe('validarMontosDeRegla', () => {
  describe('el valor plano', () => {
    it('acepta un porcentaje en decimal', () => {
      expect(() => validarMontosDeRegla('porcentaje', '0.10')).not.toThrow();
    });

    it('rechaza un porcentaje >= 1', () => {
      expect(() => validarMontosDeRegla('porcentaje', '50')).toThrow(
        BadRequestException,
      );
    });

    it('acepta el mismo número como monto fijo', () => {
      // Lo que decide es el modo, no el número.
      expect(() => validarMontosDeRegla('monto_fijo', '50')).not.toThrow();
    });

    it.each(['0', '-1', 'abc'])('rechaza %s', (valor) => {
      expect(() => validarMontosDeRegla('monto_fijo', valor)).toThrow(
        BadRequestException,
      );
    });

    it.each([null, undefined, ''])(
      'un valor ausente (%p) no es error: qué tipo lo exige lo decide el service',
      (valor) => {
        expect(() => validarMontosDeRegla('porcentaje', valor)).not.toThrow();
      },
    );
  });

  describe('los tramos', () => {
    // El caso que originó la extracción: la validación existía y no alcanzaba
    // a los tramos, así que un "50%" cargado como 50 producía un 5000%.
    it('rechaza un tramo en porcentaje con valor >= 1', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', null, [
          { valor: '0.10' },
          { valor: '50' },
        ]),
      ).toThrow(/decimal/);
    });

    it('valida los tramos con el MISMO modo que el valor plano', () => {
      // Mismos tramos, otro modo: pasan.
      expect(() =>
        validarMontosDeRegla('monto_fijo', null, [
          { valor: '0.10' },
          { valor: '50' },
        ]),
      ).not.toThrow();
    });

    it('rechaza un tramo en 0 o negativo', () => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', null, [{ valor: '-5' }]),
      ).toThrow(/mayor a 0/);
    });

    it('sin tramos, o con la lista vacía, no pasa nada', () => {
      expect(() => validarMontosDeRegla('porcentaje', '0.10')).not.toThrow();
      expect(() =>
        validarMontosDeRegla('porcentaje', '0.10', []),
      ).not.toThrow();
    });

    it('un tramo sin valor no es error', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', null, [{ valor: null }]),
      ).not.toThrow();
    });
  });
});
