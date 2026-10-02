import {
  IsBoolean,
  IsOptional,
  IsNumberString,
  ValidateIf,
} from 'class-validator';

// `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo, y
// el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
// `valorDelDia` conserva `@IsOptional()`: su columna es nullable.
export class UpdateTenantMonedaDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  habilitada?: boolean;

  @IsOptional()
  @IsNumberString()
  valorDelDia?: string;
}
