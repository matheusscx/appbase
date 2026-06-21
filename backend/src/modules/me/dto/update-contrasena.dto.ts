import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UpdateContrasenaDto {
  @IsString()
  @IsNotEmpty()
  contrasenaActual: string;

  @IsString()
  @MinLength(8)
  contrasenaNueva: string;

  @IsString()
  @IsNotEmpty()
  confirmarContrasena: string;
}
