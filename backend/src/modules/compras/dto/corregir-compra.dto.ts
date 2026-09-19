import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsDecimalPositivo,
} from '../../../common/decorators/decimal-signo.decorator';
import {
  EsCosto,
  EsMontoCobrado,
} from '../../../common/decorators/escala-moneda.decorator';
import { SerieCompraDto } from './compra-borrador.dto';

/**
 * Body de `PATCH /compras/:id/lineas/:lineaId` (spec compras-recepcion § 4.4):
 * el precio, la cantidad o los dos, de una línea de una compra ya confirmada.
 *
 * Ausente es "no se toca", y acá no borra nada: ni el precio ni la cantidad
 * aceptan null (`@ValidateIf` sobre `undefined`, no `@IsOptional`, que deja
 * pasar el null), así que omitir la clave no puede confundirse con quitar el
 * valor. Sin ninguno de los dos, el service responde 400.
 */
export class CorregirLineaDto {
  /** Por unidad TIPEADA, igual que en el borrador. */
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  precioUnitario?: string;

  /** En la unidad de la línea, como se tipeó. */
  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalPositivo()
  cantidad?: string;

  /** En serie, si la cantidad sube: las series que entran. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SerieCompraDto)
  series?: SerieCompraDto[];

  /** En serie, si la cantidad baja: las unidades que salen. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  unidadIds?: string[];
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
