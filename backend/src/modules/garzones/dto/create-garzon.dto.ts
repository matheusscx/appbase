import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TipoGarzon } from '../enums/tipo-garzon.enum';

export class CreateGarzonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  // El PIN operativo se genera automáticamente en el backend (no lo elige el
  // usuario) y se devuelve una sola vez en la respuesta de creación.

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsIn(Object.values(TipoGarzon))
  tipo?: TipoGarzon;

  /**
   * Vincula el garzón a una cuenta del tenant desde el alta (**modo personal**).
   * Cuando viene, el garzón **nace sin PIN usable**: lo fija él desde su perfil,
   * y el encargado nunca llega a ver uno. Sin este campo el alta habría que
   * hacerla en dos pasos, y el encargado vería un PIN que muere al vincular.
   */
  @IsOptional()
  @IsUUID('4', { message: 'usuarioId debe ser un UUID' })
  usuarioId?: string;
}
