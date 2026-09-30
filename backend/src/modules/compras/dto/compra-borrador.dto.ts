import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
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
import {
  EsFechaOTimestamp,
  EsFechaPura,
} from '../../../common/decorators/fecha-pura.decorator';
import { LARGO_MAXIMO_RUT, PATRON_RUT } from './lectura-dte.dto';

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

  // `item_unidad.garantia_hasta` es `timestamptz` sin `::date` (mismo campo
  // que `items/dto/create-item.dto.ts SerieInputDto.garantiaHasta`): acepta
  // fecha pura y timestamp completo, `strict` alcanza para el 500 de
  // `2026-02-31`.
  @IsOptional()
  @EsFechaOTimestamp()
  garantiaHasta?: string;
}

export class LoteCompraDto {
  @IsString()
  @IsNotEmpty()
  codigoLote: string;

  // `item_lote.fecha_elaboracion`/`fecha_vencimiento` son `timestamptz` sin
  // `::date` (mismo campo que `create-item.dto.ts LoteInputDto`): acepta
  // fecha pura y timestamp completo.
  @IsOptional()
  @EsFechaOTimestamp()
  fechaElaboracion?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  fechaVencimiento?: string;
}

export class LineaCompraDto {
  @IsUUID()
  itemId: string;

  // String + Decimal.js, como toda cantidad de kardex (`AjusteStockDto`).
  @IsNumberString()
  @IsDecimalPositivo()
  cantidad: string;

  /** En una unidad del catálogo. Exactamente una de `unidadCodigo` o `presentacionId` (lo exige el service). */
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  /** Una presentación del proveedor de la compra para este producto (spec pieza 2 § 4.1). */
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  presentacionId?: string;

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

  /**
   * La clave de la línea del XML (spec compras-xml-dte § 3.2). Solo las que
   * vinieron del XML. Viaja siempre con `descripcionProveedor`: el
   * `ValidateIf` de las dos se dispara si **cualquiera** llegó, así que una
   * descripción sin clave (o al revés) es 400 sin código en el service.
   */
  @ValidateIf(
    (o: LineaCompraDto) =>
      o.claveProveedor !== undefined || o.descripcionProveedor !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  // `@IsNotEmpty` no distingue `"   "` de contenido real (mismo caso que
  // `SerieCompraDto.serie`, más arriba): `normalizarClave` la deja en `''` y
  // quedaría una clave vacía aprendida.
  @Matches(/\S/, { message: 'La clave no puede ser solo espacios' })
  @MaxLength(160)
  claveProveedor?: string;

  @ValidateIf((o: LineaCompraDto) => o.claveProveedor !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  descripcionProveedor?: string;
}

/** Una línea del XML marcada "no es mercadería" (spec compras-xml-dte § 5.2). */
export class ApartadaDteDto {
  @IsString()
  @IsNotEmpty()
  // Mismo caso que `LineaCompraDto.claveProveedor`, más arriba.
  @Matches(/\S/, { message: 'La clave no puede ser solo espacios' })
  @MaxLength(160)
  clave: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  descripcion: string;
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

  // `compras.fecha_documento` es `date`, no `timestamptz`: fecha pura
  // estricta, no `@IsDateString` (que aceptaría un timestamp que la columna
  // no guarda).
  @EsFechaPura()
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

  /**
   * Lo que dice el documento que hay que pagar (spec compras-deuda-proveedor
   * § 3 y § 4.1, decisión 10): se tipea, o sale del XML (`MntTotal`). Solo
   * los tipos `obligatorio`/`opcional` lo llevan — el service rechaza con
   * 400 el que llegue en un tipo `suma_lineas`, cuyo total es la suma de las
   * líneas. Opcional como el resto del encabezado: el PATCH del borrador
   * reemplaza la compra entera, así que ausente es "sin total todavía".
   */
  @IsOptional()
  @IsNumberString()
  @IsDecimalPositivo()
  @EsMontoCobrado()
  totalDocumento?: string | null;

  /**
   * Tipeada, o del XML (`FchVenc`): manda sobre el plazo del proveedor al
   * confirmar (spec § 4.2). Ausente = se calcula al confirmar con
   * `fechaDocumento` + el plazo del proveedor (o 30 días).
   */
  // `compras.fecha_vencimiento` también es `date`, mismo motivo que
  // `fechaDocumento` arriba.
  @IsOptional()
  @EsFechaPura()
  fechaVencimiento?: string | null;

  // Un borrador puede estar vacío; confirmar exige al menos una línea.
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LineaCompraDto)
  lineas: LineaCompraDto[];

  /**
   * Líneas del XML marcadas "no es mercadería": se aprenden con
   * `no_mercaderia = true`, no se cargan como línea (spec compras-xml-dte
   * § 5.2).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ApartadaDteDto)
  apartadas?: ApartadaDteDto[];

  /**
   * El RUT del emisor, cuando el proveedor se eligió a mano porque el RUT del
   * XML no calzó con ninguno (spec § 3.1 y § 5.2, decisión 3). Se guarda en
   * `rut_fiscal` si el proveedor no tenía ninguno de los dos.
   */
  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAXIMO_RUT)
  @Matches(PATRON_RUT)
  rutProveedor?: string;
}
