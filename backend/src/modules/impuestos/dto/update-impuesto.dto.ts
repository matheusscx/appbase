import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsString,
  ValidateIf,
} from 'class-validator';
import {
  IsDecimalHasta,
  IsDecimalPositivo,
} from '../../../common/decorators/decimal-signo.decorator';
import {
  MENSAJE_TOPE_PORCENTAJE_IMPUESTO,
  TOPE_PORCENTAJE_IMPUESTO,
} from './create-impuesto.dto';

// `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo, y
// el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
export class UpdateImpuestoDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalPositivo()
  @IsDecimalHasta(TOPE_PORCENTAJE_IMPUESTO, {
    message: MENSAJE_TOPE_PORCENTAJE_IMPUESTO,
  })
  porcentaje?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}
