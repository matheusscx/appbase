import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Alta de un usuario del tenant por su admin.
 *
 * **No lleva contraseña**: si la cuenta es nueva, el sistema **genera** una
 * temporal y la devuelve en claro una sola vez (mismo patrón que el PIN del
 * garzón). Que la elija el admin permitiría una débil, o la misma para todos.
 *
 * **Los roles son obligatorios y múltiples.** Un usuario sin rol entra y no ve
 * nada: crear sin rol es crear algo roto. Y son varios porque así los modela ya
 * la pantalla de usuarios (`USelectMenu multiple`, `roles: []` por miembro).
 */
export class CrearUsuarioTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(100)
  correo: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  telefono?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Elegí al menos un rol' })
  @ArrayUnique()
  @IsUUID('4', { each: true })
  rolIds: string[];
}
