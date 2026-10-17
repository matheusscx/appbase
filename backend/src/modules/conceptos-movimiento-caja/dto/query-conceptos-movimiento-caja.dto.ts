import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { QueryIncluirEliminadosDto } from '../../../common/dto/query-incluir-eliminados.dto';

export class QueryConceptosMovimientoCajaDto extends QueryIncluirEliminadosDto {
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  soloActivas?: boolean;
}
