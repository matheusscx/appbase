import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ALLOWED_PAGE_SIZES,
  type ColorModePreference,
} from '../../../common/types/usuario-preferencias.interface';

// `@ValidateIf` y no `@IsOptional()`: `IsOptional` trata `null` igual que
// ausente, y el `null` pisaba la clave en el merge con lo guardado; la
// normalización lo cambiaba por el default (`light` / `15`), un 200 con la
// preferencia reseteada. Omitir una clave no toca lo guardado.
//
// `declare` no es cosmético: sin él, con target ES2023, la clave que no vino
// existe en la instancia como propiedad propia en `undefined`, el spread de
// `mergeUsuarioPreferencias` pisa lo guardado con ella y la normalización la
// vuelve default. Cambiar el tamaño de página reseteaba el modo oscuro.
class UiPreferenciasDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['light', 'dark'])
  declare colorMode?: ColorModePreference;

  @ValidateIf((_o, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @IsIn(ALLOWED_PAGE_SIZES)
  declare pageSize?: (typeof ALLOWED_PAGE_SIZES)[number];
}

// `ui` entero, igual: con `@IsOptional()` un `ui: null` pasaba como ausente y
// contestaba 200 sin haber hecho nada (el spread del merge ignora el `null`).
// `IsObject` además de `ValidateNested`: este deja pasar un array, el merge
// mete la clave "0" y la normalización la descarta; otro 200 sin hacer nada.
export class UpdatePreferenciasDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => UiPreferenciasDto)
  ui?: UiPreferenciasDto;
}
