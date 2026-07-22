import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
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
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsIn(Object.values(TipoGarzon))
  tipo?: TipoGarzon;
}
