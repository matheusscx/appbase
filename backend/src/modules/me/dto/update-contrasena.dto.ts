import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UpdateContrasenaDto {
  @IsString({ message: 'Escribe tu contraseña actual' })
  @IsNotEmpty({ message: 'Escribe tu contraseña actual' })
  contrasenaActual: string;

  @IsString({ message: 'Escribe la contraseña nueva' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  contrasenaNueva: string;

  @IsString({ message: 'Repite la contraseña nueva' })
  @IsNotEmpty({ message: 'Repite la contraseña nueva' })
  confirmarContrasena: string;
}
