import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

// `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo, y
// el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
export class UpdateCategoriaDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['productos', 'servicios', 'ambos'])
  aplicaA?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;

  // `null` explícito desasigna la ruta; `Object.assign` en el service la limpia.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  impresoraId?: string | null;
}
