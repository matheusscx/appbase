import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AjusteStockDto } from './ajuste-stock.dto';

const unidad = (n: number) =>
  `550e8400-e29b-41d4-a716-${String(n).padStart(12, '0')}`;

/**
 * La salida serie lockea todas las unidades nombradas adentro de la transacción
 * que retiene el lock del producto: el largo de `unidadIds` es espera para las
 * ventas de ese producto. Mismo techo de 200 que la venta, el salón y los
 * traslados.
 */
describe('AjusteStockDto.unidadIds — techo', () => {
  const salida = {
    ubicacionId: '550e8400-e29b-41d4-a716-446655449999',
    cantidad: '1',
    tipo: 'salida',
    motivo: 'ajuste_manual',
  };

  it('acepta hasta 200 unidades', async () => {
    const dto = plainToInstance(AjusteStockDto, {
      ...salida,
      unidadIds: Array.from({ length: 200 }, (_, i) => unidad(i + 1)),
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza más de 200 unidades', async () => {
    const dto = plainToInstance(AjusteStockDto, {
      ...salida,
      unidadIds: Array.from({ length: 201 }, (_, i) => unidad(i + 1)),
    });
    const errores = await validate(dto);
    expect(errores.map((e) => e.property)).toContain('unidadIds');
  });
});
