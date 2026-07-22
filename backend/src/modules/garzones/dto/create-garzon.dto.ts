import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { TipoGarzon } from '../enums/tipo-garzon.enum';

export class CreateGarzonDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  // El PIN operativo se genera automáticamente en el backend (no lo elige el
  // usuario) y se devuelve una sola vez en la respuesta de creación.

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsIn(Object.values(TipoGarzon))
  tipo?: TipoGarzon;
}
