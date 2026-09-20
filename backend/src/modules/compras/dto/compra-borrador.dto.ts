import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
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

export class SerieCompraDto {
  // Una serie de solo espacios no identifica nada, y `@IsNotEmpty` no la
  // distingue de contenido real (`"   "` no es `""`). `\S` pide al menos un
  // caracter visible y **deja pasar los espacios internos** —`ABC 123` es una
  // serie legítima—: lo que se rechaza es la que queda vacía al normalizar.
  // La unicidad compara sin bordes ni mayúsculas (owner, 2026-09-20), pero se
  // guarda tal como se tipeó, así que acá no se transforma el valor.
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'La serie no puede ser solo espacios' })
  // `@MaxLength` porque la serie participa de un índice único por expresión y
  // btree tiene un tope de ~2,7 KB por entrada: sin límite, una serie enorme
  // revienta el INSERT con un error de Postgres sin mapear —un 500 en el mismo
  // chokepoint que da 400 para todo lo demás—. 100 es el valor que ya usan los
  // códigos de este repo, y un IMEI son 15 caracteres.
  @MaxLength(100)
  serie: string;

  @IsOptional()
  @IsIn(['nuevo', 'usado', 'reacondicionado'])
  condicion?: 'nuevo' | 'usado' | 'reacondicionado';

  @IsOptional()
  @IsDateString()
  garantiaHasta?: string;
}

export class LoteCompraDto {
  @IsString()
  @IsNotEmpty()
  codigoLote: string;

  @IsOptional()
  @IsDateString()
  fechaElaboracion?: string;

  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;
}

export class LineaCompraDto {
  @IsUUID()
  itemId: string;

  // String + Decimal.js, como toda cantidad de kardex (`AjusteStockDto`).
  @IsNumberString()
  @IsDecimalPositivo()
  cantidad: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;

  /**
   * Por unidad TIPEADA. Ausente o null = falta costo, que se completa cuando
   * llega la factura (owner, 2026-09-18). `>= 0`: el 0 es el regalo.
   */
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  precioUnitario?: string | null;

  // Con techo por la misma razón que `lineas`: cada serie es una fila que la
  // confirmación va a insertar bajo el lock del producto.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SerieCompraDto)
  series?: SerieCompraDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LoteCompraDto)
  lote?: LoteCompraDto;
}

/**
 * Body de `POST /compras` y `PATCH /compras/:id` (el PATCH reemplaza las
 * líneas enteras).
 *
 * ⚠️ `tenantId` no está acá y no puede estarlo: sale del token.
 */
export class CompraBorradorDto {
  @IsUUID()
  proveedorId: string;

  @IsUUID()
  tipoDocumentoCompraId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  folio?: string | null;

  @IsDateString()
  fechaDocumento: string;

  @IsUUID()
  ubicacionId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacion?: string | null;

  /**
   * Descuento al total de la factura, en la moneda oficial. Se carga cuando
   * todas las líneas tienen precio, porque se reparte según su valor (spec
   * § 6). Opcional como el resto del encabezado: el PATCH del borrador
   * reemplaza la compra entera, así que ausente es "sin descuento".
   */
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsMontoCobrado()
  descuentoTotal?: string | null;

  // Un borrador puede estar vacío; confirmar exige al menos una línea.
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineaCompraDto)
  lineas: LineaCompraDto[];
}
