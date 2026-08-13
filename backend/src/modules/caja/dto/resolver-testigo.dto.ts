import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Lo que se manda para dar fe (o no) del conteo. El PIN es **opcional acá**
 * a propósito (decisión del owner, 2026-08-12): si el garzón está vinculado
 * a una cuenta (`garzones.usuario_id`), la identidad se prueba con el JWT
 * que llama y el PIN ni se pide — mandarlo no ayuda, esa vía queda
 * rechazada para él (`CajaTestigoService.resolver`). Sin vínculo, sigue
 * siendo obligatorio. Misma validación de formato que `CredencialGarzonDto`
 * (`common/dto/credencial-garzon.dto.ts`) cuando se manda: el seed y
 * `generarPinUnico` (`garzones.service.ts`) siempre producen 6 dígitos.
 */
export class ResolverTestigoDto {
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin?: string;

  /** `true` = doy fe · `false` = rechazo. */
  @IsBoolean()
  firma: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  comentario?: string;
}
