import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EstadoVenta } from '../../ventas/entities/venta.entity';

export class QueryPagosDto extends PaginationQueryDto {
  @IsOptional()
  @EsFechaOTimestamp()
  fechaDesde?: string;

  @IsOptional()
  @EsFechaOTimestamp()
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
