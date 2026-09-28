import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateTerceroDto {
  @IsOptional()
  @IsIn(['proveedor', 'empresa', 'persona_natural'])
  tipo?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

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

  @IsOptional()
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
