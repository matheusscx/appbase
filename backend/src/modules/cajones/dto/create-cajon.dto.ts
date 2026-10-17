import {
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

export class CreateCajonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre: string;

  // Fondo con el que suele abrirse (03.28). Plata de la moneda oficial: misma
  // regla que el saldo inicial. Ausente o `null` = sin fondo sugerido.
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  fondoSugerido?: string | null;
}
