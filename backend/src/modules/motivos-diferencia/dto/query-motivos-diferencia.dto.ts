import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { QueryIncluirEliminadosDto } from '../../../common/dto/query-incluir-eliminados.dto';

// `QueryIncluirEliminadosDto` es compartido por los 16 recursos de la
// papelera: `soloActivas` no le corresponde a él (es propio de este listado),
// así que se extiende acá en vez de agregarlo al DTO común.
export class QueryMotivosDiferenciaDto extends QueryIncluirEliminadosDto {
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  soloActivas?: boolean;
}
