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
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

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

  // Mismo motivo que en `ajustes-reparto.dto.ts`: sin esto el negativo llegaba
  // al CHECK de BD y salía como 500 en vez de 400.
  @IsOptional()
  @IsDecimalNoNegativo()
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
