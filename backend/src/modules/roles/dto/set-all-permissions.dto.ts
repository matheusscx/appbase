import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** Los permisos de UN módulo dentro de la llamada que guarda el rol entero. */
export class ModuloPermisosDto {
  @IsUUID('4')
  moduloTenantId: string;

  // Vacío es válido y desvincula el rol de ese módulo, igual que en
  // `SetPermissionsDto`.
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  moduloAppPermisoIds: string[];
}

/**
 * Guardar un rol es todo o nada (auditoría UX 07.11, owner 2026-10-16): la pantalla manda los
 * permisos de todos los módulos juntos y el backend los escribe en una transacción. Antes eran
 * hasta 16 `PUT` seguidos y uno que fallaba a mitad dejaba el rol a medias.
 */
export class SetAllPermissionsDto {
  @IsArray()
  // Los módulos que un tenant puede contratar; hoy son 16.
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ModuloPermisosDto)
  modulos: ModuloPermisosDto[];
}
