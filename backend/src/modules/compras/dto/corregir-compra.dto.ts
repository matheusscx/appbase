import { IsNumberString, ValidateIf } from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';
import {
  EsCosto,
  EsMontoCobrado,
} from '../../../common/decorators/escala-moneda.decorator';

/**
 * Body de `PATCH /compras/:id/lineas/:lineaId` (spec compras-recepcion § 4.4):
 * la línea de una compra ya confirmada.
 */
export class CorregirLineaDto {
  /**
   * Por unidad TIPEADA, igual que en el borrador. Obligatorio: completar o
   * corregir un precio es darle uno, y "volver a sin precio" no es una
   * corrección que la spec pida.
   */
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  precioUnitario: string;
}

/**
 * Body de `PATCH /compras/:id/descuento`: el descuento al total de la factura,
 * en la moneda oficial. `null` lo quita. Solo se acepta con todas las líneas
 * con precio, porque se reparte según el valor de cada una.
 *
 * La clave es obligatoria y `null` es un valor: sin la clave el body es 400.
 * Con `@IsOptional()`, un cliente que se olvidara del campo borraba el
 * descuento vigente sin aviso, igual que si hubiera mandado `null`.
 */
export class CorregirDescuentoDto {
  @ValidateIf((_o, v) => v !== null)
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsMontoCobrado()
  descuentoTotal: string | null;
}
