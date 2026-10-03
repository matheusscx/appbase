import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryItemsDto } from './query-items.dto';

// `incluirEliminados` está duplicado en `QueryItemsDto` (no `extends
// QueryIncluirEliminadosDto`: la clase ya extiende `PaginationQueryDto` para
// la paginación y TS no permite herencia múltiple) — mismo motivo que
// `query-motivos-baja.dto.spec.ts` existe para `QueryMotivosBajaDto`: nada
// más custodia que la coerción del booleano duplicado no se rompa.
describe('QueryItemsDto', () => {
  it('incluirEliminados=true (string, como llega en el query) se parsea como boolean true', async () => {
    const dto = plainToInstance(QueryItemsDto, { incluirEliminados: 'true' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.incluirEliminados).toBe(true);
  });

  it('incluirEliminados=false se parsea como boolean false', async () => {
    const dto = plainToInstance(QueryItemsDto, {
      incluirEliminados: 'false',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.incluirEliminados).toBe(false);
  });

  it('un valor que no es exactamente "true" se parsea como false', async () => {
    const dto = plainToInstance(QueryItemsDto, {
      incluirEliminados: 'cualquier-cosa',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.incluirEliminados).toBe(false);
  });

  it('sin el parámetro, incluirEliminados queda falsy (igual que en QueryMotivosBajaDto)', async () => {
    const dto = plainToInstance(QueryItemsDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.incluirEliminados).toBeFalsy();
  });

  it('acepta incluirEliminados combinado con los filtros propios del listado (tipo, search, paginación)', async () => {
    const dto = plainToInstance(QueryItemsDto, {
      incluirEliminados: 'true',
      tipo: 'producto',
      search: '  smart  ',
      page: '2',
      pageSize: '10',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.incluirEliminados).toBe(true);
    expect(dto.tipo).toEqual(['producto']);
    // `search` ya tenía su propio `@Transform` (trim): confirma que el campo
    // agregado después no lo pisó.
    expect(dto.search).toBe('smart');
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(10);
  });
});

// `sinCosto` es de DOS estados, no de tres como `activo`: no existe "solo los
// que sí tienen costo". Por eso copia la coerción de `incluirEliminados`
// (`value === 'true'`), no la de `activo`.
describe('QueryItemsDto.sinCosto', () => {
  it('sinCosto=true (string, como llega en el query) se parsea como boolean true', async () => {
    const dto = plainToInstance(QueryItemsDto, { sinCosto: 'true' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.sinCosto).toBe(true);
  });

  it('un valor que no es exactamente "true" se parsea como false', async () => {
    const dto = plainToInstance(QueryItemsDto, { sinCosto: 'cualquier-cosa' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.sinCosto).toBe(false);
  });

  it('sin el parámetro, sinCosto queda falsy (no filtra)', async () => {
    const dto = plainToInstance(QueryItemsDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.sinCosto).toBeFalsy();
  });
});

// `tipo` pasó a ser una lista (la grilla de venta pide producto, receta y combo
// en una sola llamada). Un valor suelto sigue valiendo y llega como lista de
// uno. Estos tests no ejercen el pipe global: el 400 real lo cubre el e2e.
describe('QueryItemsDto.tipo', () => {
  it('una lista separada por comas se parte en un array', async () => {
    const dto = plainToInstance(QueryItemsDto, { tipo: 'producto,receta' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.tipo).toEqual(['producto', 'receta']);
  });

  it('un valor suelto llega como lista de uno', async () => {
    const dto = plainToInstance(QueryItemsDto, { tipo: 'producto' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.tipo).toEqual(['producto']);
  });

  it('recorta blancos y deduplica', async () => {
    const dto = plainToInstance(QueryItemsDto, {
      tipo: 'producto, receta,producto',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.tipo).toEqual(['producto', 'receta']);
  });

  it('un tipo desconocido dentro de la lista es un error de validación', async () => {
    const dto = plainToInstance(QueryItemsDto, { tipo: 'producto,pizza' });

    const errores = await validate(dto);
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('tipo');
  });

  // Sin parámetros nuevos `GET /items` responde lo de siempre: un `tipo` vacío
  // fue 400 antes de que `tipo` fuera lista y lo sigue siendo (no se ignora).
  it.each(['', ',', 'producto,'])(
    'tipo=%j (un elemento vacío tras partir) es un error de validación',
    async (tipo) => {
      const dto = plainToInstance(QueryItemsDto, { tipo });

      const errores = await validate(dto);
      expect(errores).toHaveLength(1);
      expect(errores[0].property).toBe('tipo');
    },
  );
});

describe('QueryItemsDto.orden', () => {
  it('orden=disponibilidad pasa', async () => {
    const dto = plainToInstance(QueryItemsDto, { orden: 'disponibilidad' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.orden).toBe('disponibilidad');
  });

  it('orden=nombre pasa', async () => {
    const dto = plainToInstance(QueryItemsDto, { orden: 'nombre' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('un orden desconocido es un error de validación', async () => {
    const dto = plainToInstance(QueryItemsDto, { orden: 'precio' });

    const errores = await validate(dto);
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('orden');
  });
});

const ID_A = '550e8400-e29b-41d4-a716-446655440001';
const ID_B = '550e8400-e29b-41d4-a716-446655440002';

// `ids` y `modoInventario` los usan los selectores del frontend: `ids` para
// resolver los ítems ya elegidos sin depender de la página que cargó el
// listado. Estos tests no ejercen el pipe global (el 400 real lo cubre el e2e).
describe('QueryItemsDto.ids', () => {
  it('una lista separada por comas se parte en un array de UUID', async () => {
    const dto = plainToInstance(QueryItemsDto, { ids: `${ID_A},${ID_B}` });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.ids).toEqual([ID_A, ID_B]);
  });

  it('un valor que no es UUID es un error de validación', async () => {
    const dto = plainToInstance(QueryItemsDto, { ids: `${ID_A},no-es-uuid` });

    const errores = await validate(dto);
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('ids');
  });

  it('un ids vacío es un error de validación (no se ignora)', async () => {
    const dto = plainToInstance(QueryItemsDto, { ids: '' });

    const errores = await validate(dto);
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('ids');
  });

  it('100 ids pasan y 101 son un error', async () => {
    const uuid = (n: number) =>
      `550e8400-e29b-41d4-a716-${String(n).padStart(12, '0')}`;
    const cien = Array.from({ length: 100 }, (_, i) => uuid(i)).join(',');

    expect(
      await validate(plainToInstance(QueryItemsDto, { ids: cien })),
    ).toHaveLength(0);

    const errores = await validate(
      plainToInstance(QueryItemsDto, { ids: `${cien},${uuid(100)}` }),
    );
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('ids');
  });
});

describe('QueryItemsDto.modoInventario', () => {
  it.each(['cantidad', 'lote', 'serie'])('%s pasa', async (modo) => {
    const dto = plainToInstance(QueryItemsDto, { modoInventario: modo });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.modoInventario).toBe(modo);
  });

  it('un modo desconocido es un error de validación', async () => {
    const dto = plainToInstance(QueryItemsDto, { modoInventario: 'kilo' });

    const errores = await validate(dto);
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('modoInventario');
  });
});
