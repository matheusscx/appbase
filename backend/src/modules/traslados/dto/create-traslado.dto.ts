import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

export class LineaTrasladoDto {
  @IsUUID()
  itemId: string;

  // Cantidad como string y validada como número decimal: `Decimal.js`, nunca
  // `number` nativo. Mismo par de decoradores que `AjusteStockDto.cantidad`,
  // que es el otro borde por donde entra una cantidad de kardex: el formato lo
  // valida `@IsNumberString`, el signo `@IsDecimalPositivo` — un traslado de 0
  // o negativo no es una operación.
  @IsNumberString()
  @IsDecimalPositivo()
  cantidad: string;

  /**
   * Modo `serie`: qué unidades concretas se mueven. Si no viene, el
   * chokepoint auto-selecciona FIFO **entre las que están en el origen**.
   */
  @IsOptional()
  @IsArray()
  // Con techo por la misma razón que `lineas`: la salida serie hace un
  // `SELECT … FOR UPDATE` y un `UPDATE` por unidad adentro de la transacción
  // que retiene el lock ancla, así que el largo que manda el cliente es tiempo
  // de espera para las ventas de ese producto.
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  unidadIds?: string[];

  /**
   * Modo `lote`: de qué lote sale la mercadería. Si no viene, el chokepoint
   * descuenta FIFO de los lotes con saldo en el origen.
   */
  @IsOptional()
  @IsUUID()
  loteId?: string;
}

/**
 * ⚠️ `tenantId` no está acá y no puede estarlo: sale del token.
 */
export class CreateTrasladoDto {
  @IsUUID()
  origenId: string;

  @IsUUID()
  destinoId: string;

  @IsUUID()
  motivoTrasladoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;

  // Con techo: el largo lo elige el cliente y cada línea es un par de
  // movimientos adentro de la transacción que retiene el lock ancla de sus
  // ítems. 200 es holgado para un traslado real (una bodega entera se vacía en
  // tandas) y acota lo que un body puede hacer esperar a las ventas de esos
  // productos.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineaTrasladoDto)
  lineas: LineaTrasladoDto[];
}
