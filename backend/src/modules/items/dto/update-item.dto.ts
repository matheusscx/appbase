import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsUUID,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsInt,
  IsIn,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  RecetaExtraInputDto,
  RecetaIngredienteInputDto,
  ComboComponenteInputDto,
} from './create-item.dto';

export class UpdateItemDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsNumberString()
  @IsOptional()
  precioBase?: string;

  @IsUUID()
  @IsOptional()
  monedaId?: string;

  @IsUUID()
  @IsOptional()
  categoriaId?: string;

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

  // Extensión receta (reemplazo total de la lista)
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

  // Extensión combo (reemplazo total de la lista)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboComponenteInputDto)
  @IsOptional()
  componentes?: ComboComponenteInputDto[];

  // Reglas N:M (undefined = no tocar; [] = limpiar todas)
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
