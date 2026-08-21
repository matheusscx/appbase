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
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

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
  // `@EsMontoCobrado()`, igual que su gemelo de `ajustes-reparto.dto.ts`: es el
  // monto que el garzón cobra. `pesoManual` de arriba NO se marca: es un peso
  // de reparto, no plata.
  @IsOptional()
  @IsDecimalNoNegativo()
  @EsMontoCobrado()
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
