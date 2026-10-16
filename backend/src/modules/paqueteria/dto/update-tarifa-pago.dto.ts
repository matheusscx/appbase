import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

export class UpdateTarifaPagoDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  monto?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  esDefecto?: boolean;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activa?: boolean;
}
