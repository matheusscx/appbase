import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ClaseDocumentoMaquina } from '../../venta-documentos/entities/venta-documento.entity';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { MAX_INT } from '../../../common/constants/escalas';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class PagoItemDto {
  // En minúsculas por la misma razón que `PagoVentaDto.metodoPagoId`: el abono
  // pasa por el mismo mapa de `PagosService.registrar`.
  @IdEnMinusculas()
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
  // `@Min(0)` y no 1: Webpay informa 0 cuotas en débito. Un negativo se
  // guardaba tal cual. El máximo es el de la columna `int`.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  numeroCuotas?: number;

  @IsOptional()
  @IsString()
  tipoPago?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  tarjetaUltimos4?: string;

  /**
   * El número del voucher que emitió la máquina, si el cajero lo tiene a mano.
   * **Solo lo lee el servidor para el voucher duplicado de E1b**: un abono con
   * un medio de la máquina sobre una deuda ya documentada. En cualquier otro
   * medio se ignora sin error. Mismas reglas que `PagoVentaDto.numeroDocumento`.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(40)
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001F\u007F]*$/, {
    message: 'numeroDocumento no puede llevar caracteres de control',
  })
  numeroDocumento?: string;

  /** Qué emitió la máquina. Mismas reglas que `numeroDocumento`. */
  @IsOptional()
  @IsIn(['voucher', 'boleta'])
  claseDocumento?: ClaseDocumentoMaquina;
}

export class CreatePagoDto {
  @IsUUID()
  ventaId: string;

  @IsArray()
  // Mismo tope que `CreateVentaDto.pagos`: tres o cuatro INSERT por pago.
  @ArrayMaxSize(50)
  @ArrayMinSize(1)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PagoItemDto)
  pagos: PagoItemDto[];
}
