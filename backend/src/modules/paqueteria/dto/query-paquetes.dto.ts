import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MAX_ENTRADA_CODIGO } from '../codigo-paquete';
import type { EstadoPaquete } from '../paqueteria.types';

export class QueryPaquetesDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['disponible', 'en_ruta', 'entregado'])
  estado?: EstadoPaquete;

  @IsOptional()
  @IsIn(['true', 'false'])
  cobroEnDestino?: 'true' | 'false';

  /** Los que les falta la dirección o el destinatario: lo que hay que completar antes de salir. */
  @IsOptional()
  @IsIn(['true'])
  porCompletar?: 'true';

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ENTRADA_CODIGO)
  q?: string;
}
