import { PartialType } from '@nestjs/mapped-types';
import { ValidateIf } from 'class-validator';
import { CreatePromocionDto } from './create-promocion.dto';

// `skipNullProperties: false` (ver `UpdateRolDto`) cubre los campos que el alta
// exige. No alcanza para `activo`, que trae su propio `@IsOptional()` del alta
// y va a una columna NOT NULL: se redeclara con `@ValidateIf`, que reemplaza la
// condición heredada y conserva el `@IsBoolean`. Los demás opcionales del alta
// son nullables: `null` los borra.
//
// `declare` no es cosmético: sin él, con target ES2023, cada campo redeclarado
// existe en la instancia como propiedad propia en `undefined`, y el
// `Object.assign(entidad, dto)` del service lo copia —la respuesta sale sin
// `activo`—. `declare` aplica el decorador sin emitir el campo.
export class UpdatePromocionDto extends PartialType(CreatePromocionDto, {
  skipNullProperties: false,
}) {
  @ValidateIf((_o, v) => v !== undefined)
  declare activo?: boolean;
}
