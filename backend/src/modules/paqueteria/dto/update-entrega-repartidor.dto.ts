import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsDecimalPositivo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';
import type { MedioCobro } from '../paqueteria.types';

/** Solo se toca lo que llega; el repartidor no se cambia (se anula y se anota de nuevo). */
export class UpdateEntregaRepartidorDto {
  @ValidateIf((_o, v) => v !== undefined)
  @EsFechaPura()
  fecha?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalPositivo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  monto?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['efectivo', 'transferencia'])
  medio?: MedioCobro;

  /** `null` borra la nota; ausente la deja como está. */
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nota?: string | null;
}
