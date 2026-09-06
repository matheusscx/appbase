import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { QueryIncluirEliminadosDto } from '../../../common/dto/query-incluir-eliminados.dto';

// `soloActivas` no le corresponde a `QueryIncluirEliminadosDto` (es propio de
// este listado, igual que en `QueryMotivosDiferenciaInventarioDto`).
export class QueryUbicacionesDto extends QueryIncluirEliminadosDto {
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  soloActivas?: boolean;
}
