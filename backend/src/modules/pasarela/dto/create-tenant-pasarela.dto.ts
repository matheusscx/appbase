import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_INT } from '../../../common/constants/escalas';

/**
 * Credenciales del tenant: solo las claves que leen los providers. Hasta el
 * 2026-10-08 era un `@IsObject()` libre, y `CredencialesService.resolver`
 * esparcía lo guardado sobre las credenciales de la plataforma: con `baseUrl`
 * en la config, el cobro le mandaba a ese host el `Tbk-Api-Key-Secret` del mall
 * de la plataforma (medido con un receptor local). Ahora una clave de más es 400
 * (`forbidNonWhitelisted`) y el resolver tampoco la deja pasar.
 *
 * Tope de 255: Transbank usa códigos de comercio de 12 dígitos y secretos de 64
 * caracteres, y 255 deja margen sin acercarse a los ~16 kB de header que, con
 * un secreto enorme, hacían caer el cobro en un 500.
 */
export class ConfiguracionPasarelaDto {
  // `@ValidateIf` y no `@IsOptional()`: omitir una clave vale, mandarla en `null`
  // no (`@IsOptional()` lo dejaba pasar y el cobro mandaba `commerce_code: null`).
  // El vacío lo frena también la pantalla, con el mismo `/\S/` (`pasarelas.vue`).
  // MALL: lo único que aporta el tenant. INDIVIDUAL: su tienda.
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/\S/, {
    message: 'El código de comercio hijo no puede quedar vacío',
  })
  @MaxLength(255, {
    message: 'El código de comercio hijo admite hasta 255 caracteres',
  })
  commerceCodeHijo?: string;

  // Solo INDIVIDUAL: en MALL los pone la plataforma.
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/\S/, {
    message: 'El código de comercio mall no puede quedar vacío',
  })
  @MaxLength(255, {
    message: 'El código de comercio mall admite hasta 255 caracteres',
  })
  mallCommerceCode?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'La API key secret no puede quedar vacía' })
  @MaxLength(255, { message: 'La API key secret admite hasta 255 caracteres' })
  apiKeySecret?: string;
}

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
  @ValidateNested()
  @Type(() => ConfiguracionPasarelaDto)
  configuracion?: ConfiguracionPasarelaDto;

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
