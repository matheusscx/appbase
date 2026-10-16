import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  IsDecimalPositivo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';
import type { MedioCobro } from '../paqueteria.types';

export class CreateEntregaRepartidorDto {
  @IdEnMinusculas()
  @IsUUID()
  repartidorId: string;

  /** Día en que el repartidor dejó la plata. Columna `date`: `YYYY-MM-DD`, sin hora. */
  @EsFechaPura()
  fecha: string;

  @IsNumberString()
  @IsDecimalPositivo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  monto: string;

  @IsIn(['efectivo', 'transferencia'])
  medio: MedioCobro;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nota?: string;
}
