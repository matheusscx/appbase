import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { EsFechaPura } from '../../../common/decorators/fecha-pura.decorator';
import { MAX_ENTRADA_CODIGO } from '../codigo-paquete';

export class EscanearDto {
  @IsUUID()
  repartidorId: string;

  /** Columna `date`: `YYYY-MM-DD`, sin hora. */
  @EsFechaPura()
  fecha: string;

  /** Lo que entrega la pistola o se tipea: el service lo normaliza (`normalizarCodigoPaquete`). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ENTRADA_CODIGO)
  codigo: string;

  /** Solo vale para un paquete que este escaneo crea; uno existente conserva el suyo. */
  @IsBoolean()
  cobroEnDestino: boolean;

  /** Solo vale para un paquete que este escaneo crea; ausente = se paga con la del repartidor o la por defecto. */
  @IsOptional()
  @IsUUID()
  tarifaPagoId?: string;
}
