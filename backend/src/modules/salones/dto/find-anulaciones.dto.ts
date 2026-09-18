import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TipoMotivoBaja } from '../../motivos-baja/tipo-motivo-baja.enum';

/**
 * Filtros del reporte de anulaciones (spec
 * `2026-09-18-reporte-anulaciones-design.md` § 5.1). Compartido por las dos
 * rutas —`GET /salones/anulaciones` (Task 2) y `GET /salones/anulaciones/resumen`
 * (Task 3)—: las dos arman su `WHERE` a partir de este mismo DTO, pasado a
 * `AnulacionesReporteService.buildFilters`. El resumen no pagina, así que no
 * usa `page`/`pageSize`, pero igual extiende `PaginationQueryDto` para quedar
 * validado con el mismo shape que el listado.
 */
export class FindAnulacionesDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @IsUUID()
  garzonId?: string;

  @IsOptional()
  @IsUUID()
  motivoBajaId?: string;

  @IsOptional()
  @IsEnum(TipoMotivoBaja)
  tipo?: TipoMotivoBaja;
}
