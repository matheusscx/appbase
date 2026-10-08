import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type {
  RolImpresora,
  TipoConexionImpresora,
} from '../entities/impresora.entity';

// `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo, y
// el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
// Los que conservan `@IsOptional()` van a columnas nullable: ahí `null` borra
// el dato.
export class UpdateImpresoraDto {
  // Mismos topes de largo que el alta: las columnas `varchar` de `impresoras`.
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['comanda', 'boleta'])
  rol?: RolImpresora;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['red', 'sistema'])
  tipoConexion?: TipoConexionImpresora;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  // Mismo rango que el alta: un puerto TCP.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  puerto?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombreCola?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}
