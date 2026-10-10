import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IsDecimalHasta,
  IsDecimalNoNegativo,
  IsDecimalPositivo,
  IsMontoPersistible,
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

class PersistibleDto {
  @IsMontoPersistible()
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

describe('IsMontoPersistible', () => {
  it('acepta el máximo que cabe en NUMERIC(18,4)', async () => {
    for (const monto of ['99999999999999.9999', '99999999999999', '0']) {
      const dto = plainToInstance(PersistibleDto, { monto });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rechaza 10^14 y lo que Postgres redondearía a 10^14, con el techo en el mensaje', async () => {
    for (const monto of ['100000000000000', '99999999999999.99995', '1e20']) {
      const dto = plainToInstance(PersistibleDto, { monto });
      const errores = await validate(dto);
      expect(errores[0]?.constraints?.isMontoPersistible).toBe(
        'monto no puede ser de $100.000.000.000.000 o más: el sistema no puede guardar montos así',
      );
    }
  });

  it('rechaza lo que no es número en vez de tirar', async () => {
    const dto = plainToInstance(PersistibleDto, { monto: 'mucho' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });
});
