import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateCobroDto {
  @IsOptional()
  @IsUUID()
  inscripcionId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^\S+$/)
  pagadorRef?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  referenciaExterna?: string;

  /**
   * Sin `@EsMontoCobrado()` a propósito: esa marca valida contra la moneda
   * OFICIAL DEL TENANT, y una orden de pasarela va en la moneda de la pasarela
   * (`MONEDA_ORDEN_V1`, hoy CLP). Un tenant con oficial USD aceptaría dos
   * decimales en una orden CLP. La escala la valida el service contra la moneda
   * de la orden — ver `MonedasService.validarEscalaDeMoneda`.
   */
  @IsNumberString()
  monto: string;

  @IsString()
  @Length(1, 255)
  descripcion: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(48)
  cuotas?: number;
}
