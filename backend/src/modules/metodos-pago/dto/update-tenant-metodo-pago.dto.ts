import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';
import type { EmisorMedio } from '../entities/tenant-metodo-pago.entity';

export class UpdateTenantMetodoPagoDto {
  @IsOptional()
  @IsBoolean()
  habilitada?: boolean;

  @IsOptional()
  @IsBoolean()
  permiteVuelto?: boolean;

  // `@ValidateIf` y no `@IsOptional()`: `emisor` es NOT NULL y `IsOptional`
  // trata `null` igual que ausente y saltea `@IsIn`; el `null` llegaría a la
  // columna como un 500 de Postgres en vez de un 400. Omitirlo conserva el
  // valor que tenía.
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['sistema', 'maquina', 'nadie'])
  emisor?: EmisorMedio;
}
