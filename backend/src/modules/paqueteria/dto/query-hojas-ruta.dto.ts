import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';

export class QueryHojasRutaDto {
  /** Columna `date`: `YYYY-MM-DD`, sin hora; el rango es inclusivo en los dos extremos. Obligatorio salvo con `pendientes`. */
  @ValidateIf((o: QueryHojasRutaDto) => !o.pendientes)
  @EsFechaPura()
  desde?: string;

  @ValidateIf((o: QueryHojasRutaDto) => !o.pendientes)
  @EsFechaPura()
  hasta?: string;

  @IsOptional()
  @IsUUID()
  repartidorId?: string;

  /** Solo las hojas sin rendir (las que la pantalla de rendición ofrece). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  pendientes?: boolean;
}
