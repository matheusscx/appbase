import { IsOptional, IsUUID } from 'class-validator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';

export class QueryHojasRutaDto {
  /** Columna `date`: `YYYY-MM-DD`, sin hora; el rango es inclusivo en los dos extremos. */
  @EsFechaPura()
  desde: string;

  @EsFechaPura()
  hasta: string;

  @IsOptional()
  @IsUUID()
  repartidorId?: string;
}
