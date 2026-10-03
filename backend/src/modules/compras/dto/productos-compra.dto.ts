import {
  ArrayMaxSize,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * `ids=<uuid>,<uuid>` (o la clave repetida) como lista sin repetidos. Copia de
 * `parseLista` de `items/dto/query-items.dto.ts`, con la misma regla: un
 * elemento vacío no se descarta, para que `ids=` sea un 400 y no el catálogo
 * entero.
 */
function parseIds({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return undefined;
  const source: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [value];
  return [
    ...new Set(
      source.map((t) => (typeof t === 'string' ? t.trim() : '__invalid__')),
    ),
  ];
}

/**
 * La búsqueda del selector de producto de una compra: el mismo contrato que
 * `GET /items` usa para `AppItemSelect` (`search`, `ids`, página), sobre la
 * lista propia de Compras. No acepta los filtros de `/items` (`tipo`,
 * `activo`…): lo que se puede comprar lo decide el backend.
 */
export class QueryProductosCompraDto extends PaginationQueryDto {
  /** Los ya elegidos, para pintar su nombre sin depender de la página. Tope 100 = `MAX_PAGE_SIZE`. */
  @IsOptional()
  @Transform(parseIds)
  @IsUUID('4', { each: true })
  @ArrayMaxSize(100)
  ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;
}
