import { PartialType } from '@nestjs/mapped-types';
import { ValidateIf } from 'class-validator';
import type { NivelRegla } from '../../../common/enums/reglas.enums';
import { CreateDescuentoDto, type TramoDto } from './create-descuento.dto';

// `skipNullProperties: false` (ver `UpdateRolDto`) cubre `nombre` y
// `tipoReglaId`. No alcanza para los opcionales del alta que no aceptan `null`,
// porque traen su propio `@IsOptional()`: se redeclaran con `@ValidateIf`, que
// reemplaza la condición heredada y conserva sus validadores. Con `null`,
// `activo` y `nivel` llegaban a columnas NOT NULL (500), `metodoPagoIds` y
// `tramos` a un `.length` (500), y `modo` y `diasVencimiento` se ignoraban
// con un 200. Los importes y las fechas son nullables: `null` los borra.
//
// `declare` no es cosmético: sin él, con target ES2023, cada campo redeclarado
// existe en la instancia como propiedad propia en `undefined`, y el
// `Object.assign(entidad, dto)` del service lo copia —la respuesta sale sin
// `activo`—. `declare` aplica el decorador sin emitir el campo.
export class UpdateDescuentoDto extends PartialType(CreateDescuentoDto, {
  skipNullProperties: false,
}) {
  @ValidateIf((_o, v) => v !== undefined)
  declare modo?: string;

  @ValidateIf((_o, v) => v !== undefined)
  declare metodoPagoIds?: string[];

  @ValidateIf((_o, v) => v !== undefined)
  declare tramos?: TramoDto[];

  @ValidateIf((_o, v) => v !== undefined)
  declare diasVencimiento?: number;

  @ValidateIf((_o, v) => v !== undefined)
  declare activo?: boolean;

  @ValidateIf((_o, v) => v !== undefined)
  declare nivel?: NivelRegla;
}
