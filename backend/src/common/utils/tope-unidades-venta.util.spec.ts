import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  assertTopeUnidadesVenta,
  MAX_UNIDADES_POR_VENTA,
} from './tope-unidades-venta.util';

describe('assertTopeUnidadesVenta', () => {
  it('justo en el tope pasa, sumando enteros, kilos y Decimal', () => {
    expect(() =>
      assertTopeUnidadesVenta(
        ['50000', '49998.5', new Decimal('0.5')],
        'una venta',
      ),
    ).not.toThrow();
  });

  it('un diezmilésimo arriba del tope es 400, con la suma en el mensaje', () => {
    expect(() =>
      assertTopeUnidadesVenta(['99999', '0.0001'], 'una venta'),
    ).toThrow(
      new BadRequestException(
        'Una venta puede llevar hasta 99.999 unidades en total, y esta suma 99.999,0001',
      ),
    );
  });

  it('el mensaje nombra la mesa cuando el chequeo es de una cuenta', () => {
    expect(() =>
      assertTopeUnidadesVenta(['60000', '40000'], 'una mesa'),
    ).toThrow(
      'Una mesa puede llevar hasta 99.999 unidades en total, y esta suma 100.000',
    );
  });

  it('el tope es el que decidió el owner', () => {
    expect(MAX_UNIDADES_POR_VENTA).toBe('99999');
  });
});
