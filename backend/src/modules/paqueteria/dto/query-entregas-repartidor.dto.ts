import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class QueryEntregasRepartidorDto {
  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  repartidorId?: string;

  /** Solo las que todavía no entraron a una rendición. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  pendientes?: boolean;
}
