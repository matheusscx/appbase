import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['comanda', 'boleta'])
  rol?: RolImpresora;

  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['red', 'sistema'])
  tipoConexion?: TipoConexionImpresora;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  puerto?: number;

  @IsOptional()
  @IsString()
  nombreCola?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;
}
