import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EstadoVenta } from '../../ventas/entities/venta.entity';

export class QueryPagosDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @IsOptional()
  @IsUUID()
  metodoPagoId?: string;

  @IsOptional()
  @IsUUID()
  cajaId?: string;

  @IsOptional()
  @IsUUID()
  ventaId?: string;

  @IsOptional()
  @IsEnum(EstadoVenta)
  ventaEstado?: EstadoVenta;
}
