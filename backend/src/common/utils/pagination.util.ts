import type { PaginationQueryDto } from '../dto/pagination-query.dto';
import type { PaginationMeta } from '../interfaces/paginated-response.interface';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 100;

/**
 * La página más grande que se acepta (`PaginationQueryDto.page`). Sale de una cuenta, no
 * de un número redondo: `offset = (page - 1) * pageSize` se calcula en JS y viaja como
 * `OFFSET` a Postgres. Con `pageSize ≤ MAX_PAGE_SIZE`, la mayor página cuyo `offset` sigue
 * siendo un entero exacto de JS es
 *
 *   floor(Number.MAX_SAFE_INTEGER / MAX_PAGE_SIZE) + 1 = 90.071.992.547.410
 *
 * (`offset` ≤ 9.007.199.254.740.900 ≤ 2^53 − 1). Es más estricta que el `bigint` de
 * Postgres (~9,2e18), que era el que daba 500: pasado 2^53 el `offset` ya no es exacto, y
 * pasado el `bigint` la consulta revienta. Más allá de este tope, 400.
 */
export const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_PAGE_SIZE) + 1;

export function resolvePagination(query: PaginationQueryDto): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = Math.max(DEFAULT_PAGE, query.page ?? DEFAULT_PAGE);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
  );

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
