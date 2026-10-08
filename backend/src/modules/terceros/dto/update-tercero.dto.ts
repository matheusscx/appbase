import {
  IsBoolean,
  IsEmail,
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

// `@ValidateIf` y no `@IsOptional()` en los campos de columnas NOT NULL:
// `IsOptional` trata `null` igual que ausente y saltea el validador de abajo, y
// el `null` llegaba a la columna como un 500 de Postgres en vez de un 400.
// Omitir un campo conserva el valor que tenía.
// Los que conservan `@IsOptional()` van a columnas nullable: ahí `null` borra
// el dato.
export class UpdateTerceroDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['proveedor', 'empresa', 'persona_natural'])
  tipo?: string;

  // Los topes de largo son los de las columnas `varchar` de `terceros`: sin
  // ellos, uno más largo pasaba el DTO y daba 500 en el INSERT (2026-10-08).
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rut?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombreLegal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rutFiscal?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  correo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  telefono?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  /**
   * Giro y comuna con los largos del SII (40 y 20, Formato DTE v2.5): la venta
   * los precarga como receptor de una Factura, y ahí no se aceptan más largos.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  giro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  comuna?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;

  /**
   * Entero > 0, o `null` para volver al default de 30 días (spec
   * compras-deuda-proveedor § 2, decisión 4). Ausente = no se toca.
   *
   * `@Max(3650)`: mismo techo y mismo motivo que `create-tercero.dto.ts` —
   * sin él, un valor fuera del rango de `int` de Postgres desborda en el
   * `UPDATE` y sale como 500 en vez de 400.
   */
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(3650)
  plazoPagoDias?: number | null;
}
