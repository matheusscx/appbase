import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryIntentosRechazadosDto extends PaginationQueryDto {
  /** Los intentos contra una caja concreta. */
  @IsOptional()
  @IsUUID()
  cajaId?: string;

  /** Los intentos de una persona, a lo largo de todas sus cajas. */
  @IsOptional()
  @IsUUID()
  usuarioId?: string;
}
