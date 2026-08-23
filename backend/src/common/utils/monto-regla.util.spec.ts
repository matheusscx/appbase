import { BadRequestException } from '@nestjs/common';
import { validarMontosDeRegla } from './monto-regla.util';

describe('validarMontosDeRegla', () => {
  describe('el valor plano', () => {
    it('acepta un porcentaje en decimal', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '0.10' }),
      ).not.toThrow();
    });

    it('rechaza un porcentaje >= 1', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '50' }),
      ).toThrow(BadRequestException);
    });

    it('acepta el mismo número como monto fijo', () => {
      // Lo que decide ya no es el modo leyendo un valor ambiguo: es la COLUMNA
      // en la que vino. `50` en `valorMonto` son cincuenta pesos y nada más.
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: '50' }),
      ).not.toThrow();
    });

    it.each(['0', '-1', 'abc'])('rechaza %s', (valor) => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: valor }),
      ).toThrow(BadRequestException);
    });

    it.each([null, undefined, ''])(
      'un valor ausente (%p) no es error: qué tipo lo exige lo decide el service',
      (valor) => {
        expect(() =>
          validarMontosDeRegla('porcentaje', { valorPorcentaje: valor }),
        ).not.toThrow();
      },
    );

    it('no acepta un objeto vacío como error: la regla por tramos no trae valor plano', () => {
      expect(() => validarMontosDeRegla('porcentaje', {})).not.toThrow();
    });
  });

  describe('la unidad la dice la columna, no el modo', () => {
    it('rechaza que vengan las dos columnas a la vez', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', {
          valorMonto: '1000',
          valorPorcentaje: '0.10',
        }),
      ).toThrow(/una sola unidad/);
    });

    it('rechaza la columna que no corresponde al modo', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorMonto: '1000' }),
      ).toThrow(/valorPorcentaje/);
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorPorcentaje: '0.10' }),
      ).toThrow(/valorMonto/);
    });

    it('un monto fijo grande es válido y NO se lee como porcentaje', () => {
      // El bug que este cambio mata: `5000` como monto es plata; leído como
      // tasa habría sido 500.000%. Ahora ni siquiera es expresable.
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: '5000' }),
      ).not.toThrow();
    });
  });

  describe('los tramos', () => {
    // El caso que originó la extracción: la validación existía y no alcanzaba
    // a los tramos, así que un "50%" cargado como 50 producía un 5000%.
    it('rechaza un tramo en porcentaje con valor >= 1', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', {}, [
          { valorPorcentaje: '0.10' },
          { valorPorcentaje: '50' },
        ]),
      ).toThrow(/decimal/);
    });

    it('el mismo número en la columna de monto es válido', () => {
      // Antes esto se expresaba como "los mismos tramos con otro modo pasan".
      // Ahora no hay reinterpretación: es otra columna, es otro dato.
      expect(() =>
        validarMontosDeRegla('monto_fijo', {}, [
          { valorMonto: '0.10' },
          { valorMonto: '50' },
        ]),
      ).not.toThrow();
    });

    it('rechaza un tramo en 0 o negativo', () => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', {}, [{ valorMonto: '-5' }]),
      ).toThrow(/mayor a 0/);
    });

    it('rechaza un tramo cuya columna no corresponde al modo de la regla', () => {
      expect(() =>
        validarMontosDeRegla('monto_fijo', { valorMonto: '100' }, [
          { valorPorcentaje: '0.10' },
        ]),
      ).toThrow(/valorMonto/);
    });

    it('sin tramos, o con la lista vacía, no pasa nada', () => {
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '0.10' }),
      ).not.toThrow();
      expect(() =>
        validarMontosDeRegla('porcentaje', { valorPorcentaje: '0.10' }, []),
      ).not.toThrow();
    });

    it('un tramo SIN importe es error, y esto no era así antes', () => {
      // Hasta que el `valor` se partió en dos, esto lo tapaba el DTO: `valor`
      // era obligatorio en `TramoDto`. Los dos campos nuevos son por fuerza
      // opcionales —cuál corresponde depende del hermano `modo`—, así que sin
      // este chequeo un tramo vacío llegaba al CHECK de tabla y salía un 500.
      expect(() => validarMontosDeRegla('porcentaje', {}, [{}])).toThrow(
        /tiene que expresar su importe/,
      );
      expect(() =>
        validarMontosDeRegla('porcentaje', {}, [{ valorPorcentaje: null }]),
      ).toThrow(/tiene que expresar su importe/);
      expect(() => validarMontosDeRegla('monto_fijo', {}, [{}])).toThrow(
        /valorMonto/,
      );
    });
  });
});
