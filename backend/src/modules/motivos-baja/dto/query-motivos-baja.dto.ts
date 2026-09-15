import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { QueryIncluirEliminadosDto } from '../../../common/dto/query-incluir-eliminados.dto';
import { TipoMotivoBaja } from '../tipo-motivo-baja.enum';

// `QueryIncluirEliminadosDto` es compartido por los 16 recursos de la
// papelera: `soloActivas` no le corresponde a él (es propio de este listado),
// así que se extiende acá en vez de agregarlo al DTO común.
export class QueryMotivosBajaDto extends QueryIncluirEliminadosDto {
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  soloActivas?: boolean;

  @IsOptional()
  @IsEnum(TipoMotivoBaja)
  tipo?: TipoMotivoBaja;
}
