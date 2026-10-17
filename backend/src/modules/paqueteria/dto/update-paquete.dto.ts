import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MAX_ENTRADA_CODIGO } from '../codigo-paquete';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

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

  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  tarifaPagoId?: string | null;

  /** `null` la saca (vuelve a la por defecto); ausente no la toca. */
  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  tarifaEnvioId?: string | null;
}
