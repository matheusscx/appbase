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
import { Type } from 'class-transformer';
import {
  IsDecimalNoNegativo,
  IsDecimalPositivo,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

const MOTIVOS = ['compra', 'devolucion', 'ajuste_manual', 'inventario_inicial'];

export class SerieAjusteInputDto {
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

  @IsIn(['nuevo', 'usado', 'reacondicionado'])
  @IsOptional()
  condicion?: string;

  @IsDateString()
  @IsOptional()
  garantiaHasta?: string;

  @IsUUID()
  @IsOptional()
  loteId?: string;
}

export class LoteAjusteInputDto {
  @IsString()
  @IsNotEmpty()
  codigoLote: string;

  @IsDateString()
  @IsOptional()
  fechaElaboracion?: string;

  @IsDateString()
  @IsOptional()
  fechaVencimiento?: string;
}

export class AjusteStockDto {
  // Requerido, no opcional-con-default: cubre los CUATRO motivos de este DTO
  // (compra, devolución, ajuste manual, inventario inicial) — todos escriben
  // por el mismo `PATCH /items/:id/stock`. Un default silencioso metería el
  // movimiento en el local cada vez que la pantalla se olvide de mandarlo.
  @IsUUID()
  ubicacionId: string;

  // String + Decimal.js como los otros campos de cantidad del módulo, no
  // `number` nativo: la columna es NUMERIC(18,4) —18 dígitos significativos— y
  // un double aguanta 15-17, así que una cantidad grande con decimales se
  // corrompe al deserializarse. Encima alimenta `convertirCostoUnitario`, que
  // es dinero.
  @IsNumberString()
  @IsDecimalPositivo()
  cantidad: string;

  @IsIn(['entrada', 'salida'])
  tipo: 'entrada' | 'salida';

  @IsIn(MOTIVOS)
  motivo: string;

  @IsOptional()
  @IsString()
  comentario?: string;

  // Unidad en la que viene `cantidad`. Si difiere de la unidad base del producto,
  // se convierte antes de registrar el movimiento. Distinto de `unidadIds`, que
  // son IDs de unidades serializadas (item_unidad).
  @IsString()
  @IsOptional()
  unidadCodigo?: string;

  // Costo pagado en la entrada por compra (actualiza costo_actual + congela en el kardex).
  // `>= 0`, no `> 0`: mercadería de donación o muestra entra con costo 0 de
  // verdad (decisión del owner, 2026-08-29), igual que el `costo` de
  // `CreateItemDto`. Ausente sigue siendo "no sé cuánto costó" y no toca el CPP.
  // El negativo lo mata el decorador; el `AjusteCostoDto` es el que conserva el
  // `@IsDecimalPositivo`, porque ahí el 0 anularía el promedio en vez de informarlo.
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  costoUnitario?: string;

  // Modo 'serie' — entrada: series a registrar
  @IsArray()
  // `@ArrayMaxSize(200)`, el mismo tope que ya usa `LineaCompraDto.series`: sin
  // él, una tanda de decenas de miles de series entra entera al `unnest` del
  // guard y al loop de INSERT.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SerieAjusteInputDto)
  @IsOptional()
  series?: SerieAjusteInputDto[];

  // Modo 'serie' — salida: IDs de unidades a consumir
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  unidadIds?: string[];

  // Modo 'lote' — entrada: datos del lote a crear/agregar
  @ValidateNested()
  @Type(() => LoteAjusteInputDto)
  @IsOptional()
  lote?: LoteAjusteInputDto;

  // Modo 'lote' — salida: lote a descontar
  @IsUUID()
  @IsOptional()
  loteId?: string;
}
