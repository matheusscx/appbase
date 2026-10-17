import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_ENTRADA_CODIGO } from '../codigo-paquete';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

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

  // Ausente = se cobra con la tarifa de envío por defecto (docs/features/paqueteria.md, regla 10b):
  // la del paquete es el caso especial. El precio NO viaja: lo resuelve el servidor al entregar.
  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  tarifaEnvioId?: string | null;

  // Ausente = se paga con la tarifa del repartidor o la por defecto (docs/features/paqueteria.md,
  // regla 10): la del paquete es el caso especial.
  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  tarifaPagoId?: string | null;
}
