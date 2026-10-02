import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// `@ValidateIf` y no `@IsOptional()`: `IsOptional` trata `null` igual que
// ausente, y el service (`!= null`) lo ignoraba con un 200 sin cambiar nada.
// Omitir un campo y mandarlo en `null` son dos pedidos distintos: omitir
// conserva el valor, `null` en una columna NOT NULL es un 400.
export class UpdateCajonDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}
