import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class LineaDto {
  @IsUUID('4')
  itemId: string;

  @IsNumberString()
  cantidad: string;

  /** Override opcional del precio_base del ítem. */
  @IsOptional()
  @IsNumberString()
  precioUnitario?: string;

  /** Si se pasa, reemplaza los descuentos asociados al ítem. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  descuentoIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  recargoIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  impuestoIds?: string[];
}

export class CalcularVentaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaDto)
  lineas: LineaDto[];

  /** Habilita la evaluación de reglas por método de pago. */
  @IsOptional()
  @IsUUID('4')
  metodoPagoId?: string;

  /** Descuentos aplicados a nivel venta (sobre el total agregado). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  descuentosVentaIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  recargosVentaIds?: string[];
}
