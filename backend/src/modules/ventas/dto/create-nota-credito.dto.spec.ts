import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNotaCreditoDto } from './create-nota-credito.dto';

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';

describe('CreateNotaCreditoDto', () => {
  it('acepta payload mínimo con solo monto', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, { monto: '5000' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta payload completo', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      comentario: 'Devolución cliente',
      devolverDinero: true,
      devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza monto no numérico', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, { monto: 'abc' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza devoluciones con itemId inválido', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      devoluciones: [{ itemId: 'no-es-uuid', cantidad: '2' }],
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'devoluciones')).toBe(true);
  });

  it('rechaza devolverDinero no booleano', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      devolverDinero: 'si',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'devolverDinero')).toBe(true);
  });
});
