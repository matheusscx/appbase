import {
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AjustesRepartoDto } from './ajustes-reparto.dto';

export class PreviewLiquidacionDto {
  @IsISO8601()
  fechaDesde: string;

  @IsISO8601()
  fechaHasta: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  turnoIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AjustesRepartoDto)
  ajustes?: AjustesRepartoDto;
}
