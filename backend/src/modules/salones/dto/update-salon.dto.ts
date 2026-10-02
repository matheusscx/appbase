import { IsString, MinLength, ValidateIf } from 'class-validator';

// `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo, y
// el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
export class UpdateSalonDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  nombre?: string;
}
