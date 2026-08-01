import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryItemsDto } from './query-items.dto';

// `incluirEliminados` está duplicado en `QueryItemsDto` (no `extends
// QueryIncluirEliminadosDto`: la clase ya extiende `PaginationQueryDto` para
// la paginación y TS no permite herencia múltiple) — mismo motivo que
// `query-causas-merma.dto.spec.ts` existe para `QueryCausasMermaDto`: nada
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

  it('sin el parámetro, incluirEliminados queda falsy (igual que en QueryCausasMermaDto)', async () => {
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
    expect(dto.tipo).toBe('producto');
    // `search` ya tenía su propio `@Transform` (trim) antes de esta tarea:
    // confirma que el campo agregado no lo pisó.
    expect(dto.search).toBe('smart');
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(10);
  });
});
