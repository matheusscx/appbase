import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class QueryPagosDto {
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
}
