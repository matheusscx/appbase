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

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsOptional()
  @IsString()
  rut?: string;

  @IsOptional()
  @IsString()
  nombreLegal?: string;

  @IsOptional()
  @IsString()
  rutFiscal?: string;

  @IsOptional()
  @IsEmail()
  correo?: string;

  @IsOptional()
  @IsString()
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
