import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { MAX_INT } from '../../../common/constants/escalas';

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

  // Columna `int` de `tenant_pasarela`.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  prioridad?: number;
}
