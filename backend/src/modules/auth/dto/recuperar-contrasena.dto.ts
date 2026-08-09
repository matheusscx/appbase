import { IsEmail } from 'class-validator';

/**
 * Pedido de reset. Solo el correo: el resto de la identificación la hace el
 * link que llega a esa casilla.
 */
export class RecuperarContrasenaDto {
  @IsEmail({}, { message: 'El correo no es válido' })
  correo: string;
}
