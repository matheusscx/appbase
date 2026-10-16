import { IsNumberString } from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';

// PUT reemplaza: el monto es obligatorio (backend.md § 3). El pago al repartidor ya no está acá: son las tarifas de pago.
export class PutPaqueteConfiguracionDto {
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  precioEnvioDefecto: string;
}
