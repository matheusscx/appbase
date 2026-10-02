import { PartialType } from '@nestjs/mapped-types';
import { CreateTenantDto } from './create-tenant.dto';

// `skipNullProperties: false`: sin la opción, `PartialType` le pone
// `@IsOptional()` a cada campo, que trata `null` igual que ausente y saltea el
// validador; un `nombre` o `correo` null llegaba a una columna NOT NULL como un
// 500. Con ella aplica `@ValidateIf(v !== undefined)`: omitir sigue
// conservando el valor, y `telefono`/`direccion` —nullables— aceptan `null`
// por su propio `@IsOptional`.
export class UpdateTenantDto extends PartialType(CreateTenantDto, {
  skipNullProperties: false,
}) {}
