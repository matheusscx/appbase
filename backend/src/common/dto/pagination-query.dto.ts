import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PAGE, MAX_PAGE_SIZE } from '../utils/pagination.util';

export class PaginationQueryDto {
  /** Tope: la cuenta está en `MAX_PAGE`. Sin él, una página enorme daba 500 en vez de 400. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}
