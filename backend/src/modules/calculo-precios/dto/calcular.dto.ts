import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

export class LineaDto {
  @IsUUID('4')
  itemId: string;

  @IsNumberString()
  cantidad: string;

  @IsOptional()
  @IsNumberString()
  cantidadPresentacion?: string;

  @IsOptional()
  @IsString()
  unidadCodigoPresentacion?: string;

  /**
   * Override opcional del precio_base del ítem. Mismo signo que exige el camino
   * de venta (`LineaVentaDto`): nunca negativo. Sin esto, `-100` pasaba —
   * `cantidad` sí se valida en `resolverLinea` y este campo no— y el endpoint
   * devolvía `totalFinal: -100`. El `0` sigue siendo válido: prohibirlo es la
   * decisión de owner que sigue abierta para ventas, y no se adelanta acá.
   */
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
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
