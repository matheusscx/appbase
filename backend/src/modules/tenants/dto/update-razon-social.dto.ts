import { PartialType } from '@nestjs/mapped-types';
import { ValidateIf } from 'class-validator';
import { CreateRazonSocialDto } from './create-razon-social.dto';

// `skipNullProperties: false` (ver `UpdateRolDto`) cubre `nombre` y `rut`. No
// alcanza para `habilitado`, que trae su propio `@IsOptional()` del alta —
// opcional al crear— y va a una columna NOT NULL: se redeclara con
// `@ValidateIf`, que reemplaza la condición heredada y conserva el
// `@IsBoolean`. `direccion`/`telefono` son nullables: `null` los borra.
//
// `declare` no es cosmético: sin él, con target ES2023, cada campo redeclarado
// existe en la instancia como propiedad propia en `undefined`, y el
// `Object.assign(entidad, dto)` del service lo copia —la respuesta salía sin
// `habilitado`—. `declare` aplica el decorador sin emitir el campo.
export class UpdateRazonSocialDto extends PartialType(CreateRazonSocialDto, {
  skipNullProperties: false,
}) {
  @ValidateIf((_o, v) => v !== undefined)
  declare habilitado?: boolean;
}
