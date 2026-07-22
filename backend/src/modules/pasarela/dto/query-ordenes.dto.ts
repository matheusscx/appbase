import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const ESTADOS_ORDEN = [
  'creada',
  'en_proceso',
  'procesando',
  'pagada',
  'pendiente',
  'conciliada',
  'fallida',
  'expirada',
  'reembolsada',
] as const;

export class QueryOrdenesDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_ORDEN)
  estado?: string;

  @IsOptional()
  @IsIn(['interno', 'api'])
  origen?: string;

  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;
}
