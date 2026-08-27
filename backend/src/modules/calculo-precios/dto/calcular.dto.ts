import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
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

  /**
   * Cuenta de salón cuyo instante de apertura decide la vigencia de las reglas.
   *
   * Se manda el **id**, no la fecha: aceptar un instante del cliente sería la
   * forma de hacer que una promo vencida aplique. El servidor lee `abierta_el`.
   */
  @IsOptional()
  @IsUUID('4')
  cuentaId?: string;

  /**
   * Canal de la venta, para las promociones que rigen en uno solo. Default
   * `'fisico'`.
   *
   * ⚠️ **Este campo solo puede mentir en pantalla porque los dos caminos que
   * COBRAN lo pisan.** No es una propiedad del DTO: es una invariante que
   * sostienen `ventas.service.ts` —que pasa el canal real de la venta— y
   * `OnlineService.prepararLineasCheckout` —que fuerza `'online'`—. La versión
   * anterior de este comentario afirmaba lo mismo cuando solo el primero lo
   * hacía, y era falso: el checkout de la tienda reenviaba el `canal` del body
   * al cálculo que autoriza el monto contra la tarjeta, así que un navegador
   * mandando `'fisico'` colaba una promo de local en una compra online.
   *
   * O sea: si mañana aparece un tercer llamador que cobra, tiene que pisarlo
   * también, o este comentario vuelve a ser mentira. El campo existe para que
   * una previsualización pueda pedir la vista del otro canal, nada más — mismo
   * argumento que `cuentaId`: lo que decide plata lo pone el servidor.
   */
  @IsOptional()
  @IsIn(['fisico', 'online'])
  canal?: 'fisico' | 'online';
}
