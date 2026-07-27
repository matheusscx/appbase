import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PropinaCierreMesaDto } from './propina-cierre-mesa.dto';

const GARZON_ID = '550e8400-e29b-41d4-a716-446655440116';

describe('PropinaCierreMesaDto', () => {
  it('acepta montoPagado en 0 (cierre de mesa sin propina)', async () => {
    const dto = plainToInstance(PropinaCierreMesaDto, {
      montoPagado: '0',
      garzonId: GARZON_ID,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta montoPagado, montoSugerido y porcentajeSugerido positivos', async () => {
    const dto = plainToInstance(PropinaCierreMesaDto, {
      montoPagado: '1000',
      montoSugerido: '1000',
      porcentajeSugerido: '0.10',
      garzonId: GARZON_ID,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza montoPagado negativo', async () => {
    const dto = plainToInstance(PropinaCierreMesaDto, {
      montoPagado: '-100',
      garzonId: GARZON_ID,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'montoPagado')).toBe(true);
  });

  it('rechaza montoSugerido negativo', async () => {
    const dto = plainToInstance(PropinaCierreMesaDto, {
      montoPagado: '1000',
      montoSugerido: '-100',
      garzonId: GARZON_ID,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'montoSugerido')).toBe(true);
  });

  it('rechaza porcentajeSugerido negativo', async () => {
    const dto = plainToInstance(PropinaCierreMesaDto, {
      montoPagado: '1000',
      porcentajeSugerido: '-0.10',
      garzonId: GARZON_ID,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'porcentajeSugerido')).toBe(true);
  });
});
