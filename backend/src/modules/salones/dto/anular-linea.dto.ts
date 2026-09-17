import { IsNumberString, IsUUID } from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

/**
 * `cantidad` viaja en la unidad CANÓNICA de la línea —la misma que
 * `cuenta_lineas.cantidad_enviada`, que es el tope (spec § 4.1)— no en la
 * presentación. Es cantidad, no plata: sin `EscalaMonedaPipe`, igual que
 * `UpdateLineaDto`.
 *
 * `@IsDecimalPositivo()` (mismo par que `PagoVentaDto.monto`) rechaza en el
 * borde lo que `@IsNumberString()` deja pasar solo: negativo y cero. El resto
 * de la integridad —más de 4 decimales, que es la escala de las tres columnas
 * `numeric(18,4)` que esto mueve— no es de FORMATO sino de VALOR frente a la
 * moneda/escala de la línea, así que se valida en el service, igual que
 * `MonedasService` valida escala contra la moneda y no en un decorador ciego.
 */
export class AnularLineaDto {
  @IsNumberString()
  @IsDecimalPositivo()
  cantidad: string;

  @IsUUID()
  motivoBajaId: string;
}
