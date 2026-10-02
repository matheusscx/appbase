import { PartialType, OmitType } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { CreateTenantPasarelaDto } from './create-tenant-pasarela.dto';

// `skipNullProperties: false` (ver `UpdateRolDto`) cubre `ambiente` y
// `modoIntegracion`. No alcanza para `activo` y `prioridad`, que traen su
// propio `@IsOptional()` del alta y van a columnas NOT NULL: se redeclaran con
// `@ValidateIf`, que reemplaza la condición heredada y conserva sus
// validadores. `configuracion` es nullable.
//
// `declare` no es cosmético: sin él, con target ES2023, cada campo redeclarado
// existe en la instancia como propiedad propia en `undefined`, y un
// `Object.assign(entidad, dto)` lo copiaría —pasó en descuentos, ver
// `UpdateDescuentoDto`—. `declare` aplica el decorador sin emitir el campo.
export class UpdateTenantPasarelaDto extends PartialType(
  OmitType(CreateTenantPasarelaDto, ['pasarelaId'] as const),
  { skipNullProperties: false },
) {
  @ValidateIf((_o, v) => v !== undefined)
  declare activo?: boolean;

  @ValidateIf((_o, v) => v !== undefined)
  declare prioridad?: number;
}
