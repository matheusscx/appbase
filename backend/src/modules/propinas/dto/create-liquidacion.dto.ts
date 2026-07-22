import {
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateLiquidacionDto {
  @IsISO8601()
  fechaDesde: string;

  @IsISO8601()
  fechaHasta: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  turnoIds?: string[];
}
