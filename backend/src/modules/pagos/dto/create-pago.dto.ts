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
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

export class PagoItemDto {
  @IsUUID()
  metodoPagoId: string;

  // Mismo gate que `PagoVentaDto.monto`, que lo tenía desde siempre: acá
  // faltaba y la asimetría se notaba tarde y mal. Un abono NEGATIVO no llegaba
  // a persistirse —el guard de `registrarMovimientoEnTransaccion` lo frena y
  // revierte la transacción— pero contestaba 422 hablando de un movimiento de
  // caja, no del monto que el cliente mandó; y el CERO no lo frenaba nadie:
  // dejaba pago, aplicación y movimiento de caja en cero, sin aportar nada.
  @IsNumberString()
  @IsDecimalPositivo()
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
