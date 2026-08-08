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
  // Ver `create-liquidacion.dto.ts`: `strict` cierra el rollover de calendario,
  // `rangoLiquidacionDesde` cierra la fecha que `new Date` no sabe leer.
  @IsISO8601({ strict: true })
  fechaDesde: string;

  @IsISO8601({ strict: true })
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
