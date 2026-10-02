import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import type { EmisorMedio } from '../entities/tenant-metodo-pago.entity';

// `@ValidateIf` y no `@IsOptional()` en los tres: las tres columnas son NOT NULL
// e `IsOptional` trata `null` igual que ausente y saltea el validador de abajo;
// el `null` llegaría a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
export class UpdateTenantMetodoPagoDto {
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  habilitada?: boolean;

  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  permiteVuelto?: boolean;

  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['sistema', 'maquina', 'nadie'])
  emisor?: EmisorMedio;
}
