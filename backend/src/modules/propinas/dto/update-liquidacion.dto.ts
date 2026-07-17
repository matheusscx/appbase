import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateLiquidacionParticipanteDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
  garzonId?: string;

  @IsOptional()
  @IsUUID()
  grupoId?: string;

  @IsOptional()
  @IsBoolean()
  incluido?: boolean;

  @IsOptional()
  @IsString()
  motivoAjuste?: string;

  @IsOptional()
  @IsNumberString()
  pesoManual?: string;

  @IsOptional()
  @IsNumberString()
  monto?: string;

  @IsOptional()
  @IsString()
  ajusteMotivoMonto?: string;
}

export class UpdateLiquidacionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateLiquidacionParticipanteDto)
  participantes?: UpdateLiquidacionParticipanteDto[];

  @IsOptional()
  @IsBoolean()
  recalcular?: boolean;
}
