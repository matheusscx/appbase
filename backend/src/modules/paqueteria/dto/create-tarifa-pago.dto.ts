import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

export class CreateTarifaPagoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  monto: string;

  /** La primera tarifa del tenant queda por defecto aunque no se pida. */
  @IsOptional()
  @IsBoolean()
  esDefecto?: boolean;
}
