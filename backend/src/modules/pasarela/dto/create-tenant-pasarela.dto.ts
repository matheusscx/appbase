import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateTenantPasarelaDto {
  @IsUUID()
  pasarelaId: string;

  @IsIn(['pruebas', 'produccion'])
  ambiente: string;

  @IsIn(['mall', 'individual'])
  modoIntegracion: string;

  // MALL: { commerceCodeHijo } — INDIVIDUAL: credenciales completas del proveedor
  @IsOptional()
  @IsObject()
  configuracion?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  prioridad?: number;
}
