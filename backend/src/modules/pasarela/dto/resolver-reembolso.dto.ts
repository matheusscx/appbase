import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * El admin revisó el portal de Transbank y marca un reembolso que quedó sin
 * confirmar (ADR-029, decisión del owner del 2026-10-04).
 */
export class ResolverReembolsoDto {
  /** `true` = "Salió" (Transbank devolvió la plata); `false` = "No salió". */
  @IsBoolean()
  salio: boolean;

  /**
   * El código de autorización que muestra el portal. Obligatorio con "Salió":
   * es la evidencia de la marca, y lo que la consulta por saldo no puede traer.
   */
  @ValidateIf((o: ResolverReembolsoDto) => o.salio === true)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\S+$/, {
    message: 'El código de autorización no lleva espacios',
  })
  codigoAutorizacion?: string;
}
