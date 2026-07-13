import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateGarzonDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  // El PIN operativo se genera automáticamente en el backend (no lo elige el
  // usuario) y se devuelve una sola vez en la respuesta de creación.

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
