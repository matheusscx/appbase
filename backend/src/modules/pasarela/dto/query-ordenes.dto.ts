import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';

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
  @EsFechaOTimestamp()
  fechaDesde?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  fechaHasta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;
}
