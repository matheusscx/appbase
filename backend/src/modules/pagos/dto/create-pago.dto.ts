import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

export class PagoItemDto {
  @IsUUID()
  metodoPagoId: string;

  @IsNumberString()
  @EsMontoCobrado()
  monto: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  // Detalle de tarjeta desde la pasarela (Webpay). No lo envía el POS manual.
  @IsOptional()
  @IsInt()
  numeroCuotas?: number;

  @IsOptional()
  @IsString()
  tipoPago?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  tarjetaUltimos4?: string;
}

export class CreatePagoDto {
  @IsUUID()
  ventaId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PagoItemDto)
  pagos: PagoItemDto[];
}
