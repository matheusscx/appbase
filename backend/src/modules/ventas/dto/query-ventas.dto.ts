import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EstadoVenta } from '../entities/venta.entity';

export class QueryVentasDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EstadoVenta)
  estado?: EstadoVenta;

  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: string;
}
