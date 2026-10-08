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
} from 'class-validator';

export class CreateTerceroDto {
  @IsIn(['proveedor', 'empresa', 'persona_natural'])
  tipo: string;

  // Los topes de largo son los de las columnas `varchar` de `terceros`: sin
  // ellos, uno más largo pasaba el DTO y daba 500 en el INSERT (2026-10-08).
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

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

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  /**
   * El plazo de pago en días, para un proveedor (spec
   * compras-deuda-proveedor § 2, decisión 4). Vacío = 30 días.
   *
   * `@Max(3650)` (10 años): sin techo, un valor como `99999999999` pasa la
   * validación y desborda el `int` de Postgres al guardar — un 500 sin
   * mapear, en vez de un 400 (mismo criterio que `escalaCalculo` en
   * `update-preferencias-financieras.dto.ts`). Ningún plazo de pago real
   * necesita más de una década.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  plazoPagoDias?: number;
}
