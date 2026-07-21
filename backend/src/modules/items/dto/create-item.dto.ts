import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsUUID,
  IsIn,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SerieInputDto {
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

export class LoteInputDto {
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

export class RecetaIngredienteInputDto {
  @IsUUID()
  ingredienteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;

  @IsBoolean()
  @IsOptional()
  bloqueante?: boolean;
}

export class RecetaExtraInputDto {
  @IsUUID()
  ingredienteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;

  @IsNumberString()
  precioExtra: string;
}

export class ComboComponenteInputDto {
  @IsUUID()
  componenteItemId: string;

  @IsNumberString()
  cantidad: string;

  @IsBoolean()
  @IsOptional()
  bloqueante?: boolean;
}

export class ItemGrupoOpcionOverrideInputDto {
  @IsUUID()
  grupoOpcionId: string;

  @ValidateIf((o: ItemGrupoOpcionOverrideInputDto) => o.cantidad !== '')
  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @ValidateIf((o: ItemGrupoOpcionOverrideInputDto) => o.unidadCodigo !== '')
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  @ValidateIf((o: ItemGrupoOpcionOverrideInputDto) => o.precioExtra !== '')
  @IsOptional()
  @IsNumberString()
  precioExtra?: string;
}

export class ItemGrupoModificadorInputDto {
  @IsUUID()
  grupoModificadorId: string;

  @IsInt()
  @Min(0)
  min: number;

  @IsInt()
  @Min(1)
  max: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  orden?: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoOpcionOverrideInputDto)
  opciones?: ItemGrupoOpcionOverrideInputDto[];
}

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsNumberString()
  precioBase: string;

  @IsUUID()
  monedaId: string;

  @IsUUID()
  @IsOptional()
  categoriaId?: string;

  @IsIn([
    'producto',
    'servicio',
    'suscripcion',
    'receta',
    'ingrediente',
    'combo',
  ])
  tipo: string;

  @IsBoolean()
  @IsOptional()
  precioIncluyeImpuesto?: boolean;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsOptional()
  @IsIn(['afecto', 'exento'])
  clasificacionTributaria?: string;

  // Extensión producto
  @IsIn(['cantidad', 'lote', 'serie'])
  @IsOptional()
  modoInventario?: string;

  @IsNumberString()
  @IsOptional()
  stock?: string;

  @IsString()
  @IsOptional()
  unidadMedida?: string;

  @IsDateString()
  @IsOptional()
  fechaElaboracion?: string;

  @IsDateString()
  @IsOptional()
  fechaVencimiento?: string;

  @IsNumberString()
  @IsOptional()
  costo?: string;

  // Carga inicial modo 'serie'
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SerieInputDto)
  @IsOptional()
  series?: SerieInputDto[];

  // Carga inicial modo 'lote'
  @ValidateNested()
  @Type(() => LoteInputDto)
  @IsOptional()
  lote?: LoteInputDto;

  // Extensión receta
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaIngredienteInputDto)
  @IsOptional()
  ingredientes?: RecetaIngredienteInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaExtraInputDto)
  @IsOptional()
  extrasPermitidos?: RecetaExtraInputDto[];

  // Extensión combo
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @IsOptional()
  componentes?: ComboComponenteInputDto[];

  // Asociación de grupos de modificadores (combo | receta)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemGrupoModificadorInputDto)
  @IsOptional()
  gruposModificadores?: ItemGrupoModificadorInputDto[];

  // Extensión servicio
  @IsInt()
  @Min(0)
  @IsOptional()
  duracionEstimada?: number;

  @IsBoolean()
  @IsOptional()
  requiereCita?: boolean;

  // Extensión suscripción
  @IsIn(['semanal', 'quincenal', 'mensual'])
  @IsOptional()
  frecuencia?: string;

  // Reglas N:M
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  impuestosIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  recargosIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  descuentosIds?: string[];
}
