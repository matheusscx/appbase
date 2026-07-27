import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AbrirCajaDto } from './abrir-caja.dto';

const CAJON_ID = '550e8400-e29b-41d4-a716-446655440116';

describe('AbrirCajaDto', () => {
  it('acepta saldoInicial en 0 (cajón vacío)', async () => {
    const dto = plainToInstance(AbrirCajaDto, {
      cajonId: CAJON_ID,
      saldoInicial: '0',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta saldoInicial positivo', async () => {
    const dto = plainToInstance(AbrirCajaDto, {
      cajonId: CAJON_ID,
      saldoInicial: '50000',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza saldoInicial negativo', async () => {
    const dto = plainToInstance(AbrirCajaDto, {
      cajonId: CAJON_ID,
      saldoInicial: '-100',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'saldoInicial')).toBe(true);
  });
});
