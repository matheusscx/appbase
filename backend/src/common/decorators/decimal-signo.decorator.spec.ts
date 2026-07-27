import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsDecimalPositivo,
} from './decimal-signo.decorator';

class PositivoDto {
  @IsDecimalPositivo()
  monto: string;
}

class NoNegativoDto {
  @IsDecimalNoNegativo()
  monto: string;
}

describe('IsDecimalPositivo', () => {
  it('acepta un decimal positivo', async () => {
    const dto = plainToInstance(PositivoDto, { monto: '10.50' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza cero', async () => {
    const dto = plainToInstance(PositivoDto, { monto: '0' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza negativos', async () => {
    const dto = plainToInstance(PositivoDto, { monto: '-5' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza valores no numéricos', async () => {
    const dto = plainToInstance(PositivoDto, { monto: 'abc' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });
});

describe('IsDecimalNoNegativo', () => {
  it('acepta cero', async () => {
    const dto = plainToInstance(NoNegativoDto, { monto: '0' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta positivos', async () => {
    const dto = plainToInstance(NoNegativoDto, { monto: '10.50' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza negativos', async () => {
    const dto = plainToInstance(NoNegativoDto, { monto: '-0.01' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });
});
