import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DevolucionLineaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;
}

export class CreateReembolsoDto {
  /**
   * Sin `@EsMontoCobrado()` a propósito: esa marca valida contra la moneda
   * OFICIAL DEL TENANT, y una orden de pasarela va en la moneda de la pasarela
   * (`MONEDA_ORDEN_V1`, hoy CLP). Un tenant con oficial USD aceptaría dos
   * decimales en una orden CLP. La escala la valida el service contra la moneda
   * de la orden — ver `MonedasService.validarEscalaDeMoneda`.
   */
  @IsNumberString()
  monto: string;

  /** Genera una nota de crédito interna sobre la venta vinculada a la orden. */
  @IsOptional()
  @IsBoolean()
  generarNotaCredito?: boolean;

  /** Ítems a devolver a stock (solo modo 'cantidad'); independiente de la NC. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DevolucionLineaDto)
  devoluciones?: DevolucionLineaDto[];
}
