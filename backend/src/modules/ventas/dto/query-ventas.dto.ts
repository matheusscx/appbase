import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';
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

/**
 * El rango de fechas del historial y de sus tarjetas. Fecha pura (`YYYY-MM-DD`,
 * lo que emite `AppRangoFechas`) o timestamp: la pura se expande al **día del
 * negocio** del tenant y `hasta` incluye el día completo (`rango-fecha.util.ts`,
 * `docs/patterns/backend.md` § 10b). Se mide sobre `ventas.fecha`, la que la
 * lista muestra.
 */
export class QueryVentasResumenDto {
  @IsOptional()
  @EsFechaOTimestamp()
  desde?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  hasta?: string;
}

export class QueryVentasDto extends PaginationQueryDto {
  @IsOptional()
  @EsFechaOTimestamp()
  desde?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  hasta?: string;

  /**
   * Folio (o número) de un documento vigente de la venta: el de la boleta del
   * sistema o el que se anotó de la máquina o de afuera. Coincidencia exacta.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  folio?: string;

  @IsOptional()
  @IsEnum(EstadoVenta)
  estado?: EstadoVenta;

  /**
   * Lo que se debe ahora: la misma regla de la tarjeta "Por cobrar" del Inicio
   * (pendientes o parciales con saldo, sin las correcciones). Ignora el estado
   * que se mande junto: una venta con saldo es una de esas dos.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  porCobrar?: boolean;

  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: string;

  @IsOptional()
  @IsIn(FILTROS_DOCUMENTO)
  documento?: FiltroDocumento;
}
