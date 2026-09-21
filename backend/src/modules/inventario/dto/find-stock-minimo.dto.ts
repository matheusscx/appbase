import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindStockMinimoDto extends PaginationQueryDto {
  /** Solo las filas con mínimo cargado y stock por debajo (incluye las en camino). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloBajoMinimo?: boolean;

  @IsOptional()
  @IsUUID()
  ubicacionId?: string;

  /** Sobre el nombre del producto. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
