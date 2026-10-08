import Decimal from 'decimal.js';
import { getMetadataArgsStorage } from 'typeorm';
import { Venta } from '../../modules/ventas/entities/venta.entity';
import { VentaDetalle } from '../../modules/ventas/entities/venta-detalle.entity';
import { VentaDescuento } from '../../modules/ventas/entities/venta-descuento.entity';
import { VentaRecargo } from '../../modules/ventas/entities/venta-recargo.entity';
import { VentaImpuesto } from '../../modules/ventas/entities/venta-impuesto.entity';
import { VentaPromocion } from '../../modules/ventas/entities/venta-promocion.entity';
import {
  cabeEnColumnaDePlata,
  ESCALA_PERSISTIDA,
  formatearMontoPersistible,
  PRECISION_PERSISTIDA,
} from './monto-persistible.util';

describe('cabeEnColumnaDePlata', () => {
  // Postgres redondea a 4 decimales (mitad hacia afuera del cero) y DESPUÉS mira
  // si caben 14 enteros. Con `nivelRedondeo: 'documento'` las líneas del motor
  // corren finas a `escala_calculo` (6 por default), así que el borde del
  // redondeo es alcanzable.
  it.each([
    ['99999999999999.9999', true],
    ['99999999999999.99994', true],
    ['99999999999999.99995', false],
    ['100000000000000', false],
    ['-99999999999999.9999', true],
    ['-99999999999999.99994', true],
    ['-99999999999999.99995', false],
    ['-100000000000000', false],
  ])('%s → cabe: %s', (monto, cabe) => {
    expect(cabeEnColumnaDePlata(monto)).toBe(cabe);
  });

  it('acepta un Decimal igual que un string', () => {
    expect(cabeEnColumnaDePlata(new Decimal('73456789012345.678912'))).toBe(
      true,
    );
    expect(cabeEnColumnaDePlata(new Decimal('146913578024691.357824'))).toBe(
      false,
    );
  });
});

describe('formatearMontoPersistible', () => {
  it('agrupa los miles con punto y no pierde dígitos más allá de 2^53', () => {
    expect(formatearMontoPersistible('146913578024690.000000')).toBe(
      '146.913.578.024.690',
    );
    expect(formatearMontoPersistible('100000000000000.5000')).toBe(
      '100.000.000.000.000,5',
    );
    expect(formatearMontoPersistible('-123456789012345678.123400')).toBe(
      '-123.456.789.012.345.678,1234',
    );
  });
});

/**
 * El techo del guard se deriva de `(PRECISION_PERSISTIDA, ESCALA_PERSISTIDA)`, no
 * de un número copiado. Este test ata ese par a las columnas que el guard
 * protege: si una pasa a otra precisión, el techo deja de ser el de la columna y
 * acá se ve. La lista es la tabla de `docs/features/motor-calculo-precios.md`
 * § "Un monto que no cabe en su columna".
 */
describe('las columnas que protege el guard son NUMERIC(18,4)', () => {
  const COLUMNAS: [abstract new (...args: never[]) => unknown, string[]][] = [
    [
      Venta,
      [
        'total_bruto',
        'total_descuentos',
        'total_recargos',
        'total_impuestos',
        'total_final',
        'base_ventas_total_final',
        'base_ventas_sin_impuestos',
      ],
    ],
    [
      VentaDetalle,
      [
        'precio_unitario_origen',
        'precio_unitario',
        'subtotal',
        'descuento_aplicado',
        'recargo_aplicado',
        'ajuste_venta',
        'impuesto_aplicado',
        'total_linea',
      ],
    ],
    [VentaDescuento, ['valor_aplicado', 'valor_solicitado']],
    [VentaRecargo, ['valor_aplicado']],
    [VentaImpuesto, ['valor_aplicado']],
    [VentaPromocion, ['monto', 'valor_efectivo']],
  ];

  it.each(COLUMNAS)('%p', (entidad, nombres) => {
    const columnas = getMetadataArgsStorage().columns.filter(
      (c) => c.target === entidad,
    );
    const forma = nombres.map((nombre) => {
      const c = columnas.find(
        (col) =>
          ((col.options as { name?: string }).name ?? col.propertyName) ===
          nombre,
      );
      const o = (c?.options ?? {}) as { precision?: number; scale?: number };
      return { nombre, precision: o.precision, scale: o.scale };
    });
    expect(forma).toEqual(
      nombres.map((nombre) => ({
        nombre,
        precision: PRECISION_PERSISTIDA,
        scale: ESCALA_PERSISTIDA,
      })),
    );
  });

  it('el par es el que dicen las columnas', () => {
    expect([PRECISION_PERSISTIDA, ESCALA_PERSISTIDA]).toEqual([18, 4]);
  });
});
