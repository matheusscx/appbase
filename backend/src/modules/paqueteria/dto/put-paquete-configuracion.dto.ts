import { IsNumberString } from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

// PUT reemplaza: los dos montos son obligatorios (backend.md § 3).
export class PutPaqueteConfiguracionDto {
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  precioEnvioDefecto: string;

  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  pagoRepartidorDefecto: string;
}
