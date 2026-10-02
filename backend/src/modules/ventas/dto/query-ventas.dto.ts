import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EstadoVenta } from '../entities/venta.entity';

/**
 * Quién emitió el documento de la venta (spec `emision-por-venta` § 3.7). Los
 * tres primeros son un emisor; el resto son las revisiones del comercio: lo que
 * falta anotar (`sin_numero`), lo que nadie documentó (`sin_documento`) y los
 * vouchers de la máquina que repiten una deuda ya documentada (`duplicado`).
 */
export const FILTROS_DOCUMENTO = [
  'sistema',
  'maquina',
  'externo',
  'sin_numero',
  'sin_documento',
  'duplicado',
] as const;
export type FiltroDocumento = (typeof FILTROS_DOCUMENTO)[number];

export class QueryVentasDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EstadoVenta)
  estado?: EstadoVenta;

  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: string;

  @IsOptional()
  @IsIn(FILTROS_DOCUMENTO)
  documento?: FiltroDocumento;
}
