import {
  IsBoolean,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsDecimalNoNegativo,
  IsMontoPersistible,
} from '../../../common/decorators/decimal-signo.decorator';
import { EsMontoCobrado } from '../../../common/decorators/escala-moneda.decorator';
import { MAX_ENTRADA_CODIGO } from '../codigo-paquete';

// PATCH: ausente = no tocar. Los campos NOT NULL usan `ValidateIf(v !== undefined)` para que
// `null` sea 400 y no un "se ignora" (`IsOptional` dejaría pasar el null); los nullables
// usan `IsOptional`, donde `null` los vacía.
export class UpdatePaqueteDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ENTRADA_CODIGO)
  codigo?: string;

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

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  cobroEnDestino?: boolean;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  precioEnvio?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalNoNegativo()
  @IsMontoPersistible()
  @EsMontoCobrado()
  pagoRepartidor?: string;
}
