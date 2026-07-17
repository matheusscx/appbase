import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { repartirMayoresRestos } from './mayores-restos';

describe('repartirMayoresRestos', () => {
  it('reparte CLP con mayores restos y desempate por id ascendente', () => {
    const result = repartirMayoresRestos(
      '100001',
      [
        { id: 'pedro', peso: '1' },
        { id: 'juan', peso: '1' },
        { id: 'maria', peso: '1' },
      ],
      0,
    );

    expect(result).toEqual([
      { id: 'pedro', monto: '33333' },
      { id: 'juan', monto: '33334' },
      { id: 'maria', monto: '33334' },
    ]);
    expect(result.reduce((acc, r) => acc.plus(r.monto), new Decimal(0)).toString()).toBe(
      '100001',
    );
  });

  it('conserva la suma exacta con moneda de dos decimales', () => {
    const result = repartirMayoresRestos(
      '10.01',
      [
        { id: 'a', peso: '1' },
        { id: 'b', peso: '1' },
        { id: 'c', peso: '1' },
      ],
      2,
    );

    expect(result).toEqual([
      { id: 'a', monto: '3.34' },
      { id: 'b', monto: '3.34' },
      { id: 'c', monto: '3.33' },
    ]);
    expect(result.reduce((acc, r) => acc.plus(r.monto), new Decimal(0)).toFixed(2)).toBe(
      '10.01',
    );
  });

  it('asigna todo el monto a un único participante', () => {
    expect(
      repartirMayoresRestos('1234.56', [{ id: 'solo', peso: '9' }], 2),
    ).toEqual([{ id: 'solo', monto: '1234.56' }]);
  });

  it('rechaza una suma de pesos no positiva', () => {
    expect(() =>
      repartirMayoresRestos(
        '100',
        [
          { id: 'a', peso: '0' },
          { id: 'b', peso: '0' },
        ],
        0,
      ),
    ).toThrow(BadRequestException);
  });
});
