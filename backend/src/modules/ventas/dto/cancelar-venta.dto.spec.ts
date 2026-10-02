import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelarVentaDto } from './cancelar-venta.dto';

const base = { motivo: 'Se equivocó el pedido' };

describe('CancelarVentaDto.externoHecho', () => {
  it.each([true, false])('acepta %s', async (valor) => {
    const dto = plainToInstance(CancelarVentaDto, {
      ...base,
      externoHecho: valor,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.externoHecho).toBe(valor);
  });

  it('rechaza null: no es "no contestó" ni "contestó que no"', async () => {
    const dto = plainToInstance(CancelarVentaDto, {
      ...base,
      externoHecho: null,
    });
    expect(
      (await validate(dto)).some((e) => e.property === 'externoHecho'),
    ).toBe(true);
  });

  it('es opcional y ausente queda undefined, no false', async () => {
    const dto = plainToInstance(CancelarVentaDto, base);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.externoHecho).toBeUndefined();
  });

  it.each([
    ['"true"', 'true'],
    ['1', 1],
    ['"si"', 'si'],
  ])('rechaza %s (no es un booleano)', async (_n, valor) => {
    const dto = plainToInstance(CancelarVentaDto, {
      ...base,
      externoHecho: valor,
    });
    expect(
      (await validate(dto)).some((e) => e.property === 'externoHecho'),
    ).toBe(true);
  });
});
