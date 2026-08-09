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
 */
export class UpdateGarzonDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
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
