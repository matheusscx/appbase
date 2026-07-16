import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PersonalizacionRecetaDto } from '../../../common/dto/personalizacion-receta.dto';

export class LineaVentaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  @IsOptional()
  @IsNumberString()
  precioUnitario?: string;

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

  @IsNumberString()
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

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerVentaDto)
  customer?: CustomerVentaDto;

  @IsOptional()
  @IsString()
  comentario?: string;

  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: 'fisico' | 'online';
}
