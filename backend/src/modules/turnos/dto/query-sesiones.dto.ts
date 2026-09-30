import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';
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
  // `::date`. Este DTO fue el molde de `EsFechaPura()`; por qué hacen falta sus
  // dos validaciones está en el decorador. El precedente del repo,
  // `QueryPropinaReporteDto`, llega al mismo lugar por otro camino: regex laxo +
  // `normalizarRangoReporte()`, que hace el round-trip por `Date`. Acá no aplica
  // ese molde porque esas dos fechas son requeridas y con reglas de rango entre
  // sí, y estas son filtros opcionales e independientes.
  @IsOptional()
  @EsFechaPura()
  desde?: string;

  @IsOptional()
  @EsFechaPura()
  hasta?: string;
}
