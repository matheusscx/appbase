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
  @IsString()
  @IsNotEmpty()
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
