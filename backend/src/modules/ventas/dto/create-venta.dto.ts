import {
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
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { ClaseDocumentoMaquina } from '../../venta-documentos/entities/venta-documento.entity';
import { PersonalizacionRecetaDto } from '../../../common/dto/personalizacion-receta.dto';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { PropinaCierreMesaDto } from './propina-cierre-mesa.dto';
import { PropinaDirectaDto } from './propina-directa.dto';

export class LineaVentaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  @IsOptional()
  @IsNumberString()
  cantidadPresentacion?: string;

  @IsOptional()
  @IsString()
  unidadCodigoPresentacion?: string;

  @IsOptional()
  @IsUUID(undefined, { each: true })
  descuentoIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  recargoIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  impuestoIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  unidadIds?: string[]; // modo 'serie' salida

  @IsOptional()
  @IsUUID()
  loteId?: string; // modo 'lote' salida

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalizacionRecetaDto)
  personalizacion?: PersonalizacionRecetaDto;
}

export class PagoVentaDto {
  @IsUUID()
  metodoPagoId: string;

  // Una línea de pago en $0 no aporta nada; el POS ya los omite al confirmar.
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

  /**
   * El número del voucher o de la boleta que emitió la máquina de tarjeta, si el
   * cajero lo tiene a mano. Solo lo lee el servidor cuando el medio del pago
   * emite con la máquina; en cualquier otro medio se ignora sin error (la
   * pantalla no lo muestra ahí y el pago sigue siendo válido). Opcional: se
   * puede completar después.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(40)
  // Sin caracteres de control: un salto de línea o un NUL en el número llegaría
  // a la base y a lo que se imprima. Con el `trim` de arriba, los de los
  // extremos ya no están; acá se rechazan los del medio.
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

export class CustomerVentaDto {
  @IsOptional()
  @IsUUID()
  terceroId?: string;

  @IsString()
  @MinLength(1)
  nombre: string;

  @IsOptional()
  @IsString()
  rut?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class CreateVentaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas: LineaVentaDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagoVentaDto)
  pagos?: PagoVentaDto[];

  @IsOptional()
  @IsUUID()
  tipoDocumentoId?: string;

  @IsOptional()
  @IsUUID()
  metodoPagoId?: string;

  @IsOptional()
  @IsUUID(undefined, { each: true })
  descuentosVentaIds?: string[];

  @IsOptional()
  @IsUUID(undefined, { each: true })
  recargosVentaIds?: string[];

  // `IsObject` además de `ValidateNested`: este deja pasar un array, que con una
  // Factura revienta el chequeo de `customer_requerido` en un 500.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CustomerVentaDto)
  customer?: CustomerVentaDto;

  @IsOptional()
  @IsString()
  comentario?: string;

  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: 'fisico' | 'online';

  /** Solo cierre de cuenta de mesa — crea venta_propina y eleva target de cobro. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PropinaCierreMesaDto)
  propinaCierreMesa?: PropinaCierreMesaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PropinaDirectaDto)
  propinaDirecta?: PropinaDirectaDto;
}
