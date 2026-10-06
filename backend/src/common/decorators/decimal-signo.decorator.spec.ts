import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IsDecimalHasta,
  IsDecimalNoNegativo,
  IsDecimalPositivo,
} from './decimal-signo.decorator';

class PositivoDto {
  @IsDecimalPositivo()
  monto: string;
}

class HastaDto {
  @IsDecimalHasta('99999')
  cantidad: string;
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

describe('IsDecimalHasta', () => {
  it('acepta el máximo exacto, también escrito con decimales', async () => {
    for (const cantidad of ['99999', '99999.0000', '0.5']) {
      const dto = plainToInstance(HastaDto, { cantidad });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rechaza un diezmilésimo arriba del máximo, con el máximo en el mensaje', async () => {
    const dto = plainToInstance(HastaDto, { cantidad: '99999.0001' });
    const errores = await validate(dto);
    expect(errores[0]?.constraints?.isDecimalHasta).toBe(
      'cantidad no puede superar 99.999',
    );
  });

  it('rechaza lo que no es número en vez de tirar', async () => {
    const dto = plainToInstance(HastaDto, { cantidad: 'mucho' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'cantidad')).toBe(true);
  });
});
