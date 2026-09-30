import { IsOptional } from 'class-validator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';

/**
 * Ventana de la tendencia de descuadres. Sin paginación a propósito: la fila es
 * por cajero del tenant, no por cierre — un tenant con cien cajeros sigue
 * entrando en una respuesta.
 *
 * `desde`/`hasta` aceptan fecha pura (`YYYY-MM-DD`, lo que emite `AppDateInput`)
 * o timestamp. El borde superior lo expande `bordeHastaSql`, no este DTO: ver
 * `common/utils/rango-fecha.util.ts` y `patterns/backend.md` §10b.
 */
export class QueryTendenciaDescuadresDto {
  @IsOptional()
  @EsFechaOTimestamp()
  desde?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  hasta?: string;
}
