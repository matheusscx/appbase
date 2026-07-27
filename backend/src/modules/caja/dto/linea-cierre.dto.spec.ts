import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LineaCierreDto } from './linea-cierre.dto';

const METODO_PAGO_ID = '550e8400-e29b-41d4-a716-446655440116';

describe('LineaCierreDto', () => {
  it('acepta montoContado en 0 (método sin movimiento)', async () => {
    const dto = plainToInstance(LineaCierreDto, {
      metodoPagoId: METODO_PAGO_ID,
      montoContado: '0',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta montoContado con decimales', async () => {
    const dto = plainToInstance(LineaCierreDto, {
      metodoPagoId: null,
      montoContado: '15300.50',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza montoContado negativo', async () => {
    const dto = plainToInstance(LineaCierreDto, {
      metodoPagoId: METODO_PAGO_ID,
      montoContado: '-100',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'montoContado')).toBe(true);
  });
});
