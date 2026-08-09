import { IsString, MinLength } from 'class-validator';

/**
 * Fija la contraseña desde un link de invitación o de reset.
 *
 * **No lleva la actual**, a diferencia de `UpdateContrasenaDto`: la prueba de
 * que sos vos es el token del link. En la invitación no hay contraseña anterior,
 * y en el reset justamente no te acordás.
 *
 * `MinLength(8)`, el mismo mínimo que el cambio desde el perfil. Si divergieran,
 * una persona podría fijar por link una contraseña que después el perfil le
 * rechaza.
 */
export class ElegirContrasenaDto {
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  contrasena: string;
}
