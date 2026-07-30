import {
  IsIn,
  IsOptional,
  IsString,
  IsArray,
  IsUUID,
  ValidateNested,
  IsDateString,
  IsNotEmpty,
  IsNumberString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

const MOTIVOS = ['compra', 'devolucion', 'ajuste_manual', 'inventario_inicial'];

export class SerieAjusteInputDto {
  @IsString()
  @IsNotEmpty()
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

  // Costo pagado en la entrada por compra (actualiza costo_actual + congela en el kardex)
  @IsOptional()
  @IsNumberString()
  @IsDecimalPositivo()
  costoUnitario?: string;

  // Modo 'serie' — entrada: series a registrar
  @IsArray()
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
