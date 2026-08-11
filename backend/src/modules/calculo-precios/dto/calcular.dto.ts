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
   * Override opcional del precio_base del ítem: nunca negativo. Sin esto, `-100`
   * pasaba —`cantidad` sí se valida en `resolverLinea` y este campo no— y el
   * endpoint devolvía `totalFinal: -100`.
   *
   * ⚠️ **El `0` sigue siendo válido acá, a diferencia de `LineaVentaDto`, que el
   * 2026-08-11 pasó a exigir `> 0`.** La divergencia es deliberada y medida: este
   * campo NO es el mismo canal en los dos endpoints. Al de venta no lo manda
   * nadie (`toVentaLineasBody` no lo incluye), pero a este lo alimentan dos
   * composables con el precio ya calculado de la línea —`useVenta.ts:197` y
   * `useSalones.ts:200`—, y ese precio es `precioBase + extras`, que da `0`
   * legítimamente cuando el ítem vale 0 (`create-item.dto.ts`: el `0` es
   * legítimo) y la personalización no agrega nada pago.
   *
   * Rechazarlo acá rompía el cobro **en silencio**: `useCalculoPrecios` se traga
   * el error a propósito, así que el carrito nunca vuelve a estar vigente y el
   * modal de cobro no abre, sin un solo mensaje para el cajero. Y ni siquiera
   * protegía nada: `ventas.service.ts` ignora el override cuando la línea tiene
   * personalización —recalcula `precioBase + precioExtraTotal`—, o sea que el
   * preview habría quedado más estricto que la venta.
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
