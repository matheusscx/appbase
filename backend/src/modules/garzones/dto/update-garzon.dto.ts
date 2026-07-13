import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Actualiza datos del garzón. El PIN NO se cambia aquí — se resetea con su
 * propio endpoint (ResetPinDto) para mantener el flujo de reset explícito.
 */
export class UpdateGarzonDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
