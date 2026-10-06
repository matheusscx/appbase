import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateLiquidacionDto {
  // `strict` valida el calendario: sin él `2026-02-31` pasa y `new Date` lo
  // rueda a marzo, dejando la liquidación con un período que nadie pidió.
  // No cierra `2026-W32-1` ni `20260807` — de eso se ocupa `rangoLiquidacion`.
  @IsISO8601({ strict: true })
  fechaDesde: string;

  @IsISO8601({ strict: true })
  fechaHasta: string;

  @IsOptional()
  @IsArray()
  // Mismo tope que el filtro de turnos del reporte de propinas: los turnos
  // de un período; van en un solo `= ANY`.
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  turnoIds?: string[];
}
