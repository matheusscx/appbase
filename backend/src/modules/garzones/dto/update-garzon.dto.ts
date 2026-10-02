import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TipoGarzon } from '../enums/tipo-garzon.enum';

/**
 * Actualiza datos del garzón. El PIN NO se cambia aquí — se regenera con su
 * propio endpoint (`PATCH /garzones/:id/pin`), que crea uno nuevo y lo devuelve
 * una sola vez.
 *
 * `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
 * `IsOptional` trata `null` igual que ausente y saltea el validador de abajo,
 * y el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
 * Omitir un campo conserva el valor que tenía.
 */
export class UpdateGarzonDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(Object.values(TipoGarzon))
  tipo?: TipoGarzon;

  /**
   * Vincula el garzón a una cuenta del tenant (**modo personal**: opera desde
   * su propia tablet y no teclea PIN). `null` desvincula.
   *
   * `ValidateIf` y no `IsOptional`: `IsOptional` deja pasar **tanto** el campo
   * ausente **como** el `null`, y acá los dos significan cosas distintas —
   * ausente es "no toques el vínculo", `null` es "sacalo". Sin esa diferencia,
   * un PATCH del formulario que no manda el campo desvincularía al garzón.
   */
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsUUID('4', { message: 'usuarioId debe ser un UUID' })
  usuarioId?: string | null;
}
