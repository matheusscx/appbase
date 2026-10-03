import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';
import {
  MAX_PAGE,
  MAX_PAGE_SIZE,
  resolvePagination,
} from '../utils/pagination.util';

// El query llega como texto: `@Type(() => Number)` lo convierte antes de validar.
// Estos tests no ejercen el pipe global (el 400 real lo cubre
// `test/paginacion.e2e-spec.ts`).
describe('PaginationQueryDto.page', () => {
  it('la última página permitida pasa y la siguiente es un error', async () => {
    expect(
      await validate(
        plainToInstance(PaginationQueryDto, { page: String(MAX_PAGE) }),
      ),
    ).toHaveLength(0);

    const errores = await validate(
      plainToInstance(PaginationQueryDto, { page: String(MAX_PAGE + 1) }),
    );
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('page');
  });

  it('la página que daba 500 (su OFFSET no cabía en un bigint) es un error', async () => {
    const errores = await validate(
      plainToInstance(PaginationQueryDto, { page: '99999999999999999999' }),
    );
    expect(errores).toHaveLength(1);
    expect(errores[0].property).toBe('page');
  });
});

describe('MAX_PAGE', () => {
  it('con el pageSize más grande, el offset de la última página es un entero exacto de JS', () => {
    const { offset } = resolvePagination({
      page: MAX_PAGE,
      pageSize: MAX_PAGE_SIZE,
    });

    expect(Number.isSafeInteger(offset)).toBe(true);
  });

  it('es la página más grande con esa propiedad: la siguiente ya se pasa', () => {
    expect(Number.isSafeInteger(MAX_PAGE * MAX_PAGE_SIZE)).toBe(false);
  });
});
