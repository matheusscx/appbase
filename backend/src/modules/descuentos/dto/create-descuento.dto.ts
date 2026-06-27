import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class TramoDto {
  @IsNumberString()
  minimo: string;

  @IsNumberString()
  valor: string;
}

export class CreateDescuentoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsUUID()
  tipoReglaId: string;

  // valor is optional at DTO level; service validates by tipo
  @IsOptional()
  @IsNumberString()
  valor?: string | null;

  // modo is optional at DTO level; service validates by tipo
  @IsOptional()
  @IsString()
  modo?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  metodoPagoIds?: string[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TramoDto)
  tramos?: TramoDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  diasVencimiento?: number;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string | null;

  @IsOptional()
  @IsDateString()
  fechaFin?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
