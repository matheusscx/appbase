import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query param compartido por todos los listados de la papelera. Vive en
 * `common/` y no en cada módulo porque el nombre del param es contrato: si
 * cada controller lo escribiera por su cuenta, dos podrían discrepar y la
 * pantalla llamaría a uno con el nombre del otro, sin error visible.
 */
export class QueryIncluirEliminadosDto {
  // El query string trae 'true'/'false' como texto: sin este Transform,
  // @IsBoolean rechaza siempre y el param queda inutilizable.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  incluirEliminados?: boolean;
}
