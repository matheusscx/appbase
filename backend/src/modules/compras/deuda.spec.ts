import Decimal from 'decimal.js';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import {
  PLAZO_PAGO_DIAS_DEFAULT,
  fondear,
  totalCompra,
  vencimiento,
} from './deuda';

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

describe('fondear (spec § 5.1 y § 11): saldo primero, más viejo primero, partición', () => {
  const PAGO_NUEVO = 'pago-nuevo';

  it('sin saldo a favor, todo sale del pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '1000' }],
      [],
      '1000',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: PAGO_NUEVO, monto: '1000' },
    ]);
    expect(sobranteNuevo).toBe('0');
  });

  it('con saldo a favor suficiente, no toca el pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '400' }],
      [{ pagoId: 'p-viejo', disponible: '400' }],
      '1000',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '400' },
    ]);
    expect(sobranteNuevo).toBe('1000');
  });

  it('el saldo a favor se consume del pago MÁS VIEJO primero (el array ya viene ordenado así)', () => {
    const { partes } = fondear(
      [{ compraId: 'c1', monto: '150' }],
      [
        { pagoId: 'p-viejo', disponible: '100' },
        { pagoId: 'p-nuevo-de-los-dos', disponible: '100' },
      ],
      '0',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '100' },
      { compraId: 'c1', pagoId: 'p-nuevo-de-los-dos', monto: '50' },
    ]);
  });

  it('una aplicación puede partirse en dos: saldo a favor + el pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '150' }],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '50',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '100' },
      { compraId: 'c1', pagoId: PAGO_NUEVO, monto: '50' },
    ]);
    expect(sobranteNuevo).toBe('0');
  });

  it('varias aplicaciones consumen las fuentes EN EL ORDEN pedido, cada una hasta agotarse', () => {
    const { partes, sobranteNuevo } = fondear(
      [
        { compraId: 'c1', monto: '80' },
        { compraId: 'c2', monto: '80' },
      ],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '100',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '80' },
      { compraId: 'c2', pagoId: 'p-viejo', monto: '20' },
      { compraId: 'c2', pagoId: PAGO_NUEVO, monto: '60' },
    ]);
    expect(sobranteNuevo).toBe('40');
  });

  it('monto 0 con aplicaciones: usa el saldo a favor y no crea partes del pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '30' }],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '0',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '30' },
    ]);
    expect(sobranteNuevo).toBe('0');
  });

  it('sin aplicaciones, todo el monto nuevo queda a favor (anticipo)', () => {
    const { partes, sobranteNuevo } = fondear([], [], '500', PAGO_NUEVO);
    expect(partes).toEqual([]);
    expect(sobranteNuevo).toBe('500');
  });

  it('una fuente agotada no deja una parte en cero', () => {
    const { partes } = fondear(
      [{ compraId: 'c1', monto: '100' }],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '0',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '100' },
    ]);
  });

  it('pedir más de lo disponible (saldo + monto) revienta: el caller valida esto ANTES', () => {
    expect(() =>
      fondear(
        [{ compraId: 'c1', monto: '1000' }],
        [{ pagoId: 'p-viejo', disponible: '100' }],
        '100',
        PAGO_NUEVO,
      ),
    ).toThrow();
  });
});
