import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PropinaDirectaDto } from './propina-directa.dto';

describe('PropinaDirectaDto', () => {
  it('acepta montoPagado en 0', async () => {
    const dto = plainToInstance(PropinaDirectaDto, { montoPagado: '0' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta montoPagado, montoSugerido y porcentajeSugerido positivos', async () => {
    const dto = plainToInstance(PropinaDirectaDto, {
      montoPagado: '1000',
      montoSugerido: '1000',
      porcentajeSugerido: '0.10',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza montoPagado negativo', async () => {
    const dto = plainToInstance(PropinaDirectaDto, { montoPagado: '-100' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'montoPagado')).toBe(true);
  });

  it('rechaza montoSugerido negativo', async () => {
    const dto = plainToInstance(PropinaDirectaDto, {
      montoPagado: '1000',
      montoSugerido: '-100',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'montoSugerido')).toBe(true);
  });

  it('rechaza porcentajeSugerido negativo', async () => {
    const dto = plainToInstance(PropinaDirectaDto, {
      montoPagado: '1000',
      porcentajeSugerido: '-0.10',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'porcentajeSugerido')).toBe(true);
  });
});
