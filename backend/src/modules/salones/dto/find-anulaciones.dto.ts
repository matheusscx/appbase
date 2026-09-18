import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TipoMotivoBaja } from '../../motivos-baja/tipo-motivo-baja.enum';

/**
 * Filtros de `GET /salones/anulaciones` (el listado paginado; spec
 * `2026-09-18-reporte-anulaciones-design.md` § 5.1). `desde`/`hasta` son
 * OPCIONALES acá: el listado pagina, así que un rango sin acotar no trae todo
 * a memoria de una vez.
 *
 * `GET /salones/anulaciones/resumen` (Task 3) usa un DTO propio,
 * `ResumenAnulacionesDto` —no este—, porque ahí `desde`/`hasta` son
 * OBLIGATORIOS con tope de 366 días (ronda de fix 1: el resumen corre dos
 * consultas sin `LIMIT` sobre todo el rango, y sin ese piso `{}` traía a
 * memoria el historial entero del tenant). Los dos arman su `WHERE` con
 * `AnulacionesReporteService.buildFilters`, tipado a `FiltrosAnulacionesQuery`
 * —lo que los dos DTOs comparten—, así que la función no se duplica aunque
 * los DTOs ya no sean el mismo.
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
