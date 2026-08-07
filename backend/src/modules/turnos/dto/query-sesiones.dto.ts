import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EstadoSesionGarzon } from '../entities/sesion-garzon.entity';

export class QuerySesionesDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  garzonId?: string;

  @IsOptional()
  @IsUUID()
  turnoId?: string;

  @IsOptional()
  @IsEnum(EstadoSesionGarzon)
  estado?: EstadoSesionGarzon;

  // Fecha pura: `AppDateInput` emite `YYYY-MM-DD` y la query la castea con
  // `::date`. Hacen falta las DOS validaciones, y cada una tapa lo que la otra
  // deja pasar —medido, no deducido:
  //
  //   - `@Matches` sola acepta `2026-13-45` y `2026-08-45` → 22008 → 500.
  //   - `@IsDateString()` sola acepta `2026-08`, `2026-W32-1`, `20260807` y un
  //     timestamp completo → 22007 → 500. Y además acepta `2026-02-31`, que es
  //     sintácticamente ISO pero no existe en el calendario → 22008 → 500.
  //
  // `strict: true` es lo que valida el calendario de verdad (rechaza el 31 de
  // febrero). El precedente del repo, `QueryPropinaReporteDto`, llega al mismo
  // lugar por otro camino: regex laxo + `normalizarRangoReporte()`, que hace el
  // round-trip por `Date`. Acá no aplica ese molde porque esas dos fechas son
  // requeridas y con reglas de rango entre sí, y estas son filtros opcionales e
  // independientes.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'desde debe usar YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'desde debe ser una fecha real' })
  desde?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'hasta debe usar YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'hasta debe ser una fecha real' })
  hasta?: string;
}
