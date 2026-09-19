import Decimal from 'decimal.js';
import { costearLineas } from './reparto-descuento';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';

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

describe('costearLineas', () => {
  it('sin descuento, el costo base es el precio convertido', () => {
    // 10 cajas a $9.600 son 120 latas base: $800 la lata.
    expect(
      costearLineas(
        [{ cantidad: '10', precioUnitario: '9600', cantidadBase: '120' }],
        null,
        cfgCLP,
      ),
    ).toEqual(['800.0000']);
  });

  it('reparte el 5% al total según el valor: la lata queda a $760 (spec § 2)', () => {
    const r = costearLineas(
      [
        { cantidad: '10', precioUnitario: '9600', cantidadBase: '120' }, // $96.000
        { cantidad: '5', precioUnitario: '6000', cantidadBase: '60' }, // $30.000
      ],
      '6300',
      cfgCLP,
    );
    expect(r).toEqual(['760.0000', '475.0000']);
  });

  it('lo descontado calza al peso con un descuento que no divide exacto', () => {
    const lineas = [
      { cantidad: '3', precioUnitario: '1000', cantidadBase: '3' },
      { cantidad: '3', precioUnitario: '1000', cantidadBase: '3' },
      { cantidad: '3', precioUnitario: '1000', cantidadBase: '3' },
    ];
    const r = costearLineas(lineas, '100', cfgCLP);
    const valorFinal = r.reduce(
      (acc, c, i) => acc.plus(new Decimal(c).times(lineas[i].cantidadBase)),
      new Decimal(0),
    );
    // 9.000 − 100 = 8.900, y no 8.899 ni 8.901
    expect(valorFinal.toDecimalPlaces(0).toString()).toBe('8900');
  });

  it('una línea a $0 (regalo) no recibe descuento', () => {
    const r = costearLineas(
      [
        { cantidad: '12', precioUnitario: '9600', cantidadBase: '144' },
        { cantidad: '1', precioUnitario: '0', cantidadBase: '12' },
      ],
      '1152',
      cfgCLP,
    );
    expect(r[1]).toBe('0.0000');
    expect(r[0]).toBe('792.0000'); // (115.200 − 1.152) / 144
  });
});
