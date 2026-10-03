import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryProductosCompraDto } from './productos-compra.dto';

const ID_A = '550e8400-e29b-41d4-a716-446655440001';
const ID_B = '550e8400-e29b-41d4-a716-446655440002';

// El selector de producto de una compra resuelve los elegidos por `ids` y busca
// por `search`. Estos tests no ejercen el pipe global (el 400 real, y el de un
// filtro de `/items` que este DTO no declara, lo cubre el e2e).
describe('QueryProductosCompraDto', () => {
  it('una lista de ids separada por comas se parte en un array de UUID, sin repetidos', async () => {
    const dto = plainToInstance(QueryProductosCompraDto, {
      ids: `${ID_A},${ID_B},${ID_A}`,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.ids).toEqual([ID_A, ID_B]);
  });

  it('un id que no es UUID es un error de validación', async () => {
    const dto = plainToInstance(QueryProductosCompraDto, {
      ids: `${ID_A},no-es-uuid`,
    });

    const errores = await validate(dto);
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('ids');
  });

  it('un ids vacío es un error de validación (no se ignora: sería el catálogo entero)', async () => {
    const dto = plainToInstance(QueryProductosCompraDto, { ids: '' });

    const errores = await validate(dto);
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('ids');
  });

  it('100 ids pasan y 101 son un error', async () => {
    const uuid = (n: number) =>
      `550e8400-e29b-41d4-a716-${String(n).padStart(12, '0')}`;
    const cien = Array.from({ length: 100 }, (_, i) => uuid(i)).join(',');

    expect(
      await validate(plainToInstance(QueryProductosCompraDto, { ids: cien })),
    ).toHaveLength(0);

    const errores = await validate(
      plainToInstance(QueryProductosCompraDto, { ids: `${cien},${uuid(100)}` }),
    );
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('ids');
  });

  it('search se recorta y más de 100 caracteres es un error', async () => {
    const dto = plainToInstance(QueryProductosCompraDto, {
      search: '  harina ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.search).toBe('harina');

    const errores = await validate(
      plainToInstance(QueryProductosCompraDto, { search: 'x'.repeat(101) }),
    );
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('search');
  });
});
