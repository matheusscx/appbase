import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { MAX_ENTRADA_CODIGO } from '../codigo-paquete';

export class CreatePaqueteDto {
  /** Lo que entrega la pistola o se tipea: el service lo normaliza (`normalizarCodigoPaquete`). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ENTRADA_CODIGO)
  codigo: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  destinatarioNombre?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  destinatarioTelefono?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  direccion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  comuna?: string | null;

  @IsOptional()
  @IsString()
  nota?: string | null;

  @IsOptional()
  @IsUUID()
  remitenteTerceroId?: string | null;

  @IsBoolean()
  cobroEnDestino: boolean;

  // Ausentes = los defaults de la configuración, copiados al paquete (spec § 3 regla 1).
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  precioEnvio?: string;

  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  pagoRepartidor?: string;
}
