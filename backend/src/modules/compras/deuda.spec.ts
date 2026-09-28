import Decimal from 'decimal.js';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import { PLAZO_PAGO_DIAS_DEFAULT, totalCompra, vencimiento } from './deuda';

const cfgCLP = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  promosAcumulanDescuentos: false,
  decimalesMoneda: 0,
} as unknown as ConfigCalculo;

const cfgUSD = {
  ...cfgCLP,
  decimalesMoneda: 2,
};

describe('vencimiento (spec compras-deuda-proveedor § 4.2)', () => {
  it('el 1 de octubre + 15 días de plazo vence el 16', () => {
    expect(vencimiento('2026-10-01', 15, null)).toBe('2026-10-16');
  });

  it('sin plazo cargado (null), el default es 30 días — la ley 19.983', () => {
    expect(PLAZO_PAGO_DIAS_DEFAULT).toBe(30);
    expect(vencimiento('2026-10-01', null, null)).toBe('2026-10-31');
  });

  it('la fecha tipeada manda, aunque haya plazo', () => {
    expect(vencimiento('2026-10-01', 15, '2026-12-25')).toBe('2026-12-25');
  });

  it('cruza de mes y de año correctamente', () => {
    expect(vencimiento('2026-12-20', 30, null)).toBe('2027-01-19');
  });
});

describe('totalCompra (spec § 4.1 y § 14: cuantización única)', () => {
  it('Σ cantidad × precio − descuento, sin decimales de más', () => {
    expect(
      totalCompra(
        [
          { cantidad: '10', precioUnitario: '1500' },
          { cantidad: '5', precioUnitario: '2000' },
        ],
        null,
        cfgCLP,
      ),
    ).toBe('25000');
  });

  it('resta el descuento antes de cuantizar', () => {
    expect(
      totalCompra([{ cantidad: '10', precioUnitario: '1500' }], '1000', cfgCLP),
    ).toBe('14000');
  });

  it('null si falta el precio de alguna línea', () => {
    expect(
      totalCompra(
        [
          { cantidad: '10', precioUnitario: '1500' },
          { cantidad: '5', precioUnitario: null },
        ],
        null,
        cfgCLP,
      ),
    ).toBeNull();
  });

  it('null sin líneas', () => {
    expect(totalCompra([], null, cfgCLP)).toBeNull();
  });

  it('un total con decimales de más se cuantiza UNA vez con el modo del tenant (HALF_UP, CLP → 0 decimales)', () => {
    // 10 × 1500.5555 = 15005.555 → HALF_UP a 0 decimales = 15006
    expect(
      totalCompra(
        [{ cantidad: '10', precioUnitario: '1500.5555' }],
        null,
        cfgCLP,
      ),
    ).toBe('15006');
  });

  it('con una moneda de 2 decimales, cuantiza a esa escala', () => {
    expect(
      totalCompra([{ cantidad: '3', precioUnitario: '10.005' }], null, cfgUSD),
    ).toBe(
      new Decimal('30.015')
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toString(),
    );
  });
});
