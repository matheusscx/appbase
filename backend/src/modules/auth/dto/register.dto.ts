import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString({ message: 'Escribe tu nombre' })
  @IsNotEmpty({ message: 'Escribe tu nombre' })
  nombre: string;

  @IsOptional()
  @IsString()
  apellido?: string;

  @IsEmail({}, { message: 'Escribe un correo válido' })
  correo: string;

  // 8, el mismo mínimo que elegirla por link y cambiarla en Mi cuenta (08.16).
  @IsString({ message: 'Escribe una contraseña' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  contrasena: string;

  @IsOptional()
  @IsString()
  nombreUsuario?: string;

  @IsOptional()
  @IsString()
  telefono?: string;
}
