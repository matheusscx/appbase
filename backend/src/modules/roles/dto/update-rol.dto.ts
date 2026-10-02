import { PartialType } from '@nestjs/mapped-types';
import { CreateRolDto } from './create-rol.dto';

// `skipNullProperties: false`: sin la opción, `PartialType` le pone
// `@IsOptional()` a cada campo, que trata `null` igual que ausente y saltea el
// validador; un `nombre` null llegaba a una columna NOT NULL como un 500. Con
// ella aplica `@ValidateIf(v !== undefined)`: omitir sigue conservando el
// valor, y `descripcion` —nullable— acepta `null` por su propio `@IsOptional`.
export class UpdateRolDto extends PartialType(CreateRolDto, {
  skipNullProperties: false,
}) {}
