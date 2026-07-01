import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryMovimientosCajaDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['entrada', 'salida'])
  tipo?: string;
}
