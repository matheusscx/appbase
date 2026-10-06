import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AjustesRepartoDto } from './ajustes-reparto.dto';

export class LiquidarDto {
  // Ver `create-liquidacion.dto.ts`: `strict` cierra el rollover de calendario,
  // `rangoLiquidacion` cierra la fecha que `new Date` no sabe leer.
  @IsISO8601({ strict: true })
  fechaDesde: string;

  @IsISO8601({ strict: true })
  fechaHasta: string;

  @IsOptional()
  @IsArray()
  // Mismo tope que `CreateLiquidacionDto.turnoIds`.
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  turnoIds?: string[];

  // `IsObject` además de `ValidateNested`: este deja pasar un array, y la
  // liquidación se confirmaba sin las exclusiones ni los montos pedidos.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AjustesRepartoDto)
  ajustes?: AjustesRepartoDto;
}
