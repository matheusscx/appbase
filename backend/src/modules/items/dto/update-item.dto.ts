import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsUUID,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';

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

  // Extensión producto
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

  // Extensión servicio
  @IsInt()
  @Min(0)
  @IsOptional()
  duracionEstimada?: number;

  @IsBoolean()
  @IsOptional()
  requiereCita?: boolean;

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
